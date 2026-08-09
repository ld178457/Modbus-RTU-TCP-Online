<template>
  <div class="mb-page">
    <div class="mb-page-header">
      <div class="title-block">
        <h2 class="mb-page-title">使用帮助</h2>
        <span class="mb-page-desc">浏览器版本限制 · 三种连接方式 · 常见问题</span>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="14">
        <el-card class="mb-card">
          <template #header>
            <div class="card-header"><span class="card-title">浏览器能做 / 不能做什么</span></div>
          </template>
          <el-alert type="warning" :closable="false" class="mb-alert">
            浏览器出于安全限制，<b>无法直接打开串口或原始 TCP socket</b>。本工具用下面三种方式绕开这个限制。
          </el-alert>
          <el-table :data="rows" size="small" border>
            <el-table-column prop="feature" label="能力" width="150" />
            <el-table-column prop="rtu" label="RTU（串口）" />
            <el-table-column prop="tcp" label="TCP（以太网）" />
          </el-table>
        </el-card>

        <el-card class="mb-card">
          <template #header>
            <div class="card-header"><span class="card-title">Modbus TCP 的三种连接方式</span></div>
          </template>
          <el-steps direction="vertical" :active="0" finish-status="success">
            <el-step
              title="模拟从站（零配置，开箱即玩）"
              description="浏览器内置一个真实的 Modbus 从站，时序数据实时变化，无需任何后端或设备，适合学习和验证界面。"
            />
            <el-step
              title="云代理（Cloudflare Pages Function）"
              description="部署到 Cloudflare 后默认启用，由云端代为建立 TCP 连接。只能访问公网可直达的设备，连不到你的局域网 PLC。"
            />
            <el-step
              title="本地直连（本地代理，全平台可用）"
              description="双击 local-proxy/start-proxy.bat 启动本地代理后，浏览器用 WebSocket 把报文交给代理，由代理用原生 TCP 发往局域网设备。操作极简：填好 IP + 端口，点「建立连接」即可，无需浏览器扩展、不依赖 Chrome OS。"
            />
          </el-steps>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="10">
        <el-card class="mb-card">
          <template #header>
            <div class="card-header"><span class="card-title">RTU 串口使用须知</span></div>
          </template>
          <ul class="tip-list">
            <li>
              Web Serial API <b>仅 Chromium 内核浏览器</b>支持
              （Chrome / Edge / Brave / Opera）。Safari 与 Firefox 暂不支持，可用 TCP 的「公网云代理」模式（需设备公网可达）或 TCP/串口网关替代。
            </li>
            <li>
              页面必须运行在 <b>HTTPS</b> 或 <code>localhost</code> 下，否则浏览器禁用串口权限。
              部署到 Cloudflare Pages 后天然满足。
            </li>
            <li>浏览器<b>不会暴露 COM 口号</b>，需点击「选择串口」在系统弹窗里手动授权。</li>
            <li>首次连接建议确认 <b>波特率、数据位、停止位、校验位</b>与设备一致，A/B 线不要接反。</li>
          </ul>
        </el-card>

        <el-card class="mb-card">
          <template #header>
            <div class="card-header"><span class="card-title">常见问题</span></div>
          </template>
          <el-collapse>
            <el-collapse-item title="为什么 RTU 页面点不开串口？" name="1">
              多数情况是：① 用了 Firefox/Safari；② 在 http（非 localhost）下打开；③ 系统没有授予串口权限。优先改用 Chrome/Edge 并通过 HTTPS 或本地服务访问。
            </el-collapse-item>
            <el-collapse-item title="TCP 云代理连不上我的 PLC？" name="2">
              云端 Function 处于公网，只能访问有公网 IP 的设备。局域网内的 PLC 请用「本地直连」模式（双击 local-proxy/start-proxy.bat 启动本地代理后填 IP + 端口即可）。
            </el-collapse-item>
            <el-collapse-item title='本地直连点「建立连接」提示"未检测到本地代理"？' name="5">
              这是因为浏览器没有 raw socket 权限，必须靠本地代理把 WebSocket 转成真实 TCP。请先双击
              <code>local-proxy/start-proxy.bat</code> 启动代理（保持窗口打开），再点「检测」刷新状态，然后连接。
              该方式不依赖 Chrome OS，Windows / macOS / Linux 桌面浏览器均可使用。
            </el-collapse-item>
            <el-collapse-item title="本地直连（本地代理）怎么用？" name="6">
              在<b>本机</b>双击 <code>local-proxy/start-proxy.bat</code> 启动本地代理（保持窗口打开），
              网页选「本地直连」→ 填设备 <b>IP + 端口（默认 502）</b> → 点「建立连接」即可收发报文，
              体验与 RTU 调试一致（即连即传）。本地代理把浏览器 WebSocket 翻译成真实 TCP 发往设备，
              无需浏览器扩展、不依赖 Chrome OS。
            </el-collapse-item>
            <el-collapse-item title="读写功能码报错 0x02 / 0x03？" name="3">
              0x02 是地址越界，0x03 是数量超限。请检查起始地址 + 数量是否落在从站地址空间内（保持寄存器读写上限 125，线圈 2000）。
            </el-collapse-item>
            <el-collapse-item title="模拟从站的数据会变化吗？" name="4">
              会。输入寄存器持续刷新（正弦波、计数器、温度、浮点流量），离散输入是跑马灯效果，看起来就像连着真实设备。
            </el-collapse-item>
          </el-collapse>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script lang="ts" setup>
const rows = [
  { feature: '读线圈/离散输入', rtu: '✅ 支持', tcp: '✅ 支持' },
  { feature: '读保持/输入寄存器', rtu: '✅ 支持', tcp: '✅ 支持' },
  { feature: '写单个/多个', rtu: '✅ 支持', tcp: '✅ 支持' },
  { feature: '直连串口', rtu: '✅ 需 HTTPS+Chromium', tcp: '❌ 不支持' },
  { feature: '直连 TCP 502', rtu: '❌ 不支持', tcp: '需经中转' },
  { feature: '离线/无设备调试', rtu: '❌', tcp: '✅ 模拟从站' }
]
</script>

<style scoped>
.mb-alert {
  margin-bottom: 16px;
}
.tip-list {
  padding-left: 18px;
  line-height: 1.9;
  font-size: 13px;
  color: #303133;
}
.tip-list code {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--mb-mono);
}
</style>
