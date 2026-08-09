/**
 * WebSocket ↔ TCP 传输（Modbus TCP）
 *
 * 浏览器没有 raw socket 权限，无法直接连接 502 端口，
 * 必须经由一个 WebSocket 中转。本类同时服务两种中转端：
 *
 *   1. Cloudflare Pages Function（functions/api/modbus-proxy.ts）
 *      —— 部署后零配置可用，但只能访问公网可达的设备
 *
 * 两端使用完全相同的子协议：
 *   连接:  ws(s)://<中转地址>?host=<目标IP>&port=<端口>
 *   控制:  文本帧，JSON  { type: 'ready' | 'error' | 'closed', message?: string }
 *   数据:  二进制帧，原始 Modbus TCP 报文双向透传
 */

import { BaseTransport } from './BaseTransport'
import { TransportError, TransportKind } from './types'
import { expectedTcpFrameLength } from '../modbus/codec'

export interface WebSocketTransportOptions {
  /** 中转服务地址，如 wss://your.pages.dev/api/modbus-proxy 或 ws://127.0.0.1:8765 */
  bridgeUrl: string
  /** 目标 Modbus TCP 设备地址 */
  host: string
  port: number
  /** 建链超时 */
  connectTimeoutMs?: number
}

interface ControlMessage {
  type: 'ready' | 'error' | 'closed'
  message?: string
}

export class WebSocketTransport extends BaseTransport {
  readonly kind: TransportKind = 'websocket'

  private ws: WebSocket | null = null
  private closing = false

  constructor(private options: WebSocketTransportOptions) {
    // TCP 有 MBAP 长度字段，帧边界明确，冲刷时间给宽松些即可
    super(expectedTcpFrameLength, 50)
  }

  private buildUrl(): string {
    const { bridgeUrl, host, port } = this.options
    let base = bridgeUrl.trim()

    // 允许用户填 https:// 开头的地址，自动换成 wss://
    if (base.startsWith('https://')) base = 'wss://' + base.slice(8)
    else if (base.startsWith('http://')) base = 'ws://' + base.slice(7)
    else if (!/^wss?:\/\//.test(base)) {
      // 相对路径：跟随当前页面协议，便于部署到 Pages 后直接用 /api/modbus-proxy
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      base = `${proto}//${window.location.host}${base.startsWith('/') ? '' : '/'}${base}`
    }

    const url = new URL(base)
    url.searchParams.set('host', host)
    url.searchParams.set('port', String(port))
    return url.toString()
  }

  protected doOpen(): Promise<void> {
    const url = this.buildUrl()
    const timeoutMs = this.options.connectTimeoutMs ?? 10000
    this.closing = false

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let ws: WebSocket

      try {
        ws = new WebSocket(url)
      } catch (err) {
        reject(new TransportError(`WebSocket 地址无效：${url}`, err))
        return
      }

      ws.binaryType = 'arraybuffer'
      this.ws = ws

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          ws.close()
        } catch {
          /* 忽略 */
        }
        reject(
          new TransportError(
            `连接中转服务超时（${timeoutMs}ms）。请确认中转地址可达：${url}`
          )
        )
      }, timeoutMs)

      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        err ? reject(err) : resolve()
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          let msg: ControlMessage
          try {
            msg = JSON.parse(ev.data) as ControlMessage
          } catch {
            return
          }
          if (msg.type === 'ready') {
            finish()
          } else if (msg.type === 'error') {
            const error = new TransportError(msg.message || '中转服务报告错误')
            if (settled) this.handleError(error)
            else finish(error)
          } else if (msg.type === 'closed') {
            if (!this.closing) {
              this.handleError(new TransportError(msg.message || '目标设备已断开连接'))
              void this.close()
            }
          }
          return
        }

        // 二进制帧：原始 Modbus 报文
        if (ev.data instanceof ArrayBuffer) {
          this.handleBytes(new Uint8Array(ev.data))
        }
      }

      ws.onerror = () => {
        const error = new TransportError(
          `无法连接中转服务 ${url}。` +
            '若使用本地直连，请确认 local-proxy 已启动（start-proxy.bat）；若使用云代理，请确认已部署 Functions。'
        )
        if (settled) this.handleError(error)
        else finish(error)
      }

      ws.onclose = (ev: CloseEvent) => {
        if (!settled) {
          finish(
            new TransportError(
              ev.reason
                ? `中转服务拒绝连接：${ev.reason}`
                : `中转服务关闭了连接（code ${ev.code}）`
            )
          )
          return
        }
        if (!this.closing) {
          this.handleError(new TransportError(ev.reason || '连接已被远端关闭'))
          this.setState('closed')
        }
      }
    })
  }

  protected async doClose(): Promise<void> {
    this.closing = true
    const ws = this.ws
    this.ws = null
    if (!ws) return
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.close(1000, 'client closing')
      } catch {
        /* 忽略 */
      }
    }
  }

  protected async doSend(frame: Uint8Array): Promise<void> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new TransportError('WebSocket 未连接')
    }
    // 复制一份，避免底层复用 buffer 造成数据错乱
    ws.send(frame.slice().buffer)
  }
}
