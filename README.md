# Claude Code Monitor

[中文文档](README_zh_CN.md)

A lightweight monitoring tool for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions across multiple machines. See at a glance which sessions are active, waiting, compacting, or idle — across local, SSH, and Docker environments.

**Monitor-only** — no control features. Designed to be simple.

## Architecture

```
[Machine A: agent] ──POST──> [Server] <──GET── [Electron Tray App]
[Machine B: agent] ──POST──>    │
[Docker:    agent] ──POST──>    │
                                └──SSH poll──> [Machine C: no agent]
```

All machines are assumed to be on the same [Tailscale](https://tailscale.com/) network.

| Component | Role |
|-----------|------|
| **Server** | Central state aggregator. Receives agent pushes, optionally polls via SSH, serves REST API. |
| **Agent** | Runs on each monitored machine. Detects session state from JSONL transcripts + PID liveness. Pushes to server. |
| **UI** | Electron tray/menubar app. Displays sessions grouped by machine. Supports light/dark mode. |

## Session Metadata

Each session shows:

- Status: `active` / `waiting` / `compacting` / `idle`
- Working directory
- Session slug/title (double-click to set a custom name)
- Session UUID (one-click copy)
- Machine name and environment type
- Last activity time and session age

Sessions idle > 2 days are auto-hidden (configurable). Hidden sessions auto-restore when they become non-idle.

## Tray Icon

The system tray icon color reflects the most urgent status:

- **Red** — at least one session is waiting (needs attention)
- **Green** — at least one session is active (no waiting)
- **Blue** — compacting in progress
- **Gray** — all sessions idle

## Quick Start

### 1. Start the Server

```bash
# Copy and edit config
cp config/server-config.example.json config/server-config.json
# Edit config/server-config.json with your settings

# Option A: Docker Compose (recommended)
cp .env.example .env
# Edit .env with your Tailscale auth key
docker compose up -d

# Option B: Run directly
npm install
npm run -w @claude-monitor/shared build
npm run -w @claude-monitor/server build
npm run -w @claude-monitor/server start
```

### 2. Install the Agent (on each monitored machine)

```bash
# Create agent config
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

# Install as system service
bash agent/install.sh
```

The install script sets up a systemd service (Linux) or launchd agent (macOS) that starts automatically.

### 3. Launch the UI

```bash
cd ui
npm install
npm run dev
```

On first launch, a Settings window opens — enter your server URL (e.g. `http://claude-monitor.your-tailnet.ts.net:19876`) and optional API key.

To package as a standalone app:

```bash
# macOS
npm run build && npx electron-builder --mac --config electron-builder.yml

# Linux
npm run build && npx electron-builder --linux --config electron-builder.yml
```

Output goes to `ui/release/`.

## Configuration

### Server (`config/server-config.json`)

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

### Agent (`~/.claude-monitor/agent-config.json`)

| Field | Description |
|-------|-------------|
| `serverUrl` | Server URL (Tailscale hostname) |
| `apiKey` | Must match server config |
| `machineName` | Display name for this machine |
| `environment` | `local` / `ssh` / `docker` |
| `pollIntervalSeconds` | How often to scan sessions (default: 5) |
| `heartbeatIntervalSeconds` | Force report even if no change (default: 30) |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/report` | Agent pushes session state |
| `GET` | `/api/sessions` | Fetch all visible sessions |
| `GET` | `/api/sessions?includeHidden=true` | Include hidden sessions |
| `PATCH` | `/api/sessions/:id` | Set custom title (`{"customTitle": "..."}`) |
| `DELETE` | `/api/sessions/:id` | Hide a session |
| `POST` | `/api/sessions/:id/restore` | Restore a hidden session |

All mutation endpoints (`POST`, `PATCH`, `DELETE`) require `Authorization: Bearer <apiKey>`. `GET` is unauthenticated.

## How Status Detection Works

The agent detects session status by:

1. Scanning `~/.claude/projects/*/<session-uuid>.jsonl` for session files
2. Checking PID liveness via `~/.claude/tasks/<sessionId>/.lock` (held open by the Claude process)
3. Reading the JSONL tail to determine state:
   - **active**: File recently written + PID alive
   - **waiting**: Last assistant message has `tool_use` with no follow-up user response
   - **compacting**: Last entry is `system:compact_boundary`
   - **idle**: PID dead or file stale

## Tech Stack

- **Server**: TypeScript, Fastify, SQLite (better-sqlite3)
- **Agent**: TypeScript, Node.js
- **UI**: Electron, vanilla HTML/CSS/JS
- **Shared**: TypeScript types (npm workspace)

## License

[MIT](LICENSE)
