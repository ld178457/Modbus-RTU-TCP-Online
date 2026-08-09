# Modbus RTU / TCP 在线调试工具

打开浏览器就能用的 Modbus 调试台。串口设备走 **Web Serial**，以太网设备走 **Modbus TCP**，
不用装上位机、不用配环境，网页里直接发报文、看寄存器、读日志。

> 在线地址：部署到 Cloudflare Pages 后填在这里 → `https://<你的项目>.pages.dev`

---

## 功能一览

| 能力 | 说明 |
| --- | --- |
| **Modbus RTU** | 通过 Web Serial API 直连本机串口 / USB 转 232、485 |
| **Modbus TCP** | 三种连接方式：内置模拟从站、本地代理直连、公网云代理 |
| **功能码** | 01 读线圈、02 读离散输入、03 读保持寄存器、04 读输入寄存器、05 写单线圈、06 写单寄存器、0F 写多线圈、10 写多寄存器 |
| **数据视图** | 寄存器表格支持十进制 / 十六进制 / 二进制，以及有符号、浮点解析 |
| **报文日志** | 收发原始帧十六进制打印，CRC / MBAP 校验与异常码解析 |
| **轮询** | 可设定周期自动重复请求，实时刷新数据 |

技术栈：Vue 3 + TypeScript + Element Plus + Vue Router + Vuex，构建器为 Vue CLI 5（webpack）。
路由使用 hash 模式，任何静态托管平台刷新都不会 404。

---

## 三种 TCP 连接方式怎么选

浏览器出于安全限制**不能直接建立原始 TCP 连接**，所以访问真实设备必须有一层中转。

### 1. 内置模拟从站（零配置）

页面里跑一个假的 Modbus 从站，用来熟悉界面、验证报文格式、演示教学。不需要任何设备。

### 2. 本地直连（推荐，用于调试身边的设备）

在你自己的电脑上跑一个极小的 Python 中继脚本，网页通过 `ws://127.0.0.1:8765` 把报文交给它，
它再用真正的 TCP 连接你的 PLC / 网关。数据不出内网。

**使用步骤**

1. 在 TCP 页面点「下载本地代理脚本」，得到 `modbus-local-proxy.zip`；
2. 解压后**双击 `start-proxy.bat`**（需要本机装有 Python 3.8+）；
3. 看到 `Listening on ws://127.0.0.1:8765` 即启动成功，网页上的状态会自动变成「运行中」；
4. 在网页填写**设备**的 IP 和 Modbus 端口（通常是 `502`），点击建立连接。

> ⚠️ 两个端口别搞混：
> `8765` 是本地代理自己的监听端口，前端写死，**不要改**；
> `502` 是你的 Modbus 设备端口，填在网页的「目标端口」里。

> ⚠️ 浏览器不允许 HTTPS 页面连接 `ws://` 明文地址。若线上站点是 HTTPS，
> 本地直连请改用 `http://localhost:8080` 本地运行本项目，或使用下面的公网云代理。

**手动启动（macOS / Linux）**

```bash
python3 local-proxy/modbus_relay.py         # 默认监听 127.0.0.1:8765
python3 local-proxy/modbus_relay.py --port 8765
```

### 3. 公网云代理（访客零安装）

由 Cloudflare Pages Functions（`functions/api/modbus-proxy.ts`，基于 `cloudflare:sockets`）
在云端替浏览器建立 TCP 连接。适合设备**有公网 IP 或已做端口映射**的场景。

可选安全配置（在 Cloudflare 控制台设置环境变量）：

| 变量名 | 作用 |
| --- | --- |
| `PROXY_AUTH_TOKEN` | 访问令牌，设置后请求必须携带 `?token=...` |
| `ALLOWLIST` | 目标白名单，形如 `10.0.0.5:502,plc.example.com:502` |

> 内网设备（NAT 后、无公网 IP）云代理无法直接触达，请用「本地直连」，
> 或自行用 cloudflared / frp 之类的隧道把设备端口暴露到公网后再填写。

---

## Modbus RTU 使用须知

- 需要 **Chromium 内核浏览器**：Chrome / Edge / Opera 89+，桌面端；Firefox 与 Safari 不支持 Web Serial。
- 页面必须运行在 **HTTPS** 或 `http://localhost` 下，否则浏览器不会弹出串口选择框。
- 点击「打开串口」后在弹窗中选择设备，设置波特率、数据位、停止位、校验位后即可收发。

---

## 本地开发

```bash
# 1. 安装依赖（Node.js 18+）
npm install

# 2. 启动开发服务器，默认 http://localhost:8080
npm run serve

# 3. 生产构建，产物在 dist/
npm run build

# 4.（可选）单独启动本地 Modbus 中继
npm run proxy
```

## 目录结构

```
.
├── functions/api/modbus-proxy.ts   # Cloudflare Pages Function：云端 TCP 中转
├── local-proxy/                    # 本地 WebSocket ↔ TCP 中继（Python + 一键 bat）
│   ├── modbus_relay.py
│   └── start-proxy.bat
├── public/
│   ├── local-proxy/                # 供网页下载的代理脚本压缩包
│   └── _redirects                  # SPA 回退规则
├── src/
│   ├── core/modbus/                # 协议层：编解码、CRC、常量、格式化
│   ├── core/transport/             # 传输层：串口 / WebSocket / 模拟器
│   ├── components/                 # 请求表单、寄存器表格、日志面板等
│   └── views/                      # RTU / TCP / 帮助 三个页面
├── wrangler.toml                   # Cloudflare Pages 配置（含 sockets 兼容标志）
└── DEPLOY.md                       # 详细部署指南
```

---

## 部署

推荐 **Cloudflare Pages**：静态前端与云代理 Function 一次部署搞定。

1. 把仓库推送到 GitHub；
2. Cloudflare Dashboard → Workers & Pages → 创建 → Pages → 连接到 Git；
3. 框架预设选 **Vue.js**，构建命令 `npm run build`，输出目录 `dist`；
4. 在 Settings → Functions → Compatibility flags 中加上 `sockets`（云代理必需）；
5. 保存并部署，之后每次 `git push` 都会自动重新发布。

完整图文步骤、自定义域名、`wrangler` 命令行部署方式见 **[DEPLOY.md](./DEPLOY.md)**。

> 关于 GitHub Pages：纯静态托管**不支持** Pages Functions，部署后「公网云代理」会失效，
> 只剩模拟从站与本地直连可用。所以本项目不提供 GitHub Pages 工作流。

---

## 常见问题

**Q：点了下载脚本，双击 bat 一闪而过？**
A：多半是没装 Python。安装 Python 3.8+ 并勾选 “Add to PATH”，或直接用命令行运行 `python local-proxy/modbus_relay.py`。

**Q：本地代理显示“运行中”，但连接设备失败？**
A：检查网页填的目标 IP/端口是否是**设备**的地址（一般 502），以及本机能否 `telnet <ip> 502` 通。

**Q：连上几秒后自动断开？**
A：请使用仓库内最新版 `modbus_relay.py`，旧版本存在空闲超时会掐断连接的问题。

**Q：RTU 页面点不出串口选择框？**
A：换 Chrome / Edge，并确认地址是 HTTPS 或 localhost。

---

## 许可

MIT License，可自由用于学习与商用改造。
