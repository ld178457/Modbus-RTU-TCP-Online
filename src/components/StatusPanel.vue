<template>
  <el-card class="mb-card">
    <template #header>
      <div class="card-header status-header">
        <span class="card-title">通信状态</span>
        <el-button size="small" text type="primary" @click="reset">重置统计</el-button>
      </div>
    </template>

    <div class="status-body">
      <!-- 统计指标 -->
      <div class="metric-grid">
        <div class="metric">
          <div class="metric-value tx">{{ stats.sent }}</div>
          <div class="metric-label">发送</div>
        </div>
        <div class="metric">
          <div class="metric-value rx">{{ stats.received }}</div>
          <div class="metric-label">成功</div>
        </div>
        <div class="metric">
          <div class="metric-value err">{{ stats.errors }}</div>
          <div class="metric-label">错误</div>
        </div>
        <div class="metric">
          <div class="metric-value warn">{{ stats.timeouts }}</div>
          <div class="metric-label">超时</div>
        </div>
      </div>

      <div class="rate-row">
        <span class="rate-label">成功率</span>
        <el-progress
          :percentage="successRate"
          :status="rateStatus"
          :stroke-width="10"
          style="flex: 1"
        />
      </div>

      <div class="rtt-row">
        <span>响应时间</span>
        <span class="rtt-values">
          <el-tag size="small" type="info">当前 {{ stats.lastRttMs }}ms</el-tag>
          <el-tag size="small" type="info">最小 {{ stats.minRttMs }}ms</el-tag>
          <el-tag size="small" type="info">最大 {{ stats.maxRttMs }}ms</el-tag>
        </span>
      </div>

      <el-alert
        v-if="lastError"
        :title="lastError"
        type="error"
        :closable="false"
        show-icon
        class="error-alert"
      />

      <!-- 报文字段拆解 -->
      <el-divider content-position="left">
        <span class="divider-text">报文字段解析</span>
      </el-divider>

      <div v-if="fields.length === 0" class="fields-empty">收到响应后，各字段含义会在此逐条列出</div>

      <el-table v-else :data="fields" size="small" border class="field-table">
        <el-table-column prop="name" label="字段" width="96" />
        <el-table-column label="值" width="128">
          <template #default="{ row }">
            <span class="mono">{{ row.hex }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="180" show-overflow-tooltip />
      </el-table>
    </div>
  </el-card>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useStore } from 'vuex'
import type { ChannelStats } from '@/store/modules/channel'

const props = defineProps<{ channel: 'rtu' | 'tcp' }>()
const store = useStore()

const stats = computed<ChannelStats>(() => store.getters[`${props.channel}/stats`])
const successRate = computed<number>(() => store.getters[`${props.channel}/successRate`])
const lastError = computed<string>(() => store.getters[`${props.channel}/lastError`])
const fields = computed(() => store.getters[`${props.channel}/lastFrameFields`])

const rateStatus = computed(() => {
  if (stats.value.sent === 0) return undefined
  if (successRate.value >= 95) return 'success'
  if (successRate.value >= 70) return 'warning'
  return 'exception'
})

function reset() {
  store.dispatch(`${props.channel}/resetStats`)
}
</script>

<style scoped>
.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.metric {
  text-align: center;
  padding: 8px 4px;
  background: #f7f9fc;
  border-radius: 6px;
}

.metric-value {
  font-size: 20px;
  font-weight: 700;
  font-family: 'Cascadia Mono', Consolas, monospace;
  line-height: 1.2;
}

.metric-value.tx {
  color: #3b82f6;
}
.metric-value.rx {
  color: #67c23a;
}
.metric-value.err {
  color: #f56c6c;
}
.metric-value.warn {
  color: #e6a23c;
}

.metric-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.rate-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.rate-label {
  font-size: 13px;
  color: #606266;
  flex-shrink: 0;
}

.rtt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}

.rtt-values {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.error-alert {
  margin-top: 12px;
}

.divider-text {
  font-size: 13px;
  color: #909399;
}

.fields-empty {
  font-size: 13px;
  color: #c0c4cc;
  text-align: center;
  padding: 16px 0;
}

.mono {
  font-family: 'Cascadia Mono', Consolas, monospace;
  color: #1f6feb;
  letter-spacing: 0.5px;
}
</style>
