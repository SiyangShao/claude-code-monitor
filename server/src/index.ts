import Fastify from "fastify";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ServerConfig } from "@claude-monitor/shared";
import { SessionDB } from "./db.js";
import { registerRoutes } from "./routes.js";
import { SshPoller } from "./ssh-poller.js";

const CONFIG_PATH =
  process.env.CLAUDE_MONITOR_CONFIG ||
  path.join(os.homedir(), ".claude-monitor", "server-config.json");

const DB_PATH =
  process.env.CLAUDE_MONITOR_DB ||
  path.join(os.homedir(), ".claude-monitor", "server.db");

function loadConfig(): ServerConfig {
  const defaults: ServerConfig = {
    port: 19876,
    apiKey: "",
    autoHideIdleDays: 2,
    sshTargets: [],
  };

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    console.log(`[server] No config at ${CONFIG_PATH}, using defaults`);
    return defaults;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Ensure data directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new SessionDB(DB_PATH);
  const app = Fastify({ logger: true });

  registerRoutes(app, db, config.apiKey, config.autoHideIdleDays);

  // Start SSH poller if targets configured
  let sshPoller: SshPoller | null = null;
  if (config.sshTargets.length > 0) {
    sshPoller = new SshPoller();
    sshPoller.start(config.sshTargets, (target, sessions) => {
      const environment = target.docker ? "docker" : "ssh";
      for (const session of sessions) {
        db.upsertSession({
          sessionId: session.sessionId,
          machine: target.name,
          environment,
          status: session.status,
          cwd: session.cwd,
          title: session.title,
          slug: session.slug,
          lastActivity: session.lastActivity,
          pid: session.pid,
          claudeVersion: session.claudeVersion,
        });
      }
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[server] Shutting down...");
    sshPoller?.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start server
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`[server] Listening on port ${config.port}`);
}

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
