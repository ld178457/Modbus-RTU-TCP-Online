<template>
  <el-card class="mb-card">
    <template #header>
      <div class="card-header viewer-header">
        <span class="card-title">{{ isBitMode ? '线圈 / 离散输入状态' : '寄存器数据' }}</span>

        <div class="viewer-toolbar">
          <template v-if="!isBitMode">
            <span class="toolbar-label">数据类型</span>
            <el-select v-model="decodeType" size="small" style="width: 132px">
              <el-option
                v-for="opt in REGISTER_DECODE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>

            <el-tooltip placement="top">
              <template #content>
                多寄存器组合时的排列顺序<br />
                ABCD 大端（最常见）· CDAB 字交换<br />
                BADC 字节交换 · DCBA 小端
              </template>
              <span class="toolbar-label">字节序</span>
            </el-tooltip>
            <el-select
              v-model="byteOrder"
              size="small"
              style="width: 96px"
              :disabled="wordsPerValue === 1"
            >
              <el-option v-for="o in BYTE_ORDERS" :key="o" :label="o" :value="o" />
            </el-select>
          </template>

          <span class="toolbar-label">显示</span>
          <el-radio-group v-model="radix" size="small">
            <el-radio-button value="HEX">HEX</el-radio-button>
            <el-radio-button value="DEC">DEC</el-radio-button>
            <el-radio-button value="BIN">BIN</el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </template>

    <div class="viewer-body">
      <!-- 空状态 -->
      <div v-if="isEmpty" class="viewer-empty">
        <el-icon :size="32"><DataLine /></el-icon>
        <p>暂无数据</p>
        <span>发送一次读取请求后，解析结果会显示在这里</span>
      </div>

      <!-- 位数据：线圈 / 离散输入 -->
      <div v-else-if="isBitMode" class="bit-grid">
        <div v-for="item in bitItems" :key="item.address" class="bit-cell" :class="{ on: item.on }">
          <div class="bit-addr">{{ formatAddress(item.address) }}</div>
          <el-switch :model-value="item.on" disabled size="small" />
          <div class="bit-value">{{ item.on ? 'ON' : 'OFF' }}</div>
        </div>
      </div>

      <!-- 字数据：保持寄存器 / 输入寄存器 -->
      <el-table
        v-else
        :data="decodedRows"
        size="small"
        border
        stripe
        max-height="360"
        class="reg-table"
      >
        <el-table-column label="地址" width="120">
          <template #default="{ row }">
            <span class="mono">{{ formatAddress(row.address) }}</span>
            <span v-if="row.words > 1" class="span-hint">+{{ row.words - 1 }}</span>
          </template>
        </el-table-column>

        <el-table-column label="原始值" min-width="150">
          <template #default="{ row }">
            <span class="mono raw-cell">{{ formatRaw(row.raw) }}</span>
          </template>
        </el-table-column>

        <el-table-column :label="decodeLabel" min-width="140">
          <template #default="{ row }">
            <span class="mono value-cell">{{ formatDecoded(row.value) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-card>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useStore } from 'vuex'
import { DataLine } from '@element-plus/icons-vue'
import {
  REGISTER_DECODE_OPTIONS,
  type ByteOrder,
  type DisplayRadix,
  type RegisterDecodeType,
  getFunctionMeta
} from '@/core/modbus/constants'
import { decodeRegisters, formatByRadix } from '@/core/modbus/format'

const props = defineProps<{ channel: 'rtu' | 'tcp' }>()

const store = useStore()
const BYTE_ORDERS: ByteOrder[] = ['ABCD', 'CDAB', 'BADC', 'DCBA']

const radix = ref<DisplayRadix>('HEX')
const decodeType = ref<RegisterDecodeType>('uint16')
const byteOrder = ref<ByteOrder>('ABCD')

const bits = computed<boolean[]>(() => store.getters[`${props.channel}/lastBits`])
const registers = computed<number[]>(() => store.getters[`${props.channel}/lastRegisters`])
const startAddress = computed<number>(() => store.getters[`${props.channel}/lastStartAddress`])
const functionCode = computed<number>(() => store.getters[`${props.channel}/lastFunctionCode`])

const isBitMode = computed(() => getFunctionMeta(functionCode.value & 0x7f)?.dataType === 'bit')
const isEmpty = computed(() =>
  isBitMode.value ? bits.value.length === 0 : registers.value.length === 0
)

const wordsPerValue = computed(
  () => REGISTER_DECODE_OPTIONS.find((o) => o.value === decodeType.value)?.words ?? 1
)

const decodeLabel = computed(
  () => REGISTER_DECODE_OPTIONS.find((o) => o.value === decodeType.value)?.label ?? '值'
)

const bitItems = computed(() =>
  bits.value.map((on, i) => ({ address: startAddress.value + i, on }))
)

const decodedRows = computed(() =>
  decodeRegisters(registers.value, decodeType.value, byteOrder.value, startAddress.value)
)

function formatAddress(addr: number): string {
  return radix.value === 'DEC' ? String(addr) : `0x${addr.toString(16).padStart(4, '0').toUpperCase()}`
}

function formatRaw(raw: number[]): string {
  return raw.map((v) => formatByRadix(v, radix.value, 16)).join(' ')
}

function formatDecoded(value: number): string {
  // 浮点数保持十进制展示，转成二进制/十六进制没有意义
  if (decodeType.value === 'float32' || decodeType.value === 'float64') {
    return Number.isFinite(value) ? value.toFixed(4) : String(value)
  }
  if (radix.value === 'DEC') return String(value)
  const bitWidth = wordsPerValue.value * 16
  // 负数先转成对应位宽的补码再格式化
  const unsigned = value < 0 ? value >>> 0 : value
  return formatByRadix(unsigned, radix.value, bitWidth)
}
</script>

<style scoped>
.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-label {
  font-size: 13px;
  color: #606266;
  font-weight: normal;
  cursor: default;
}

.viewer-body {
  min-height: 180px;
}

.bit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}

.bit-cell {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 8px 4px;
  text-align: center;
  background: #fafcff;
  transition: all 0.15s;
}

.bit-cell.on {
  border-color: #95d475;
  background: #f0f9eb;
}

.bit-addr {
  font-size: 11px;
  color: #86868b;
  margin-bottom: 5px;
  font-family: Consolas, monospace;
}

.bit-value {
  font-size: 11px;
  margin-top: 4px;
  font-weight: 600;
  color: #909399;
}

.bit-cell.on .bit-value {
  color: #67c23a;
}

.mono {
  font-family: 'Cascadia Mono', Consolas, 'Courier New', monospace;
}

.raw-cell {
  color: #606266;
  letter-spacing: 0.5px;
}

.value-cell {
  color: #1f6feb;
  font-weight: 600;
}

.span-hint {
  font-size: 10px;
  color: #c0c4cc;
  margin-left: 4px;
}

.viewer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #c0c4cc;
}

.viewer-empty p {
  margin: 8px 0 4px;
  font-size: 15px;
  color: #909399;
}

.viewer-empty span {
  font-size: 13px;
}
</style>
