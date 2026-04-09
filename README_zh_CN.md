# Claude Code Monitor

[English](README.md)

一个轻量级的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 会话监控工具，支持跨多台机器监控。一眼看清哪些会话正在活跃、等待中、压缩中或空闲——覆盖本地、SSH 远程和 Docker 环境。

**纯监控** —— 不包含控制功能。设计目标：简单。

## 架构

```
[Claude Code] ──HTTP hook──> [Server] <──GET── [UI (Electron 或 macOS 原生)]
[Agent]       ──POST──>         │
                                └──SSH 轮询──> [机器 C: 无 agent]
```

所有机器需在同一个 [Tailscale](https://tailscale.com/) 网络中。

| 组件 | 职责 |
|------|------|
| **Server** | 中央状态聚合器。接收 hook 事件 + agent 推送，可选通过 SSH 轮询无 agent 的机器，提供 REST API。 |
| **Hooks** | Claude Code 原生 hook 系统，实时推送状态事件（waiting、active、idle、compacting）到 server。 |
| **Agent** | 运行在每台被监控的机器上。轮询 JSONL 日志 + PID 存活检测作为兜底/校准。推送全量快照到 server。 |
| **UI (Electron)** | 跨平台 Electron 托盘/菜单栏应用。按机器分组显示会话，支持明亮/暗黑模式自动切换。 |
| **UI (macOS 原生)** | 原生 Swift/SwiftUI 菜单栏应用。macOS 上更轻量的替代方案。 |

## 会话元数据

每个会话显示：

- 状态：`active`（活跃）/ `waiting`（等待中）/ `compacting`（压缩中）/ `idle`（空闲）
- 工作目录
- 会话 slug/标题（双击可自定义命名）
- 会话 UUID（一键复制）
- 机器名称和环境类型
- 最后活动时间和会话存活时间

空闲超过 2 天的会话自动隐藏（可配置）。隐藏的会话在状态变为非空闲时自动恢复显示。

## 托盘图标

系统托盘图标颜色反映最紧急的状态：

- **红色** — 至少有一个会话正在等待（需要关注）
- **绿色** — 至少有一个会话活跃（无等待）
- **蓝色** — 正在压缩上下文
- **灰色** — 所有会话空闲

## 快速开始

### 1. 启动 Server

```bash
# 复制并编辑配置
cp config/server-config.example.json config/server-config.json
# 编辑 config/server-config.json

# 方式 A：Docker Compose（推荐）
cp .env.example .env
# 编辑 .env，填入 Tailscale auth key
docker compose up -d

# 方式 B：直接运行
npm install
npm run -w @claude-monitor/shared build
npm run -w @claude-monitor/server build
npm run -w @claude-monitor/server start
```

### 2. 安装 Agent（在每台被监控的机器上）

```bash
# 创建 agent 配置
mkdir -p ~/.claude-monitor
cat > ~/.claude-monitor/agent-config.json << 'EOF'
{
  "serverUrl": "http://claude-monitor.your-tailnet.ts.net:19876",
  "apiKey": "your-secret-key",
  "machineName": "my-machine",
  "environment": "local",
  "pollIntervalSeconds": 5,
  "heartbeatIntervalSeconds": 30
}
EOF

# 安装为系统服务
bash agent/install.sh
```

安装脚本会自动配置 systemd 服务（Linux）或 launchd 代理（macOS），开机自启，并配置 Claude Code hooks。

#### 手动设置 hooks（可选，如果未使用 install.sh）

```bash
# 从 ~/.claude-monitor/agent-config.json 读取 serverUrl 和 apiKey，
# 将 hooks 写入 ~/.claude/settings.json，将 CLAUDE_MONITOR_API_KEY 写入 shell profile
node agent/dist/setup-hooks.js

# 移除 hooks
node agent/dist/setup-hooks.js --remove
```

安装 hooks 后需要重启 Claude Code 会话才能生效。

### 3. 启动 UI

#### 方式 A：macOS 原生应用（macOS 推荐）

```bash
cd macos-ui

# 编译并创建 .app 包
bash make-app.sh

# 安装到 Applications
cp -r ClaudeCodeMonitor.app /Applications/

# 或直接运行
open ClaudeCodeMonitor.app
```

需要 macOS 14 (Sonoma) 或更高版本，以及 Xcode Command Line Tools。

首次启动后，点击托盘图标 → 齿轮图标，配置 Server 地址和 API Key。

#### 方式 B：Electron（跨平台）

```bash
cd ui
npm install
npm run dev
```

首次启动时会弹出设置窗口 — 输入 Server 地址（如 `http://claude-monitor.your-tailnet.ts.net:19876`）和可选的 API Key。

打包为独立应用：

```bash
# macOS
npm run build && npx electron-builder --mac --config electron-builder.yml

# Linux
npm run build && npx electron-builder --linux --config electron-builder.yml
```

输出在 `ui/release/` 目录。

## 配置

### Server 配置 (`config/server-config.json`)

```json
{
  "port": 19876,
  "apiKey": "your-secret-key",
  "autoHideIdleDays": 2,
  "sshTargets": [
    {
      "name": "gpu-server",
      "host": "gpu-server.tailnet.ts.net",
      "user": "your-user",
      "pollIntervalSeconds": 30
    },
    {
      "name": "gpu-docker",
      "host": "gpu-server.tailnet.ts.net",
      "user": "your-user",
      "docker": "claude-container",
      "pollIntervalSeconds": 30
    }
  ]
}
```

### Agent 配置 (`~/.claude-monitor/agent-config.json`)

| 字段 | 说明 |
|------|------|
| `serverUrl` | Server 地址（Tailscale 主机名） |
| `apiKey` | 需与 server 配置一致 |
| `machineName` | 本机显示名称 |
| `environment` | `local` / `ssh` / `docker` |
| `pollIntervalSeconds` | 扫描会话间隔（默认：5 秒） |
| `heartbeatIntervalSeconds` | 无变化时强制上报间隔（默认：30 秒） |

## API

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/report` | Agent 推送会话状态（全量快照） |
| `POST` | `/api/hook/*` | Claude Code hooks 实时推送事件 |
| `GET` | `/api/sessions` | 获取所有可见会话 |
| `GET` | `/api/sessions?includeHidden=true` | 包含已隐藏的会话 |
| `PATCH` | `/api/sessions/:id` | 设置自定义标题（`{"customTitle": "..."}`） |
| `DELETE` | `/api/sessions/:id` | 隐藏一个会话 |
| `POST` | `/api/sessions/:id/restore` | 恢复一个被隐藏的会话 |

所有写操作（`POST`、`PATCH`、`DELETE`）需要 `Authorization: Bearer <apiKey>` 请求头。`GET` 无需认证。

## 状态检测原理

通过两个互补的通道检测状态：

### Hooks（实时，主要）

Claude Code 的 [hook 系统](https://code.claude.com/docs/en/hooks) 直接推送 HTTP 事件到 server：

| Hook 事件 | 状态 |
|-----------|------|
| `Notification` (`permission_prompt`) | **waiting** |
| `Notification` (`idle_prompt`) | **idle** |
| `PreToolUse` / `PostToolUse` | **active** |
| `SubagentStart` / `SubagentStop` | **active** |
| `PreCompact` | **compacting** |
| `PostCompact` / `Stop` | **idle** |
| `SessionStart` | **active** |
| `SessionEnd` | **idle** |

### Agent 轮询（兜底/校准）

Agent 每 5 秒轮询一次，作为没有 hooks 的机器的兜底方案：

1. 扫描 `~/.claude/projects/*/<session-uuid>.jsonl` 查找会话文件
2. 检测 PID 存活：
   - **Linux**：通过 `~/.claude/tasks/<sessionId>/.lock` 文件检测（Claude 进程持有该文件句柄）
   - **macOS**：使用 `lsof -a -c claude -d cwd` 匹配 Claude 进程工作目录
3. 读取 JSONL 文件末尾判断状态

### 状态合并

当两个通道同时上报时，hooks 在 30 秒内优先。如果 agent 报告 PID=null（进程已死），则覆盖 hooks 状态，强制设为 idle。

## 技术栈

- **Server**: TypeScript, Fastify, SQLite (better-sqlite3)
- **Agent**: TypeScript, Node.js
- **UI (Electron)**: Electron, 原生 HTML/CSS/JS
- **UI (macOS 原生)**: Swift, SwiftUI + AppKit
- **共享类型**: TypeScript (npm workspace)

## 许可证

[MIT](LICENSE)
