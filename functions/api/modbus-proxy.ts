/**
 * Cloudflare Pages Function — Modbus TCP 中转
 * --------------------------------------------------------------------------
 * 浏览器无法直接建立原始 TCP 连接到 502 端口，这里由 Cloudflare 边缘节点
 * 代为建立 TCP 连接，并把字节双向透传给浏览器的 WebSocket。
 *
 * 子协议（必须与前端 src/core/transport/WebSocketTransport.ts 保持一致）：
 *   - 客户端连接：  /api/modbus-proxy?host=<目标IP>&port=<端口>[&token=<令牌>]
 *   - 控制帧：      文本帧，JSON { type: 'ready' | 'error' | 'closed', message? }
 *   - 数据帧：      二进制帧，原始 Modbus TCP 报文（含 MBAP 头）
 *
 * 安全（多人访问必看）：
 *   - 设了 PROXY_AUTH_TOKEN 环境变量后，客户端必须带 ?token= 且匹配，否则 401；
 *     不设置则不做令牌校验（便于本地/内网测试）。
 *   - 设了 ALLOWLIST 环境变量后，仅放行白名单内的目标（精确 IPv4 / IPv4 CIDR
 *     / 主机名后缀，逗号分隔），防止本 Function 被当作公网跳板；不设置则允许任意目标。
 *
 * 注意：本函数处于公网，只能访问「公网可直达」的设备；局域网内的 PLC 请用
 * 前端「本地直连」模式（local-proxy/modbus_relay.py，仅本地/局域网使用）。
 *
 * 部署要求：compatibility_flags 需包含 "sockets"（见 wrangler.toml / DEPLOY.md）。
 */

// @ts-ignore - cloudflare:sockets 仅在 Cloudflare 运行时可用，本地无类型
import { connect } from 'cloudflare:sockets'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface EnvLike {
  PROXY_AUTH_TOKEN?: string
  ALLOWLIST?: string
}

// 合并 Pages 注入的 env 与进程环境变量，提升可用性
function resolveEnv(context: any): EnvLike {
  const base =
    typeof process !== 'undefined' && process.env
      ? (process.env as Record<string, string | undefined>)
      : {}
  return { ...base, ...(context?.env ?? {}) } as EnvLike
}

/** 把 ALLOWLIST 解析为匹配函数；未设置返回 null（不限制） */
function parseAllowlist(raw: string | undefined): null | ((host: string) => boolean) {
  if (!raw) return null
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (entries.length === 0) return null
  return (host: string) => entries.some((e) => matchEntry(e, host))
}

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = (n << 8) | v
  }
  return n >>> 0
}

function matchCidr(cidr: string, host: string): boolean {
  const [net, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  if (!net || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const netLong = ipv4ToLong(net)
  const hostLong = ipv4ToLong(host)
  if (netLong === null || hostLong === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (netLong & mask) === (hostLong & mask)
}

function matchEntry(entry: string, host: string): boolean {
  if (entry.includes('/')) return matchCidr(entry, host)
  if (ipv4ToLong(entry) !== null) return entry === host
  // 主机名后缀：".example.com" 或 "example.com" 或 "plc.local"
  if (entry.startsWith('.')) return host.endsWith(entry) || host === entry.slice(1)
  return host === entry || host.endsWith('.' + entry)
}

function sendControl(ws: WebSocket, type: 'ready' | 'error' | 'closed', message?: string): void {
  try {
    ws.send(JSON.stringify(message ? { type, message } : { type }))
  } catch {
    /* 连接已断，忽略 */
  }
}

// Pages Functions 入口。context 在 Cloudflare 侧有完整类型，这里用宽松类型避免本地编译依赖。
export const onRequest = async (context: any): Promise<Response> => {
  const env = resolveEnv(context)
  const req: Request = context.request
  const upgrade = req.headers.get('upgrade')
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    return new Response('该接口仅用于 WebSocket 中转（Modbus TCP），请使用 ws(s):// 连接', {
      status: 400
    })
  }

  const url = new URL(req.url)
  const host = url.searchParams.get('host')
  const portRaw = url.searchParams.get('port') || '502'
  const port = parseInt(portRaw, 10)

  if (!host) {
    return new Response('缺少必填参数 host（目标设备 IP）', { status: 400 })
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return new Response('port 参数非法（应为 1-65535）', { status: 400 })
  }

  // 令牌校验：设置了 PROXY_AUTH_TOKEN 才强制校验
  const token = url.searchParams.get('token')
  if (env.PROXY_AUTH_TOKEN && token !== env.PROXY_AUTH_TOKEN) {
    return new Response('缺少或错误的访问令牌', { status: 401 })
  }

  // 目标白名单：设置了 ALLOWLIST 才强制校验
  const allowlist = parseAllowlist(env.ALLOWLIST)
  if (allowlist && !allowlist(host)) {
    return new Response(`目标 ${host} 不在 ALLOWLIST 白名单内`, { status: 403 })
  }

  // 一对互连的 WebSocket：client 交给浏览器，server 由本函数在边缘处理
  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()

  try {
    const socket = connect(`${host}:${port}`)

    // TCP 建立成功后通知浏览器，并开始把设备数据推回前端
    socket.opened
      .then(() => {
        sendControl(server, 'ready')

        const reader = socket.readable.getReader()
        const pump = async (): Promise<void> => {
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (value && value.byteLength > 0) server.send(value)
            }
            sendControl(server, 'closed')
            server.close()
          } catch (err) {
            sendControl(server, 'error', `设备连接中断：${errMsg(err)}`)
            server.close()
          }
        }
        pump()
      })
      .catch((err) => {
        sendControl(server, 'error', `无法连接到 ${host}:${port} —— ${errMsg(err)}`)
        server.close()
      })

    // 前端发来的请求 → 写入 TCP
    const writer = socket.writable.getWriter()
    server.addEventListener('message', (event: MessageEvent) => {
      // 控制帧（文本）忽略，只有二进制帧才是 Modbus 报文
      if (typeof event.data === 'string') return
      const chunk: Uint8Array =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array((event.data as Blob).arrayBuffer ? (event.data as Blob).arrayBuffer() : event.data)
      writer.write(chunk).catch(() => {
        /* 写失败通常是设备已断，错误会由 TCP 端捕获并通知前端 */
      })
    })

    server.addEventListener('close', () => {
      try {
        socket.close()
      } catch {
        /* 忽略 */
      }
    })
    server.addEventListener('error', () => {
      try {
        socket.close()
      } catch {
        /* 忽略 */
      }
    })
  } catch (err) {
    sendControl(server, 'error', `建立 TCP 中转失败：${errMsg(err)}`)
    server.close()
  }

  return new Response(null, { status: 101, webSocket: client })
}
