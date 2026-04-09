# Claude Code Monitor

## Architecture

```
[Claude Code] ──HTTP hook──> [Server] <──HTTP GET── [Electron Tray App]
[Agent]       ──HTTP POST──>    │
                                └──SSH poll──> [Machine C: no agent]
```

- **Hooks** (real-time): Claude Code pushes status events directly to server via HTTP hooks
- **Agent** (fallback): polls JSONL + PID for full-snapshot calibration, covers machines without hooks
- **Network assumption**: All machines on same Tailscale network. No NAT/tunnels needed.

## Components

### Server (`server/`) — Fastify + SQLite
- Central state aggregator: receives agent pushes, Claude Code hooks, optional SSH polling, serves REST API
- API: `POST /api/report`, `GET /api/sessions`, `DELETE /api/sessions/:id`, `POST /api/sessions/:id/restore`
- Hook endpoints: `POST /api/hook/{notification,stop,session-start,session-end,tool-use,subagent,compact}`
- State merge: hook updates are real-time high-priority; agent reports are full-snapshot fallback/calibration
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
- `setup-hooks.ts`: CLI tool to install Claude Code hooks into `~/.claude/settings.json` and write `CLAUDE_MONITOR_API_KEY` env var to shell profile

### Claude Code Hooks (real-time status)
- Claude Code's native hook system pushes HTTP events directly to the server
- Hooks fire on: Notification (permission_prompt → waiting, idle_prompt → idle), Stop, SessionStart, SessionEnd, PreToolUse/PostToolUse, SubagentStart/SubagentStop, PreCompact/PostCompact
- Configured via `~/.claude/settings.json`, installed by `agent/src/setup-hooks.ts`
- Solves: subagent idle misdetection, polling delay, JSONL tail window limitations

### UI (`ui/`) — Electron Tray App
- Tray icon color = worst-status session (orange=waiting, green=active, gray=idle)
- Dropdown: session list grouped by machine, emoji status indicators, copy UUID, hide/restore sessions
- Follows system theme (light/dark) via `prefers-color-scheme` + `nativeTheme`
- Polls server API every 5s
- Packageable via electron-builder (`npm run package`)

## Project Structure

```
claude-code-monitor/
├── shared/src/types.ts                          # Shared TypeScript interfaces (incl. hook event types)
├── server/src/{index,routes,db,ssh-poller,jsonl-parser}.ts
├── agent/src/{index,scanner,detector,reporter}.ts
├── agent/src/setup-hooks.ts                     # CLI: install/remove Claude Code hooks
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
- Hooks: `~/.claude/settings.json` (managed by `setup-hooks.ts`, merges into existing config)
- Env: `.env` (TS_AUTHKEY for Docker Compose Tailscale), `CLAUDE_MONITOR_API_KEY` (for hooks auth, written to shell profile by setup-hooks)

## Tech Stack

- TypeScript throughout, npm workspaces
- Server: Fastify + better-sqlite3
- Agent: Node.js
- UI: Electron + CSS variables for theming
