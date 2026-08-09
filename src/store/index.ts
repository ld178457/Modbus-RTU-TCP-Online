import { createStore } from 'vuex'
import { createChannelModule } from './modules/channel'

/**
 * 两条调试通道各自独立持有状态，互不干扰：
 * 切到 TCP 页面时 RTU 的日志与统计仍然保留。
 *
 * strict 模式在开发环境下会对每次 mutation 做深度比对，
 * 而本工具在高频轮询时每秒可能产生上百条日志，
 * 开启后会造成明显掉帧，因此显式关闭。
 */
export default createStore({
  modules: {
    rtu: createChannelModule(),
    tcp: createChannelModule()
  },
  strict: false
})
