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
