const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { createApiServer } = require("./server");
const { route, handler, setContext } = require("./api-handlers");
const getStores = require("./stores-node");
const { executeWorkflow } = require("./engine");

let stores, api;

app.whenReady().then(() => {
  stores = getStores(app.getPath("userData"));

  // Wire pure handlers into main-process context
  setContext({
    Store: stores.providers,
    Convos: stores.convos,
    Workflows: stores.workflows,
    RunStore: stores.runs,
    BehaviorProfiles: stores.behaviorProfiles,
    Projects: stores.projects,
    Memory: stores.memory,
    ModelInventory: stores.modelInventory,
    EvalSuites: stores.evalSuites,
    validateGraph: require("./workflow").validateGraph,
    ExecuteWorkflow: executeWorkflow,
  });

  // engine.js references these as script-globals in the renderer; provide them
  // in the main process too so server-side workflow execution works.
  globalThis.Store = stores.providers;
  globalThis.BehaviorProfiles = stores.behaviorProfiles;
  globalThis.RunStore = stores.runs;

  api = createApiServer(
    { port: 3789, host: "127.0.0.1", token: stores.settings.token },
    handler,
    (status) => {
      if (BrowserWindow.getAllWindows().length) {
        BrowserWindow.getAllWindows()[0].webContents.send("api-status", status);
      }
    }
  );
  api.start();

  // IPC: renderer pushes store snapshots; main persists and serves them over HTTP.
  ipcMain.handle("iterai:push-snapshot", (_e, snap) => { stores.importSnapshot(snap); return true; });
  ipcMain.handle("iterai:get-snapshot", () => stores.state || {});
  ipcMain.handle("iterai:get-settings", () => ({ token: stores.settings.token, port: 3789 }));
  ipcMain.handle("iterai:set-token", (_e, token) => { stores.settings.setToken(token); api.updateToken(token); return true; });

  // Native folder picker for the IDE section
  ipcMain.handle("iterai:choose-folder", async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: __dirname + "/preload.js",
    },
  });
  win.loadFile(__dirname + "/index.html");
});

app.on("window-all-closed", () => { api?.stop(); app.quit(); });
