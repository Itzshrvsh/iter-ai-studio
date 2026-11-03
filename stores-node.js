// Node-side store mirror. The renderer keeps its stores in localStorage;
// the main process needs shared access for the external API server.
// Strategy: renderer pushes snapshots via IPC; main persists to a JSON file
// in userData and serves reads/writes through this module.

const fs = require("fs");
const path = require("path");

function getStores(userDataDir) {
  const file = path.join(userDataDir, "bridge-state.json");
  let state = { settings: { token: "" }, providers: [], convos: [], workflows: [], runs: [], behaviorProfiles: [], projects: [], memory: [], evalSuites: [], modelInventory: [], activeProviderId: null };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch {}

  function persist() {
    try { fs.writeFileSync(file, JSON.stringify(state)); } catch {}
  }

  const generic = (key) => ({
    load: () => state[key] || [],
    saveAll: (list) => { state[key] = list; persist(); },
    upsert: (item) => {
      const list = state[key] || [];
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      state[key] = list; persist();
    },
    get: (id) => (state[key] || []).find((x) => x.id === id) || null,
    remove: (id) => { state[key] = (state[key] || []).filter((x) => x.id !== id); persist(); },
  });

  return {
    file,
    settings: { ...state.settings, setToken: (t) => { state.settings.token = t; persist(); } },
    providers: {
      ...generic("providers"),
      active: () => (state.providers || []).find((p) => p.id === state.activeProviderId) || null,
      setActive: (id) => { state.activeProviderId = id; persist(); },
      all: () => state.providers || [],
    },
    convos: generic("convos"),
    workflows: generic("workflows"),
    runs: generic("runs"),
    behaviorProfiles: generic("behaviorProfiles"),
    projects: generic("projects"),
    memory: {
      ...generic("memory"),
      add: (entry) => {
        const list = state.memory || [];
        entry.id = "m_" + Date.now();
        entry.createdAt = Date.now();
        list.unshift(entry);
        state.memory = list; persist();
        return entry;
      },
      byProject: (pid) => (state.memory || []).filter((m) => m.projectId === pid),
    },
    evalSuites: generic("evalSuites"),
    modelInventory: generic("modelInventory"),
    // Called by renderer via IPC to push full snapshots
    importSnapshot(snap) {
      Object.keys(snap || {}).forEach((k) => { state[k] = snap[k]; });
      persist();
    },
    persist,
  };
}

module.exports = getStores;
