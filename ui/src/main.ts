import { app, BrowserWindow, Tray, Menu, nativeImage, clipboard, screen, ipcMain, nativeTheme } from "electron";
import * as path from "path";
import type { MonitorSession, SessionStatus } from "@claude-monitor/shared";

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

const SERVER_URL = process.env.CLAUDE_MONITOR_SERVER || "http://localhost:19876";
const API_KEY = process.env.CLAUDE_MONITOR_API_KEY || "";
const POLL_INTERVAL = 5000;

function authHeaders(): Record<string, string> {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

// Status colors for tray icon
const STATUS_COLORS: Record<SessionStatus, string> = {
  active: "#30d158",    // system green
  waiting: "#ff9f0a",   // system orange
  compacting: "#0a84ff", // system blue
  idle: "#636366",      // system gray
};

const STATUS_EMOJI: Record<SessionStatus, string> = {
  active: "\u26a1",
  waiting: "\u23f3",
  compacting: "\ud83e\uddf9",
  idle: "\ud83d\udca4",
};

let currentStatus: SessionStatus = "idle";

function createTrayIcon(status: SessionStatus): Electron.NativeImage {
  const color = STATUS_COLORS[status];
  const size = 22;
  const textFill = nativeTheme.shouldUseDarkColors ? "white" : "white";
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${color}" opacity="0.9"/>
      <text x="${size / 2}" y="${size / 2 + 1}" text-anchor="middle" dominant-baseline="central" fill="${textFill}" font-size="12" font-family="monospace">&gt;_</text>
    </svg>
  `;
  return nativeImage.createFromBuffer(
    Buffer.from(svg),
    { width: size, height: size }
  );
}

function getWorstStatus(sessions: MonitorSession[]): SessionStatus {
  const priority: SessionStatus[] = ["waiting", "active", "compacting", "idle"];
  for (const status of priority) {
    if (sessions.some((s) => s.status === status)) {
      return status;
    }
  }
  return "idle";
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 500,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.on("blur", () => {
    win.hide();
  });

  return win;
}

function positionWindowNearTray(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const winBounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y: number;

  // If tray is at top of screen (macOS), show below
  if (trayBounds.y < display.bounds.height / 2) {
    y = trayBounds.y + trayBounds.height + 4;
  } else {
    y = trayBounds.y - winBounds.height - 4;
  }

  // Keep within screen bounds
  x = Math.max(display.bounds.x, Math.min(x, display.bounds.x + display.bounds.width - winBounds.width));

  win.setPosition(x, y, false);
}

async function fetchSessions(): Promise<MonitorSession[]> {
  try {
    const response = await fetch(`${SERVER_URL}/api/sessions`);
    if (!response.ok) return [];
    const data = await response.json() as { sessions: MonitorSession[] };
    return data.sessions;
  } catch {
    return [];
  }
}

app.whenReady().then(() => {
  // Create tray
  tray = new Tray(createTrayIcon("idle" as SessionStatus));
  tray.setToolTip("Claude Code Monitor");

  mainWindow = createWindow();

  // Re-render tray icon and notify renderer on system theme change
  nativeTheme.on("updated", () => {
    if (tray) {
      tray.setImage(createTrayIcon(currentStatus));
    }
  });

  tray.on("click", (_event, bounds) => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      positionWindowNearTray(mainWindow, bounds);
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // IPC handlers
  ipcMain.on("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle("hide-session", async (_event, sessionId: string) => {
    try {
      const resp = await fetch(`${SERVER_URL}/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  });

  ipcMain.handle("restore-session", async (_event, sessionId: string) => {
    try {
      const resp = await fetch(
        `${SERVER_URL}/api/sessions/${sessionId}/restore`,
        { method: "POST", headers: authHeaders() }
      );
      return resp.ok;
    } catch {
      return false;
    }
  });

  // Poll for sessions
  const updateSessions = async () => {
    const sessions = await fetchSessions();
    const worstStatus = getWorstStatus(sessions);

    currentStatus = worstStatus;
    if (tray) {
      tray.setImage(createTrayIcon(worstStatus));
      const counts = {
        active: sessions.filter((s) => s.status === "active").length,
        waiting: sessions.filter((s) => s.status === "waiting").length,
        idle: sessions.filter((s) => s.status === "idle").length,
      };
      tray.setToolTip(
        `Claude Monitor: ${counts.active} active, ${counts.waiting} waiting, ${counts.idle} idle`
      );
    }

    // Send sessions to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sessions-update", sessions);
    }
  };

  updateSessions();
  setInterval(updateSessions, POLL_INTERVAL);
});

app.on("window-all-closed", () => {
  // Keep app running in tray
});
