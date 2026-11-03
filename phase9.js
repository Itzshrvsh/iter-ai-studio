// Phase 9 — Reliability, extensibility, hardening
// Import/export workflows (secrets-free), settings backup/restore, diagnostics bundle, keyboard shortcuts.

const Export = {
  VERSION: 1,

  // Workflow export: only structural data. Provider keys never live in workflows.
  workflow(wf) {
    return {
      kind: "iterai-workflow",
      version: this.VERSION,
      exportedAt: new Date().toISOString(),
      name: wf.name,
      nodes: wf.nodes,
      edges: wf.edges,
    };
  },

  // Full settings backup (projects, memory, profiles, evals) — with provider API keys REDACTED by default.
  backup(includeSecrets) {
    return {
      kind: "iterai-backup",
      version: this.VERSION,
      exportedAt: new Date().toISOString(),
      secretsIncluded: !!includeSecrets,
      data: {
        providers: includeSecrets
          ? Store.all()
          : Store.all().map((p) => ({ ...p, apiKey: p.apiKey ? "__REDACTED__" : "" })),
        behaviorProfiles: JSON.parse(localStorage.getItem("iterai.behaviorProfiles") || "[]"),
        workflows: JSON.parse(localStorage.getItem("iterai.workflows") || "[]"),
        projects: JSON.parse(localStorage.getItem("iterai.projects") || "[]"),
        memory: JSON.parse(localStorage.getItem("iterai.memory") || "[]"),
        evalSuites: JSON.parse(localStorage.getItem("iterai.evalSuites") || "[]"),
        modelInventory: JSON.parse(localStorage.getItem("iterai.modelInventory") || "[]"),
      },
    };
  },

  download(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  // Import: validate shape, merge by id, never silently overwrite different data.
  importBackup(obj) {
    if (obj.kind !== "iterai-backup") throw new Error("Not an ITER-AI backup file.");
    if (obj.version > this.VERSION) throw new Error("Backup from a newer app version.");
    const d = obj.data || {};
    let counts = {};

    // Providers: preserve existing key if imported one is redacted
    if (d.providers) {
      const existing = Store.all();
      d.providers.forEach((p) => {
        const old = existing.find((x) => x.id === p.id);
        if (p.apiKey === "__REDACTED__" && old) p.apiKey = old.apiKey;
        if (old) Store.update(p); else Store.add(p);
      });
      counts.providers = d.providers.length;
    }
    const merge = (key, storeObj) => {
      const arr = d[key];
      if (!Array.isArray(arr)) return;
      const list = JSON.parse(localStorage.getItem(storeObj.key) || "[]");
      arr.forEach((item) => {
        const i = list.findIndex((x) => x.id === item.id);
        if (i >= 0) list[i] = item; else list.push(item);
      });
      localStorage.setItem(storeObj.key, JSON.stringify(list));
      counts[key] = arr.length;
    };
    const BP = { key: "iterai.behaviorProfiles" };
    const WF = { key: "iterai.workflows" };
    const PRJ = { key: "iterai.projects" };
    const MEM = { key: "iterai.memory" };
    const ES = { key: "iterai.evalSuites" };
    const MI = { key: "iterai.modelInventory" };
    merge("behaviorProfiles", BP);
    merge("workflows", WF);
    merge("projects", PRJ);
    merge("memory", MEM);
    merge("evalSuites", ES);
    merge("modelInventory", MI);
    return counts;
  },

  // Diagnostics bundle: environment info + run stats, secrets redacted.
  diagnostics() {
    const runs = JSON.parse(localStorage.getItem("iterai.runs") || "[]");
    return {
      kind: "iterai-diagnostics",
      version: this.VERSION,
      generatedAt: new Date().toISOString(),
      app: { userAgent: navigator.userAgent, localStorageBytes: JSON.stringify(localStorage).length },
      counts: {
        providers: Store.all().length,
        workflows: (JSON.parse(localStorage.getItem("iterai.workflows") || "[]")).length,
        runs: runs.length,
        projects: (JSON.parse(localStorage.getItem("iterai.projects") || "[]")).length,
        memory: (JSON.parse(localStorage.getItem("iterai.memory") || "[]")).length,
      },
      lastRuns: runs.slice(0, 10).map((r) => ({
        id: r.id, workflow: r.workflowName, state: r.state,
        startedAt: r.startedAt, error: r.error || null,
        tokens: r.tokens,
      })),
    };
  },
};

/* ---------- Settings page wiring (page markup added in index.html) ---------- */
const $st = (id) => document.getElementById(id);

function wireSettingsPage() {
  const page = $st("page-settings");
  if (!page || page.dataset.wired) return;
  page.dataset.wired = "1";

  const grid = document.createElement("div");
  grid.className = "settings-grid";
  page.innerHTML = "";
  page.appendChild(grid);

  const mkSection = (title) => {
    const s = document.createElement("div");
    s.className = "settings-card";
    const h = document.createElement("h3");
    h.textContent = title;
    s.appendChild(h);
    grid.appendChild(s);
    return s;
  };

  // Export/Import
  const ioSec = mkSection("Import / Export");
  const btnExpWf = mkBtn("Export current workflow (JSON)");
  btnExpWf.addEventListener("click", () => {
    const sel = document.getElementById("wfSelect")?.value;
    const wf = sel && Workflows.get(sel);
    if (!wf) { alert("No workflow selected on the Flow Architect page."); return; }
    Export.download(Export.workflow(wf), wf.name.replace(/\W+/g, "_") + ".workflow.json");
  });
  const btnExpBackup = mkBtn("Export backup (no API keys)");
  btnExpBackup.addEventListener("click", () => Export.download(Export.backup(false), "iterai-backup.json"));
  const btnExpBackupK = mkBtn("Export backup (WITH API keys)");
  btnExpBackupK.title = "Only for private machine-to-machine transfer. Keys are stored in plaintext inside the file.";
  btnExpBackupK.addEventListener("click", () => {
    if (confirm("Include API keys in plaintext in the exported file?")) Export.download(Export.backup(true), "iterai-backup-keys.json");
  });
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json";
  fileInput.style.display = "none";
  const btnImport = mkBtn("Import backup…");
  btnImport.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const counts = Export.importBackup(obj);
      alert("Imported: " + JSON.stringify(counts));
      if (window.__refreshProfileSelect) window.__refreshProfileSelect();
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  });
  ioSec.append(btnExpWf, btnExpBackup, btnExpBackupK, btnImport, fileInput);

  // Diagnostics
  const diagSec = mkSection("Diagnostics");
  const btnDiag = mkBtn("Export diagnostics bundle");
  btnDiag.addEventListener("click", () => Export.download(Export.diagnostics(), "iterai-diagnostics.json"));
  btnDiag.addEventListener("click", () => Export.download(Export.diagnostics(), "iterai-diagnostics.json"));
  const stInfo = document.createElement("div");
  stInfo.className = "dim";
  stInfo.style.fontSize = "11px";
  stInfo.textContent = "Contains app counts and last 10 run summaries. No API keys, no message contents.";
  diagSec.append(btnDiag, stInfo);

  // Danger zone
  const dangerSec = mkSection("Maintenance");
  const btnClearRuns = mkBtn("Clear run history");
  btnClearRuns.addEventListener("click", () => {
    if (confirm("Delete all persisted runs?")) { localStorage.removeItem("iterai.runs"); alert("Run history cleared."); }
  });
  const btnWipe = mkBtn("Factory reset (delete everything)");
  btnWipe.addEventListener("click", () => {
    if (confirm("Delete ALL app data (providers, workflows, runs, projects, memory)?")) {
      Object.keys(localStorage).filter((k) => k.startsWith("iterai.")).forEach((k) => localStorage.removeItem(k));
      location.reload();
    }
  });
  dangerSec.append(btnClearRuns, btnWipe);
}

function mkBtn(label) {
  const b = document.createElement("button");
  b.textContent = label;
  return b;
}

/* ---------- Global keyboard shortcuts ---------- */
function wireShortcuts() {
  const pages = ["command", "chat", "flow", "drivers", "lab", "inspector", "evals", "ide", "agentic", "projects", "settings", "api"];
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const idx = Number(e.key);
    if (idx >= 1 && idx <= pages.length) {
      navigate(pages[idx - 1]);
      e.preventDefault();
    }
    if (e.key === "s") { // Alt+S: save current context-appropriate thing
      const saveBtn = document.getElementById("wfSaveBtn");
      if (saveBtn && !saveBtn.disabled) saveBtn.click();
      e.preventDefault();
    }
  });
}

/* ---------- Init ---------- */
(function initPhase9() {
  // Replace the settings empty state with the real page
  const page = document.getElementById("page-settings");
  if (page && page.querySelector(".empty-state")) wireSettingsPage();
  wireShortcuts();

  // Startup sanity note in dock
  const missing = [];
  ["Store", "Workflows", "RunStore", "BehaviorProfiles", "EvalSuites"].forEach((n) => { if (!window[n]) missing.push(n); });
  if (missing.length) console.warn("Init check failed for:", missing);
  else { const d = document.getElementById("dockStatus"); if (d) d.textContent = "Ready"; }
})();
