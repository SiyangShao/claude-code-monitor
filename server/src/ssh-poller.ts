import { execFile } from "child_process";
import { promisify } from "util";
import type { SshTarget } from "@claude-monitor/shared";
import type { SessionReport } from "@claude-monitor/shared";

const execFileAsync = promisify(execFile);

// Script to run on remote machine to collect session data
// Outputs JSON with session info detected from JSONL files
const REMOTE_SCRIPT = `
python3 -c "
import os, json, sys, time, glob

home = os.path.expanduser('~')
claude_dir = os.path.join(home, '.claude', 'projects')
if not os.path.isdir(claude_dir):
    print(json.dumps([]))
    sys.exit(0)

sessions = []
for jsonl in glob.glob(os.path.join(claude_dir, '*', '*.jsonl')):
    if '/subagents/' in jsonl:
        continue
    try:
        stat = os.stat(jsonl)
        mtime = stat.st_mtime
        size = stat.st_size
        if size == 0:
            continue

        # Read tail
        tail_bytes = min(32768, size)
        with open(jsonl, 'rb') as f:
            f.seek(max(0, size - tail_bytes))
            data = f.read().decode('utf-8', errors='replace')

        lines = data.strip().split('\\n')
        if size > tail_bytes:
            lines = lines[1:]  # drop partial first line

        entries = []
        for line in lines:
            try:
                entries.append(json.loads(line))
            except:
                pass

        if not entries:
            continue

        # Extract metadata
        session_id = os.path.basename(jsonl).replace('.jsonl', '')
        cwd = ''
        slug = None
        version = None
        last_activity = ''
        last_prompt = None

        for e in entries:
            if e.get('sessionId'): session_id = e['sessionId']
            if e.get('cwd'): cwd = e['cwd']
            if e.get('slug'): slug = e['slug']
            if e.get('version'): version = e['version']
            if e.get('timestamp'): last_activity = e['timestamp']
            if e.get('type') == 'last-prompt':
                last_prompt = e.get('lastPrompt')

        # Determine status based on mtime
        age = time.time() - mtime
        last_entry = entries[-1]
        status = 'idle'

        if last_entry.get('type') == 'system' and last_entry.get('subtype') == 'compact_boundary':
            status = 'compacting'
        elif age < 10:
            status = 'active'
        elif age < 300:
            # Check for pending tool use (assistant has tool_use with no follow-up user turn)
            for idx in range(len(entries) - 1, -1, -1):
                e = entries[idx]
                if e.get('type') in ('last-prompt', 'file-history-snapshot', 'system'):
                    continue
                if e.get('type') == 'assistant':
                    msg = e.get('message', {})
                    content = msg.get('content', [])
                    if isinstance(content, list):
                        has_tool = any(b.get('type') == 'tool_use' for b in content if isinstance(b, dict))
                        if has_tool:
                            # Check if there's a user turn after this assistant entry
                            has_followup = any(entries[j].get('type') == 'user' for j in range(idx + 1, len(entries)))
                            if not has_followup:
                                status = 'waiting'
                    break
                if e.get('type') == 'user':
                    break

        sessions.append({
            'sessionId': session_id,
            'status': status,
            'cwd': cwd,
            'title': None,
            'slug': slug,
            'lastActivity': last_activity,
            'pid': None,
            'claudeVersion': version
        })
    except Exception as ex:
        pass

print(json.dumps(sessions))
" 2>/dev/null
`;

export class SshPoller {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  start(
    targets: SshTarget[],
    onResult: (target: SshTarget, sessions: SessionReport[]) => void
  ): void {
    for (const target of targets) {
      const poll = async () => {
        try {
          const sessions = await this.pollTarget(target);
          onResult(target, sessions);
        } catch (err) {
          console.error(
            `[ssh-poller] Error polling ${target.name}:`,
            (err as Error).message
          );
        }
      };

      // Initial poll
      poll();

      // Set up interval
      const interval = setInterval(
        poll,
        target.pollIntervalSeconds * 1000
      );
      this.intervals.set(target.name, interval);
    }
  }

  stop(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  private async pollTarget(target: SshTarget): Promise<SessionReport[]> {
    let command: string;
    let args: string[];

    if (target.docker) {
      // SSH to host, then docker exec
      command = "ssh";
      args = [
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new",
        `${target.user}@${target.host}`,
        "docker", "exec", target.docker, "bash", "-c",
        REMOTE_SCRIPT,
      ];
    } else {
      // Direct SSH
      command = "ssh";
      args = [
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new",
        `${target.user}@${target.host}`,
        "bash", "-c",
        REMOTE_SCRIPT,
      ];
    }

    const { stdout } = await execFileAsync(command, args, {
      timeout: 30000,
    });

    const sessions: SessionReport[] = JSON.parse(stdout.trim());
    return sessions;
  }
}
