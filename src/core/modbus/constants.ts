/**
 * Modbus 协议常量定义
 * RTU 与 TCP 共用同一套功能码与异常码语义
 */

/** 支持的功能码 */
export const FUNCTION_CODE = {
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_COILS: 0x0f,
  WRITE_MULTIPLE_REGISTERS: 0x10
} as const

export type FunctionCode = (typeof FUNCTION_CODE)[keyof typeof FUNCTION_CODE]

/** 功能码元信息：驱动界面动态渲染表单 */
export interface FunctionCodeMeta {
  code: FunctionCode
  /** 十六进制字符串，如 '03' */
  hex: string
  label: string
  /** 读操作返回位（线圈/离散输入），还是字（寄存器） */
  dataType: 'bit' | 'word'
  /** 是否为写操作 */
  isWrite: boolean
  /** 是否需要"数量"字段 */
  needQuantity: boolean
  /** 是否需要用户填写写入值 */
  needValues: boolean
  /** 单次请求允许的最大数量 */
  maxQuantity: number
}

export const FUNCTION_CODES: FunctionCodeMeta[] = [
  {
    code: FUNCTION_CODE.READ_COILS,
    hex: '01',
    label: '01 读线圈',
    dataType: 'bit',
    isWrite: false,
    needQuantity: true,
    needValues: false,
    maxQuantity: 2000
  },
  {
    code: FUNCTION_CODE.READ_DISCRETE_INPUTS,
    hex: '02',
    label: '02 读离散输入',
    dataType: 'bit',
    isWrite: false,
    needQuantity: true,
    needValues: false,
    maxQuantity: 2000
  },
  {
    code: FUNCTION_CODE.READ_HOLDING_REGISTERS,
    hex: '03',
    label: '03 读保持寄存器',
    dataType: 'word',
    isWrite: false,
    needQuantity: true,
    needValues: false,
    maxQuantity: 125
  },
  {
    code: FUNCTION_CODE.READ_INPUT_REGISTERS,
    hex: '04',
    label: '04 读输入寄存器',
    dataType: 'word',
    isWrite: false,
    needQuantity: true,
    needValues: false,
    maxQuantity: 125
  },
  {
    code: FUNCTION_CODE.WRITE_SINGLE_COIL,
    hex: '05',
    label: '05 写单个线圈',
    dataType: 'bit',
    isWrite: true,
    needQuantity: false,
    needValues: true,
    maxQuantity: 1
  },
  {
    code: FUNCTION_CODE.WRITE_SINGLE_REGISTER,
    hex: '06',
    label: '06 写单个寄存器',
    dataType: 'word',
    isWrite: true,
    needQuantity: false,
    needValues: true,
    maxQuantity: 1
  },
  {
    code: FUNCTION_CODE.WRITE_MULTIPLE_COILS,
    hex: '0F',
    label: '0F 写多个线圈',
    dataType: 'bit',
    isWrite: true,
    needQuantity: true,
    needValues: true,
    maxQuantity: 1968
  },
  {
    code: FUNCTION_CODE.WRITE_MULTIPLE_REGISTERS,
    hex: '10',
    label: '10 写多个寄存器',
    dataType: 'word',
    isWrite: true,
    needQuantity: true,
    needValues: true,
    maxQuantity: 123
  }
]

export function getFunctionMeta(code: number): FunctionCodeMeta | undefined {
  return FUNCTION_CODES.find((f) => f.code === code)
}

/** Modbus 标准异常码 */
export const EXCEPTION_MESSAGES: Record<number, string> = {
  0x01: '非法功能码 — 从站不支持该功能',
  0x02: '非法数据地址 — 请求的地址超出从站范围',
  0x03: '非法数据值 — 请求中包含从站不接受的值',
  0x04: '从站设备故障 — 执行请求时发生不可恢复的错误',
  0x05: '确认 — 从站已接受请求但需要较长处理时间',
  0x06: '从站设备忙 — 请稍后重试',
  0x08: '存储奇偶校验错误',
  0x0a: '网关路径不可用',
  0x0b: '网关目标设备无响应'
}

export function describeException(code: number): string {
  return EXCEPTION_MESSAGES[code] ?? `未知异常码 0x${code.toString(16).padStart(2, '0').toUpperCase()}`
}

/** 数据显示格式 */
export type DisplayRadix = 'HEX' | 'DEC' | 'BIN'

/** 寄存器解码类型 */
export type RegisterDecodeType =
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'float32'
  | 'float64'

/** 32/64 位数据的字节序（寄存器组合顺序） */
export type ByteOrder = 'ABCD' | 'CDAB' | 'BADC' | 'DCBA'

export const REGISTER_DECODE_OPTIONS: { value: RegisterDecodeType; label: string; words: number }[] = [
  { value: 'uint16', label: '无符号 16 位', words: 1 },
  { value: 'int16', label: '有符号 16 位', words: 1 },
  { value: 'uint32', label: '无符号 32 位', words: 2 },
  { value: 'int32', label: '有符号 32 位', words: 2 },
  { value: 'float32', label: '单精度浮点', words: 2 },
  { value: 'float64', label: '双精度浮点', words: 4 }
]
