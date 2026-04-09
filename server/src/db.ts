import Database from "better-sqlite3";
import type { MonitorSession, SessionStatus, EnvironmentType, HookEvent } from "@claude-monitor/shared";

export class SessionDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        machine TEXT NOT NULL,
        environment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        cwd TEXT NOT NULL DEFAULT '',
        title TEXT,
        slug TEXT,
        last_activity TEXT NOT NULL,
        last_reported TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        pid INTEGER,
        claude_version TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        hidden_at TEXT,
        custom_title TEXT
      )
    `);

    // Migration: add custom_title column if missing
    const cols = this.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "custom_title")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN custom_title TEXT");
    }
    // Migration: add hook_updated_at column for hook vs agent-report merge
    if (!cols.some((c) => c.name === "hook_updated_at")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN hook_updated_at TEXT");
    }
  }

  /** How long (ms) a hook update takes precedence over agent report status. */
  private static readonly HOOK_PRIORITY_MS = 30_000;

  upsertSession(session: {
    sessionId: string;
    machine: string;
    environment: EnvironmentType;
    status: SessionStatus;
    cwd: string;
    title: string | null;
    slug: string | null;
    lastActivity: string;
    pid: number | null;
    claudeVersion: string | null;
  }): void {
    const now = new Date().toISOString();

    // Merge logic: if hook recently updated this session, prefer hook's status
    // unless agent reports PID=null (process dead → force idle)
    let effectiveStatus = session.status;
    const hookTs = this.getHookUpdatedAt(session.sessionId);
    if (hookTs) {
      const hookAge = Date.now() - new Date(hookTs).getTime();
      if (hookAge < SessionDB.HOOK_PRIORITY_MS && session.pid !== null) {
        // Hook updated recently and process is alive — keep hook's status
        const existing = this.db
          .prepare("SELECT status FROM sessions WHERE session_id = ?")
          .get(session.sessionId) as { status: string } | undefined;
        if (existing) {
          effectiveStatus = existing.status as SessionStatus;
        }
      }
    }

    // If agent says PID is null, force idle regardless of hooks
    if (session.pid === null && effectiveStatus !== "idle") {
      effectiveStatus = "idle";
    }

    this.db
      .prepare(
        `INSERT INTO sessions (
          session_id, machine, environment, status, cwd, title, slug,
          last_activity, last_reported, first_seen, pid, claude_version,
          hidden, hidden_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
        ON CONFLICT(session_id) DO UPDATE SET
          machine = excluded.machine,
          environment = excluded.environment,
          status = excluded.status,
          cwd = excluded.cwd,
          title = COALESCE(excluded.title, sessions.title),
          slug = COALESCE(excluded.slug, sessions.slug),
          last_activity = excluded.last_activity,
          last_reported = excluded.last_reported,
          first_seen = sessions.first_seen,
          pid = excluded.pid,
          claude_version = COALESCE(excluded.claude_version, sessions.claude_version),
          hidden = CASE
            WHEN sessions.hidden = 1 AND excluded.status != 'idle' THEN 0
            ELSE sessions.hidden
          END,
          hidden_at = CASE
            WHEN sessions.hidden = 1 AND excluded.status != 'idle' THEN NULL
            ELSE sessions.hidden_at
          END`
      )
      .run(
        session.sessionId,
        session.machine,
        session.environment,
        effectiveStatus,
        session.cwd,
        session.title,
        session.slug,
        session.lastActivity,
        now,
        now,
        session.pid,
        session.claudeVersion
      );
  }

  getSessions(includeHidden: boolean = false, autoHideIdleDays: number = 2): MonitorSession[] {
    const cutoff = new Date(
      Date.now() - autoHideIdleDays * 24 * 60 * 60 * 1000
    ).toISOString();

    let query: string;
    if (includeHidden) {
      query = "SELECT * FROM sessions ORDER BY last_activity DESC";
    } else {
      query = `SELECT * FROM sessions
        WHERE hidden = 0
        AND NOT (status = 'idle' AND last_activity < ?)
        ORDER BY last_activity DESC`;
    }

    const rows = includeHidden
      ? (this.db.prepare(query).all() as DbRow[])
      : (this.db.prepare(query).all(cutoff) as DbRow[]);

    return rows.map(rowToSession);
  }

  hideSession(sessionId: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE sessions SET hidden = 1, hidden_at = ? WHERE session_id = ?"
      )
      .run(new Date().toISOString(), sessionId);
    return result.changes > 0;
  }

  restoreSession(sessionId: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE sessions SET hidden = 0, hidden_at = NULL WHERE session_id = ?"
      )
      .run(sessionId);
    return result.changes > 0;
  }

  setCustomTitle(sessionId: string, customTitle: string | null): boolean {
    const result = this.db
      .prepare("UPDATE sessions SET custom_title = ? WHERE session_id = ?")
      .run(customTitle, sessionId);
    return result.changes > 0;
  }

  /** Update session status from a hook event (real-time, high priority). */
  updateFromHook(
    sessionId: string,
    status: SessionStatus,
    cwd: string,
    machineName?: string
  ): void {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(sessionId) as { session_id: string } | undefined;

    if (existing) {
      // Update existing session — hook always wins for status
      this.db
        .prepare(
          `UPDATE sessions SET
            status = ?,
            cwd = CASE WHEN ? != '' THEN ? ELSE cwd END,
            last_activity = ?,
            last_reported = ?,
            hook_updated_at = ?,
            hidden = CASE WHEN hidden = 1 AND ? != 'idle' THEN 0 ELSE hidden END,
            hidden_at = CASE WHEN hidden = 1 AND ? != 'idle' THEN NULL ELSE hidden_at END
          WHERE session_id = ?`
        )
        .run(status, cwd, cwd, now, now, now, status, status, sessionId);
    } else {
      // Insert new session from hook — we know session_id and cwd, rest filled later by agent report
      this.db
        .prepare(
          `INSERT INTO sessions (
            session_id, machine, environment, status, cwd, title, slug,
            last_activity, last_reported, first_seen, pid, claude_version,
            hidden, hidden_at, hook_updated_at
          ) VALUES (?, ?, 'local', ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, 0, NULL, ?)`
        )
        .run(
          sessionId,
          machineName || "unknown",
          status,
          cwd,
          now,
          now,
          now,
          now
        );
    }
  }

  /** Get hook_updated_at for a session (used for merge logic). */
  getHookUpdatedAt(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT hook_updated_at FROM sessions WHERE session_id = ?")
      .get(sessionId) as { hook_updated_at: string | null } | undefined;
    return row?.hook_updated_at ?? null;
  }

  close(): void {
    this.db.close();
  }
}

interface DbRow {
  session_id: string;
  machine: string;
  environment: string;
  status: string;
  cwd: string;
  title: string | null;
  slug: string | null;
  last_activity: string;
  last_reported: string;
  first_seen: string;
  pid: number | null;
  claude_version: string | null;
  hidden: number;
  hidden_at: string | null;
  custom_title: string | null;
  hook_updated_at: string | null;
}

function rowToSession(row: DbRow): MonitorSession {
  return {
    sessionId: row.session_id,
    machine: row.machine,
    environment: row.environment as EnvironmentType,
    status: row.status as SessionStatus,
    cwd: row.cwd,
    title: row.title,
    slug: row.slug,
    lastActivity: row.last_activity,
    lastReported: row.last_reported,
    firstSeen: row.first_seen,
    pid: row.pid,
    claudeVersion: row.claude_version,
    customTitle: row.custom_title,
    hidden: row.hidden === 1,
    hiddenAt: row.hidden_at,
  };
}
