/**
 * 传输层统一抽象
 *
 * Modbus 的 PDU 与链路无关，因此把"怎么把字节送出去、怎么收回来"
 * 收敛到同一个接口，RTU(串口) / TCP(WebSocket 代理) / 模拟从站
 * 三种链路对上层完全等价。
 */

export type TransportState = 'closed' | 'connecting' | 'open' | 'closing'

export type TransportKind = 'serial' | 'websocket' | 'simulator'

/** 根据已收到的字节推断整帧长度；返回 null 表示还不能确定 */
export type FrameLengthResolver = (buf: Uint8Array) => number | null

export interface TransportEvents {
  /** 收到一个完整帧 */
  frame: (frame: Uint8Array) => void
  /** 收到无法构成合法帧的残留字节（超时冲刷），调试时很有用 */
  garbage: (bytes: Uint8Array) => void
  state: (state: TransportState) => void
  error: (error: Error) => void
}

export interface ITransport {
  readonly kind: TransportKind
  readonly state: TransportState
  open(): Promise<void>
  close(): Promise<void>
  /** 只发送，不等待响应 */
  send(frame: Uint8Array): Promise<void>
  /** 发送并等待一个完整响应帧 */
  request(frame: Uint8Array, timeoutMs: number): Promise<Uint8Array>
  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void
}

export class TransportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'TransportError'
  }
}

export class TimeoutError extends TransportError {
  constructor(ms: number) {
    super(`响应超时（${ms}ms 内未收到完整帧）`)
    this.name = 'TimeoutError'
  }
}
