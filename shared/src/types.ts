// Session status as detected by agent or SSH poller
export type SessionStatus = "active" | "waiting" | "compacting" | "idle";

// Environment where the session is running
export type EnvironmentType = "local" | "ssh" | "docker";

// Session state reported by agent to server
export interface SessionReport {
  sessionId: string;
  status: SessionStatus;
  cwd: string;
  title: string | null;
  slug: string | null;
  lastActivity: string; // ISO 8601
  pid: number | null;
  claudeVersion: string | null;
}

// Agent report payload (POST /api/report)
export interface AgentReport {
  machineName: string;
  environment: EnvironmentType;
  timestamp: string; // ISO 8601
  sessions: SessionReport[];
}

// Session as stored in server DB and returned by API
export interface MonitorSession extends SessionReport {
  machine: string;
  environment: EnvironmentType;
  customTitle: string | null;
  hidden: boolean;
  hiddenAt: string | null;
  firstSeen: string; // ISO 8601
  lastReported: string; // ISO 8601
}

// GET /api/sessions response
export interface SessionsResponse {
  sessions: MonitorSession[];
}

// Server config
export interface ServerConfig {
  port: number;
  apiKey: string;
  autoHideIdleDays: number;
  sshTargets: SshTarget[];
}

export interface SshTarget {
  name: string;
  host: string;
  user: string;
  docker?: string; // container name, if session is inside docker
  pollIntervalSeconds: number;
  claudeHomePath?: string; // default: ~/.claude
}

// Agent config
export interface AgentConfig {
  serverUrl: string;
  apiKey: string;
  machineName: string;
  environment: EnvironmentType;
  pollIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  claudeHomePath?: string; // default: ~/.claude
}

// ── Hook event types ──

export type HookEventName =
  | "Notification"
  | "Stop"
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PostCompact";

export type NotificationType =
  | "permission_prompt"
  | "idle_prompt"
  | "auth_success"
  | "elicitation_dialog";

// Common fields present in all hook payloads
export interface HookEventBase {
  session_id: string;
  cwd: string;
  hook_event_name: HookEventName;
  timestamp?: string; // added by our server if missing
}

export interface HookNotificationEvent extends HookEventBase {
  hook_event_name: "Notification";
  notification_type: NotificationType;
  message?: string;
  title?: string;
}

export interface HookStopEvent extends HookEventBase {
  hook_event_name: "Stop";
  stop_hook_active?: boolean;
}

export interface HookSessionStartEvent extends HookEventBase {
  hook_event_name: "SessionStart";
  source?: string; // "startup" | "resume" | "clear" | "compact"
  model?: string;
}

export interface HookSessionEndEvent extends HookEventBase {
  hook_event_name: "SessionEnd";
  reason?: string;
}

export interface HookToolUseEvent extends HookEventBase {
  hook_event_name: "PreToolUse" | "PostToolUse";
  tool_name?: string;
}

export interface HookSubagentEvent extends HookEventBase {
  hook_event_name: "SubagentStart" | "SubagentStop";
  agent_type?: string;
}

export interface HookCompactEvent extends HookEventBase {
  hook_event_name: "PreCompact" | "PostCompact";
  source?: string; // "manual" | "auto"
}

export type HookEvent =
  | HookNotificationEvent
  | HookStopEvent
  | HookSessionStartEvent
  | HookSessionEndEvent
  | HookToolUseEvent
  | HookSubagentEvent
  | HookCompactEvent;
