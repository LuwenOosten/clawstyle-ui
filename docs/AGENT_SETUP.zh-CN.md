# 智能体安装与配置

本文面向两类用户：想让 AI 编码代理（Codex、Claude Code、Cursor、Pi 等）代为安装并运行
ClawStyle UI 的人，以及需要准确了解模型、provider、profile 在何处配置的人。

ClawStyle UI **只是前端**。它需要一个已安装并正在运行的 Hermes Agent 仪表盘后端，且不得修改
该后端。下面的代理流程对后端刻意保持保守。

## 可粘贴给 AI 编码代理的提示词

把下面的代码块复制给你的代理。如果你使用本地检出，请替换克隆 URL/路径。

```text
在这台机器上安装并运行 ClawStyle UI 前端，连接现有的 Hermes Agent 仪表盘后端。

目标
- 在 http://127.0.0.1:9130 本地运行 ClawStyle UI，使用这台机器上的 Hermes 后端（后端与前端
  可用不同的 loopback 端口）。
- 报告你执行的准确命令、健康检查输出、访问 URL，以及仍未解决的问题。

无需再次确认即可执行
- 检查进程、端口与已安装工具；克隆本仓库；运行 npm ci、构建与前端。
- 如果已安装 Hermes 但没有正在运行的后端：你可以自行在空闲 loopback 端口启动：
  hermes dashboard --no-open --port <空闲端口> > /tmp/hermes-dashboard.log 2>&1 &
  先检查是否已有后端在运行；绝不停止、重启或打断已有服务——直接复用。

必须先征求同意
- 安装系统级软件、使用 sudo、把服务暴露到 127.0.0.1 之外，或替换正在运行的后端。

绝不允许（不得跳过）
- 修改后端配置（config.yaml、.env、provider 默认值、API 密钥、模型、记忆、技能、会话）或停止/
  重启/重配已有后端或网关。
- 用修改后端配置的方式来"修复"前端问题。

步骤
1. 先检查并报告：
   - uname -s；node -v；npm -v
   - curl -sI http://127.0.0.1:9119 | head -n 1   （是否已有后端在运行？）
   - command -v hermes
   - 端口 9119、9130 是否已被占用
2. 获取前端（若已有检出可跳过）：
   git clone https://github.com/LuwenOosten/clawstyle-ui.git
   cd clawstyle-ui
3. 安装依赖：
   npm ci
   若 npm 版本不在支持范围，使用：npx npm@11.17.0 ci
4. 确保后端可用。若已有后端在响应则直接复用；否则在已安装 `hermes` 时用上面的命令在空闲 loopback
   端口（例如 19119）启动，并等待其根路径返回 HTTP 200 且包含 window.__HERMES_*。若未安装 Hermes，
   停止并告诉我。
5. 构建并启动前端。直接 `npm start` 是前台运行：要么保持在本终端、另开一个终端做健康检查，要么以
   分离方式启动并保留进程句柄/日志以便清理。
   npm run build
   PORT=9130 HERMES_DASHBOARD_URL=http://127.0.0.1:<后端端口> npm start
6. 健康检查（第二个终端，或分离启动后）：
   curl -s http://127.0.0.1:9130/healthz
   确认 JSON 中 "ok": true 且 "backend": { "ok": true, "bootstrap": true }。若返回 503，请阅读
   backend.detail 与服务器 stderr，只修复前端侧原因（PORT、HERMES_DASHBOARD_URL、后端是否返回引导值）。
7. 告诉我 URL http://127.0.0.1:9130、你执行的准确命令与健康检查输出，并说明 npm/构建中的警告。

安装过程中不要配置模型、provider、密钥或 profile。如果我之后提出具体的配置变更，请遵循
docs/AGENT_SETUP.zh-CN.md 中的"配置管理指南"：概括确切范围，只保存我授权的值；只有缺少必要值或
需要做出新选择时才再询问。
```

本页其余部分是上述流程的手动版本，以及提示词中提到的配置地图。

## 环境检查

安装前先运行：

```bash
uname -s                              # 预期为 macOS/Linux
node -v                               # ^22.22.0 || ^24.11.0 || >=26.0.0
npm -v                                # <11.10.0 || >=11.17.0
curl -sI http://127.0.0.1:9119 | head -n 1   # 后端是否已在运行？
command -v hermes                     # 后端平时的启动方式
lsof -nP -iTCP:9130 -sTCP:LISTEN 2>/dev/null || true   # 前端端口是否空闲？
```

如果后端未运行，请用你已有的方式启动（通常是 `hermes dashboard`；若默认端口已被其他后端占用，加
`--no-open --port <空闲端口>`），并等 `curl -I http://127.0.0.1:9119` 有响应。不要为了让前端工作
而另装一个后端或修改后端配置。

## 安装、启动与健康检查

```bash
git clone https://github.com/LuwenOosten/clawstyle-ui.git
cd clawstyle-ui
npm ci
npm run build
PORT=9130 HERMES_DASHBOARD_URL=http://127.0.0.1:9119 npm start
```

在另一个终端做健康检查：

```bash
curl -s http://127.0.0.1:9130/healthz | jq
# 预期：{ "ok": true, "backend": { "ok": true, ... }, ... }
```

开发界面时改用 `npm run dev`（Vite 在 `http://127.0.0.1:9130`，`strictPort`），它会代理到后端并
转发会话 token 引导；9130 被占用时可设置 `HERMES_CLAWSTYLE_DEV_PORT`。

## 排错

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `/healthz` 返回 `503`，`backend.ok: false` | 后端已停止、`HERMES_DASHBOARD_URL` 错误，或后端返回 200 但不含 `window.__HERMES_*`（headless） | 启动/复用 Hermes 仪表盘后端；让 `HERMES_DASHBOARD_URL` 指向根路径包含引导值（`backend.bootstrap: true`）的 loopback 地址。 |
| 页面能打开但请求 401 | 独立服务器/开发服务器未能注入后端会话 token | 查看 `/healthz`，后端可达后刷新；token 会随后端重启轮换。 |
| 出现 "Cannot reach the Hermes Agent backend" 横幅 | 侧边栏状态轮询失败 | 修复后端可达性后点击 **Retry now**。 |
| `npm start` 报 "uses the frontend listen port" | `HERMES_DASHBOARD_URL` 与前端 `PORT` 相同（自代理） | 把 `HERMES_DASHBOARD_URL` 指向后端，或更换 `PORT`，如 `PORT=9130`。 |
| `HERMES_DASHBOARD_URL` 被拒绝 | 非 loopback 地址，或与前端开发/监听端口相同 | 使用 `http://127.0.0.1:9119` 或其他 loopback 后端端口。 |
| `npm ci` 因 Node/npm 失败 | 版本不在 engines 范围 | 安装受支持的 Node/npm，或 `npx npm@11.17.0 ci`。 |
| 对话提示需要 sudo / 密钥 / 浏览器预览 | 仅 PTY 支持的交互，原生对话未实现 | 使用 **System → Open console**、上游仪表盘或 CLI 终端。 |

## 配置管理指南

以下配置全部由 **Hermes 后端**存储，并与上游仪表盘共享。在本界面中，每个请求都限定于侧边栏
profile 切换器当前选中的管理 profile。

### 路由速查

| 路由 | 管理内容 | 持久化 |
| --- | --- | --- |
| `/models` | 模型用量/分析；**Model Settings**（主模型、辅助任务覆盖、Mixture-of-Agents 预设） | 持久配置，作用于**新建会话** |
| `/env` | `.env` 中的 API 密钥；OAuth provider 登录；自定义环境变量 | 持久保存，立即写盘 |
| `/profiles` | Profile：新建/克隆、重命名、删除、设为激活、`SOUL.md`、按 profile 的模型 | 持久保存，按 profile 隔离 |
| `/config` | 类型化 `config.yaml` 编辑器；原始 YAML；导入/导出；按分区重置默认 | 按 Save 后持久保存 |
| `/chat` | 会话及其运行中的模型/工具 | 会话运行期内生效 |

侧边栏 **profile 切换器**不是普通设置：它决定管理页面读写哪个 profile。"this dashboard (<name>)"
表示后端进程自身服务的 profile。

### 模型

**持久配置（对新建会话生效）** — `/models` → **Model Settings** 卡片：

- **Main model** — 点击 **Change**，在选择器中选 provider + model。后端要求的昂贵模型确认属于流程
  的一部分；只有确实需要时才确认。
- **Auxiliary tasks** — 视觉、会话搜索等辅助任务可继承主模型或使用覆盖；卡片显示覆盖数量，并打开
  按任务的选择弹窗。
- **Mixture of Agents** — 由参考模型 + 一个聚合模型组成的预设。聚合模型是真正执行回答与工具调用的
  模型，参考模型提供多视角。

这些分配属于后端配置，只对之后新建的会话生效。

**按会话** — 在 `/chat` 的活动对话中，聊天头部的模型胶囊打开 **Switch model**。这只改变当前运行中
会话的模型，**不会**改写 profile 的默认模型。`ModelPickerDialog` 通过会话 id 与实时网关通信，不写
持久模型偏好。部分任务不支持会话内切换，请使用 `/models`。

### Provider 与密钥

**`/env`（Keys）**：

- **LLM Providers** — 设置/替换/清除 `.env` 中的 API 密钥。存储值默认脱敏，可按需揭示；保存立即
  生效。
- **OAuth provider 登录** — 每个 provider 的 `Login`/`Disconnect`，无法在仪表盘完成的流程会显示 CLI
  命令回退。
- **Custom keys** — 供技能、MCP 服务器或工具使用的任意 `.env` 变量。

Provider 默认值（模型到 provider 的映射、base URL 等）在 `/config`，不在 `/env`。除非用户明确要求，
绝不覆盖 provider 默认值；UI 会照常持久化，下一次会话就会使用新值。

### Profile

**`/profiles`**：

- **New Profile** — 名称（小写字母、数字、`_`、`-`，最长 64 字符），可选从现有 profile 克隆配置或
  空白创建。
- 每个 profile 卡片支持编辑模型、重命名、删除、编辑 `SOUL.md`、复制等价 CLI 命令、**Set as
  active**。
- 删除 profile 会移除其配置、密钥、记忆、会话、技能与定时任务——属于破坏性操作，必须先与用户确认。
- 网关正在运行的 profile 在会导致停机 的改动前会显示警告。

**作用域** — 在侧边栏切换 profile 会改变所有管理页面读写的内容（配置、密钥、技能、MCP、模型设置、
新会话），但不会改变后端进程本身。Profile 是保持智能体隔离的正确方式；在 UI 已提供操作时，不要手工
编辑文件在 profile 之间搬运配置。

### 代理绝不能擅自做的事

- 代替用户设置或更改 provider 默认值、API 密钥、模型分配或 profile。
- 直接编辑 `~/.hermes/config.yaml`、`~/.hermes/.env`、profile 目录或会话存储。
- 删除 profile、清除密钥、重置配置分区，或从 System 页面触发 **Update Hermes** /
  **Restart gateway**。
- 为"让前端工作"而停止、启动、更新或重配 Hermes 后端。

如果用户明确要求上述操作，就按要求执行：说明作用范围（哪个 profile、哪些值），只保存其授权的值，
不要对已经明确提出的每项改动反复确认；只有缺少必要值或需要做出不同选择时才追问。使用 UI/API 路径，
而不是绕过后端直接改文件。
