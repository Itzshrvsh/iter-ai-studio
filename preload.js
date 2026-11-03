// Preload: minimal, safe bridge between renderer and main.
// Uses direct assignment when contextIsolation is disabled (this app's setup);
// contextBridge when enabled.
let api;
try {
  const { contextBridge, ipcRenderer } = require("electron");
  api = {
    onApiStatus: (cb) => ipcRenderer.on("api-status", (_e, status) => cb(status)),
    pushSnapshot: (snap) => ipcRenderer.invoke("iterai:push-snapshot", snap),
    getSnapshot: () => ipcRenderer.invoke("iterai:get-snapshot"),
    getSettings: () => ipcRenderer.invoke("iterai:get-settings"),
    setToken: (token) => ipcRenderer.invoke("iterai:set-token", token),
    chooseFolder: () => ipcRenderer.invoke("iterai:choose-folder"),
  };
  if (process.contextIsolated) contextBridge.exposeInMainWorld("iteraiBridge", api);
  else window.iteraiBridge = api;
} catch (err) {
  // Fallback: expose nothing; the API page degrades gracefully.
  window.iteraiBridge = null;
}
