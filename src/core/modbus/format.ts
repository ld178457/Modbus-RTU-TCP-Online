/**
 * 数据格式化与解码
 * 负责把寄存器原始值翻译成工程量，以及 HEX 字符串的双向转换。
 */

import { ByteOrder, DisplayRadix, RegisterDecodeType } from './constants'

/** 字节数组 → 十六进制字符串 */
export function bytesToHex(bytes: Uint8Array | number[], separator = ' '): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(separator)
}

/** 字节数组 → 可打印 ASCII，不可见字符用 '.' 代替 */
export function bytesToAscii(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('')
}

/**
 * 十六进制字符串 → 字节数组
 * 容忍空格、逗号、0x 前缀、换行等常见写法
 */
export function hexToBytes(input: string): Uint8Array {
  const cleaned = input
    .replace(/0[xX]/g, '')
    .replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length === 0) return new Uint8Array(0)
  if (cleaned.length % 2 !== 0) {
    throw new Error(`十六进制字符个数必须为偶数（当前 ${cleaned.length} 个）`)
  }
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.substr(i * 2, 2), 16)
  }
  return out
}

/** 校验一个十六进制输入是否合法，返回错误信息或 null */
export function validateHex(input: string): string | null {
  const cleaned = input.replace(/0[xX]/g, '').replace(/\s|,/g, '')
  if (cleaned.length === 0) return '不能为空'
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) return '包含非十六进制字符'
  if (cleaned.length % 2 !== 0) return '十六进制字符个数必须为偶数'
  return null
}

/** 解析用户输入的地址/数量：支持 '0x1F'、'1F'(按十六进制) 与 '31'(按十进制) */
export function parseNumberInput(input: string, radix: 'hex' | 'dec' = 'hex'): number {
  const s = String(input).trim()
  if (s === '') return 0
  if (/^0[xX]/.test(s)) return parseInt(s.slice(2), 16) || 0
  const value = parseInt(s, radix === 'hex' ? 16 : 10)
  return Number.isNaN(value) ? 0 : value
}

/** 按指定进制格式化一个数值 */
export function formatByRadix(value: number, radix: DisplayRadix, bitWidth = 16): string {
  switch (radix) {
    case 'HEX':
      return value.toString(16).toUpperCase().padStart(bitWidth / 4, '0')
    case 'BIN':
      return value.toString(2).padStart(bitWidth, '0')
    case 'DEC':
    default:
      return String(value)
  }
}

export interface DecodedRegister {
  /** 该值起始的寄存器序号（相对于起始地址的偏移） */
  index: number
  /** 绝对地址 */
  address: number
  /** 占用的寄存器个数 */
  words: number
  /** 参与组合的寄存器原始值 */
  raw: number[]
  /** 解码后的工程量 */
  value: number
}

const WORDS_PER_TYPE: Record<RegisterDecodeType, number> = {
  uint16: 1,
  int16: 1,
  uint32: 2,
  int32: 2,
  float32: 2,
  float64: 4
}

/**
 * 按指定类型与字节序解码寄存器数组
 *
 * 字节序说明（以 32 位为例，A 为最高字节）：
 *   ABCD — 大端，寄存器高位在前（最常见）
 *   CDAB — 字交换，两个寄存器互换（西门子/部分变频器常用）
 *   BADC — 字节交换
 *   DCBA — 小端
 */
export function decodeRegisters(
  registers: number[],
  type: RegisterDecodeType,
  byteOrder: ByteOrder = 'ABCD',
  startAddress = 0
): DecodedRegister[] {
  const words = WORDS_PER_TYPE[type]
  const out: DecodedRegister[] = []

  for (let i = 0; i + words <= registers.length; i += words) {
    const raw = registers.slice(i, i + words)
    out.push({
      index: i,
      address: startAddress + i,
      words,
      raw,
      value: decodeOne(raw, type, byteOrder)
    })
  }
  return out
}

function decodeOne(raw: number[], type: RegisterDecodeType, byteOrder: ByteOrder): number {
  if (type === 'uint16') return raw[0] & 0xffff
  if (type === 'int16') {
    const v = raw[0] & 0xffff
    return v > 0x7fff ? v - 0x10000 : v
  }

  // 先把寄存器摊平成字节（默认大端），再按字节序重排
  const bytes: number[] = []
  for (const r of raw) {
    bytes.push((r >> 8) & 0xff, r & 0xff)
  }
  const ordered = applyByteOrder(bytes, byteOrder)

  const view = new DataView(new ArrayBuffer(ordered.length))
  ordered.forEach((b, i) => view.setUint8(i, b))

  switch (type) {
    case 'uint32':
      return view.getUint32(0, false)
    case 'int32':
      return view.getInt32(0, false)
    case 'float32':
      return view.getFloat32(0, false)
    case 'float64':
      return view.getFloat64(0, false)
    default:
      return 0
  }
}

/** 按字节序规则重排字节；对 8 字节数据按每 4 字节分组套用同样规则 */
function applyByteOrder(bytes: number[], order: ByteOrder): number[] {
  if (order === 'ABCD') return bytes

  const transform = (group: number[]): number[] => {
    const [a, b, c, d] = group
    switch (order) {
      case 'CDAB':
        return [c, d, a, b]
      case 'BADC':
        return [b, a, d, c]
      case 'DCBA':
        return [d, c, b, a]
      default:
        return group
    }
  }

  const out: number[] = []
  for (let i = 0; i < bytes.length; i += 4) {
    out.push(...transform(bytes.slice(i, i + 4)))
  }
  return out
}

/**
 * 把用户输入的写入值字符串解析成数值数组
 * 支持逗号/空格/换行分隔，支持 0x 前缀
 */
export function parseValueList(input: string, radix: 'hex' | 'dec'): number[] {
  return String(input)
    .split(/[\s,;]+/)
    .filter((s) => s.length > 0)
    .map((s) => {
      if (/^0[xX]/.test(s)) return parseInt(s.slice(2), 16)
      const v = parseInt(s, radix === 'hex' ? 16 : 10)
      return Number.isNaN(v) ? 0 : v
    })
}

/** 生成 HH:MM:SS.mmm 时间戳，毫秒对分析响应耗时很关键 */
export function timestamp(date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(
    date.getMilliseconds(),
    3
  )}`
}
