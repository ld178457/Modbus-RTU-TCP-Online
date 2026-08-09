# 部署到 Cloudflare Pages

本指南教你把「Modbus 在线调试工具」（RTU 串口 + TCP 以太网）部署到 Cloudflare Pages，
让任何人都能通过浏览器访问。工具同时支持：

- **RTU**：依赖浏览器 Web Serial API（需 HTTPS + Chromium 内核浏览器）。
- **TCP**：三种连接方式 —— 内置模拟从站 / 本地直连（本地代理，全平台可用）/ 公网云代理。

---

## 一、前置准备

| 项目 | 说明 |
| --- | --- |
| Node.js | 18+（本项目在 Node 22 下验证） |
| 包管理器 | npm（已随 Node 安装） |
| Cloudflare 账号 | 免费版即可，[注册地址](https://dash.cloudflare.com/sign-up) |
| Git 仓库（方式一需要） | GitHub / GitLab / Bitbucket 任一，用于方式一连接部署 |

> 本项目**保留 Vue CLI（webpack）构建**，构建命令为 `npm run build`，产物目录为 `dist`。

---

## 二、方式一：Git 连接部署（推荐，最省心）

适合希望「推送代码即自动部署」的场景。

### 1. 把代码推送到 Git 仓库

```bash
git add .
git commit -m "feat: 支持 Modbus RTU/TCP 在线调试"
git push
```

> 注意：`functions/` 目录必须随代码一起提交（它包含云代理中转逻辑），
> 而 `dist/` 已被 `.gitignore` 忽略，由 Cloudflare 在构建时生成，无需提交。

### 2. 在 Cloudflare 控制台创建 Pages 项目

1. 打开 [Cloudflare Dashboard → Workers & Pages → 创建 → Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)。
2. 选择 **连接到 Git**，授权并选中你的仓库。
3. 设置**构建设置**：
   - **Framework preset（框架预设）**：选 **Vue.js**（会自动填好下面两项）；
   - 或选 **None（无）** 并手动填写：
     - **Build command（构建命令）**：`npm run build`
     - **Build output directory（构建输出目录）**：`dist`
4. 点击 **保存并部署**。

### 3. 设置 Functions 兼容标志（关键！）

云代理中转 `functions/api/modbus-proxy.ts` 用到了 `cloudflare:sockets`，
**必须**为 Functions 开启 `sockets` 兼容标志，否则部署后云代理模式会报
`The module 'cloudflare:sockets' ... was not found`：

- 进入项目 → **Settings → Functions → Compatibility flags**
- 在 **Compatibility flags** 中添加一行：`sockets`
- 同时把 **Compatibility date** 设为 `2024-11-01` 或更新

> 如果用方式二（wrangler）部署，`wrangler.toml` 已写好这个标志，无需手动设置。

### 4. 等待构建完成

构建成功后，Cloudflare 会给你一个 `*.pages.dev` 域名，例如
`https://modbus-online.pages.dev`。以后每次 `git push` 都会自动重新部署。

---

## 三、方式二：用 Wrangler 命令行部署

适合不想连 Git、直接用本地构建产物部署的场景。

```bash
# 1. 安装依赖并构建
npm install
npm run build

# 2. 首次使用需登录 Cloudflare（按提示在浏览器完成授权）
npx wrangler login

# 3. 部署 dist 目录
npm run deploy
# 等价于：npx wrangler pages deploy dist
```

`wrangler.toml` 已包含：

```toml
name = "modbus-online"
pages_build_output_dir = "dist"
compatibility_date = "2024-11-01"
compatibility_flags = ["sockets"]   # 云代理 Function 需要
```

部署完成后终端会输出访问地址。

---

## 四、验证部署

1. 打开你的 `*.pages.dev` 地址。
2. 进入 **Modbus TCP** 页面（`/#/tcp`）。
3. 连接方式选 **模拟从站**（默认），点 **建立连接**。
4. 在右侧「发送请求」里选功能码 `03 读保持寄存器`，点 **发送**。
5. 能看到请求帧（TX）与响应帧（RX）以及寄存器数据，说明链路正常 ✅。

接着可以试：

- **本地直连**：选「本地直连」，先双击 `local-proxy/start-proxy.bat` 启动本地代理，再填设备 **IP + 端口** 点连接即可（全平台可用，无需浏览器扩展）。
- **公网云代理**：选「公网云代理」，目标地址填一个**公网可达**的 Modbus TCP 设备 IP，
  端口 `502`，建立连接后即可收发。

---

## 四·补：安全加固与零安装上线清单

### ① RTU + ② TCP 云代理 = 访客零安装

部署到 Cloudflare Pages 后，访问者**无需下载任何东西**：

- **RTU**：用浏览器 Web Serial API（Chrome / Edge 桌面版），本机插好 USB 串口即连；
- **TCP 公网设备**：TCP 页面选「公网云代理」，填公网可达的 IP + 端口即连（走部署的 Pages Function）。

这正是你要的「网页端操作调试、零下载零安装」闭环，适用于设备有公网地址的场景。

### 多人访问前的必做安全项

云代理 Function 会按访客填的 IP 开真实 TCP，等于一个**开放代理**。
公网多用户访问前，二选一加固（两者都不设也能跑，但仅建议内网/测试用）：

1. **设置 `ALLOWLIST`（推荐，不破坏零安装体验）**：仅放行你自己的设备。
   支持「精确 IPv4 / IPv4 CIDR / 主机名后缀」，逗号分隔。例如：
   `203.0.113.10,10.0.0.0/8,.my-plc.example.com`。
   设置后目标不在白名单内会返回 `403`。
2. **设置 `PROXY_AUTH_TOKEN`**：要求访客在「公网云代理 → 访问令牌」里填正确令牌，否则 `401`。
   （开启后把令牌分享给可信任的人即可；不填则所有人可用，慎用于公网。）

> 设置位置：Cloudflare 控制台 → 你的 Pages 项目 → **Settings → Functions → Environment variables**，
> 添加 `ALLOWLIST` / `PROXY_AUTH_TOKEN`（保存即生效，无需重新部署）。

### 零安装上线检查清单

- [ ] `npm run build` 成功，产出 `dist/`
- [ ] Pages 项目已开启 `sockets` 兼容标志（Settings → Functions → Compatibility flags 含 `sockets`）
- [ ] 已设置 `ALLOWLIST`（公网多用户必做）
- [ ] 部署后打开 `*.pages.dev`：RTU 页面在 Chrome/Edge 可识别串口；TCP 页面「公网云代理」填公网 IP 可正常收发

---

## 五：本地直连（本地代理，全平台可用）

浏览器没有 raw socket 权限，纯网页无法直连局域网设备。本项目附带一个**本地代理**
（`local-proxy/modbus_relay.py`，纯 Python 标准库、零依赖），它在本机起一个 WebSocket
服务，把浏览器发来的 Modbus 报文用**原生 TCP** 转发到局域网 PLC，再把响应原样回传——
这就是「网口调试助手」式的即连即传体验，且**无需浏览器扩展、不依赖 Chrome OS**。

> 原理：浏览器 ↔ `ws://127.0.0.1:8765` ↔ 本地代理 ↔ 真实 TCP 502 ↔ PLC。
> 本地代理只在你本机运行，不会上传任何数据。

### 1. 启动本地代理（每次调试前）

- 最简单：双击 `local-proxy/start-proxy.bat`；
- 或命令行：`python local-proxy/modbus_relay.py`（默认监听 `127.0.0.1:8765`，可加端口参数覆盖）。
- 启动后**保持窗口打开**，TCP 页面的「本地直连」面板会显示「已运行」。

### 2. 使用

1. TCP 页面 → 连接方式选 **本地直连**；
2. 填好设备 **IP 地址** 与 **端口（默认 502）**；
3. 点 **建立连接** → 发送请求即可收发报文。

---

## 六、云代理 Function 说明

`functions/api/modbus-proxy.ts` 是 Pages Functions 的源码，**随仓库一起部署，无需单独上传**。
它做的事很简单：

- 收到浏览器 WebSocket 连接 `wss://<你的域名>/api/modbus-proxy?host=<IP>&port=<端口>`；
- 在 Cloudflare 边缘节点用 `cloudflare:sockets` 建立到目标设备的 TCP 连接；
- 把浏览器发来的 Modbus TCP 报文原样写入 TCP，把设备响应原样回传（二进制透传）；
- 通过文本控制帧 `{type:'ready'|'error'|'closed'}` 通知前端连接状态。

子协议与前端 `src/core/transport/WebSocketTransport.ts` 完全一致，
「本地直连」与「公网云代理」复用同一套报文格式（均由 `WebSocketTransport` 承载），可在三种 TCP 模式间无缝切换。

---

## 七、常见问题（FAQ）

**Q：RTU 串口页面点不开「选择串口」？**
- Web Serial API 仅 Chromium 内核浏览器支持（Chrome / Edge / Brave / Opera），
  Safari、Firefox 不支持。请用支持的设备，或改用 TCP 的「公网云代理」+ 串口服务器。
- 页面必须在 **HTTPS** 或 **localhost** 下运行，否则浏览器禁用串口权限。
  部署到 Pages 后天然是 HTTPS，满足要求。

**Q：TCP 云代理连不上我的 PLC？**
- 云端 Function 在公网，只能访问有公网 IP 的设备。局域网 PLC 请在本机双击 `local-proxy/start-proxy.bat` 启动本地代理后用「本地直连」模式。

**Q：部署后页面空白 / 路由 404？**
- 本项目使用 **hash 路由**（`/#/rtu`），静态托管无需任何重写规则，刷新任意页面都不会 404。
- 若空白，请确认构建输出目录是 `dist`，且 `index.html` 存在。
- 打开浏览器控制台看是否有资源 404（多为 BASE_URL 或资源路径问题）。

**Q：云代理报 `cloudflare:sockets` 模块找不到？**
- 没有开启 `sockets` 兼容标志。按「第二节第 3 步」或确保 `wrangler.toml` 包含
  `compatibility_flags = ["sockets"]`。

**Q：读取/写入报异常码 0x02 / 0x03？**
- `0x02` = 地址越界，`0x03` = 数量超限。保持寄存器单次最多 125 个，线圈最多 2000 个，
  请核对起始地址 + 数量是否落在从站地址空间内。

**Q：本地直连提示「未检测到本地代理」？**
- 浏览器没有 raw socket 权限，必须靠本地代理把 WebSocket 转成真实 TCP。请先双击
  `local-proxy/start-proxy.bat` 启动代理并保持窗口打开，再点「检测」刷新状态后连接。
  该方式全平台可用，无需浏览器扩展，也不依赖 Chrome OS。

---

## 八、部署到 GitHub Pages（可选）

如果你更想用 GitHub Pages 而不是 Cloudflare，也可以。本项目已提供
`.github/workflows/deploy-pages.yml`：

1. 把代码推到 GitHub 仓库；
2. 仓库 **Settings → Pages → Build and deployment → Source 选 GitHub Actions**；
3. 推送 `master`/`main` 分支即自动构建 `dist` 并发布。

```bash
git add .
git commit -m "deploy: Modbus 在线调试工具"
git push
```

> ⚠️ 重要限制：GitHub Pages 是**纯静态托管**，**没有** `cloudflare:sockets` 能力，
> 因此 **「公网云代理」模式在 GitHub Pages 上不可用**（Function 不会运行）。
> 在 GitHub Pages 上你仍然可以用：
> - **模拟从站**（完全可用）；
> - **本地直连（扩展）**（直连局域网设备，与托管平台无关，照常可用）。
> 若需要「公网云代理」，请使用 Cloudflare Pages（见上文第二、三节）。

---

## 九、本地开发预览

```bash
npm install
npm run serve
# 默认 http://localhost:8080（端口被占用时会自动顺延，终端会打印实际地址）
```

本地 `localhost` 下串口权限可用；测试 TCP 三种模式（尤其是模拟从站）也都正常。
