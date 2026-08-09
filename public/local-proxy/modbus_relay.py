#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Modbus TCP 本地代理 (WebSocket -> 原生 TCP 中继)
================================================

浏览器没有 raw socket 权限，无法直接连接 PLC 的 502 端口。
本脚本在本地起一个 WebSocket 服务（默认 ws://127.0.0.1:8765），
把浏览器发来的二进制帧原样转发到目标 PLC 的真实 TCP 端口，
再把 PLC 的响应原样回传。

子协议（与前端 src/core/transport/WebSocketTransport.ts 完全一致）：
  - 浏览器连接：  ws://<本机>:8765?host=<目标IP>&port=<端口>
  - 控制帧(代理->浏览器)：文本帧 JSON {type:'ready'|'error'|'closed', message?}
  - 数据帧：      二进制帧，原始 Modbus TCP 报文（含 MBAP 头）

纯标准库实现，零第三方依赖，Python 3.7+ 即可运行。
用法：  python modbus_relay.py [监听端口，默认 8765]
"""

import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import urllib.parse
from datetime import datetime

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# 日志文件与本脚本同目录，双击 bat 闪退时也可在此查看历史输出
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay.log")


def _write_log_file(line: str) -> None:
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def log(msg: str) -> None:
    now = datetime.now().strftime("%H:%M:%S")
    line = f"[{now}] {msg}"
    print(line, flush=True)
    _write_log_file(line)


def recv_exact(sock: socket.socket, n: int) -> bytes:
    """从 socket 精确读取 n 字节，连接关闭或出错返回 b''。"""
    if n <= 0:
        return b""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return b""
        buf.extend(chunk)
    return bytes(buf)


def parse_frame(sock: socket.socket):
    """解析一个 WebSocket 数据帧，返回 (fin, opcode, payload)，连接断开返回 None。"""
    header = recv_exact(sock, 2)
    if len(header) < 2:
        return None
    b0, b1 = header[0], header[1]
    fin = (b0 & 0x80) != 0
    opcode = b0 & 0x0F
    masked = (b1 & 0x80) != 0
    length = b1 & 0x7F
    if length == 126:
        ext = recv_exact(sock, 2)
        if len(ext) < 2:
            return None
        length = struct.unpack("!H", ext)[0]
    elif length == 127:
        ext = recv_exact(sock, 8)
        if len(ext) < 8:
            return None
        length = struct.unpack("!Q", ext)[0]
    if masked:
        mask = recv_exact(sock, 4)
        if len(mask) < 4:
            return None
    payload = recv_exact(sock, length)
    if len(payload) < length:
        return None
    if masked:
        payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
    return fin, opcode, payload


def build_frame(opcode: int, payload: bytes) -> bytes:
    """构造服务端 -> 客户端的帧（不加掩码）。"""
    b0 = 0x80 | (opcode & 0x0F)
    length = len(payload)
    if length < 126:
        header = bytes([b0, length])
    elif length < 65536:
        header = bytes([b0, 126]) + struct.pack("!H", length)
    else:
        header = bytes([b0, 127]) + struct.pack("!Q", length)
    return header + payload


def send_text(sock: socket.socket, obj) -> None:
    try:
        sock.sendall(build_frame(0x1, json.dumps(obj).encode("utf-8")))
    except OSError:
        pass


def send_binary(sock: socket.socket, data: bytes) -> None:
    try:
        sock.sendall(build_frame(0x2, data))
    except OSError:
        pass


def ws_handshake(conn: socket.socket):
    """完成 WebSocket 握手，解析查询参数，返回 (host, port)。失败返回 None。"""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            return None
        data += chunk
        if len(data) > 65536:
            return None
    header_text = data.split(b"\r\n\r\n", 1)[0].decode("utf-8", "replace")
    lines = header_text.split("\r\n")
    if not lines:
        return None
    try:
        _, path, _ = lines[0].split(" ", 2)
    except ValueError:
        return None
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    key = headers.get("sec-websocket-key")
    if not key:
        # 普通 HTTP GET（前端探活探针）：返回 200 让其通过，随后关闭，不建立 TCP 转发。
        body = b"modbus relay ok (ws-only upstream)"
        resp = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/plain\r\n"
            b"Access-Control-Allow-Origin: *\r\n"
            b"Connection: close\r\n"
            b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n"
            + body
        )
        try:
            conn.sendall(resp)
        except OSError:
            pass
        return None
    accept = base64.b64encode(
        hashlib.sha1((key + GUID).encode("utf-8")).digest()
    ).decode("ascii")
    resp = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n"
        "\r\n"
    )
    conn.sendall(resp.encode("utf-8"))
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    host = qs.get("host", ["127.0.0.1"])[0]
    try:
        port = int(qs.get("port", ["502"])[0])
    except ValueError:
        port = 502
    if not (1 <= port <= 65535):
        port = 502
    return host, port


def pump_ws_to_tcp(ws: socket.socket, tcp: socket.socket, stop: threading.Event) -> None:
    """读取浏览器 WebSocket 帧 -> 写入 PLC TCP。"""
    try:
        while not stop.is_set():
            frame = parse_frame(ws)
            if frame is None:
                break
            _, opcode, payload = frame
            if opcode == 0x8:  # close
                break
            elif opcode == 0x9:  # ping -> pong
                try:
                    ws.sendall(build_frame(0xA, payload))
                except OSError:
                    pass
            elif opcode in (0x1, 0x2):  # text / binary -> 转发到 TCP
                if payload:
                    tcp.sendall(payload)
    except OSError:
        pass
    finally:
        stop.set()
        try:
            tcp.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            tcp.close()
        except OSError:
            pass


def pump_tcp_to_ws(ws: socket.socket, tcp: socket.socket, stop: threading.Event) -> None:
    """读取 PLC TCP 响应 -> 通过 WebSocket 二进制帧回传。"""
    try:
        while not stop.is_set():
            data = tcp.recv(4096)
            if not data:
                send_text(ws, {"type": "closed", "message": "目标设备已断开连接"})
                break
            send_binary(ws, data)
    except OSError:
        pass
    finally:
        stop.set()
        try:
            ws.sendall(build_frame(0x8, b""))
        except OSError:
            pass
        try:
            ws.close()
        except OSError:
            pass


def handle_client(conn: socket.socket, addr) -> None:
    target = ws_handshake(conn)
    if not target:
        # 探活 GET 或握手失败：直接关闭，不记录（避免日志刷屏）
        try:
            conn.close()
        except OSError:
            pass
        return
    log(f"新连接来自 {addr[0]}:{addr[1]}")
    host, port = target
    log(f"请求转发到 {host}:{port}")

    try:
        tcp = socket.create_connection((host, port), timeout=5)
    except OSError as e:
        log(f"无法连接 {host}:{port} —— {e}")
        send_text(conn, {"type": "error", "message": f"无法连接目标 {host}:{port}：{e}"})
        try:
            conn.close()
        except OSError:
            pass
        return

    # create_connection 的 timeout 只应用于「建链」阶段；建链成功后必须改回阻塞模式，
    # 否则后续 recv 会在 5 秒无数据时抛超时，代理误判设备断开而关闭连接。
    tcp.settimeout(None)

    log(f"已建立 TCP 连接 {host}:{port}，开始透传")
    send_text(conn, {"type": "ready"})

    stop = threading.Event()
    t1 = threading.Thread(target=pump_ws_to_tcp, args=(conn, tcp, stop), daemon=True)
    t2 = threading.Thread(target=pump_tcp_to_ws, args=(conn, tcp, stop), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    log(f"连接 {host}:{port} 已结束")
    try:
        conn.close()
    except OSError:
        pass


def main() -> None:
    bind_host = "127.0.0.1"
    bind_port = 8765
    if len(sys.argv) > 1:
        try:
            bind_port = int(sys.argv[1])
        except ValueError:
            pass

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((bind_host, bind_port))
    server.listen(16)
    log(f"=== local proxy started at ws://{bind_host}:{bind_port} ===")
    log("浏览器在「本地直连」模式连接前，请保持此窗口打开。按 Ctrl+C 退出。")
    try:
        while True:
            conn, addr = server.accept()
            threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()
    except KeyboardInterrupt:
        log("正在关闭…")
    finally:
        server.close()


if __name__ == "__main__":
    main()
