<template>
  <div class="mb-page">
    <div class="mb-page-header">
      <div class="title-block">
        <h2 class="mb-page-title">Modbus TCP 在线调试工具</h2>
        <span class="mb-page-desc">以太网通信 · MBAP 解析 · 循环轮询 · 内置模拟从站</span>
      </div>
      <div class="conn-indicator">
        <span class="conn-dot" :class="{ online: connected, connecting }" />
        {{ connected ? '已连接' : connecting ? '连接中…' : '未连接' }}
      </div>
    </div>

    <el-row :gutter="16">
      <!-- 左栏：连接 + 请求 -->
      <el-col :xs="24" :sm="24" :md="10" :lg="8">
        <el-card class="mb-card">
          <template #header>
            <div class="card-header"><span class="card-title">网络连接设置</span></div>
          </template>

          <el-form label-width="88px" label-position="left">
            <el-form-item label="连接方式">
              <el-segmented v-model="mode" :options="MODE_OPTIONS" class="mode-seg" />
            </el-form-item>

            <el-alert v-if="modeDescription" type="info" :closable="false" class="mode-tip">
              <div class="tip-body" v-html="modeDescription" />
            </el-alert>

            <!-- 模拟从站参数 -->
            <template v-if="mode === 'simulator'">
              <el-form-item label="响应延迟">
                <el-input-number
                  v-model="sim.responseDelayMs"
                  :min="0"
                  :max="3000"
                  :step="10"
                  controls-position="right"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="丢包率">
                <el-slider
                  v-model="sim.packetLossPercent"
                  :min="0"
                  :max="50"
                  :format-tooltip="(v: number) => `${v}%`"
                  style="width: 100%"
                />
                <div class="field-hint">模拟弱网环境，用于验证超时与重试逻辑</div>
              </el-form-item>
            </template>

            <!-- 本地直连（本地代理：WebSocket -> TCP 中继） -->
            <template v-else-if="mode === 'local'">
              <el-form-item label="目标地址">
                <el-input v-model="localNet.host" placeholder="设备 IP，例如 192.168.1.10" />
              </el-form-item>

              <el-form-item label="端口">
                <el-input-number
                  v-model="localNet.port"
                  :min="1"
                  :max="65535"
                  controls-position="right"
                  style="width: 100%"
                />
              </el-form-item>

              <div class="field-hint">
                由本机 <b>本地代理</b> 把浏览器 WebSocket 转为真实 TCP 发往设备。请先双击
                <code>start-proxy.bat</code> 启动代理（保持窗口打开），当前状态：
                <b :class="proxyOnline ? 'ok' : 'warn'">{{ proxyOnline ? '已运行' : '未运行' }}</b>
                <el-link
                  type="primary"
                  :underline="false"
                  class="retry-link"
                  :loading="proxyChecking"
                  @click="checkProxy"
                >重新检测</el-link>
                <div v-if="mixedContentBlocked" class="mixed-warn">
                  ⚠ 当前页面是 HTTPS，浏览器会拦截对 <code>ws://127.0.0.1</code> 的本地代理连接。
                  请在 <b>http://localhost</b> 或本地 http 服务下使用「本地直连」（RTU / 云代理不受影响）。
                </div>
              </div>

              <div class="proxy-download">
                <el-button type="primary" plain :icon="Download">
                  <a :href="proxyZipUrl" download class="dl-link">一键下载本地代理脚本</a>
                </el-button>
                <span class="dl-note">
                  含 <code>start-proxy.bat</code> 与 <code>modbus_relay.py</code>，解压到同一目录后双击
                  <code>.bat</code> 即可（需本机已装 Python 3.7+）。
                </span>
              </div>
            </template>

            <!-- 公网云代理参数（② 零安装：部署的 Pages Function 代为建 TCP） -->
            <template v-else-if="mode === 'cloud'">
              <el-form-item label="目标地址">
                <el-input v-model="cloudNet.host" placeholder="公网可达的设备 IP，例如 203.0.113.10" />
              </el-form-item>

              <el-form-item label="端口">
                <el-input-number
                  v-model="cloudNet.port"
                  :min="1"
                  :max="65535"
                  controls-position="right"
                  style="width: 100%"
                />
              </el-form-item>

              <el-form-item label="代理地址">
                <el-input v-model="bridgeUrl" :placeholder="bridgePlaceholder" />
              </el-form-item>

              <el-form-item label="访问令牌">
                <el-input v-model="cloudToken" placeholder="可选；仅当部署方设置了 PROXY_AUTH_TOKEN 时才需填写" />
              </el-form-item>
            </template>

            <el-form-item>
              <el-button
                :type="connected ? 'danger' : 'primary'"
                :icon="connected ? SwitchButton : Link"
                :loading="connecting"
                @click="toggleConnection"
              >
                {{ connected ? '断开连接' : '建立连接' }}
              </el-button>
              <el-button v-if="mode === 'simulator' && connected" :icon="Refresh" @click="showSimInfo">
                从站说明
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
          framing="tcp"
          @send="handleSend"
          @toggle-poll="handleTogglePoll"
          @send-raw="handleSendRaw"
        />
      </el-col>

      <!-- 右栏：日志 + 数据 -->
      <el-col :xs="24" :sm="24" :md="14" :lg="16">
        <DataLogPanel channel="tcp" height="380px" />

        <el-row :gutter="16">
          <el-col :xs="24" :lg="15">
            <RegisterViewer channel="tcp" />
          </el-col>
          <el-col :xs="24" :lg="9">
            <StatusPanel channel="tcp" />
          </el-col>
        </el-row>
      </el-col>
    </el-row>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Link, SwitchButton, Refresh, Download } from '@element-plus/icons-vue'
import DataLogPanel from '@/components/DataLogPanel.vue'
import RegisterViewer from '@/components/RegisterViewer.vue'
import StatusPanel from '@/components/StatusPanel.vue'
import RequestForm from '@/components/RequestForm.vue'
import { useModbusChannel } from '@/composables/useModbusChannel'
import { useRequestForm } from '@/composables/useRequestForm'
import { WebSocketTransport } from '@/core/transport/WebSocketTransport'
import { SimulatorTransport } from '@/core/transport/SimulatorTransport'
import { hexToBytes } from '@/core/modbus/format'

type Mode = 'simulator' | 'cloud' | 'local'

const MODE_OPTIONS = [
  { label: '模拟从站', value: 'simulator' },
  { label: '公网云代理', value: 'cloud' },
  { label: '本地直连', value: 'local' }
]

const LOCAL_PROXY_URL = 'ws://127.0.0.1:8765'

// 部署到 Pages 后，本地代理脚本随静态资源一起托管，供访客一键下载
// 注意：本项目用 Vue CLI/webpack 构建，基准路径用 process.env.BASE_URL（非 Vite 的 import.meta.env）
const proxyZipUrl = `${process.env.BASE_URL}local-proxy/modbus-local-proxy.zip`

const DEFAULT_CLOUD_URL = '/api/modbus-proxy'

const mode = ref<Mode>('simulator')
const bridgeUrl = ref(DEFAULT_CLOUD_URL)
const cloudToken = ref('')
const proxyUrl = ref(LOCAL_PROXY_URL)
const proxyOnline = ref(false)
const proxyChecking = ref(false)
let proxyTimer: number | undefined

// HTTPS 页面会按混合内容策略拦截 ws://127.0.0.1，本地直连必须在本机 http/localhost 下访问
const mixedContentBlocked = computed(
  () => typeof window !== 'undefined' && window.location?.protocol === 'https:'
)

const localNet = reactive({ host: '192.168.1.10', port: 502 })
const cloudNet = reactive({ host: '', port: 502 })
const activeNet = computed(() => (mode.value === 'local' ? localNet : cloudNet))
const sim = reactive({ responseDelayMs: 30, packetLossPercent: 0 })

// 进入页面即探测本地代理是否运行，决定「本地直连」面板的状态提示
onMounted(() => {
  checkProxy()
  startProxyPolling()
})

// 在「本地直连」模式下每 3 秒自动重新探测，代理启动后状态会自动翻成「已运行」
function startProxyPolling() {
  stopProxyPolling()
  proxyTimer = window.setInterval(() => {
    if (mode.value === 'local') checkProxy()
  }, 3000)
}

function stopProxyPolling() {
  if (proxyTimer !== undefined) {
    clearInterval(proxyTimer)
    proxyTimer = undefined
  }
}

onUnmounted(() => {
  stopProxyPolling()
})

function checkProxy() {
  proxyChecking.value = true
  // 用普通 HTTP GET 探活：代理对无 WebSocket 握手的 GET 返回 200，
  // 既能确认代理在运行，又不会真的去连某个目标端口（避免日志刷屏）。
  const httpUrl = proxyUrl.value.trim().replace(/^ws/, 'http') + '/'
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 2000)
  fetch(httpUrl, { mode: 'no-cors', signal: ctrl.signal })
    .then(() => {
      proxyOnline.value = true
    })
    .catch(() => {
      proxyOnline.value = false
    })
    .finally(() => {
      clearTimeout(timer)
      proxyChecking.value = false
    })
}

const {
  connected,
  connecting,
  connect,
  disconnect,
  execute,
  executeRaw,
  previewFrame,
  startPolling,
  stopPolling
} = useModbusChannel('tcp', 'tcp')

const { form, options, parsedValues, validationErrors, isValid } = useRequestForm({
  quantity: 8
})

const isPolling = ref(false)
const previewHex = computed(() => previewFrame(options.value))

// 切换连接方式时同步默认地址，并刷新本地代理状态
watch(mode, (m) => {
  if (m === 'cloud') bridgeUrl.value = DEFAULT_CLOUD_URL
  if (m === 'local') checkProxy()
})

const bridgePlaceholder = computed(() => DEFAULT_CLOUD_URL)

const modeDescription = computed(() => {
  switch (mode.value) {
    case 'simulator':
      return `浏览器内置的 Modbus TCP 从站，<b>无需任何设备或后端</b>。
        保持寄存器预置了递增值，输入寄存器有随时间变化的正弦波、计数器与浮点流量值，
        适合学习报文结构和验证界面逻辑。`
    case 'cloud':
      return '通过部署在 Cloudflare 上的 Pages Function 建立 TCP 连接。'
    case 'local':
      return ''
    default:
      return ''
  }
})

function buildTransport() {
  if (mode.value === 'simulator') {
    return new SimulatorTransport({
      mode: 'tcp',
      responseDelayMs: sim.responseDelayMs,
      packetLossRate: sim.packetLossPercent / 100
    })
  }
  if (mode.value === 'local') {
    return new WebSocketTransport({
      bridgeUrl: proxyUrl.value,
      host: activeNet.value.host,
      port: activeNet.value.port
    })
  }
  const cloudUrl = (() => {
    const base = bridgeUrl.value.trim()
    const t = cloudToken.value.trim()
    if (!t) return base
    return base + (base.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t)
  })()
  return new WebSocketTransport({
    bridgeUrl: cloudUrl,
    host: activeNet.value.host,
    port: activeNet.value.port
  })
}

async function toggleConnection() {
  if (connected.value) {
    isPolling.value = false
    await disconnect()
    ElMessage.info('连接已断开')
    return
  }

  if (mode.value !== 'simulator' && !activeNet.value.host.trim()) {
    ElMessage.warning('请填写目标设备地址')
    return
  }

  if (mode.value === 'local' && !proxyOnline.value) {
    if (mixedContentBlocked.value) {
      ElMessage.warning('本地直连需在本机 http://localhost 下访问：HTTPS 页面会被浏览器拦截 ws://127.0.0.1')
    } else {
      ElMessage.warning('未检测到本地代理，请先双击 start-proxy.bat 启动 local-proxy')
    }
    return
  }

  try {
    await connect(buildTransport())
    ElMessage.success(
      mode.value === 'simulator'
        ? '模拟从站已启动，可以直接发送请求了'
        : `已连接 ${activeNet.value.host}:${activeNet.value.port}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ElMessageBox.alert(msg, '连接失败', {
      type: 'error',
      confirmButtonText: '知道了',
      dangerouslyUseHTMLString: false
    })
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

function showSimInfo() {
  ElMessageBox.alert(
    [
      '模拟从站数据分布：',
      '',
      '· 保持寄存器 0x0000-0x001F：预置为 100、200、300 …',
      '· 保持寄存器 0x0064 起：ASCII 标志串 "MODBUS-SIM"',
      '· 输入寄存器 0x0000：正弦波 0-65535',
      '· 输入寄存器 0x0001：递增计数器',
      '· 输入寄存器 0x0002：温度 ×10（25.0-35.0 ℃）',
      '· 输入寄存器 0x0004-0x0005：单精度浮点流量值',
      '· 线圈 / 离散输入 0x0000-0x001F：可读写，离散输入为跑马灯',
      '',
      '地址范围 0-1999，越界会返回标准异常码 0x02。'
    ].join('\n'),
    '内置模拟从站',
    { confirmButtonText: '知道了', customClass: 'sim-info-box' }
  )
}
</script>

<style scoped>
.mode-seg {
  width: 100%;
}

.mode-tip {
  margin-bottom: 18px;
}

.tip-body {
  font-size: 13px;
  line-height: 1.7;
}

.tip-body :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--mb-mono);
  font-size: 12px;
}

.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin-top: 4px;
}

.field-hint code {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--mb-mono);
}

.field-hint .ok {
  color: #67c23a;
  font-weight: 600;
}

.field-hint .warn {
  color: #e6a23c;
  font-weight: 600;
}

.retry-link {
  margin-left: 8px;
  font-size: 12px;
  vertical-align: baseline;
}

.mixed-warn {
  margin-top: 8px;
  padding: 6px 10px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  border-radius: 4px;
  color: #e6a23c;
  font-size: 12px;
  line-height: 1.6;
}

.mixed-warn code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--mb-mono);
}

.proxy-download {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  background: #f5f7fa;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
}

.proxy-download .dl-link {
  color: inherit;
  text-decoration: none;
}

.proxy-download .dl-note {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.proxy-download .dl-note code {
  background: #ebeef5;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--mb-mono);
}
</style>

<style>
.sim-info-box {
  max-width: 520px;
}
.sim-info-box .el-message-box__message {
  white-space: pre-line;
  font-size: 13px;
  line-height: 1.8;
}
</style>
