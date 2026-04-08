import {
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  clipboard,
  screen,
  ipcMain,
  nativeTheme,
  Menu,
  dialog,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { MonitorSession, SessionStatus } from "@claude-monitor/shared";

// ===== Config =====

interface UIConfig {
  serverUrl: string;
  apiKey: string;
}

const CONFIG_PATH = path.join(os.homedir(), ".claude-monitor", "ui-config.json");

function loadConfig(): UIConfig {
  const defaults: UIConfig = {
    serverUrl: "http://localhost:19876",
    apiKey: "",
  };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveConfig(config: UIConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let config = loadConfig();

function authHeaders(): Record<string, string> {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

// ===== Tray Icon =====

const POLL_INTERVAL = 5000;
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let currentStatus: SessionStatus = "idle";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let settingsJustOpened = false;

const STATUS_COLORS: Record<SessionStatus, string> = {
  active: "#30d158",
  waiting: "#ff9f0a",
  compacting: "#0a84ff",
  idle: "#636366",
};

function createTrayIcon(status: SessionStatus): Electron.NativeImage {
  const color = STATUS_COLORS[status];
  const size = 32; // render at 2x for retina
  const canvas = Buffer.alloc(size * size * 4); // RGBA

  // Draw a filled circle
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const [cr, cg, cb] = hexToRgb(color);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r) {
        const idx = (y * size + x) * 4;
        canvas[idx] = cr;
        canvas[idx + 1] = cg;
        canvas[idx + 2] = cb;
        canvas[idx + 3] = 230; // slightly transparent
      }
    }
  }

  const img = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  return img.resize({ width: 16, height: 16 });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function getWorstStatus(sessions: MonitorSession[]): SessionStatus {
  const priority: SessionStatus[] = ["waiting", "active", "compacting", "idle"];
  for (const s of priority) {
    if (sessions.some((sess) => sess.status === s)) return s;
  }
  return "idle";
}

// ===== Windows =====

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 420,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Delay blur-hide so that clicking the settings button inside the window
  // has time to fire before the window disappears.
  win.on("blur", () => {
    setTimeout(() => {
      if (settingsJustOpened) {
        settingsJustOpened = false;
        return;
      }
      if (!win.isDestroyed() && !win.isFocused()) {
        win.hide();
      }
    }, 150);
  });
  return win;
}

function createSettingsWindow(): BrowserWindow {
  settingsJustOpened = true;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const win = new BrowserWindow({
    width: 480,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Claude Code Monitor - Settings",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "settings.html"));
  win.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow = win;
  return win;
}

function positionWindowNearTray(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const winBounds = win.getBounds();

  // On some macOS versions tray bounds are all zeros; fall back to top-right of primary display
  if (trayBounds.width === 0 && trayBounds.height === 0) {
    const primary = screen.getPrimaryDisplay();
    const x = primary.workArea.x + primary.workArea.width - winBounds.width - 8;
    const y = primary.workArea.y + 4;
    win.setPosition(x, y, false);
    return;
  }

  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y: number;

  if (trayBounds.y < display.bounds.height / 2) {
    y = trayBounds.y + trayBounds.height + 4;
  } else {
    y = trayBounds.y - winBounds.height - 4;
  }

  x = Math.max(display.bounds.x, Math.min(x, display.bounds.x + display.bounds.width - winBounds.width));
  win.setPosition(x, y, false);
}

// ===== Networking =====

async function fetchSessions(): Promise<MonitorSession[]> {
  try {
    const response = await fetch(`${config.serverUrl}/api/sessions`);
    if (!response.ok) return [];
    const data = (await response.json()) as { sessions: MonitorSession[] };
    return data.sessions;
  } catch {
    return [];
  }
}

// ===== Polling =====

async function updateSessions(): Promise<void> {
  const sessions = await fetchSessions();
  const worstStatus = getWorstStatus(sessions);

  currentStatus = worstStatus;
  if (tray && !tray.isDestroyed()) {
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

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sessions-update", sessions);
  }
}

// ===== App Lifecycle =====

app.whenReady().then(() => {
  // Hide dock icon on macOS (tray-only app)
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  tray = new Tray(createTrayIcon("idle"));
  tray.setToolTip("Claude Code Monitor");

  // Right-click context menu
  const contextMenu = Menu.buildFromTemplate([
    { label: "Settings...", click: () => createSettingsWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  mainWindow = createMainWindow();

  tray.on("click", (_event, bounds) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      positionWindowNearTray(mainWindow, bounds);
      mainWindow.show();
      mainWindow.focus();
      // Send latest data immediately when window becomes visible
      updateSessions();
    }
  });

  tray.on("right-click", () => {
    if (tray && !tray.isDestroyed()) tray.popUpContextMenu(contextMenu);
  });

  nativeTheme.on("updated", () => {
    if (tray && !tray.isDestroyed()) tray.setImage(createTrayIcon(currentStatus));
  });

  // ===== IPC Handlers =====

  ipcMain.on("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle("hide-session", async (_event, sessionId: string) => {
    try {
      const resp = await fetch(`${config.serverUrl}/api/sessions/${sessionId}`, {
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
      const resp = await fetch(`${config.serverUrl}/api/sessions/${sessionId}/restore`, {
        method: "POST",
        headers: authHeaders(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  });

  ipcMain.handle("get-config", () => {
    return { serverUrl: config.serverUrl, apiKey: config.apiKey };
  });

  ipcMain.handle("save-config", async (_event, newConfig: { serverUrl: string; apiKey: string }) => {
    config.serverUrl = newConfig.serverUrl;
    config.apiKey = newConfig.apiKey;
    saveConfig(config);
    // Restart polling with new config
    if (pollTimer) clearInterval(pollTimer);
    updateSessions();
    pollTimer = setInterval(updateSessions, POLL_INTERVAL);
    return true;
  });

  ipcMain.on("open-settings", () => {
    createSettingsWindow();
  });

  // ===== Polling =====

  updateSessions();
  pollTimer = setInterval(updateSessions, POLL_INTERVAL);

  // Show settings on first launch if no config exists
  if (config.serverUrl === "http://localhost:19876") {
    createSettingsWindow();
  }
});

app.on("window-all-closed", () => {
  // Keep app running in tray
});
