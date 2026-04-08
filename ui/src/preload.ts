import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  onSessionsUpdate: (callback: (sessions: unknown[]) => void) => {
    ipcRenderer.removeAllListeners("sessions-update");
    ipcRenderer.on("sessions-update", (_event, sessions) => {
      callback(sessions);
    });
  },
  copyToClipboard: (text: string) => {
    ipcRenderer.send("copy-to-clipboard", text);
  },
  hideSession: (sessionId: string) => {
    return ipcRenderer.invoke("hide-session", sessionId);
  },
  restoreSession: (sessionId: string) => {
    return ipcRenderer.invoke("restore-session", sessionId);
  },
  getConfig: () => {
    return ipcRenderer.invoke("get-config");
  },
  saveConfig: (config: { serverUrl: string; apiKey: string }) => {
    return ipcRenderer.invoke("save-config", config);
  },
  openSettings: () => {
    ipcRenderer.send("open-settings");
  },
});
