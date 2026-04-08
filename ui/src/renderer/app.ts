interface MonitorSession {
  sessionId: string;
  status: "active" | "waiting" | "compacting" | "idle";
  cwd: string;
  title: string | null;
  slug: string | null;
  customTitle: string | null;
  lastActivity: string;
  machine: string;
  environment: string;
  pid: number | null;
  claudeVersion: string | null;
  hidden: boolean;
  firstSeen: string;
}

interface ElectronAPI {
  onSessionsUpdate: (callback: (sessions: MonitorSession[]) => void) => void;
  copyToClipboard: (text: string) => void;
  hideSession: (sessionId: string) => Promise<boolean>;
  restoreSession: (sessionId: string) => Promise<boolean>;
  getConfig: () => Promise<{ serverUrl: string; apiKey: string }>;
  saveConfig: (config: { serverUrl: string; apiKey: string }) => Promise<boolean>;
  openSettings: () => void;
  getSessions: () => Promise<MonitorSession[]>;
  renameSession: (sessionId: string, customTitle: string | null) => Promise<boolean>;
}

const api = (window as any).electronAPI as ElectronAPI;

const STATUS_EMOJI: Record<string, string> = {
  active: "\u26a1",
  waiting: "\u23f3",
  compacting: "\ud83e\uddf9",
  idle: "\ud83d\udca4",
};

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function shortPath(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return cwd;
  return parts.slice(-2).join("/");
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderProductivityBar(sessions: MonitorSession[]): void {
  const bar = document.getElementById("productivity-bar")!;
  if (sessions.length === 0) {
    bar.innerHTML = "";
    return;
  }

  const counts: Record<string, number> = { active: 0, waiting: 0, compacting: 0, idle: 0 };
  for (const s of sessions) counts[s.status]++;
  const total = sessions.length;

  let html = "";
  for (const [status, count] of Object.entries(counts)) {
    if (count === 0) continue;
    const pct = (count / total) * 100;
    html += `<div class="bar-segment ${status}" style="width: ${pct}%" title="${count} ${status} (${Math.round(pct)}%)"></div>`;
  }
  bar.innerHTML = html;
}

function renderSessions(sessions: MonitorSession[]): void {
  const container = document.getElementById("sessions")!;

  // Don't re-render while user is editing a session name
  if (container.querySelector(".rename-input")) return;
  const emptyState = document.getElementById("empty-state")!;
  const summary = document.getElementById("status-summary")!;

  if (sessions.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    summary.textContent = "connecting...";
    renderProductivityBar([]);
    return;
  }

  emptyState.style.display = "none";
  renderProductivityBar(sessions);

  // Summary
  const counts: Record<string, number> = { active: 0, waiting: 0, compacting: 0, idle: 0 };
  for (const s of sessions) counts[s.status]++;

  const parts: string[] = [];
  if (counts.active) parts.push(`${counts.active} active`);
  if (counts.waiting) parts.push(`${counts.waiting} waiting`);
  if (counts.compacting) parts.push(`${counts.compacting} compacting`);
  if (counts.idle) parts.push(`${counts.idle} idle`);
  summary.textContent = parts.join(" \u00b7 ");

  // Group by machine
  const grouped = new Map<string, MonitorSession[]>();
  for (const session of sessions) {
    const key = session.machine;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(session);
  }

  let html = "";
  let groupIndex = 0;

  for (const [machine, machineSessions] of grouped) {
    if (groupIndex > 0) {
      html += `<div class="machine-divider"></div>`;
    }

    const envLabel = machineSessions[0].environment;
    html += `<div class="machine-group">`;
    html += `<div class="machine-header">${escapeHtml(machine)} <span style="text-transform: none; font-weight: 400;">(${envLabel})</span></div>`;

    for (const s of machineSessions) {
      const displayName = s.customTitle || s.title || s.slug || shortPath(s.cwd) || s.sessionId.substring(0, 8);
      const projectPath = shortPath(s.cwd);
      const lastChange = formatTimeAgo(s.lastActivity);
      const created = formatTimeAgo(s.firstSeen);
      const emoji = STATUS_EMOJI[s.status] || "";

      html += `
        <div class="session" title="${escapeHtml(s.cwd)}" data-session-id="${escapeHtml(s.sessionId)}">
          <div class="status-indicator">${emoji}</div>
          <div class="session-info">
            <div class="session-name" ondblclick="event.stopPropagation(); renameSession('${escapeHtml(s.sessionId)}', this)">${escapeHtml(displayName)}</div>
            <div class="session-meta">${escapeHtml(projectPath)}</div>
          </div>
          <div class="session-time" title="last change / created">${lastChange} / ${created}</div>
          <div class="session-actions">
            <button class="btn copy" onclick="event.stopPropagation(); copyId('${escapeHtml(s.sessionId)}')" title="Copy UUID">ID</button>
            <button class="btn" onclick="event.stopPropagation(); hideSession('${escapeHtml(s.sessionId)}')" title="Hide">\u2715</button>
          </div>
        </div>
      `;
    }
    html += `</div>`;
    groupIndex++;
  }

  container.innerHTML = html;
}

// Global functions for onclick handlers
(window as any).copyId = (sessionId: string) => {
  api.copyToClipboard(sessionId);
};

(window as any).hideSession = async (sessionId: string) => {
  await api.hideSession(sessionId);
};

(window as any).openSettings = () => {
  api.openSettings();
};

(window as any).renameSession = (sessionId: string, el: HTMLElement) => {
  const current = el.textContent || "";
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.className = "rename-input";
  el.textContent = "";
  el.appendChild(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim() || null;
    input.removeEventListener("blur", commit);
    await api.renameSession(sessionId, newTitle);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      el.textContent = current;
    }
  });
};

// Listen for updates from main process
api.onSessionsUpdate((sessions) => {
  console.log("[renderer] received sessions-update:", sessions.length);
  renderSessions(sessions);
});

// Also pull sessions on load (in case we missed the push)
api.getSessions().then((sessions) => {
  console.log("[renderer] initial pull:", sessions.length);
  renderSessions(sessions);
});
