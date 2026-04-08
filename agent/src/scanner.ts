import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

export interface DiscoveredSession {
  sessionId: string;
  jsonlPath: string;
  projectHash: string;
}

// Scan ~/.claude/projects/*/<session-uuid>.jsonl for session files
export async function scanSessions(
  claudeHomePath: string
): Promise<DiscoveredSession[]> {
  const projectsDir = path.join(claudeHomePath, "projects");

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  // Find all JSONL files (excluding subagents)
  const pattern = path.join(projectsDir, "*", "*.jsonl");
  const files = await glob(pattern);

  const sessions: DiscoveredSession[] = [];

  for (const filePath of files) {
    // Skip subagent files
    if (filePath.includes("/subagents/")) continue;

    const basename = path.basename(filePath, ".jsonl");
    // Session IDs are UUIDs
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(basename)) {
      continue;
    }

    const projectHash = path.basename(path.dirname(filePath));

    sessions.push({
      sessionId: basename,
      jsonlPath: filePath,
      projectHash,
    });
  }

  return sessions;
}
