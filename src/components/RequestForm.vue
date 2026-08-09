<template>
  <el-card class="mb-card">
    <template #header>
      <div class="card-header">
        <span class="card-title">发送请求</span>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <!-- ---------------------------------------------- 标准请求 -->
      <el-tab-pane label="标准请求" name="standard">
        <el-form label-width="88px" label-position="left" size="default">
          <el-form-item :label="unitLabel">
            <el-input v-model="form.unitId" placeholder="十六进制，如 01">
              <template #append>HEX</template>
            </el-input>
          </el-form-item>

          <el-form-item label="功能码">
            <el-select v-model="form.functionCode" style="width: 100%">
              <el-option
                v-for="fc in FUNCTION_CODES"
                :key="fc.code"
                :label="fc.label"
                :value="fc.code"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="起始地址">
            <el-input v-model="form.startAddress" placeholder="起始地址">
              <template #append>
                <el-select v-model="form.addressRadix" style="width: 76px">
                  <el-option label="HEX" value="hex" />
                  <el-option label="DEC" value="dec" />
                </el-select>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item v-if="meta?.needQuantity && !meta?.isWrite" label="数量">
            <el-input-number
              v-model="form.quantity"
              :min="1"
              :max="meta.maxQuantity"
              style="width: 100%"
              controls-position="right"
            />
          </el-form-item>

          <!-- 写单个线圈 -->
          <el-form-item v-if="form.functionCode === FC.WRITE_SINGLE_COIL" label="线圈状态">
            <el-switch
              v-model="form.coilOn"
              active-text="ON (FF00)"
              inactive-text="OFF (0000)"
              inline-prompt
              style="--el-switch-on-color: #67c23a"
            />
          </el-form-item>

          <!-- 写单个寄存器 -->
          <el-form-item v-if="form.functionCode === FC.WRITE_SINGLE_REGISTER" label="写入值">
            <el-input v-model="form.singleValue" placeholder="0 - 65535">
              <template #append>
                <el-select v-model="form.writeValueRadix" style="width: 76px">
                  <el-option label="DEC" value="dec" />
                  <el-option label="HEX" value="hex" />
                </el-select>
              </template>
            </el-input>
          </el-form-item>

          <!-- 写多个 -->
          <el-form-item v-if="isMultiWrite" label="写入值">
            <el-input
              v-model="form.writeValues"
              type="textarea"
              :rows="3"
              :placeholder="
                form.functionCode === FC.WRITE_MULTIPLE_COILS
                  ? '每个线圈填 0 或 1，用空格/逗号分隔，如：1 0 1 1'
                  : '每个寄存器一个值，用空格/逗号分隔，如：100 200 300'
              "
            />
            <div class="field-hint">
              <span>已解析 {{ parsedValues.length }} 个值</span>
              <el-radio-group v-model="form.writeValueRadix" size="small">
                <el-radio-button value="dec">DEC</el-radio-button>
                <el-radio-button value="hex">HEX</el-radio-button>
              </el-radio-group>
            </div>
          </el-form-item>

          <el-form-item label="待发报文">
            <el-input
              :model-value="previewHex"
              readonly
              type="textarea"
              :rows="2"
              class="preview-input"
            />
          </el-form-item>

          <el-alert
            v-if="validationErrors.length"
            type="warning"
            :closable="false"
            show-icon
            class="validate-alert"
          >
            <div v-for="(e, i) in validationErrors" :key="i">{{ e }}</div>
          </el-alert>

          <el-form-item label="超时">
            <el-input-number
              v-model="form.timeoutMs"
              :min="50"
              :max="20000"
              :step="100"
              controls-position="right"
              style="width: 130px"
            />
            <span class="unit-text">ms</span>
            <span class="spacer" />
            <span class="inline-label">轮询周期</span>
            <el-input-number
              v-model="form.pollIntervalMs"
              :min="20"
              :max="60000"
              :step="100"
              controls-position="right"
              style="width: 130px"
            />
            <span class="unit-text">ms</span>
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              :icon="Promotion"
              :disabled="!connected || !isValid || polling"
              @click="emit('send')"
            >
              发送
            </el-button>
            <el-button
              :type="polling ? 'danger' : 'success'"
              :icon="polling ? VideoPause : VideoPlay"
              :disabled="!connected || !isValid"
              @click="emit('toggle-poll')"
            >
              {{ polling ? '停止轮询' : '循环发送' }}
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ---------------------------------------------- 自定义报文 -->
      <el-tab-pane label="自定义报文" name="raw">
        <el-form label-width="88px" label-position="left">
          <el-form-item label="模式">
            <el-radio-group v-model="form.rawMode">
              <el-tooltip
                :content="
                  framing === 'rtu'
                    ? '只填 PDU（功能码开始），自动补从站地址与 CRC'
                    : '只填 PDU（功能码开始），自动补 MBAP 头'
                "
                placement="top"
              >
                <el-radio-button value="auto">自动补全</el-radio-button>
              </el-tooltip>
              <el-tooltip content="完整帧原样发出，不做任何加工" placement="top">
                <el-radio-button value="raw">原样发送</el-radio-button>
              </el-tooltip>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="form.rawMode === 'auto'" :label="unitLabel">
            <el-input v-model="form.unitId" placeholder="十六进制，如 01">
              <template #append>HEX</template>
            </el-input>
          </el-form-item>

          <el-form-item label="报文">
            <el-input
              v-model="form.rawHex"
              type="textarea"
              :rows="4"
              :placeholder="rawPlaceholder"
              class="preview-input"
            />
            <div class="field-hint">
              <span v-if="rawError" class="hint-error">{{ rawError }}</span>
              <span v-else>{{ rawByteCount }} 字节</span>
            </div>
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              :icon="Promotion"
              :disabled="!connected || !!rawError || rawByteCount === 0"
              @click="emit('send-raw')"
            >
              发送
            </el-button>
            <el-button :icon="Delete" @click="form.rawHex = ''">清空</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Promotion, VideoPlay, VideoPause, Delete } from '@element-plus/icons-vue'
import { FUNCTION_CODE as FC, FUNCTION_CODES, getFunctionMeta } from '@/core/modbus/constants'
import { validateHex, hexToBytes } from '@/core/modbus/format'
import type { RequestFormState } from '@/composables/useRequestForm'

const props = defineProps<{
  form: RequestFormState
  parsedValues: number[]
  validationErrors: string[]
  isValid: boolean
  previewHex: string
  connected: boolean
  polling: boolean
  framing: 'rtu' | 'tcp'
}>()

const emit = defineEmits<{
  (e: 'send'): void
  (e: 'toggle-poll'): void
  (e: 'send-raw'): void
}>()

const activeTab = ref<'standard' | 'raw'>('standard')

const unitLabel = computed(() => (props.framing === 'rtu' ? '从站地址' : '单元标识'))
const meta = computed(() => getFunctionMeta(props.form.functionCode))

const isMultiWrite = computed(
  () =>
    props.form.functionCode === FC.WRITE_MULTIPLE_COILS ||
    props.form.functionCode === FC.WRITE_MULTIPLE_REGISTERS
)

const rawPlaceholder = computed(() =>
  props.form.rawMode === 'auto'
    ? '03 00 00 00 0A   ← 功能码开始，地址与校验自动补全'
    : props.framing === 'rtu'
      ? '01 03 00 00 00 0A C5 CD   ← 完整帧，含 CRC'
      : '00 01 00 00 00 06 01 03 00 00 00 0A   ← 完整帧，含 MBAP'
)

const rawError = computed(() => {
  if (props.form.rawHex.trim() === '') return ''
  return validateHex(props.form.rawHex) ?? ''
})

const rawByteCount = computed(() => {
  if (rawError.value || props.form.rawHex.trim() === '') return 0
  try {
    return hexToBytes(props.form.rawHex).length
  } catch {
    return 0
  }
})
</script>

<style scoped>
.field-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}

.hint-error {
  color: #f56c6c;
}

.preview-input :deep(textarea) {
  font-family: 'Cascadia Mono', Consolas, 'Courier New', monospace;
  letter-spacing: 0.6px;
  background-color: #f7f9fc;
  color: #1f6feb;
}

.validate-alert {
  margin-bottom: 16px;
}

.unit-text {
  margin-left: 6px;
  font-size: 13px;
  color: #909399;
}

.inline-label {
  font-size: 13px;
  color: #606266;
  margin-right: 8px;
}

.spacer {
  flex: 1;
  min-width: 12px;
}
</style>
