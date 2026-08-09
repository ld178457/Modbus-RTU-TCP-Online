/**
 * Modbus 调试通道组合式函数
 *
 * 把「传输层 + 协议编解码 + 状态记录」串成一条完整链路，
 * RTU 页面与 TCP 页面共用同一份逻辑，只在建链方式和帧格式上有差异。
 */

import { computed, onBeforeUnmount, shallowRef } from 'vue'
import { useStore } from 'vuex'
import type { ITransport } from '@/core/transport/types'
import { TimeoutError } from '@/core/transport/types'
import {
  RequestOptions,
  buildRtuFrame,
  buildTcpFrame,
  parseRtuResponse,
  parseTcpResponse,
  wrapRtu,
  wrapTcp
} from '@/core/modbus/codec'
import { bytesToAscii, bytesToHex } from '@/core/modbus/format'
import { getFunctionMeta } from '@/core/modbus/constants'

export type Framing = 'rtu' | 'tcp'
export type ChannelName = 'rtu' | 'tcp'

export interface ExecuteResult {
  ok: boolean
  error?: string
  rttMs: number
}

export function useModbusChannel(channel: ChannelName, framing: Framing) {
  const store = useStore()
  // 传输层实例是纯 JS 对象且内部有大量非响应式字段，
  // 用 shallowRef 避免 Vue 递归代理带来的性能损耗与潜在错误
  const transport = shallowRef<ITransport | null>(null)

  let transactionId = 0
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let inFlight = false
  const disposers: (() => void)[] = []

  const connected = computed<boolean>(() => store.getters[`${channel}/connected`])
  const connecting = computed<boolean>(() => store.getters[`${channel}/connecting`])
  const stats = computed(() => store.getters[`${channel}/stats`])
  const polling = computed(() => pollTimer !== null)

  const dispatch = (action: string, payload?: unknown) =>
    store.dispatch(`${channel}/${action}`, payload)

  function logInfo(note: string) {
    void dispatch('pushLog', { dir: 'info', hex: '', note })
  }

  function logError(note: string) {
    void dispatch('pushLog', { dir: 'error', hex: '', note })
  }

  // ------------------------------------------------------------ 连接管理

  async function connect(instance: ITransport): Promise<void> {
    await disconnect()
    void dispatch('setConnecting', true)

    try {
      // 订阅传输层事件：主动上报、异常、非法数据都要能看到
      disposers.push(
        instance.on('garbage', (bytes) => {
          void dispatch('pushLog', {
            dir: 'error',
            hex: bytesToHex(bytes),
            ascii: bytesToAscii(bytes),
            size: bytes.length,
            note: '无法识别的数据（长度或格式不符合协议，已按帧间隔超时冲刷）'
          })
        })
      )
      disposers.push(
        instance.on('error', (err) => {
          void dispatch('setError', err.message)
          logError(err.message)
        })
      )
      disposers.push(
        instance.on('state', (state) => {
          void dispatch('setConnected', state === 'open')
        })
      )

      await instance.open()
      transport.value = instance
      void dispatch('setConnected', true)
      void dispatch('setError', '')
      return
    } catch (err) {
      cleanupListeners()
      void dispatch('setConnected', false)
      throw err
    } finally {
      void dispatch('setConnecting', false)
    }
  }

  async function disconnect(): Promise<void> {
    stopPolling()
    const t = transport.value
    transport.value = null
    cleanupListeners()
    if (t) {
      try {
        await t.close()
      } catch (err) {
        console.warn('[modbus] 关闭链路异常:', err)
      }
    }
    void dispatch('setConnected', false)
  }

  function cleanupListeners() {
    disposers.splice(0).forEach((off) => off())
  }

  // ------------------------------------------------------------ 请求执行

  function nextTransactionId(): number {
    transactionId = (transactionId + 1) & 0xffff
    return transactionId
  }

  /** 组装请求帧 */
  function buildFrame(opts: RequestOptions): { frame: Uint8Array; tid: number } {
    if (framing === 'tcp') {
      const tid = nextTransactionId()
      return { frame: buildTcpFrame(opts, tid), tid }
    }
    return { frame: buildRtuFrame(opts), tid: 0 }
  }

  /** 预览请求帧（不发送），用于界面实时显示待发报文 */
  function previewFrame(opts: RequestOptions): string {
    try {
      const frame =
        framing === 'tcp'
          ? buildTcpFrame(opts, (transactionId + 1) & 0xffff)
          : buildRtuFrame(opts)
      return bytesToHex(frame)
    } catch (err) {
      return err instanceof Error ? `<${err.message}>` : ''
    }
  }

  /**
   * 发送一次请求并等待响应
   */
  async function execute(opts: RequestOptions, timeoutMs = 1000): Promise<ExecuteResult> {
    const t = transport.value
    if (!t) {
      const msg = '尚未建立连接'
      logError(msg)
      return { ok: false, error: msg, rttMs: 0 }
    }
    if (inFlight) {
      return { ok: false, error: '上一条请求尚未完成', rttMs: 0 }
    }

    inFlight = true
    const started = performance.now()

    try {
      const { frame } = buildFrame(opts)
      const meta = getFunctionMeta(opts.functionCode)

      void dispatch('pushLog', {
        dir: 'tx',
        hex: bytesToHex(frame),
        ascii: bytesToAscii(frame),
        size: frame.length,
        note: meta?.label ?? ''
      })
      void dispatch('countSent')

      const response = await t.request(frame, timeoutMs)
      const rttMs = Math.round(performance.now() - started)

      const parsed =
        framing === 'tcp'
          ? parseTcpResponse(response, opts.unitId)
          : parseRtuResponse(response, opts.unitId)

      void dispatch('pushLog', {
        dir: parsed.ok ? 'rx' : 'error',
        hex: bytesToHex(response),
        ascii: bytesToAscii(response),
        size: response.length,
        rttMs,
        note: parsed.ok
          ? describeSuccess(parsed.bits?.length, parsed.registers?.length, parsed.echoValue)
          : parsed.error ?? '解析失败'
      })

      if (parsed.ok) {
        void dispatch('countReceived', rttMs)
        void dispatch('setResponse', {
          bits: parsed.bits,
          registers: parsed.registers,
          startAddress: opts.startAddress,
          functionCode: opts.functionCode,
          fields: parsed.fields
        })
        return { ok: true, rttMs }
      }

      void dispatch('countError')
      void dispatch('setError', parsed.error ?? '解析失败')
      // 异常响应也要展示字段拆解，便于定位问题
      void dispatch('setResponse', {
        bits: [],
        registers: [],
        startAddress: opts.startAddress,
        functionCode: opts.functionCode,
        fields: parsed.fields
      })
      return { ok: false, error: parsed.error, rttMs }
    } catch (err) {
      const rttMs = Math.round(performance.now() - started)
      const isTimeout = err instanceof TimeoutError
      const message = err instanceof Error ? err.message : String(err)

      if (isTimeout) void dispatch('countTimeout')
      else void dispatch('countError')

      void dispatch('setError', message)
      logError(
        isTimeout
          ? `${message}${framing === 'rtu' ? '（检查从站地址、波特率、接线 A/B 是否接反）' : '（检查目标 IP、端口与设备是否在线）'}`
          : message
      )
      return { ok: false, error: message, rttMs }
    } finally {
      inFlight = false
    }
  }

  /**
   * 发送自定义报文
   * @param pduHexOrFull 用户输入的十六进制
   * @param mode 'auto' 表示由程序补全地址/MBAP 与校验，'raw' 表示原样发送
   */
  async function executeRaw(
    pdu: Uint8Array,
    unitId: number,
    mode: 'auto' | 'raw',
    timeoutMs = 1000
  ): Promise<ExecuteResult> {
    const t = transport.value
    if (!t) return { ok: false, error: '尚未建立连接', rttMs: 0 }
    if (inFlight) return { ok: false, error: '上一条请求尚未完成', rttMs: 0 }

    inFlight = true
    const started = performance.now()

    try {
      let frame: Uint8Array
      if (mode === 'raw') {
        frame = pdu
      } else if (framing === 'tcp') {
        frame = wrapTcp(unitId, pdu, nextTransactionId())
      } else {
        frame = wrapRtu(unitId, pdu)
      }

      void dispatch('pushLog', {
        dir: 'tx',
        hex: bytesToHex(frame),
        ascii: bytesToAscii(frame),
        size: frame.length,
        note: mode === 'raw' ? '自定义报文（原样发送）' : '自定义报文（自动补全校验）'
      })
      void dispatch('countSent')

      const response = await t.request(frame, timeoutMs)
      const rttMs = Math.round(performance.now() - started)
      const parsed =
        framing === 'tcp' ? parseTcpResponse(response) : parseRtuResponse(response)

      void dispatch('pushLog', {
        dir: parsed.ok ? 'rx' : 'error',
        hex: bytesToHex(response),
        ascii: bytesToAscii(response),
        size: response.length,
        rttMs,
        note: parsed.ok ? '响应正常' : parsed.error ?? '解析失败'
      })

      if (parsed.ok) void dispatch('countReceived', rttMs)
      else void dispatch('countError')

      void dispatch('setResponse', {
        bits: parsed.bits,
        registers: parsed.registers,
        startAddress: 0,
        functionCode: parsed.functionCode,
        fields: parsed.fields
      })

      return { ok: parsed.ok, error: parsed.error, rttMs }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof TimeoutError) void dispatch('countTimeout')
      else void dispatch('countError')
      logError(message)
      return { ok: false, error: message, rttMs: Math.round(performance.now() - started) }
    } finally {
      inFlight = false
    }
  }

  // ------------------------------------------------------------ 轮询

  function startPolling(getOptions: () => RequestOptions, intervalMs: number, timeoutMs: number) {
    stopPolling()
    // 立即执行一次，避免用户等待一个周期才看到数据
    void execute(getOptions(), timeoutMs)
    pollTimer = setInterval(() => {
      // 上一轮未结束就跳过本轮，防止请求堆积
      if (inFlight) return
      void execute(getOptions(), timeoutMs)
    }, Math.max(20, intervalMs))
    logInfo(`开始轮询，周期 ${intervalMs}ms`)
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
      logInfo('停止轮询')
    }
  }

  onBeforeUnmount(() => {
    stopPolling()
    void disconnect()
  })

  return {
    transport,
    connected,
    connecting,
    stats,
    polling,
    connect,
    disconnect,
    execute,
    executeRaw,
    previewFrame,
    startPolling,
    stopPolling,
    logInfo,
    logError
  }
}

function describeSuccess(bitCount?: number, regCount?: number, echoValue?: number): string {
  if (bitCount) return `读取成功，返回 ${bitCount} 个位`
  if (regCount) return `读取成功，返回 ${regCount} 个寄存器`
  if (echoValue !== undefined) return '写入成功，从站已回显确认'
  return '响应正常'
}
