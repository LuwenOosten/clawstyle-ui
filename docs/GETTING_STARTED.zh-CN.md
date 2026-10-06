# 快速开始

本指南从干净检出开始，带你连上本地 Hermes Agent 后端运行 ClawStyle UI，并覆盖配置、健康检查
与排错。

ClawStyle UI 只是浏览器前端，**必须有一个正在运行的 Hermes Agent 仪表盘后端**（默认
`http://127.0.0.1:9119`）。安装与启动本前端不会修改后端配置或服务；Config/Keys/Models 页面只在你
明确保存时写入后端配置，详见 [AGENT_SETUP.zh-CN.md](AGENT_SETUP.zh-CN.md#配置管理指南)。

## 1. 环境要求

| 要求 | 版本 / 说明 |
| --- | --- |
| Node.js | `^22.22.0 || ^24.11.0 || >=26.0.0`（`node -v`） |
| npm | `<11.10.0 || >=11.17.0`（`npm -v`）；仓库使用 `npm ci` 安装 |
| Hermes Agent 后端 | 正在运行且可通过 loopback 访问；`hermes dashboard` 默认服务于 `http://127.0.0.1:9119` |
| 操作系统 | macOS 或 Linux。不支持原生 Windows（脚本为 POSIX；WSL 未验证） |

前端端口必须与后端端口不同；若 `HERMES_DASHBOARD_URL` 指向前端自身监听端口（自代理），独立
服务器与 Vite 开发服务器都会拒绝。后端默认端口为 `9119`，前端默认端口为 `9130`。

## 2. 安装

```bash
git clone https://github.com/LuwenOosten/clawstyle-ui.git
cd clawstyle-ui
npm ci
```

`npm ci` 使用仓库中的 `package-lock.json`，并安装 `web` 与 `apps/shared` 两个 workspace。

## 3. 运行

### 生产式独立服务器（日常使用推荐）

```bash
npm run build      # 类型检查并写入 ./dist（含构建回执）
npm start          # 提供 ./dist 并代理到后端，默认 http://127.0.0.1:9130
```

`npm run preview` 是同一服务器的别名。服务器在请求时把后端的 `window.__HERMES_*` 引导脚本注入
`index.html`。因此没有仪表盘后端就不能运行：没有注入的会话 token，API 请求无法认证。`hermes
serve`（headless）会返回 HTTP 200 但不注入引导值，不能作为这里的上游。

### 开发模式（修改界面时使用）

先启动后端，然后：

```bash
npm run dev        # Vite 开发服务器，默认 http://127.0.0.1:9130（strictPort）
```

开发服务器会：

- 把 `/api`、`/dashboard-plugins`（含 WebSocket）代理到 `HERMES_DASHBOARD_URL`；
- 抓取后端仪表盘 HTML，注入 `window.__HERMES_SESSION_TOKEN__` 等引导值。后端未启动时控制台会提示，
  且 `/api` 将返回 401；
- 若 9130 被占用，可用 `HERMES_CLAWSTYLE_DEV_PORT` 覆盖开发端口。

## 4. 配置

### 环境变量

| 变量 | 默认值 | 生效范围 | 说明 |
| --- | --- | --- | --- |
| `PORT` | `9130` | `npm start`、`npm run preview` | 监听端口，必须与后端端口不同；若 `HERMES_DASHBOARD_URL` 与此端口相同（自代理）会被拒绝。 |
| `HERMES_DASHBOARD_URL` | `http://127.0.0.1:9119` | 开发代理 + 独立服务器 | 后端地址，仅 loopback（`127.0.0.1`、`localhost`、`::1`）；不得与前端监听/开发端口相同。 |
| `HERMES_CLAWSTYLE_DEV_PORT` | `9130` | `npm run dev` | Vite 开发服务器端口（`strictPort`）；测试或 9130 被占用时有用。 |
| `HERMES_CLAWSTYLE_DIST` | `./dist`（`ops/server.mjs` 旁或仓库 `dist/`） | 独立服务器 | 构建产物目录。 |
| `HERMES_CLAWSTYLE_HOST` | `127.0.0.1` | 独立服务器 | 监听地址，仅 loopback。 |
| `HERMES_CLAWSTYLE_ALLOWED_HOSTS` | *(空)* | 独立服务器 | 额外信任的 `Host`/`Origin`，逗号分隔。适用于本地 TLS 终止代理（如 `tailscale serve`）在前端的场景；裸主机名会自动补 `PORT`。 |

后端在非默认 loopback 端口上的示例：

```bash
HERMES_DASHBOARD_URL=http://127.0.0.1:9199 PORT=9130 npm start
```

### 部署期覆盖项（macOS LaunchAgent 辅助脚本）

以下变量由 `ops/deploy.mjs` 读取，用于脚本化安装与测试。

| 变量 | 含义 |
| --- | --- |
| `HERMES_CLAWSTYLE_APP_ROOT` | 版本存储根目录（默认 `~/Library/Application Support/HermesClawStyleUI`） |
| `HERMES_CLAWSTYLE_LAUNCH_AGENTS_DIR` | LaunchAgent 目录（默认 `~/Library/LaunchAgents`） |
| `HERMES_CLAWSTYLE_LAUNCHCTL` | `launchctl` 可执行文件；设置后测试也会启用 launchd 路径 |
| `HERMES_CLAWSTYLE_RELOAD_RETRY_DELAY_MS` | 服务重载重试的基础退避 |
| `HERMES_CLAWSTYLE_HTTP_READY_TIMEOUT_MS` | `check` 中 HTTP 探测的最长等待 |

### 在界面中配置

日常配置（模型、provider、profile、密钥、技能、MCP、渠道、配置 YAML）都通过界面写入后端。具体页面
与控件见 [AGENT_SETUP.zh-CN.md](AGENT_SETUP.zh-CN.md#配置管理指南)。要点：

- `/config` — 类型化配置表单 + 原始 YAML 编辑器。
- `/env` — `.env` 中的 API 密钥与 OAuth provider 登录。
- `/models` — 主模型、辅助任务覆盖与 Mixture-of-Agents 预设。
- `/profiles` — 新建/克隆/重命名/删除 profile，编辑 `SOUL.md`，设置 profile 模型。
- 侧边栏 profile 切换器 — 所有管理页面跟随所选 profile。

## 5. 健康检查

1. **独立服务器探测** — 运行期间：

   ```bash
   curl -s http://127.0.0.1:9130/healthz | jq
   ```

   返回 `200`：前端配置、最近一次引导注入结果，以及对后端的实时探测（`backend.ok`、
   `backend.bootstrap`）。后端不可达，**或**返回 200 但不含 `window.__HERMES_*` 引导值
   （headless/错误上游）时返回 `503`，`backend.detail` 会给出 URL 与失败原因。

2. **界面诊断** — 侧边栏状态轮询失败时，应用外壳会显示"Cannot reach the Hermes Agent backend"
   横幅并提供重试；页面加载失败会显示"Could not load …"卡片并附带重试。

3. **部署健康（macOS LaunchAgent）**：

   ```bash
   node ops/deploy.mjs check          # 人类可读的 PASS/FAIL
   node ops/deploy.mjs check --json   # 机器可读
   ```

4. **工作区质量门**：

   ```bash
   npm run check                      # typecheck + lint + 测试 + 构建
   ```

## 6. 排错

### 页面能打开但所有请求都失败 / "Your dashboard session has expired"

前端未能从后端拿到会话 token：`npm start` 时是独立服务器抓取失败，`npm run dev` 时是开发服务器
引导抓取失败。

- 确认后端在运行：`curl -I http://127.0.0.1:9119`（或 `hermes dashboard`）。
- 确认 `HERMES_DASHBOARD_URL` 指向该后端且**处于 loopback**。
- `curl -s http://127.0.0.1:9130/healthz`，查看 `backend.detail`。
- 修复后手动刷新一次：loopback 会话 token 会随每次后端重启轮换，重启前打开的标签页持有旧 token。
  应用已会针对旧 token 的 401 自动刷新一次；若仍失败请手动刷新。

### 出现 "Cannot reach the Hermes Agent backend" 横幅

侧边栏状态轮询失败。启动后端，或修正 `HERMES_DASHBOARD_URL` / 端口，然后点击 **Retry now**
（或等待下一次 10 秒轮询）。

### `npm start` 报 "uses the frontend listen port"

`HERMES_DASHBOARD_URL` 与前端监听端口相同，会把前端代理到自身。请把 `HERMES_DASHBOARD_URL` 指向
后端（默认 `http://127.0.0.1:9119`），或更换 `PORT`，例如 `PORT=9131 npm start`。

### `HERMES_DASHBOARD_URL` 被拒绝

服务器只接受 loopback 地址，也会拒绝与前端监听端口相同的 URL。请使用 `http://127.0.0.1:9119`
（或你自己的 loopback 后端端口）。

### `npm ci` 因 Node/npm 版本失败

对照要求表检查 `node -v` 与 `npm -v`。锁文件需要较新的 npm；请使用受支持版本的 `npm ci`，若默认
npm 不在支持范围内可用 `npx npm@11.17.0 ci`。

### 对话里提示需要 sudo / 密钥 / 浏览器预览

这些交互流程仅支持 PTY，原生对话未实现，界面会明确失败。请使用本界面的 **System → Open
console**（构建仍包含 xterm 控制台 chunk），或上游仪表盘 / CLI 终端。

### 恢复原版仪表盘

后端未被修改。停止前端后直接访问后端即可：

```bash
# 前台 `npm start`：Ctrl+C
launchctl bootout gui/$(id -u)/local.hermes.clawstyle-ui   # 仅 macOS LaunchAgent
open http://127.0.0.1:9119
```

### 清理 macOS 部署

只删除部署脚本拥有的路径（先确认应用根目录中的 `owner.json`）：

```bash
launchctl bootout gui/$(id -u)/local.hermes.clawstyle-ui 2>/dev/null || true
rm -f ~/Library/LaunchAgents/local.hermes.clawstyle-ui.plist
rm -rf ~/Library/Application\ Support/HermesClawStyleUI
```
