#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AgentConfig } from "@claude-monitor/shared";
import { scanSessions } from "./scanner.js";
import { detectSession } from "./detector.js";
import { Reporter } from "./reporter.js";

const CONFIG_PATH =
  process.env.CLAUDE_MONITOR_AGENT_CONFIG ||
  path.join(os.homedir(), ".claude-monitor", "agent-config.json");

function loadConfig(): AgentConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[agent] Failed to load config from ${CONFIG_PATH}:`, (err as Error).message);
    console.error("[agent] Create the config file or set CLAUDE_MONITOR_AGENT_CONFIG env var");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const claudeHome = config.claudeHomePath || path.join(os.homedir(), ".claude");

  console.log(`[agent] Machine: ${config.machineName} (${config.environment})`);
  console.log(`[agent] Server: ${config.serverUrl}`);
  console.log(`[agent] Claude home: ${claudeHome}`);
  console.log(`[agent] Poll interval: ${config.pollIntervalSeconds}s`);
  console.log(`[agent] Heartbeat interval: ${config.heartbeatIntervalSeconds}s`);

  const reporter = new Reporter(
    config.serverUrl,
    config.apiKey,
    config.machineName,
    config.environment
  );

  let lastHeartbeat = 0;

  const poll = async () => {
    try {
      const discovered = await scanSessions(claudeHome);
      const sessions = discovered
        .map((d) => detectSession(d, claudeHome))
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const now = Date.now();
      const forceHeartbeat =
        now - lastHeartbeat >= config.heartbeatIntervalSeconds * 1000;

      const sent = await reporter.report(sessions, forceHeartbeat);
      if (sent) {
        lastHeartbeat = now;
        console.log(
          `[agent] Reported ${sessions.length} sessions (${sessions.filter((s) => s.status !== "idle").length} non-idle)`
        );
      }
    } catch (err) {
      console.error("[agent] Poll error:", (err as Error).message);
    }
  };

  // Initial poll
  await poll();

  // Set up interval
  const interval = setInterval(poll, config.pollIntervalSeconds * 1000);

  // Graceful shutdown
  const shutdown = () => {
    console.log("[agent] Shutting down...");
    clearInterval(interval);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
