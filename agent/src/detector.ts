import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import type { SessionStatus, SessionReport } from "@claude-monitor/shared";
import type { DiscoveredSession } from "./scanner.js";

interface JsonlEntry {
  type: string;
  subtype?: string;
  sessionId?: string;
  cwd?: string;
  slug?: string;
  version?: string;
  timestamp?: string;
  lastPrompt?: string;
  message?: {
    role?: string;
    content?: unknown;
    stop_reason?: string | null;
  };
}

// Read the tail of a JSONL file
function readTail(filePath: string, tailBytes: number = 32768): JsonlEntry[] {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  if (fileSize === 0) return [];

  const readStart = Math.max(0, fileSize - tailBytes);
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(Math.min(tailBytes, fileSize));
  fs.readSync(fd, buffer, 0, buffer.length, readStart);
  fs.closeSync(fd);

  const text = buffer.toString("utf-8");
  const lines = text.split("\n");
  if (readStart > 0) lines.shift(); // Drop partial line

  const entries: JsonlEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed
    }
  }
  return entries;
}

// Find the PID of the Claude Code process for a given session
// Uses ~/.claude/tasks/<sessionId>/.lock which is held open by the process
function findClaudePid(sessionId: string, claudeHome: string): number | null {
  const lockFile = path.join(claudeHome, "tasks", sessionId, ".lock");

  try {
    if (!fs.existsSync(lockFile)) return null;
  } catch {
    return null;
  }

  try {
    // Linux: check /proc for any process with the lock file open
    const procDirs = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pidStr of procDirs) {
      try {
        // Check fd symlinks for the lock file
        const fdDir = `/proc/${pidStr}/fd`;
        const fds = fs.readdirSync(fdDir);
        for (const fd of fds) {
          try {
            const target = fs.readlinkSync(`${fdDir}/${fd}`);
            if (target === lockFile) {
              return parseInt(pidStr, 10);
            }
          } catch {
            // fd may have been closed
          }
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // /proc not available (macOS) — try lsof
    try {
      const output = execSync(
        `lsof "${lockFile}" 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 }
      );
      for (const line of output.trim().split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[1], 10);
        if (!isNaN(pid)) return pid;
      }
    } catch {
      // lsof may fail or file not opened
    }
  }

  return null;
}

// Detect session status from JSONL entries and process state
function detectStatus(
  entries: JsonlEntry[],
  mtime: Date,
  pid: number | null
): SessionStatus {
  if (entries.length === 0) return "idle";

  const lastEntry = entries[entries.length - 1];
  const ageMs = Date.now() - mtime.getTime();

  // Check for compaction
  if (
    lastEntry.type === "system" &&
    lastEntry.subtype === "compact_boundary"
  ) {
    // If recent, it's compacting; if old, it finished
    if (ageMs < 30000) return "compacting";
  }

  // If file was written very recently and process alive, it's active
  if (ageMs < 10000 && pid !== null) {
    return "active";
  }

  // Check for pending tool use (waiting for permission or user input)
  if (pid !== null && ageMs < 300000) {
    // 5 min window
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (
        entry.type === "last-prompt" ||
        entry.type === "file-history-snapshot" ||
        entry.type === "system"
      ) {
        continue;
      }

      if (entry.type === "assistant" && entry.message?.content) {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          const hasToolUse = content.some(
            (block: { type: string }) => block.type === "tool_use"
          );
          if (hasToolUse) {
            // No user response after tool_use = waiting
            let hasFollowUp = false;
            for (let j = i + 1; j < entries.length; j++) {
              if (entries[j].type === "user") {
                hasFollowUp = true;
                break;
              }
            }
            if (!hasFollowUp) return "waiting";
          }
        }
        break;
      }

      if (entry.type === "user") break;
    }

    // Process alive, turn ended, waiting for next user prompt
    // Check if the last meaningful entry is a system:turn_duration (turn ended)
    if (
      lastEntry.type === "system" &&
      lastEntry.subtype === "turn_duration"
    ) {
      return "idle";
    }

    // If process alive and relatively recent activity, could still be active
    if (pid !== null && ageMs < 30000) {
      return "active";
    }
  }

  return "idle";
}

// Detect full session state
export function detectSession(
  discovered: DiscoveredSession,
  claudeHome?: string
): SessionReport | null {
  try {
    const home = claudeHome || path.join(os.homedir(), ".claude");
    const stat = fs.statSync(discovered.jsonlPath);
    if (stat.size === 0) return null;

    const entries = readTail(discovered.jsonlPath);
    if (entries.length === 0) return null;

    // Extract metadata
    let cwd = "";
    let slug: string | null = null;
    let version: string | null = null;
    let lastActivity = "";

    for (const entry of entries) {
      if (entry.cwd) cwd = entry.cwd;
      if (entry.slug) slug = entry.slug;
      if (entry.version) version = entry.version;
      if (entry.timestamp) lastActivity = entry.timestamp;
    }

    // Find PID via lock file
    const pid = findClaudePid(discovered.sessionId, home);

    // Detect status
    const status = detectStatus(entries, stat.mtime, pid);

    return {
      sessionId: discovered.sessionId,
      status,
      cwd,
      title: null,
      slug,
      lastActivity,
      pid,
      claudeVersion: version,
    };
  } catch {
    return null;
  }
}
