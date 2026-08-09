import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
import RTU from '../views/RTU.vue'

const routes: Array<RouteRecordRaw> = [
  { path: '/', redirect: '/rtu' },
  {
    path: '/rtu',
    name: 'RTU',
    component: RTU,
    meta: { title: 'Modbus RTU 在线调试' }
  },
  {
    // TCP 与帮助页按需加载，首屏只需要 RTU 一个页面的代码
    path: '/tcp',
    name: 'TCP',
    component: () => import(/* webpackChunkName: "tcp" */ '../views/TCP.vue'),
    meta: { title: 'Modbus TCP 在线调试' }
  },
  {
    path: '/help',
    name: 'Help',
    component: () => import(/* webpackChunkName: "help" */ '../views/Help.vue'),
    meta: { title: '使用帮助' }
  },
  // 兼容旧的大写路径书签
  { path: '/TCP', redirect: '/tcp' },
  { path: '/:pathMatch(.*)*', redirect: '/rtu' }
]

const router = createRouter({
  // 使用 hash 模式：静态托管无需任何服务端重写规则，刷新任意页面都不会 404
  history: createWebHashHistory(process.env.BASE_URL),
  routes
})

router.afterEach((to) => {
  const title = to.meta?.title as string | undefined
  document.title = title ? `${title} · Modbus Online` : 'Modbus 协议在线调试工具'
})

export default router
