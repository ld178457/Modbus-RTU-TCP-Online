/**
 * Modbus RTU CRC-16 校验
 * 多项式 0xA001（0x8005 反转），初值 0xFFFF，结果以小端序附加在报文尾部
 *
 * 使用预计算查表法：相比逐位移位快约 8 倍，
 * 在高频轮询场景（10ms 间隔）下可显著降低主线程占用。
 */

const CRC_TABLE = new Uint16Array(256)

for (let i = 0; i < 256; i++) {
  let crc = i
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 0x0001 ? (crc >> 1) ^ 0xa001 : crc >> 1
  }
  CRC_TABLE[i] = crc
}

/**
 * 计算 CRC-16
 * @param data 参与校验的字节序列
 * @param length 可选，仅校验前 length 个字节
 * @returns 16 位无符号整数
 */
export function crc16(data: Uint8Array | number[], length?: number): number {
  const len = length ?? data.length
  let crc = 0xffff
  for (let i = 0; i < len; i++) {
    crc = (crc >> 8) ^ CRC_TABLE[(crc ^ (data[i] & 0xff)) & 0xff]
  }
  return crc & 0xffff
}

/** 返回小端序的 CRC 字节对 [低字节, 高字节]，即报文中的实际排列顺序 */
export function crc16Bytes(data: Uint8Array | number[], length?: number): [number, number] {
  const crc = crc16(data, length)
  return [crc & 0xff, (crc >> 8) & 0xff]
}

/**
 * 校验一个完整的 RTU 帧（含尾部 2 字节 CRC）
 * @returns 校验是否通过
 */
export function verifyCrc16(frame: Uint8Array | number[]): boolean {
  if (frame.length < 3) return false
  const [lo, hi] = crc16Bytes(frame, frame.length - 2)
  return frame[frame.length - 2] === lo && frame[frame.length - 1] === hi
}

/** 在数据后追加 CRC，返回新的完整帧 */
export function appendCrc16(data: Uint8Array | number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : Uint8Array.from(data)
  const frame = new Uint8Array(body.length + 2)
  frame.set(body, 0)
  const [lo, hi] = crc16Bytes(body)
  frame[body.length] = lo
  frame[body.length + 1] = hi
  return frame
}
