import type { FastifyInstance } from "fastify";
import type {
  AgentReport,
  HookEvent,
  HookNotificationEvent,
  HookStopEvent,
  HookSessionStartEvent,
  HookSessionEndEvent,
  HookToolUseEvent,
  HookSubagentEvent,
  HookCompactEvent,
  SessionStatus,
} from "@claude-monitor/shared";
import type { SessionDB } from "./db.js";

export function registerRoutes(
  app: FastifyInstance,
  db: SessionDB,
  apiKey: string,
  autoHideIdleDays: number
): void {
  // Auth check for agent reports
  function checkAuth(authorization: string | undefined): boolean {
    if (!apiKey) return true; // No auth configured
    return authorization === `Bearer ${apiKey}`;
  }

  // POST /api/report — agent pushes session state
  app.post<{ Body: AgentReport }>("/api/report", async (request, reply) => {
    if (!checkAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const report = request.body;
    if (!report.machineName || !Array.isArray(report.sessions)) {
      return reply.status(400).send({ error: "Invalid report format" });
    }

    for (const session of report.sessions) {
      db.upsertSession({
        sessionId: session.sessionId,
        machine: report.machineName,
        environment: report.environment,
        status: session.status,
        cwd: session.cwd,
        title: session.title,
        slug: session.slug,
        lastActivity: session.lastActivity,
        pid: session.pid,
        claudeVersion: session.claudeVersion,
      });
    }

    return { ok: true, count: report.sessions.length };
  });

  // GET /api/sessions — UI fetches all sessions
  app.get<{
    Querystring: { includeHidden?: string };
  }>("/api/sessions", async (request) => {
    const includeHidden = request.query.includeHidden === "true";
    const sessions = db.getSessions(includeHidden, autoHideIdleDays);
    return { sessions };
  });

  // DELETE /api/sessions/:id — hide a session
  app.delete<{
    Params: { id: string };
  }>("/api/sessions/:id", async (request, reply) => {
    if (!checkAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const ok = db.hideSession(request.params.id);
    if (!ok) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return { ok: true };
  });

  // PATCH /api/sessions/:id — rename a session
  app.patch<{
    Params: { id: string };
    Body: { customTitle: string | null };
  }>("/api/sessions/:id", async (request, reply) => {
    if (!checkAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const { customTitle } = request.body;
    const ok = db.setCustomTitle(request.params.id, customTitle || null);
    if (!ok) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return { ok: true };
  });

  // POST /api/sessions/:id/restore — restore a hidden session
  app.post<{
    Params: { id: string };
  }>("/api/sessions/:id/restore", async (request, reply) => {
    if (!checkAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const ok = db.restoreSession(request.params.id);
    if (!ok) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return { ok: true };
  });

  // ── Hook endpoints ──
  // Claude Code hooks POST JSON directly to these endpoints.
  // Each resolves a SessionStatus and calls db.updateFromHook().

  function hookAuth(authorization: string | undefined): boolean {
    return checkAuth(authorization);
  }

  // POST /api/hook/notification — permission_prompt → waiting, idle_prompt → idle
  app.post<{ Body: HookNotificationEvent }>(
    "/api/hook/notification",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      let status: SessionStatus;
      switch (body.notification_type) {
        case "permission_prompt":
          status = "waiting";
          break;
        case "idle_prompt":
          status = "idle";
          break;
        default:
          // auth_success, elicitation_dialog — treat as active
          status = "active";
      }

      db.updateFromHook(body.session_id, status, body.cwd || "");
      app.log.info(
        `[hook] notification: session=${body.session_id} type=${body.notification_type} → ${status}`
      );
      return { ok: true };
    }
  );

  // POST /api/hook/stop — turn ended → idle
  app.post<{ Body: HookStopEvent }>(
    "/api/hook/stop",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      db.updateFromHook(body.session_id, "idle", body.cwd || "");
      app.log.info(`[hook] stop: session=${body.session_id} → idle`);
      return { ok: true };
    }
  );

  // POST /api/hook/session-start — session started → active
  app.post<{ Body: HookSessionStartEvent }>(
    "/api/hook/session-start",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      db.updateFromHook(body.session_id, "active", body.cwd || "");
      app.log.info(
        `[hook] session-start: session=${body.session_id} source=${body.source || "unknown"} → active`
      );
      return { ok: true };
    }
  );

  // POST /api/hook/session-end — session closed → idle
  app.post<{ Body: HookSessionEndEvent }>(
    "/api/hook/session-end",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      db.updateFromHook(body.session_id, "idle", body.cwd || "");
      app.log.info(
        `[hook] session-end: session=${body.session_id} reason=${body.reason || "unknown"} → idle`
      );
      return { ok: true };
    }
  );

  // POST /api/hook/tool-use — tool invoked → active
  app.post<{ Body: HookToolUseEvent }>(
    "/api/hook/tool-use",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      db.updateFromHook(body.session_id, "active", body.cwd || "");
      // Don't log every tool use — too noisy
      return { ok: true };
    }
  );

  // POST /api/hook/subagent — subagent lifecycle
  app.post<{ Body: HookSubagentEvent }>(
    "/api/hook/subagent",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      // SubagentStart → parent is active (working via subagent)
      // SubagentStop → parent still active (subagent returned result)
      db.updateFromHook(body.session_id, "active", body.cwd || "");
      app.log.info(
        `[hook] ${body.hook_event_name}: session=${body.session_id} type=${body.agent_type || "unknown"} → active`
      );
      return { ok: true };
    }
  );

  // POST /api/hook/compact — compaction lifecycle
  app.post<{ Body: HookCompactEvent }>(
    "/api/hook/compact",
    async (request, reply) => {
      if (!hookAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body;
      if (!body?.session_id) {
        return reply.status(400).send({ error: "Missing session_id" });
      }

      const status: SessionStatus =
        body.hook_event_name === "PreCompact" ? "compacting" : "active";
      db.updateFromHook(body.session_id, status, body.cwd || "");
      app.log.info(
        `[hook] ${body.hook_event_name}: session=${body.session_id} → ${status}`
      );
      return { ok: true };
    }
  );
}
