/**
 * Web Serial 串口传输（Modbus RTU）
 *
 * 注意：Web Serial API 仅在安全上下文（HTTPS 或 localhost）下可用，
 * 且目前只有 Chromium 系浏览器支持（Chrome / Edge / Opera 89+）。
 */

import { BaseTransport } from './BaseTransport'
import { TransportError, TransportKind } from './types'
import { expectedRtuFrameLength, rtuFrameGapMs } from '../modbus/codec'

export interface SerialOptions {
  baudRate: number
  dataBits: 7 | 8
  stopBits: 1 | 2
  parity: 'none' | 'even' | 'odd'
  flowControl: 'none' | 'hardware'
  bufferSize?: number
}

export interface SerialSupport {
  supported: boolean
  reason?: string
  solution?: string
}

/** 检测当前环境是否可用 Web Serial */
export function checkSerialSupport(): SerialSupport {
  if (typeof navigator === 'undefined') {
    return { supported: false, reason: '非浏览器环境', solution: '请在浏览器中打开本页面' }
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: '当前页面不是安全上下文（需要 HTTPS）',
      solution: '请通过 https:// 或 http://localhost 访问'
    }
  }
  if (!('serial' in navigator)) {
    return {
      supported: false,
      reason: '当前浏览器不支持 Web Serial API',
      solution: '请使用 Chrome / Edge / Opera 89 及以上版本（Firefox 与 Safari 暂不支持）'
    }
  }
  return { supported: true }
}

/** 生成串口的可读名称：Web Serial 出于隐私不暴露 COM 号 */
export function describePort(port: SerialPort, index = 0): string {
  const info = port.getInfo?.() ?? {}
  const vid = info.usbVendorId
  const pid = info.usbProductId
  if (vid !== undefined && pid !== undefined) {
    const hex = (n: number) => n.toString(16).padStart(4, '0').toUpperCase()
    return `USB 串口 (VID:${hex(vid)} PID:${hex(pid)})`
  }
  // 虚拟串口 / 板载串口的 getInfo() 通常返回空对象
  return `串口设备 #${index + 1}`
}

export class SerialTransport extends BaseTransport {
  readonly kind: TransportKind = 'serial'

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoopPromise: Promise<void> | null = null
  private closing = false

  constructor(
    private port: SerialPort,
    private options: SerialOptions
  ) {
    // RTU 依靠 3.5 字符的静默间隔判定帧结束。
    // 浏览器的调度精度有限，这里给一个不小于 8ms 的下限以避免误切帧。
    super(
      expectedRtuFrameLength,
      Math.max(
        8,
        Math.ceil(
          rtuFrameGapMs(options.baudRate, options.dataBits, options.stopBits, options.parity) * 2
        )
      )
    )
  }

  protected async doOpen(): Promise<void> {
    this.closing = false
    try {
      await this.port.open({
        baudRate: this.options.baudRate,
        dataBits: this.options.dataBits,
        stopBits: this.options.stopBits,
        parity: this.options.parity,
        flowControl: this.options.flowControl,
        bufferSize: this.options.bufferSize ?? 4096
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already open/i.test(msg)) {
        throw new TransportError('该串口已被打开，请先断开或关闭占用它的其他程序', err)
      }
      if (/Access denied|Failed to open/i.test(msg)) {
        throw new TransportError(
          '无法打开串口：可能已被其他程序占用（如串口助手、组态软件），请先关闭它们',
          err
        )
      }
      throw new TransportError(`打开串口失败：${msg}`, err)
    }

    if (!this.port.writable) {
      throw new TransportError('串口已打开但不可写')
    }
    this.writer = this.port.writable.getWriter()
    // 持续读取，不阻塞 open()
    this.readLoopPromise = this.readLoop()
  }

  protected async doClose(): Promise<void> {
    this.closing = true

    // 先取消 reader，让 read() 立刻返回，读循环才能退出
    if (this.reader) {
      try {
        await this.reader.cancel()
      } catch {
        /* 取消时的异常无需处理 */
      }
    }
    if (this.readLoopPromise) {
      try {
        await this.readLoopPromise
      } catch {
        /* 读循环内部已处理 */
      }
      this.readLoopPromise = null
    }
    if (this.writer) {
      try {
        this.writer.releaseLock()
      } catch {
        /* 忽略 */
      }
      this.writer = null
    }
    try {
      await this.port.close()
    } catch (err) {
      console.warn('[serial] 关闭串口时出现异常:', err)
    }
  }

  protected async doSend(frame: Uint8Array): Promise<void> {
    if (!this.writer) throw new TransportError('串口未打开')
    await this.writer.write(frame)
  }

  /**
   * 持续读取循环。
   * 外层 while 用于在流意外中断后重新获取 reader（例如设备短暂断连）。
   */
  private async readLoop(): Promise<void> {
    while (!this.closing && this.port.readable) {
      let reader: ReadableStreamDefaultReader<Uint8Array>
      try {
        reader = this.port.readable.getReader()
      } catch {
        // readable 已被锁定，说明另有读者，直接退出
        break
      }
      this.reader = reader

      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.length > 0) {
            this.handleBytes(value)
          }
        }
      } catch (err) {
        if (!this.closing) {
          this.handleError(new TransportError('串口读取中断，设备可能已拔出', err))
        }
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* 忽略 */
        }
        this.reader = null
      }

      if (this.closing) break
    }
  }
}
