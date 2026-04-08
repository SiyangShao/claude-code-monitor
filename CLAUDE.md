# Claude Code Monitor

## Architecture

```
[Machine A: agent] ──HTTP POST──> [Server] <──HTTP GET── [Electron Tray App]
[Machine B: agent] ──HTTP POST──>    │
[Docker:    agent] ──HTTP POST──>    │
                                     └──SSH poll──> [Machine C: no agent]
```

**Network assumption**: All machines on same Tailscale network. No NAT/tunnels needed.

## Components

### Server (`server/`) — Fastify + SQLite
- Central state aggregator: receives agent pushes, optional SSH polling, serves REST API
- API: `POST /api/report`, `GET /api/sessions`, `DELETE /api/sessions/:id`, `POST /api/sessions/:id/restore`
- All mutation endpoints require Bearer token auth
- Auto-hide: idle > 2 days (configurable). Hidden sessions auto-restore on non-idle.
- Deploy via Docker Compose with Tailscale sidecar container

### Agent (`agent/`) — Node.js daemon
- Runs on each monitored machine, detects session state, pushes to server
- Detection: scan `~/.claude/projects/*/sessions/*.jsonl`, read JSONL tail
- PID liveness: Linux checks `~/.claude/tasks/<sessionId>/.lock` via `/proc/<pid>/fd/`; macOS uses `lsof -a -c claude -d cwd` to match process cwd
- States: active (recent writes + PID alive), waiting (tool_use without follow-up user response), compacting (compact_boundary), idle
- Pushes on state change + 30s heartbeat
- Metadata: sessionId, status, cwd, title/slug, lastActivity, machine, environment

### UI (`ui/`) — Electron Tray App
- Tray icon color = worst-status session (orange=waiting, green=active, gray=idle)
- Dropdown: session list grouped by machine, emoji status indicators, copy UUID, hide/restore sessions
- Follows system theme (light/dark) via `prefers-color-scheme` + `nativeTheme`
- Polls server API every 5s
- Packageable via electron-builder (`npm run package`)

## Project Structure

```
claude-code-monitor/
├── shared/src/types.ts                          # Shared TypeScript interfaces
├── server/src/{index,routes,db,ssh-poller,jsonl-parser}.ts
├── agent/src/{index,scanner,detector,reporter}.ts
├── ui/src/{main,tray,preload}.ts
├── ui/src/renderer/{index.html,app.ts,style.css}
├── docker-compose.yml + Dockerfile.server       # Server + Tailscale sidecar
├── config/server-config.example.json
├── .env.example                                 # TS_AUTHKEY for Tailscale
├── agent/install.sh                             # systemd/launchd service setup
└── LICENSE (MIT)
```

## Config

- Server: `config/server-config.json` (port, apiKey, autoHideIdleDays, sshTargets)
- Agent: `~/.claude-monitor/agent-config.json` (serverUrl, apiKey, machineName, environment, pollInterval)
- Env: `.env` (TS_AUTHKEY for Docker Compose Tailscale)

## Tech Stack

- TypeScript throughout, npm workspaces
- Server: Fastify + better-sqlite3
- Agent: Node.js
- UI: Electron + CSS variables for theming
