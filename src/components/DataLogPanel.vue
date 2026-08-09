<template>
  <el-card class="mb-card log-card">
    <template #header>
      <div class="card-header log-header">
        <span class="card-title">收发数据</span>
        <div class="log-toolbar">
          <el-checkbox v-model="autoScroll" label="自动滚动" size="small" />
          <el-tooltip content="暂停后新报文不再记入日志，便于查看历史" placement="top">
            <el-checkbox v-model="paused" label="暂停" size="small" />
          </el-tooltip>

          <span class="toolbar-label">最大条数</span>
          <el-input-number
            v-model="maxEntries"
            :min="10"
            :max="5000"
            :step="50"
            size="small"
            controls-position="right"
            style="width: 108px"
          />

          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button value="HEX">HEX</el-radio-button>
            <el-radio-button value="ASCII">ASCII</el-radio-button>
          </el-radio-group>

          <el-button size="small" type="primary" :icon="CopyDocument" @click="copyAll">
            复制
          </el-button>
          <el-button size="small" type="success" :icon="Download" @click="exportLog">
            导出
          </el-button>
          <el-button size="small" type="warning" :icon="Delete" @click="clear">清空</el-button>
        </div>
      </div>
    </template>

    <div class="log-body">
      <el-scrollbar ref="scrollbarRef" :height="height">
        <div v-if="log.length === 0" class="log-empty">
          <el-icon :size="34"><ChatLineSquare /></el-icon>
          <p>暂无数据</p>
          <span>建立连接后发送请求，收发报文会实时显示在这里</span>
        </div>

        <div v-else class="log-list">
          <div v-for="item in log" :key="item.id" class="log-row" :class="`dir-${item.dir}`">
            <span class="log-time">{{ item.time }}</span>
            <span class="log-tag" :class="`tag-${item.dir}`">{{ dirLabel(item.dir) }}</span>
            <span v-if="item.size" class="log-size">{{ item.size }}B</span>
            <span v-if="item.rttMs !== undefined" class="log-rtt">{{ item.rttMs }}ms</span>
            <span class="log-data">{{ viewMode === 'HEX' ? item.hex : item.ascii }}</span>
            <span v-if="item.note" class="log-note">{{ item.note }}</span>
          </div>
        </div>
      </el-scrollbar>
    </div>
  </el-card>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'
import { CopyDocument, Delete, Download, ChatLineSquare } from '@element-plus/icons-vue'
import type { LogDirection, LogEntry } from '@/store/modules/channel'

const props = withDefaults(
  defineProps<{
    channel: 'rtu' | 'tcp'
    height?: string
  }>(),
  { height: '430px' }
)

const store = useStore()
const scrollbarRef = ref<{ setScrollTop: (n: number) => void } | null>(null)
const viewMode = ref<'HEX' | 'ASCII'>('HEX')

const log = computed<LogEntry[]>(() => store.getters[`${props.channel}/log`])

// 三个开关通过 getter/setter 双向绑定到 store，保证切换页面后设置不丢失
const autoScroll = computed({
  get: () => store.getters[`${props.channel}/autoScroll`] as boolean,
  set: (v: boolean) => store.dispatch(`${props.channel}/setAutoScroll`, v)
})
const paused = computed({
  get: () => store.getters[`${props.channel}/paused`] as boolean,
  set: (v: boolean) => store.dispatch(`${props.channel}/setPaused`, v)
})
const maxEntries = computed({
  get: () => store.getters[`${props.channel}/maxEntries`] as number,
  set: (v: number) => store.dispatch(`${props.channel}/setMaxEntries`, v)
})

const dirLabel = (dir: LogDirection) =>
  ({ tx: '发送', rx: '接收', info: '提示', error: '错误' })[dir]

// 新日志到达后滚到底部。用 nextTick 等 DOM 更新完成，
// 直接给一个足够大的值即可命中底部，避免读取 scrollHeight 触发重排。
watch(
  () => log.value.length,
  async () => {
    if (!autoScroll.value) return
    await nextTick()
    scrollbarRef.value?.setScrollTop(log.value.length * 40 + 10000)
  }
)

function buildText(): string {
  return log.value
    .map((it) => {
      const parts = [`[${it.time}]`, dirLabel(it.dir)]
      if (it.rttMs !== undefined) parts.push(`${it.rttMs}ms`)
      const data = viewMode.value === 'HEX' ? it.hex : it.ascii
      if (data) parts.push(data)
      if (it.note) parts.push(`// ${it.note}`)
      return parts.join(' ')
    })
    .join('\n')
}

async function copyAll() {
  if (log.value.length === 0) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  const text = buildText()
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      // 非安全上下文下 Clipboard API 不可用，退回到 execCommand
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success(`已复制 ${log.value.length} 条记录`)
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

function exportLog() {
  if (log.value.length === 0) {
    ElMessage.warning('没有可导出的内容')
    return
  }
  const blob = new Blob([buildText()], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `modbus-${props.channel}-${Date.now()}.log`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('日志已导出')
}

function clear() {
  store.dispatch(`${props.channel}/clearLog`)
}
</script>

<style scoped>
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.log-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.toolbar-label {
  font-size: 13px;
  color: #606266;
  font-weight: normal;
}

.log-body {
  padding: 8px;
  background-color: #fcfdff;
  border: 1px solid rgba(4, 162, 225, 0.35);
  border-radius: 6px;
}

.log-list {
  font-family: 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
}

.log-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  border-left: 3px solid transparent;
}

.log-row:hover {
  background-color: #f2f6fc;
}

.dir-tx {
  border-left-color: #3b82f6;
}
.dir-rx {
  border-left-color: #119a43;
}
.dir-error {
  border-left-color: #f56c6c;
  background-color: #fef6f6;
}
.dir-info {
  border-left-color: #c0c4cc;
}

.log-time {
  color: #86868b;
  flex-shrink: 0;
}

.log-tag {
  flex-shrink: 0;
  font-weight: 700;
  min-width: 32px;
}
.tag-tx {
  color: #3b82f6;
}
.tag-rx {
  color: #119a43;
}
.tag-error {
  color: #f56c6c;
}
.tag-info {
  color: #909399;
}

.log-size,
.log-rtt {
  flex-shrink: 0;
  font-size: 11px;
  color: #909399;
  background: #f0f2f5;
  padding: 0 5px;
  border-radius: 3px;
}

.log-data {
  word-break: break-all;
  flex: 1 1 260px;
  color: #303133;
  letter-spacing: 0.4px;
}

.log-note {
  flex: 1 1 100%;
  font-size: 12px;
  color: #909399;
  padding-left: 4px;
  font-family: system-ui, -apple-system, 'Microsoft YaHei', sans-serif;
}

.log-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #c0c4cc;
}

.log-empty p {
  margin: 10px 0 4px;
  font-size: 15px;
  color: #909399;
}

.log-empty span {
  font-size: 13px;
}
</style>
