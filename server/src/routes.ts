import type { FastifyInstance } from "fastify";
import type { AgentReport } from "@claude-monitor/shared";
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
}
