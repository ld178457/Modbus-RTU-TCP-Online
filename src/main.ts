import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
// @ts-ignore
import store from './store'
import './assets/styles/common.css'

// Element Plus 按需引入：
// 模板里的 <el-*> 组件由 unplugin-vue-components 自动注册并注入样式，
// 这里只需手动引入「指令式」组件（ElMessage / ElMessageBox）的样式，
// 因为这类组件不走模板解析，解析器无法自动补全其 CSS。
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

createApp(App).use(store).use(router).mount('#app')
