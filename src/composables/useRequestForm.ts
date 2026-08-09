/**
 * 请求表单状态
 *
 * RTU 与 TCP 的 PDU 完全一致，因此请求参数也可以共用同一份模型，
 * 差别只在于「从站地址」和「单元标识符」的叫法。
 */

import { computed, reactive } from 'vue'
import type { RequestOptions } from '@/core/modbus/codec'
import { FUNCTION_CODE, getFunctionMeta } from '@/core/modbus/constants'
import { parseNumberInput, parseValueList } from '@/core/modbus/format'

export type NumberRadix = 'hex' | 'dec'

export interface RequestFormState {
  /** 从站地址 / 单元标识符 */
  unitId: string
  functionCode: number
  startAddress: string
  quantity: number
  /** 地址与数量的输入进制 */
  addressRadix: NumberRadix
  /** 写多个寄存器/线圈时的值列表（空白或逗号分隔） */
  writeValues: string
  writeValueRadix: NumberRadix
  /** 写单个线圈时的 ON/OFF */
  coilOn: boolean
  /** 写单个寄存器的值 */
  singleValue: string
  timeoutMs: number
  pollIntervalMs: number
  /** 自定义报文 */
  rawHex: string
  rawMode: 'auto' | 'raw'
}

export function useRequestForm(defaults: Partial<RequestFormState> = {}) {
  const form = reactive<RequestFormState>({
    unitId: '01',
    functionCode: FUNCTION_CODE.READ_HOLDING_REGISTERS,
    startAddress: '0000',
    quantity: 10,
    addressRadix: 'hex',
    writeValues: '',
    writeValueRadix: 'dec',
    coilOn: true,
    singleValue: '0',
    timeoutMs: 1000,
    pollIntervalMs: 500,
    rawHex: '',
    rawMode: 'auto',
    ...defaults
  })

  const meta = computed(() => getFunctionMeta(form.functionCode))

  /** 解析后的写入值数组 */
  const parsedValues = computed<number[]>(() => {
    const fc = form.functionCode
    if (fc === FUNCTION_CODE.WRITE_SINGLE_COIL) return [form.coilOn ? 1 : 0]
    if (fc === FUNCTION_CODE.WRITE_SINGLE_REGISTER) {
      return [parseNumberInput(form.singleValue, form.writeValueRadix) & 0xffff]
    }
    return parseValueList(form.writeValues, form.writeValueRadix)
  })

  /** 组装成协议层需要的请求参数 */
  const options = computed<RequestOptions>(() => {
    const m = meta.value
    const values = parsedValues.value
    // 写多个时以实际填写的值个数为准，避免数量与数据长度对不上
    const quantity =
      m?.isWrite && m.needQuantity ? values.length : m?.needQuantity ? form.quantity : 1

    return {
      unitId: parseNumberInput(form.unitId, 'hex') & 0xff,
      functionCode: form.functionCode,
      startAddress: parseNumberInput(form.startAddress, form.addressRadix) & 0xffff,
      quantity,
      values
    }
  })

  /** 表单校验，返回错误信息数组 */
  const validationErrors = computed<string[]>(() => {
    const errs: string[] = []
    const m = meta.value
    const o = options.value

    if (o.unitId > 247 && o.unitId !== 255) {
      errs.push('从站地址通常应在 0-247 范围内（0 为广播）')
    }
    if (!m) {
      errs.push('未知功能码')
      return errs
    }
    if (m.needQuantity && (o.quantity ?? 0) < 1) {
      errs.push(m.isWrite ? '请填写至少一个写入值' : '数量至少为 1')
    }
    if (m.needQuantity && (o.quantity ?? 0) > m.maxQuantity) {
      errs.push(`${m.label} 单次最多 ${m.maxQuantity} 个`)
    }
    if ((o.startAddress ?? 0) + (o.quantity ?? 0) > 0x10000) {
      errs.push('起始地址加数量超出 65535 的地址空间')
    }
    if (m.isWrite && m.needValues && o.values!.length === 0) {
      errs.push('请填写要写入的值')
    }
    if (
      form.functionCode === FUNCTION_CODE.WRITE_MULTIPLE_REGISTERS &&
      o.values!.some((v) => v < 0 || v > 0xffff)
    ) {
      errs.push('寄存器值必须在 0-65535 之间')
    }
    return errs
  })

  const isValid = computed(() => validationErrors.value.length === 0)

  return { form, meta, options, parsedValues, validationErrors, isValid }
}
