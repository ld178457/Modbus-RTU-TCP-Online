/**
 * 内置模拟从站
 *
 * 完全运行在浏览器内，不需要任何真实设备或后端服务。
 * 用途：
 *   - 部署到公网后，任何访客打开即可体验完整的收发流程
 *   - 学习 Modbus 报文结构、验证上位机逻辑
 *   - 在没有 PLC 的情况下调试界面
 *
 * 它实现了一个真实的从站数据模型（四个地址空间 + 异常响应），
 * 并按 RTU 或 TCP 的帧格式作答，因此上层代码无需任何分支。
 */

import { BaseTransport } from './BaseTransport'
import { TransportKind } from './types'
import {
  expectedRtuFrameLength,
  expectedTcpFrameLength
} from '../modbus/codec'
import { appendCrc16, verifyCrc16 } from '../modbus/crc'
import { FUNCTION_CODE } from '../modbus/constants'

export type SimulatorMode = 'rtu' | 'tcp'

export interface SimulatorOptions {
  mode: SimulatorMode
  unitId?: number
  /** 模拟响应延迟(ms)，用来体现真实链路的往返时间 */
  responseDelayMs?: number
  /** 模拟丢包率 0~1，用于测试超时重试逻辑 */
  packetLossRate?: number
  /** 地址空间大小 */
  size?: number
}

/** 从站数据区大小上限，覆盖常见调试范围 */
const DEFAULT_SIZE = 2000

export class SimulatorTransport extends BaseTransport {
  readonly kind: TransportKind = 'simulator'

  readonly coils: Uint8Array
  readonly discreteInputs: Uint8Array
  readonly holdingRegisters: Uint16Array
  readonly inputRegisters: Uint16Array

  private tickTimer: ReturnType<typeof setInterval> | null = null
  private tick = 0
  private readonly size: number

  constructor(private options: SimulatorOptions) {
    super(
      options.mode === 'tcp' ? expectedTcpFrameLength : expectedRtuFrameLength,
      options.mode === 'tcp' ? 50 : 10
    )
    this.size = options.size ?? DEFAULT_SIZE
    this.coils = new Uint8Array(this.size)
    this.discreteInputs = new Uint8Array(this.size)
    this.holdingRegisters = new Uint16Array(this.size)
    this.inputRegisters = new Uint16Array(this.size)
    this.seed()
  }

  /** 预置一些有辨识度的初始值，便于第一次读取就能看到内容 */
  private seed(): void {
    for (let i = 0; i < 32; i++) {
      this.holdingRegisters[i] = (i + 1) * 100
      this.coils[i] = i % 3 === 0 ? 1 : 0
      this.discreteInputs[i] = i % 2 === 0 ? 1 : 0
    }
    // 0x0000 起放一个可识别的标志串 "MODBUS-SIM"
    const tag = 'MODBUS-SIM'
    for (let i = 0; i < tag.length; i += 2) {
      this.holdingRegisters[100 + i / 2] =
        (tag.charCodeAt(i) << 8) | (tag.charCodeAt(i + 1) || 0x20)
    }
  }

  protected async doOpen(): Promise<void> {
    this.tick = 0
    // 让输入寄存器与离散输入持续变化，界面看起来才像连着真实设备
    this.tickTimer = setInterval(() => this.updateLiveData(), 200)
  }

  protected async doClose(): Promise<void> {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  /** 生成随时间变化的过程量 */
  private updateLiveData(): void {
    this.tick++
    const t = this.tick / 5

    // 0: 正弦波（0~65535）
    this.inputRegisters[0] = Math.round((Math.sin(t) * 0.5 + 0.5) * 65535)
    // 1: 递增计数器
    this.inputRegisters[1] = this.tick & 0xffff
    // 2: 模拟温度 ×10，25.0 ~ 35.0 ℃
    this.inputRegisters[2] = Math.round((25 + Math.sin(t / 3) * 5) * 10)
    // 3: 模拟压力 ×100
    this.inputRegisters[3] = Math.round((1.01 + Math.cos(t / 4) * 0.05) * 10000)
    // 4-5: 单精度浮点流量值（大端 ABCD）
    const flow = 12.5 + Math.sin(t / 2) * 3.2
    const buf = new DataView(new ArrayBuffer(4))
    buf.setFloat32(0, flow, false)
    this.inputRegisters[4] = buf.getUint16(0, false)
    this.inputRegisters[5] = buf.getUint16(2, false)

    // 离散输入：跑马灯
    for (let i = 0; i < 16; i++) {
      this.discreteInputs[i] = i === this.tick % 16 ? 1 : 0
    }
  }

  protected async doSend(frame: Uint8Array): Promise<void> {
    // 模拟丢包：直接不作答，让上层走超时分支
    const loss = this.options.packetLossRate ?? 0
    if (loss > 0 && Math.random() < loss) return

    const response = this.buildResponse(frame)
    if (!response) return

    const delay = this.options.responseDelayMs ?? 30
    setTimeout(() => {
      if (this.state === 'open') this.handleBytes(response)
    }, delay)
  }

  // ------------------------------------------------------------ 报文处理

  private buildResponse(frame: Uint8Array): Uint8Array | null {
    if (this.options.mode === 'tcp') {
      if (frame.length < 8) return null
      const transactionId = (frame[0] << 8) | frame[1]
      const unitId = frame[6]
      const pdu = frame.subarray(7)
      const respPdu = this.handlePdu(pdu)
      const length = respPdu.length + 1
      const mbap = Uint8Array.from([
        (transactionId >> 8) & 0xff,
        transactionId & 0xff,
        0,
        0,
        (length >> 8) & 0xff,
        length & 0xff,
        unitId
      ])
      return concat(mbap, respPdu)
    }

    // RTU：先验 CRC，校验失败的帧真实从站会直接丢弃
    if (frame.length < 4 || !verifyCrc16(frame)) return null
    const unitId = frame[0]
    const pdu = frame.subarray(1, frame.length - 2)
    const respPdu = this.handlePdu(pdu)
    // 广播地址 0 不作答，符合协议规定
    if (unitId === 0) return null
    return appendCrc16(concat(Uint8Array.from([unitId]), respPdu))
  }

  /** 处理 PDU 并生成响应 PDU */
  private handlePdu(pdu: Uint8Array): Uint8Array {
    const fc = pdu[0]

    try {
      switch (fc) {
        case FUNCTION_CODE.READ_COILS:
          return this.readBits(fc, pdu, this.coils)
        case FUNCTION_CODE.READ_DISCRETE_INPUTS:
          return this.readBits(fc, pdu, this.discreteInputs)
        case FUNCTION_CODE.READ_HOLDING_REGISTERS:
          return this.readWords(fc, pdu, this.holdingRegisters)
        case FUNCTION_CODE.READ_INPUT_REGISTERS:
          return this.readWords(fc, pdu, this.inputRegisters)
        case FUNCTION_CODE.WRITE_SINGLE_COIL:
          return this.writeSingleCoil(pdu)
        case FUNCTION_CODE.WRITE_SINGLE_REGISTER:
          return this.writeSingleRegister(pdu)
        case FUNCTION_CODE.WRITE_MULTIPLE_COILS:
          return this.writeMultipleCoils(pdu)
        case FUNCTION_CODE.WRITE_MULTIPLE_REGISTERS:
          return this.writeMultipleRegisters(pdu)
        default:
          return exception(fc, 0x01) // 非法功能码
      }
    } catch (err) {
      const code = err instanceof SimException ? err.code : 0x04
      return exception(fc, code)
    }
  }

  private readBits(fc: number, pdu: Uint8Array, space: Uint8Array): Uint8Array {
    const addr = (pdu[1] << 8) | pdu[2]
    const qty = (pdu[3] << 8) | pdu[4]
    if (qty < 1 || qty > 2000) throw new SimException(0x03)
    if (addr + qty > this.size) throw new SimException(0x02)

    const byteCount = Math.ceil(qty / 8)
    const out = new Uint8Array(2 + byteCount)
    out[0] = fc
    out[1] = byteCount
    for (let i = 0; i < qty; i++) {
      if (space[addr + i]) out[2 + (i >> 3)] |= 1 << i % 8
    }
    return out
  }

  private readWords(fc: number, pdu: Uint8Array, space: Uint16Array): Uint8Array {
    const addr = (pdu[1] << 8) | pdu[2]
    const qty = (pdu[3] << 8) | pdu[4]
    if (qty < 1 || qty > 125) throw new SimException(0x03)
    if (addr + qty > this.size) throw new SimException(0x02)

    const out = new Uint8Array(2 + qty * 2)
    out[0] = fc
    out[1] = qty * 2
    for (let i = 0; i < qty; i++) {
      const v = space[addr + i]
      out[2 + i * 2] = (v >> 8) & 0xff
      out[3 + i * 2] = v & 0xff
    }
    return out
  }

  private writeSingleCoil(pdu: Uint8Array): Uint8Array {
    const addr = (pdu[1] << 8) | pdu[2]
    const value = (pdu[3] << 8) | pdu[4]
    if (addr >= this.size) throw new SimException(0x02)
    if (value !== 0xff00 && value !== 0x0000) throw new SimException(0x03)
    this.coils[addr] = value === 0xff00 ? 1 : 0
    return pdu.slice(0, 5) // 原样回显
  }

  private writeSingleRegister(pdu: Uint8Array): Uint8Array {
    const addr = (pdu[1] << 8) | pdu[2]
    const value = (pdu[3] << 8) | pdu[4]
    if (addr >= this.size) throw new SimException(0x02)
    this.holdingRegisters[addr] = value
    return pdu.slice(0, 5)
  }

  private writeMultipleCoils(pdu: Uint8Array): Uint8Array {
    const addr = (pdu[1] << 8) | pdu[2]
    const qty = (pdu[3] << 8) | pdu[4]
    const byteCount = pdu[5]
    if (qty < 1 || qty > 1968 || byteCount !== Math.ceil(qty / 8)) throw new SimException(0x03)
    if (addr + qty > this.size) throw new SimException(0x02)

    for (let i = 0; i < qty; i++) {
      this.coils[addr + i] = (pdu[6 + (i >> 3)] >> i % 8) & 1
    }
    return Uint8Array.from([pdu[0], pdu[1], pdu[2], pdu[3], pdu[4]])
  }

  private writeMultipleRegisters(pdu: Uint8Array): Uint8Array {
    const addr = (pdu[1] << 8) | pdu[2]
    const qty = (pdu[3] << 8) | pdu[4]
    const byteCount = pdu[5]
    if (qty < 1 || qty > 123 || byteCount !== qty * 2) throw new SimException(0x03)
    if (addr + qty > this.size) throw new SimException(0x02)

    for (let i = 0; i < qty; i++) {
      this.holdingRegisters[addr + i] = (pdu[6 + i * 2] << 8) | pdu[7 + i * 2]
    }
    return Uint8Array.from([pdu[0], pdu[1], pdu[2], pdu[3], pdu[4]])
  }
}

/** 内部异常，携带 Modbus 标准异常码 */
class SimException extends Error {
  constructor(public readonly code: number) {
    super(`Modbus exception 0x${code.toString(16)}`)
  }
}

function exception(fc: number, code: number): Uint8Array {
  return Uint8Array.from([(fc | 0x80) & 0xff, code])
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
