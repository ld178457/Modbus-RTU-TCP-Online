<template>
  <div class="mb-page">
    <div class="mb-page-header">
      <div class="title-block">
        <h2 class="mb-page-title">Modbus RTU 在线调试工具</h2>
        <span class="mb-page-desc">串口通信 · 实时采集 · 报文解析 · 可视化分析</span>
      </div>
      <div class="conn-indicator">
        <span class="conn-dot" :class="{ online: connected, connecting }" />
        {{ connected ? '已连接' : connecting ? '连接中…' : '未连接' }}
      </div>
    </div>

    <el-alert
      v-if="!support.supported"
      type="warning"
      show-icon
      :closable="false"
      class="mb-card"
    >
      <template #title>{{ support.reason }}</template>
      <div>{{ support.solution }}</div>
      <div class="alert-extra">
        如果暂时没有串口设备，也可以先切到
        <router-link to="/tcp">Modbus TCP 页面</router-link>
        使用内置模拟从站体验完整流程。
      </div>
    </el-alert>

    <el-row :gutter="16">
      <!-- 左栏：连接 + 请求 -->
      <el-col :xs="24" :sm="24" :md="10" :lg="8">
        <el-card class="mb-card">
          <template #header>
            <div class="card-header"><span class="card-title">串口连接设置</span></div>
          </template>

          <el-form label-width="88px" label-position="left">
            <el-form-item label="串口">
              <div class="port-row">
                <el-input
                  :model-value="portName"
                  readonly
                  placeholder="尚未选择串口"
                  class="port-input"
                />
                <el-button :icon="Search" :disabled="!support.supported || connected" @click="pickPort">选择</el-button>
              </div>
              <div class="field-hint">
                浏览器出于隐私限制不会暴露 COM 号，需手动授权选择设备
              </div>
            </el-form-item>

            <el-form-item label="波特率">
              <el-select v-model="serial.baudRate" :disabled="connected" style="width: 100%" filterable allow-create>
                <el-option v-for="b in BAUD_RATES" :key="b" :label="String(b)" :value="b" />
              </el-select>
            </el-form-item>

            <el-form-item label="数据位">
              <el-select v-model="serial.dataBits" :disabled="connected" style="width: 100%">
                <el-option label="8" :value="8" />
                <el-option label="7" :value="7" />
              </el-select>
            </el-form-item>

            <el-form-item label="停止位">
              <el-select v-model="serial.stopBits" :disabled="connected" style="width: 100%">
                <el-option label="1" :value="1" />
                <el-option label="2" :value="2" />
              </el-select>
            </el-form-item>

            <el-form-item label="校验位">
              <el-select v-model="serial.parity" :disabled="connected" style="width: 100%">
                <el-option label="无校验 (None)" value="none" />
                <el-option label="奇校验 (Odd)" value="odd" />
                <el-option label="偶校验 (Even)" value="even" />
              </el-select>
            </el-form-item>

            <el-form-item label="流控">
              <el-select v-model="serial.flowControl" :disabled="connected" style="width: 100%">
                <el-option label="无 (None)" value="none" />
                <el-option label="硬件 (RTS/CTS)" value="hardware" />
              </el-select>
            </el-form-item>

            <el-form-item>
              <el-button
                :type="connected ? 'danger' : 'primary'"
                :icon="connected ? SwitchButton : Link"
                :loading="connecting"
                :disabled="!support.supported"
                @click="toggleConnection"
              >
                {{ connected ? '断开串口' : '打开串口' }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <RequestForm
          :form="form"
          :parsed-values="parsedValues"
          :validation-errors="validationErrors"
          :is-valid="isValid"
          :preview-hex="previewHex"
          :connected="connected"
          :polling="isPolling"
          framing="rtu"
          @send="handleSend"
          @toggle-poll="handleTogglePoll"
          @send-raw="handleSendRaw"
        />
      </el-col>

      <!-- 右栏：日志 + 数据 -->
      <el-col :xs="24" :sm="24" :md="14" :lg="16">
        <DataLogPanel channel="rtu" height="380px" />

        <el-row :gutter="16">
          <el-col :xs="24" :lg="15">
            <RegisterViewer channel="rtu" />
          </el-col>
          <el-col :xs="24" :lg="9">
            <StatusPanel channel="rtu" />
          </el-col>
        </el-row>
      </el-col>
    </el-row>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Link, SwitchButton, Search } from '@element-plus/icons-vue'
import DataLogPanel from '@/components/DataLogPanel.vue'
import RegisterViewer from '@/components/RegisterViewer.vue'
import StatusPanel from '@/components/StatusPanel.vue'
import RequestForm from '@/components/RequestForm.vue'
import { useModbusChannel } from '@/composables/useModbusChannel'
import { useRequestForm } from '@/composables/useRequestForm'
import {
  SerialTransport,
  checkSerialSupport,
  describePort,
  type SerialOptions
} from '@/core/transport/SerialTransport'
import { hexToBytes } from '@/core/modbus/format'

const BAUD_RATES = [
  1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 128000, 230400, 256000, 460800,
  921600
]

const support = ref(checkSerialSupport())

const serial = reactive<SerialOptions>({
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none'
})

const selectedPort = ref<SerialPort | null>(null)
const portName = ref('')

const { connected, connecting, connect, disconnect, execute, executeRaw, previewFrame, startPolling, stopPolling, polling } =
  useModbusChannel('rtu', 'rtu')

const { form, options, parsedValues, validationErrors, isValid } = useRequestForm()

const isPolling = ref(false)
const previewHex = computed(() => previewFrame(options.value))

onMounted(async () => {
  if (!support.value.supported) return
  // 复用用户此前已授权的串口，省去每次重新选择
  try {
    const granted = await navigator.serial.getPorts()
    if (granted.length > 0) {
      selectedPort.value = granted[0]
      portName.value = describePort(granted[0], 0) + '（已授权）'
    }
  } catch {
    /* 忽略：部分环境下 getPorts 可能不可用 */
  }
})

async function pickPort() {
  const check = checkSerialSupport()
  support.value = check
  if (!check.supported) {
    ElMessage.error(`${check.reason}。${check.solution}`)
    return
  }
  try {
    const port = await navigator.serial.requestPort()
    selectedPort.value = port
    portName.value = describePort(port)
    ElMessage.success('串口已选择')
  } catch (err) {
    // 用户点了取消不算错误，静默处理
    const msg = err instanceof Error ? err.message : String(err)
    if (!/No port selected|cancelled/i.test(msg)) {
      ElMessage.error(`选择串口失败：${msg}`)
    }
  }
}

async function toggleConnection() {
  if (connected.value) {
    isPolling.value = false
    await disconnect()
    ElMessage.info('串口已断开')
    return
  }

  if (!selectedPort.value) {
    ElMessage.warning('请先选择一个串口')
    return
  }

  try {
    await connect(new SerialTransport(selectedPort.value, { ...serial }))
    ElMessage.success(`串口已打开（${serial.baudRate} bps）`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ElMessageBox.alert(msg, '打开串口失败', { type: 'error', confirmButtonText: '知道了' })
  }
}

async function handleSend() {
  await execute(options.value, form.timeoutMs)
}

function handleTogglePoll() {
  if (isPolling.value) {
    stopPolling()
    isPolling.value = false
  } else {
    startPolling(() => options.value, form.pollIntervalMs, form.timeoutMs)
    isPolling.value = true
  }
}

async function handleSendRaw() {
  try {
    const bytes = hexToBytes(form.rawHex)
    if (bytes.length === 0) {
      ElMessage.warning('请输入要发送的报文')
      return
    }
    await executeRaw(bytes, options.value.unitId, form.rawMode, form.timeoutMs)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '报文格式错误')
  }
}

// polling 由 composable 内部维护，这里只做界面状态同步
void polling
</script>

<style scoped>
.port-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.port-input {
  flex: 1;
}

.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}

.alert-extra {
  margin-top: 6px;
  font-size: 13px;
}

.alert-extra a {
  color: var(--mb-accent);
  font-weight: 600;
}
</style>
