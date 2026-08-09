/**
 * Modbus 报文编解码
 *
 * 分层设计：
 *   PDU  = 功能码 + 数据           （RTU / TCP 完全一致）
 *   RTU ADU = 从站地址 + PDU + CRC16
 *   TCP ADU = MBAP 头(7B) + PDU
 *
 * 因此上层业务只需构造一次 PDU，两种链路复用同一份逻辑。
 */

import { appendCrc16, verifyCrc16 } from './crc'
import { FUNCTION_CODE, describeException, getFunctionMeta } from './constants'

export interface RequestOptions {
  /** 从站地址(RTU) / 单元标识符(TCP)，0-255 */
  unitId: number
  functionCode: number
  /** 起始地址 0-65535 */
  startAddress: number
  /** 读取数量；写单个时忽略 */
  quantity?: number
  /** 写操作的数据：线圈为 0/1 数组，寄存器为 0-65535 数组 */
  values?: number[]
}

/** 构建 PDU（功能码 + 数据部分） */
export function buildPdu(opts: RequestOptions): Uint8Array {
  const { functionCode: fc, startAddress: addr } = opts
  const quantity = opts.quantity ?? 1
  const values = opts.values ?? []

  switch (fc) {
    case FUNCTION_CODE.READ_COILS:
    case FUNCTION_CODE.READ_DISCRETE_INPUTS:
    case FUNCTION_CODE.READ_HOLDING_REGISTERS:
    case FUNCTION_CODE.READ_INPUT_REGISTERS:
      return Uint8Array.from([
        fc,
        (addr >> 8) & 0xff,
        addr & 0xff,
        (quantity >> 8) & 0xff,
        quantity & 0xff
      ])

    case FUNCTION_CODE.WRITE_SINGLE_COIL: {
      // 线圈 ON = 0xFF00，OFF = 0x0000，无中间值
      const on = values[0] ? 0xff : 0x00
      return Uint8Array.from([fc, (addr >> 8) & 0xff, addr & 0xff, on, 0x00])
    }

    case FUNCTION_CODE.WRITE_SINGLE_REGISTER: {
      const v = (values[0] ?? 0) & 0xffff
      return Uint8Array.from([fc, (addr >> 8) & 0xff, addr & 0xff, (v >> 8) & 0xff, v & 0xff])
    }

    case FUNCTION_CODE.WRITE_MULTIPLE_COILS: {
      const count = quantity || values.length
      const byteCount = Math.ceil(count / 8)
      const payload = new Uint8Array(byteCount)
      for (let i = 0; i < count; i++) {
        if (values[i]) payload[i >> 3] |= 1 << i % 8
      }
      const head = Uint8Array.from([
        fc,
        (addr >> 8) & 0xff,
        addr & 0xff,
        (count >> 8) & 0xff,
        count & 0xff,
        byteCount
      ])
      return concat(head, payload)
    }

    case FUNCTION_CODE.WRITE_MULTIPLE_REGISTERS: {
      const count = quantity || values.length
      const payload = new Uint8Array(count * 2)
      for (let i = 0; i < count; i++) {
        const v = (values[i] ?? 0) & 0xffff
        payload[i * 2] = (v >> 8) & 0xff
        payload[i * 2 + 1] = v & 0xff
      }
      const head = Uint8Array.from([
        fc,
        (addr >> 8) & 0xff,
        addr & 0xff,
        (count >> 8) & 0xff,
        count & 0xff,
        count * 2
      ])
      return concat(head, payload)
    }

    default:
      throw new Error(`不支持的功能码: 0x${fc.toString(16).padStart(2, '0').toUpperCase()}`)
  }
}

/** 构建完整的 RTU 帧：地址 + PDU + CRC */
export function buildRtuFrame(opts: RequestOptions): Uint8Array {
  const pdu = buildPdu(opts)
  const body = concat(Uint8Array.from([opts.unitId & 0xff]), pdu)
  return appendCrc16(body)
}

/** 构建完整的 TCP 帧：MBAP 头 + PDU */
export function buildTcpFrame(opts: RequestOptions, transactionId: number): Uint8Array {
  const pdu = buildPdu(opts)
  // MBAP: 事务标识(2) 协议标识(2) 长度(2) 单元标识(1)
  // 长度字段 = 后续字节数 = 单元标识(1) + PDU
  const length = pdu.length + 1
  const mbap = Uint8Array.from([
    (transactionId >> 8) & 0xff,
    transactionId & 0xff,
    0x00,
    0x00,
    (length >> 8) & 0xff,
    length & 0xff,
    opts.unitId & 0xff
  ])
  return concat(mbap, pdu)
}

/** 把任意 PDU 包成 RTU 帧（用于自定义报文发送） */
export function wrapRtu(unitId: number, pdu: Uint8Array): Uint8Array {
  return appendCrc16(concat(Uint8Array.from([unitId & 0xff]), pdu))
}

/** 把任意 PDU 包成 TCP 帧（用于自定义报文发送） */
export function wrapTcp(unitId: number, pdu: Uint8Array, transactionId: number): Uint8Array {
  const length = pdu.length + 1
  const mbap = Uint8Array.from([
    (transactionId >> 8) & 0xff,
    transactionId & 0xff,
    0x00,
    0x00,
    (length >> 8) & 0xff,
    length & 0xff,
    unitId & 0xff
  ])
  return concat(mbap, pdu)
}

// ---------------------------------------------------------------- 响应解析

export interface ParsedResponse {
  ok: boolean
  /** 解析失败或异常响应时的说明 */
  error?: string
  unitId: number
  functionCode: number
  /** 是否为从站返回的异常响应（功能码最高位置 1） */
  isException: boolean
  exceptionCode?: number
  /** 读位操作的结果 */
  bits?: boolean[]
  /** 读字操作的结果（每个元素为 0-65535 的寄存器原始值） */
  registers?: number[]
  /** 数据区原始字节（不含地址、功能码、字节数、CRC） */
  payload?: Uint8Array
  /** 写操作回显的地址 */
  echoAddress?: number
  /** 写操作回显的值或数量 */
  echoValue?: number
  /** TCP 专用：事务标识符 */
  transactionId?: number
  /** 供界面逐字段高亮的分段信息 */
  fields: FrameField[]
}

/** 报文字段切片，用于界面上的逐字段解析展示 */
export interface FrameField {
  name: string
  /** 在整帧中的起始下标 */
  offset: number
  length: number
  hex: string
  description: string
}

/**
 * 解析 RTU 响应帧
 * @param frame 完整帧（含 CRC）
 * @param expectedUnitId 期望的从站地址，用于校验；传 undefined 跳过
 */
export function parseRtuResponse(frame: Uint8Array, expectedUnitId?: number): ParsedResponse {
  const fields: FrameField[] = []

  if (frame.length < 4) {
    return failed(fields, '帧长度不足（至少需要 4 字节）')
  }

  if (!verifyCrc16(frame)) {
    const [lo, hi] = [frame[frame.length - 2], frame[frame.length - 1]]
    return failed(
      fields,
      `CRC 校验失败（收到 ${toHex(lo)} ${toHex(hi)}），可能是波特率不匹配或线路干扰`
    )
  }

  const unitId = frame[0]
  const fc = frame[1]

  fields.push(field('从站地址', 0, 1, frame, `地址 ${unitId}`))

  if (expectedUnitId !== undefined && unitId !== expectedUnitId) {
    fields.push(field('功能码', 1, 1, frame, ''))
    return {
      ...failed(fields, `从站地址不匹配：期望 ${expectedUnitId}，实际 ${unitId}`),
      unitId,
      functionCode: fc
    }
  }

  // 去掉地址与 CRC，交给 PDU 层解析
  const pdu = frame.subarray(1, frame.length - 2)
  const result = parsePdu(pdu, 1, frame, fields)
  result.unitId = unitId

  fields.push(
    field('CRC 校验', frame.length - 2, 2, frame, '低字节在前（小端序），校验通过')
  )
  return result
}

/**
 * 解析 TCP 响应帧（含 MBAP 头）
 */
export function parseTcpResponse(frame: Uint8Array, expectedUnitId?: number): ParsedResponse {
  const fields: FrameField[] = []

  if (frame.length < 8) {
    return failed(fields, 'TCP 帧长度不足（MBAP 头 7 字节 + 至少 1 字节 PDU）')
  }

  const transactionId = (frame[0] << 8) | frame[1]
  const protocolId = (frame[2] << 8) | frame[3]
  const lengthField = (frame[4] << 8) | frame[5]
  const unitId = frame[6]

  fields.push(field('事务标识', 0, 2, frame, `请求与响应配对编号 ${transactionId}`))
  fields.push(
    field('协议标识', 2, 2, frame, protocolId === 0 ? 'Modbus 协议（固定 0）' : `异常值 ${protocolId}`)
  )
  fields.push(field('长度', 4, 2, frame, `后续 ${lengthField} 字节`))
  fields.push(field('单元标识', 6, 1, frame, `目标从站 ${unitId}`))

  if (protocolId !== 0) {
    return { ...failed(fields, `协议标识错误：应为 0，实际 ${protocolId}`), transactionId, unitId }
  }

  const expectedTotal = 6 + lengthField
  if (frame.length !== expectedTotal) {
    return {
      ...failed(
        fields,
        `长度字段与实际不符：声明 ${expectedTotal} 字节，实际收到 ${frame.length} 字节`
      ),
      transactionId,
      unitId
    }
  }

  if (expectedUnitId !== undefined && unitId !== expectedUnitId) {
    return {
      ...failed(fields, `单元标识不匹配：期望 ${expectedUnitId}，实际 ${unitId}`),
      transactionId,
      unitId
    }
  }

  const pdu = frame.subarray(7)
  const result = parsePdu(pdu, 7, frame, fields)
  result.unitId = unitId
  result.transactionId = transactionId
  return result
}

/**
 * 解析 PDU 主体（功能码 + 数据），RTU 与 TCP 共用
 * @param pdu       PDU 切片
 * @param baseOffset PDU 在整帧中的起始下标，用于生成正确的字段偏移
 * @param frame     整帧，用于取十六进制片段
 */
function parsePdu(
  pdu: Uint8Array,
  baseOffset: number,
  frame: Uint8Array,
  fields: FrameField[]
): ParsedResponse {
  const fc = pdu[0]
  const meta = getFunctionMeta(fc & 0x7f)

  const base: ParsedResponse = {
    ok: true,
    unitId: 0,
    functionCode: fc,
    isException: false,
    fields
  }

  // 异常响应：功能码最高位被置 1
  if (fc & 0x80) {
    const exceptionCode = pdu[1]
    fields.push(
      field('功能码', baseOffset, 1, frame, `异常响应（原功能码 ${toHex(fc & 0x7f)}）`)
    )
    fields.push(field('异常码', baseOffset + 1, 1, frame, describeException(exceptionCode)))
    return {
      ...base,
      ok: false,
      isException: true,
      exceptionCode,
      error: describeException(exceptionCode)
    }
  }

  fields.push(field('功能码', baseOffset, 1, frame, meta ? meta.label : `未知功能码 ${toHex(fc)}`))

  switch (fc) {
    case FUNCTION_CODE.READ_COILS:
    case FUNCTION_CODE.READ_DISCRETE_INPUTS: {
      if (pdu.length < 2) return { ...base, ok: false, error: '响应缺少字节数字段' }
      const byteCount = pdu[1]
      if (pdu.length < 2 + byteCount) {
        return { ...base, ok: false, error: `数据区不完整：声明 ${byteCount} 字节` }
      }
      fields.push(field('字节数', baseOffset + 1, 1, frame, `${byteCount} 字节数据`))
      const payload = pdu.subarray(2, 2 + byteCount)
      fields.push(
        field('线圈数据', baseOffset + 2, byteCount, frame, `每字节 8 个线圈，低位在前`)
      )
      const bits: boolean[] = []
      for (let i = 0; i < byteCount * 8; i++) {
        bits.push(((payload[i >> 3] >> i % 8) & 1) === 1)
      }
      return { ...base, bits, payload }
    }

    case FUNCTION_CODE.READ_HOLDING_REGISTERS:
    case FUNCTION_CODE.READ_INPUT_REGISTERS: {
      if (pdu.length < 2) return { ...base, ok: false, error: '响应缺少字节数字段' }
      const byteCount = pdu[1]
      if (byteCount % 2 !== 0) {
        return { ...base, ok: false, error: `寄存器字节数应为偶数，实际 ${byteCount}` }
      }
      if (pdu.length < 2 + byteCount) {
        return { ...base, ok: false, error: `数据区不完整：声明 ${byteCount} 字节` }
      }
      fields.push(
        field('字节数', baseOffset + 1, 1, frame, `${byteCount} 字节 = ${byteCount / 2} 个寄存器`)
      )
      const payload = pdu.subarray(2, 2 + byteCount)
      fields.push(field('寄存器数据', baseOffset + 2, byteCount, frame, '每 2 字节一个寄存器，高字节在前'))
      const registers: number[] = []
      for (let i = 0; i < byteCount; i += 2) {
        registers.push((payload[i] << 8) | payload[i + 1])
      }
      return { ...base, registers, payload }
    }

    case FUNCTION_CODE.WRITE_SINGLE_COIL:
    case FUNCTION_CODE.WRITE_SINGLE_REGISTER: {
      if (pdu.length < 5) return { ...base, ok: false, error: '写响应长度不足' }
      const echoAddress = (pdu[1] << 8) | pdu[2]
      const echoValue = (pdu[3] << 8) | pdu[4]
      fields.push(field('输出地址', baseOffset + 1, 2, frame, `地址 ${echoAddress}`))
      fields.push(
        field(
          '输出值',
          baseOffset + 3,
          2,
          frame,
          fc === FUNCTION_CODE.WRITE_SINGLE_COIL
            ? echoValue === 0xff00
              ? '线圈置 ON'
              : '线圈置 OFF'
            : `写入值 ${echoValue}`
        )
      )
      return { ...base, echoAddress, echoValue }
    }

    case FUNCTION_CODE.WRITE_MULTIPLE_COILS:
    case FUNCTION_CODE.WRITE_MULTIPLE_REGISTERS: {
      if (pdu.length < 5) return { ...base, ok: false, error: '写响应长度不足' }
      const echoAddress = (pdu[1] << 8) | pdu[2]
      const echoValue = (pdu[3] << 8) | pdu[4]
      fields.push(field('起始地址', baseOffset + 1, 2, frame, `地址 ${echoAddress}`))
      fields.push(field('写入数量', baseOffset + 3, 2, frame, `成功写入 ${echoValue} 个`))
      return { ...base, echoAddress, echoValue }
    }

    default:
      return {
        ...base,
        ok: false,
        error: `不支持解析的功能码 ${toHex(fc)}`,
        payload: pdu.subarray(1)
      }
  }
}

// ---------------------------------------------------------------- 帧长度判定

/**
 * 根据已收到的 RTU 字节推断整帧总长度。
 * 串口是字节流，没有天然的帧边界，必须靠协议结构 + 超时来切分。
 * @returns 已能确定时返回总长度，尚不能确定返回 null
 */
export function expectedRtuFrameLength(buf: Uint8Array): number | null {
  if (buf.length < 2) return null
  const fc = buf[1]

  // 异常响应固定 5 字节：地址 + 功能码 + 异常码 + CRC(2)
  if (fc & 0x80) return 5

  switch (fc) {
    case FUNCTION_CODE.READ_COILS:
    case FUNCTION_CODE.READ_DISCRETE_INPUTS:
    case FUNCTION_CODE.READ_HOLDING_REGISTERS:
    case FUNCTION_CODE.READ_INPUT_REGISTERS:
      if (buf.length < 3) return null
      // 地址(1) + 功能码(1) + 字节数(1) + 数据(N) + CRC(2)
      return 3 + buf[2] + 2

    case FUNCTION_CODE.WRITE_SINGLE_COIL:
    case FUNCTION_CODE.WRITE_SINGLE_REGISTER:
    case FUNCTION_CODE.WRITE_MULTIPLE_COILS:
    case FUNCTION_CODE.WRITE_MULTIPLE_REGISTERS:
      // 地址(1) + 功能码(1) + 地址(2) + 值/数量(2) + CRC(2)
      return 8

    default:
      return null
  }
}

/**
 * 根据 MBAP 长度字段推断 TCP 整帧长度
 * @returns 头部尚未收全时返回 null
 */
export function expectedTcpFrameLength(buf: Uint8Array): number | null {
  if (buf.length < 6) return null
  return 6 + ((buf[4] << 8) | buf[5])
}

/**
 * 计算 RTU 帧间隔时间（3.5 个字符时间），单位毫秒。
 * 波特率 > 19200 时协议规定固定使用 1.75ms。
 */
export function rtuFrameGapMs(baudRate: number, dataBits = 8, stopBits = 1, parity = 'none'): number {
  if (baudRate > 19200) return 1.75
  const bitsPerChar = 1 + dataBits + (parity === 'none' ? 0 : 1) + stopBits
  return (bitsPerChar * 3.5 * 1000) / baudRate
}

// ---------------------------------------------------------------- 工具函数

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase()
}

function field(
  name: string,
  offset: number,
  length: number,
  frame: Uint8Array,
  description: string
): FrameField {
  const slice = Array.from(frame.subarray(offset, offset + length))
  return {
    name,
    offset,
    length,
    hex: slice.map(toHex).join(' '),
    description
  }
}

function failed(fields: FrameField[], error: string): ParsedResponse {
  return {
    ok: false,
    error,
    unitId: 0,
    functionCode: 0,
    isException: false,
    fields
  }
}
