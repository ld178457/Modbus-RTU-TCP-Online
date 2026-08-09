/**
 * 传输层基类：负责字节流 → 完整帧的切分，以及请求/响应配对。
 *
 * 这里解决了原实现最严重的两个问题：
 *   1. 原代码每次发送后只 read() 一次就 cancel，响应被分包时直接丢数据；
 *      现在维护持久缓冲区，按协议结构累积到完整帧才交付。
 *   2. 原代码没有超时机制，从站不响应时界面会静默卡死；
 *      现在有请求超时 + 帧间隔冲刷双重保护。
 */

import {
  FrameLengthResolver,
  ITransport,
  TimeoutError,
  TransportEvents,
  TransportKind,
  TransportState
} from './types'

interface PendingRequest {
  resolve: (frame: Uint8Array) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export abstract class BaseTransport implements ITransport {
  abstract readonly kind: TransportKind

  protected _state: TransportState = 'closed'
  /** 接收缓冲区：跨 chunk 累积，直到能切出完整帧 */
  private buffer = new Uint8Array(0)
  private pending: PendingRequest | null = null
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Map<keyof TransportEvents, Set<(...args: never[]) => void>>()

  /**
   * @param resolveFrameLength 帧长度推断函数（RTU 按协议结构，TCP 按 MBAP 长度字段）
   * @param gapMs 帧间隔冲刷时间：超过这个时间没有新字节，就认为当前帧结束
   */
  constructor(
    protected resolveFrameLength: FrameLengthResolver,
    protected gapMs = 20
  ) {}

  get state(): TransportState {
    return this._state
  }

  // ------------------------------------------------------------ 子类实现
  protected abstract doOpen(): Promise<void>
  protected abstract doClose(): Promise<void>
  protected abstract doSend(frame: Uint8Array): Promise<void>

  // ------------------------------------------------------------ 生命周期
  async open(): Promise<void> {
    if (this._state === 'open' || this._state === 'connecting') return
    this.setState('connecting')
    try {
      await this.doOpen()
      this.setState('open')
    } catch (err) {
      this.setState('closed')
      throw err
    }
  }

  async close(): Promise<void> {
    if (this._state === 'closed' || this._state === 'closing') return
    this.setState('closing')
    this.clearGapTimer()
    this.failPending(new Error('连接已关闭'))
    try {
      await this.doClose()
    } finally {
      this.buffer = new Uint8Array(0)
      this.setState('closed')
    }
  }

  // ------------------------------------------------------------ 收发
  async send(frame: Uint8Array): Promise<void> {
    if (this._state !== 'open') throw new Error('链路未连接')
    await this.doSend(frame)
  }

  request(frame: Uint8Array, timeoutMs = 1000): Promise<Uint8Array> {
    if (this._state !== 'open') return Promise.reject(new Error('链路未连接'))

    // 同一时刻只允许一个在途请求：Modbus 是严格的一问一答协议
    if (this.pending) {
      this.failPending(new Error('已被新请求取代'))
    }
    // 发新请求前丢弃上一轮的残留字节，避免串帧
    this.buffer = new Uint8Array(0)

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        // 超时也把缓冲区里的残片抛出来，方便排查"收到了但格式不对"的情况
        if (this.buffer.length > 0) {
          this.emit('garbage', this.buffer.slice())
          this.buffer = new Uint8Array(0)
        }
        reject(new TimeoutError(timeoutMs))
      }, timeoutMs)

      this.pending = { resolve, reject, timer }

      this.doSend(frame).catch((err) => {
        clearTimeout(timer)
        this.pending = null
        reject(err)
      })
    })
  }

  // ------------------------------------------------------------ 字节流处理
  /** 子类收到原始字节后调用 */
  protected handleBytes(chunk: Uint8Array): void {
    if (chunk.length === 0) return

    const merged = new Uint8Array(this.buffer.length + chunk.length)
    merged.set(this.buffer, 0)
    merged.set(chunk, this.buffer.length)
    this.buffer = merged

    this.drainFrames()

    // 还有残留字节时启动冲刷定时器：
    // 可能是非标准帧或数据不完整，等一个帧间隔后交给上层展示
    if (this.buffer.length > 0) {
      this.restartGapTimer()
    } else {
      this.clearGapTimer()
    }
  }

  /** 从缓冲区尽可能多地切出完整帧 */
  private drainFrames(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.buffer.length === 0) return
      const expected = this.resolveFrameLength(this.buffer)
      if (expected === null || this.buffer.length < expected) return

      const frame = this.buffer.slice(0, expected)
      this.buffer = this.buffer.slice(expected)
      this.deliverFrame(frame)
    }
  }

  private deliverFrame(frame: Uint8Array): void {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      const { resolve } = this.pending
      this.pending = null
      resolve(frame)
    }
    this.emit('frame', frame)
  }

  private restartGapTimer(): void {
    this.clearGapTimer()
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null
      if (this.buffer.length === 0) return
      const leftover = this.buffer.slice()
      this.buffer = new Uint8Array(0)
      // 长度可推断说明只是没收全，交给超时逻辑处理；否则当作非法数据抛出
      this.emit('garbage', leftover)
    }, this.gapMs)
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer)
      this.gapTimer = null
    }
  }

  private failPending(err: Error): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    const { reject } = this.pending
    this.pending = null
    reject(err)
  }

  // ------------------------------------------------------------ 事件
  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler as (...args: never[]) => void)
    return () => set!.delete(handler as (...args: never[]) => void)
  }

  protected emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    const set = this.listeners.get(event)
    if (!set) return
    set.forEach((fn) => {
      try {
        ;(fn as (...a: unknown[]) => void)(...args)
      } catch (err) {
        console.error(`[transport] 事件处理器异常 (${String(event)}):`, err)
      }
    })
  }

  protected setState(state: TransportState): void {
    if (this._state === state) return
    this._state = state
    this.emit('state', state)
  }

  protected handleError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err))
    this.failPending(error)
    this.emit('error', error)
  }
}
