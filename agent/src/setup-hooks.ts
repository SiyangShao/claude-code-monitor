#!/usr/bin/env node

/**
 * Sets up Claude Code hooks in ~/.claude/settings.json
 * to push real-time status events to the monitor server.
 *
 * Usage: node setup-hooks.js [--server-url URL] [--api-key KEY] [--remove]
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AgentConfig } from "@claude-monitor/shared";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const AGENT_CONFIG_PATH =
  process.env.CLAUDE_MONITOR_AGENT_CONFIG ||
  path.join(os.homedir(), ".claude-monitor", "agent-config.json");

interface HookEntry {
  type: "http";
  url: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
  timeout: number;
}

interface HookRule {
  matcher?: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookRule[]>;
  [key: string]: unknown;
}

function buildHookUrl(serverUrl: string, endpoint: string): string {
  return `${serverUrl.replace(/\/$/, "")}/api/hook/${endpoint}`;
}

function buildHookEntry(serverUrl: string, endpoint: string): HookEntry {
  return {
    type: "http",
    url: buildHookUrl(serverUrl, endpoint),
    headers: { Authorization: "Bearer $CLAUDE_MONITOR_API_KEY" },
    allowedEnvVars: ["CLAUDE_MONITOR_API_KEY"],
    timeout: 5,
  };
}

function generateHooks(serverUrl: string): Record<string, HookRule[]> {
  return {
    Notification: [
      { matcher: "", hooks: [buildHookEntry(serverUrl, "notification")] },
    ],
    Stop: [{ hooks: [buildHookEntry(serverUrl, "stop")] }],
    SessionStart: [{ hooks: [buildHookEntry(serverUrl, "session-start")] }],
    SessionEnd: [{ hooks: [buildHookEntry(serverUrl, "session-end")] }],
    PreToolUse: [
      { matcher: ".*", hooks: [buildHookEntry(serverUrl, "tool-use")] },
    ],
    PostToolUse: [
      { matcher: ".*", hooks: [buildHookEntry(serverUrl, "tool-use")] },
    ],
    SubagentStart: [{ hooks: [buildHookEntry(serverUrl, "subagent")] }],
    SubagentStop: [{ hooks: [buildHookEntry(serverUrl, "subagent")] }],
    PreCompact: [{ hooks: [buildHookEntry(serverUrl, "compact")] }],
    PostCompact: [{ hooks: [buildHookEntry(serverUrl, "compact")] }],
  };
}

/** Check if a hook rule was created by us (by URL pattern). */
function isOurHook(rule: HookRule, serverUrl: string): boolean {
  return rule.hooks?.some(
    (h) =>
      h.type === "http" && h.url.startsWith(serverUrl.replace(/\/$/, "") + "/api/hook/")
  ) ?? false;
}

function loadSettings(): ClaudeSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function loadAgentConfig(): AgentConfig | null {
  try {
    const raw = fs.readFileSync(AGENT_CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectShellProfile(): string {
  const shell = process.env.SHELL || "";
  if (shell.includes("zsh")) {
    return path.join(os.homedir(), ".zshrc");
  }
  // Prefer .bashrc for interactive shells
  const bashrc = path.join(os.homedir(), ".bashrc");
  if (fs.existsSync(bashrc)) return bashrc;
  return path.join(os.homedir(), ".profile");
}

const ENV_MARKER = "# claude-code-monitor hooks";

function ensureEnvVar(apiKey: string): void {
  if (!apiKey) return;

  const profile = detectShellProfile();
  const exportLine = `export CLAUDE_MONITOR_API_KEY="${apiKey}"`;
  const block = `${ENV_MARKER}\n${exportLine}\n`;

  try {
    const content = fs.existsSync(profile)
      ? fs.readFileSync(profile, "utf-8")
      : "";

    if (content.includes("CLAUDE_MONITOR_API_KEY")) {
      // Replace existing line
      const updated = content.replace(
        /# claude-code-monitor hooks\nexport CLAUDE_MONITOR_API_KEY="[^"]*"\n/,
        block
      );
      if (updated !== content) {
        fs.writeFileSync(profile, updated);
        console.log(`[hooks] Updated CLAUDE_MONITOR_API_KEY in ${profile}`);
      } else {
        console.log(`[hooks] CLAUDE_MONITOR_API_KEY already set in ${profile}`);
      }
    } else {
      // Append
      fs.appendFileSync(profile, `\n${block}`);
      console.log(`[hooks] Added CLAUDE_MONITOR_API_KEY to ${profile}`);
    }
  } catch (err) {
    console.warn(
      `[hooks] Could not write to ${profile}: ${(err as Error).message}`
    );
    console.log(`[hooks] Please add manually: ${exportLine}`);
  }
}

function removeEnvVar(): void {
  const profile = detectShellProfile();
  try {
    if (!fs.existsSync(profile)) return;
    const content = fs.readFileSync(profile, "utf-8");
    const updated = content.replace(
      /\n?# claude-code-monitor hooks\nexport CLAUDE_MONITOR_API_KEY="[^"]*"\n/,
      "\n"
    );
    if (updated !== content) {
      fs.writeFileSync(profile, updated);
      console.log(`[hooks] Removed CLAUDE_MONITOR_API_KEY from ${profile}`);
    }
  } catch {
    // ignore
  }
}

function install(serverUrl: string, apiKey: string): void {
  const settings = loadSettings();
  const newHooks = generateHooks(serverUrl);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Merge: for each event, remove our old hooks, then add new ones
  for (const [event, rules] of Object.entries(newHooks)) {
    const existing = settings.hooks[event] || [];
    // Filter out any previous monitor hooks
    const kept = existing.filter((r: HookRule) => !isOurHook(r, serverUrl));
    settings.hooks[event] = [...kept, ...rules];
  }

  saveSettings(settings);
  ensureEnvVar(apiKey);

  console.log(`[hooks] Installed hooks in ${SETTINGS_PATH}`);
  console.log(`[hooks] Server URL: ${serverUrl}`);
  console.log(`[hooks] Done. Restart Claude Code sessions for hooks to take effect.`);
}

function remove(serverUrl: string): void {
  const settings = loadSettings();
  if (!settings.hooks) {
    console.log("[hooks] No hooks configured, nothing to remove.");
    return;
  }

  for (const event of Object.keys(settings.hooks)) {
    const existing = settings.hooks[event] || [];
    settings.hooks[event] = existing.filter(
      (r: HookRule) => !isOurHook(r, serverUrl)
    );
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  saveSettings(settings);
  removeEnvVar();
  console.log(`[hooks] Removed monitor hooks from ${SETTINGS_PATH}`);
}

// ── CLI ──

function main(): void {
  const args = process.argv.slice(2);
  const isRemove = args.includes("--remove");

  let serverUrl = "";
  let apiKey = "";

  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server-url" && args[i + 1]) {
      serverUrl = args[++i];
    } else if (args[i] === "--api-key" && args[i + 1]) {
      apiKey = args[++i];
    }
  }

  // Fall back to agent config
  if (!serverUrl || !apiKey) {
    const agentConfig = loadAgentConfig();
    if (agentConfig) {
      serverUrl = serverUrl || agentConfig.serverUrl;
      apiKey = apiKey || agentConfig.apiKey;
    }
  }

  if (!serverUrl) {
    console.error(
      "Error: --server-url required (or configure agent-config.json first)"
    );
    process.exit(1);
  }

  if (isRemove) {
    remove(serverUrl);
  } else {
    install(serverUrl, apiKey);
  }
}

main();
