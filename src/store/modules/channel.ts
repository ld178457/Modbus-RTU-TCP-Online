/**
 * 通道状态模块工厂
 *
 * RTU 与 TCP 的界面状态需求完全一致（收发日志、统计、连接状态），
 * 因此用工厂生成两个命名空间模块，避免复制粘贴。
 *
 * 相比原实现的关键修正：
 *   原来发送和接收分别存在两个数组里，界面用 min(len1, len2) 双循环合并，
 *   一旦收发条数不等（超时、主动上报、多次重发）后面的记录就会被整段丢弃。
 *   现在改为单一有序日志流，天然按真实时序排列，不会丢任何一条。
 */

import type { Module } from 'vuex'
import { timestamp } from '@/core/modbus/format'

export type LogDirection = 'tx' | 'rx' | 'info' | 'error'

export interface LogEntry {
  id: number
  time: string
  dir: LogDirection
  /** 报文的十六进制表示 */
  hex: string
  /** 报文的 ASCII 表示 */
  ascii: string
  /** 附加说明：解析结论、异常原因等 */
  note: string
  /** 往返耗时，仅接收帧有值 */
  rttMs?: number
  /** 字节数 */
  size: number
}

export interface ChannelStats {
  sent: number
  received: number
  errors: number
  timeouts: number
  lastRttMs: number
  minRttMs: number
  maxRttMs: number
}

export interface ChannelState {
  log: LogEntry[]
  maxEntries: number
  autoScroll: boolean
  paused: boolean
  connected: boolean
  connecting: boolean
  /** 最近一次成功解析的响应，供寄存器面板渲染 */
  lastFrameFields: { name: string; hex: string; description: string }[]
  lastBits: boolean[]
  lastRegisters: number[]
  lastStartAddress: number
  lastFunctionCode: number
  lastError: string
  stats: ChannelStats
}

const emptyStats = (): ChannelStats => ({
  sent: 0,
  received: 0,
  errors: 0,
  timeouts: 0,
  lastRttMs: 0,
  minRttMs: 0,
  maxRttMs: 0
})

let entryId = 0

export interface PushLogPayload {
  dir: LogDirection
  hex: string
  ascii?: string
  note?: string
  rttMs?: number
  size?: number
}

export function createChannelModule(): Module<ChannelState, unknown> {
  return {
    namespaced: true,

    state: (): ChannelState => ({
      log: [],
      maxEntries: 300,
      autoScroll: true,
      paused: false,
      connected: false,
      connecting: false,
      lastFrameFields: [],
      lastBits: [],
      lastRegisters: [],
      lastStartAddress: 0,
      lastFunctionCode: 0x03,
      lastError: '',
      stats: emptyStats()
    }),

    getters: {
      log: (s) => s.log,
      maxEntries: (s) => s.maxEntries,
      autoScroll: (s) => s.autoScroll,
      paused: (s) => s.paused,
      connected: (s) => s.connected,
      connecting: (s) => s.connecting,
      stats: (s) => s.stats,
      lastBits: (s) => s.lastBits,
      lastRegisters: (s) => s.lastRegisters,
      lastStartAddress: (s) => s.lastStartAddress,
      lastFunctionCode: (s) => s.lastFunctionCode,
      lastFrameFields: (s) => s.lastFrameFields,
      lastError: (s) => s.lastError,
      /** 成功率，用于连接质量展示 */
      successRate: (s) => {
        const total = s.stats.sent
        if (total === 0) return 0
        return Math.round((s.stats.received / total) * 100)
      }
    },

    mutations: {
      PUSH_LOG(state, payload: PushLogPayload) {
        if (state.paused) return
        state.log.push({
          id: ++entryId,
          time: timestamp(),
          dir: payload.dir,
          hex: payload.hex,
          ascii: payload.ascii ?? '',
          note: payload.note ?? '',
          rttMs: payload.rttMs,
          size: payload.size ?? 0
        })
        // 超出上限时批量裁剪，避免每帧都做 shift() 造成的 O(n) 抖动
        const overflow = state.log.length - state.maxEntries
        if (overflow > 0) {
          state.log.splice(0, overflow)
        }
      },

      CLEAR_LOG(state) {
        state.log = []
      },

      SET_MAX_ENTRIES(state, value: number) {
        state.maxEntries = Math.max(10, Math.min(5000, Math.floor(value) || 300))
        const overflow = state.log.length - state.maxEntries
        if (overflow > 0) state.log.splice(0, overflow)
      },

      SET_AUTO_SCROLL(state, value: boolean) {
        state.autoScroll = value
      },

      SET_PAUSED(state, value: boolean) {
        state.paused = value
      },

      SET_CONNECTED(state, value: boolean) {
        state.connected = value
        if (!value) state.connecting = false
      },

      SET_CONNECTING(state, value: boolean) {
        state.connecting = value
      },

      SET_RESPONSE(
        state,
        payload: {
          bits?: boolean[]
          registers?: number[]
          startAddress: number
          functionCode: number
          fields: { name: string; hex: string; description: string }[]
        }
      ) {
        state.lastBits = payload.bits ?? []
        state.lastRegisters = payload.registers ?? []
        state.lastStartAddress = payload.startAddress
        state.lastFunctionCode = payload.functionCode
        state.lastFrameFields = payload.fields
        state.lastError = ''
      },

      SET_ERROR(state, message: string) {
        state.lastError = message
      },

      COUNT_SENT(state) {
        state.stats.sent++
      },

      COUNT_RECEIVED(state, rttMs: number) {
        const s = state.stats
        s.received++
        s.lastRttMs = rttMs
        s.maxRttMs = Math.max(s.maxRttMs, rttMs)
        s.minRttMs = s.minRttMs === 0 ? rttMs : Math.min(s.minRttMs, rttMs)
      },

      COUNT_ERROR(state) {
        state.stats.errors++
      },

      COUNT_TIMEOUT(state) {
        state.stats.timeouts++
      },

      RESET_STATS(state) {
        state.stats = emptyStats()
      },

      RESET_DATA(state) {
        state.lastBits = []
        state.lastRegisters = []
        state.lastFrameFields = []
        state.lastError = ''
      }
    },

    actions: {
      pushLog({ commit }, payload: PushLogPayload) {
        commit('PUSH_LOG', payload)
      },
      clearLog({ commit }) {
        commit('CLEAR_LOG')
      },
      setMaxEntries({ commit }, v: number) {
        commit('SET_MAX_ENTRIES', v)
      },
      setAutoScroll({ commit }, v: boolean) {
        commit('SET_AUTO_SCROLL', v)
      },
      setPaused({ commit }, v: boolean) {
        commit('SET_PAUSED', v)
      },
      setConnected({ commit }, v: boolean) {
        commit('SET_CONNECTED', v)
      },
      setConnecting({ commit }, v: boolean) {
        commit('SET_CONNECTING', v)
      },
      setResponse({ commit }, payload) {
        commit('SET_RESPONSE', payload)
      },
      setError({ commit }, message: string) {
        commit('SET_ERROR', message)
      },
      countSent({ commit }) {
        commit('COUNT_SENT')
      },
      countReceived({ commit }, rttMs: number) {
        commit('COUNT_RECEIVED', rttMs)
      },
      countError({ commit }) {
        commit('COUNT_ERROR')
      },
      countTimeout({ commit }) {
        commit('COUNT_TIMEOUT')
      },
      resetStats({ commit }) {
        commit('RESET_STATS')
      },
      resetData({ commit }) {
        commit('RESET_DATA')
      }
    }
  }
}
