import Database from "better-sqlite3";
import type { MonitorSession, SessionStatus, EnvironmentType } from "@claude-monitor/shared";

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
        hidden_at TEXT
      )
    `);
  }

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

    // Check if session was hidden and is now non-idle → auto-restore
    const existing = this.db
      .prepare("SELECT hidden, status FROM sessions WHERE session_id = ?")
      .get(session.sessionId) as { hidden: number; status: string } | undefined;

    let hidden = 0;
    let hiddenAt: string | null = null;

    if (existing?.hidden && session.status !== "idle") {
      // Auto-restore: was hidden but now non-idle
      hidden = 0;
      hiddenAt = null;
    } else if (existing) {
      hidden = existing.hidden;
      hiddenAt = null; // preserved by the ON CONFLICT below
    }

    this.db
      .prepare(
        `INSERT INTO sessions (
          session_id, machine, environment, status, cwd, title, slug,
          last_activity, last_reported, first_seen, pid, claude_version,
          hidden, hidden_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        session.status,
        session.cwd,
        session.title,
        session.slug,
        session.lastActivity,
        now,
        now,
        session.pid,
        session.claudeVersion,
        hidden,
        hiddenAt
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
    hidden: row.hidden === 1,
    hiddenAt: row.hidden_at,
  };
}
