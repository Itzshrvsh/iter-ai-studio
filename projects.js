// Projects & Memory (Phase 6)
const Projects = {
  key: "iterai.projects",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  upsert(p) {
    const list = this.load();
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    this.saveAll(list);
  },
  get(id) { return this.load().find((x) => x.id === id) || null; },
  remove(id) { this.saveAll(this.load().filter((x) => x.id !== id)); },
};

const Memory = {
  key: "iterai.memory",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  add(entry) {
    const list = this.load();
    entry.id = "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
    entry.createdAt = Date.now();
    list.unshift(entry);
    this.saveAll(list);
    return entry;
  },
  update(entry) {
    const list = this.load();
    const i = list.findIndex((m) => m.id === entry.id);
    if (i >= 0) list[i] = entry;
    this.saveAll(list);
  },
  remove(id) { this.saveAll(this.load().filter((m) => m.id !== id)); },
  byProject(pid) { return this.load().filter((m) => m.projectId === pid); },
};

const MEM_CATEGORIES = [
  ["fact", "Stable project fact"],
  ["decision", "User-approved decision"],
  ["finding", "Verified technical finding"],
  ["failure", "Known failure & fix"],
  ["wfperf", "Workflow performance note"],
  ["temp", "Temporary task state"],
];

const $pj = (id) => document.getElementById(id);
let editingProjectId = null;

function blankProject() {
  return {
    id: "prj_" + Date.now(),
    name: "",
    rootDir: "",
    instructions: "",
    stack: "",
    keyFiles: "",
    testCommands: "",
    constraints: "",
    protectedFiles: "",
  };
}

// ---- Ready-made project templates ----
// Pre-fill the project dossier fields; user edits freely afterwards.
const PROJECT_TEMPLATES = {
  genericSoftware: {
    name: "Software project",
    instructions: "Work only inside the root directory. Ask before changing any file not directly related to the task.",
    stack: "",
    keyFiles: "",
    testCommands: "npm test",
    constraints: "Keep changes minimal. Follow existing code style. No new dependencies without approval.",
    protectedFiles: "",
  },
  electronApp: {
    name: "Electron app",
    instructions: "Desktop app: main process (Node) and renderer process (DOM) must stay clearly separated. Renderer uses plain scripts, no bundler.",
    stack: "Electron, vanilla JS (no framework), CSS",
    keyFiles: "main.js — main process\nindex.html — markup + script order\napp.js — shared helpers loaded first",
    testCommands: "node tests/run-tests.js",
    constraints: "Load order matters: app.js defines shared $ before page scripts. nodeIntegration is on; do not add remote content.",
    protectedFiles: "package-lock.json",
  },
  webSite: {
    name: "Static website",
    instructions: "Static site. Optimize for readability and fast loading. No build step required.",
    stack: "HTML, CSS, vanilla JS",
    keyFiles: "index.html",
    testCommands: "",
    constraints: "No frameworks unless approved. Keep everything self-contained in the project folder.",
    protectedFiles: "",
  },
  dataAnalysis: {
    name: "Data analysis",
    instructions: "Analyses must be reproducible: every number in a report traces to a script or command recorded here.",
    stack: "Python (pandas, matplotlib)",
    keyFiles: "data/ — raw data (never modified in place)",
    testCommands: "",
    constraints: "Never overwrite raw data. Write outputs to out/. Note data provenance for every dataset used.",
    protectedFiles: "data/",
  },
  writing: {
    name: "Writing project",
    instructions: "Long-form writing. Keep a consistent voice; flag any claim that needs a source rather than inventing one.",
    stack: "Markdown",
    keyFiles: "draft.md",
    testCommands: "",
    constraints: "No fabricated citations. Preserve author voice; suggest rather than rewrite unless asked.",
    protectedFiles: "",
  },
};

function projectFromTemplate(key) {
  const tpl = PROJECT_TEMPLATES[key];
  if (!tpl) return null;
  const p = blankProject();
  Object.entries(tpl).forEach(([k, v]) => { p[k] = v; });
  return p;
}

/* ---------- Project list ---------- */
function renderProjectList() {
  const el = $pj("prjList");
  el.innerHTML = "";
  Projects.load().forEach((p) => {
    const row = document.createElement("div");
    row.className = "bp-item" + (p.id === editingProjectId ? " active" : "");
    row.textContent = p.name || "(unnamed)";
    row.addEventListener("click", () => loadProject(p.id));
    el.appendChild(row);
  });
  if (!Projects.load().length) el.innerHTML = "<p class='dim'>No projects yet.</p>";
}

function loadProject(id) {
  const p = Projects.get(id);
  if (!p) return;
  editingProjectId = id;
  renderProjectList();
  const ed = $pj("prjEditor");
  ed.innerHTML = "";
  ed.appendChild(mkField("Project name", "text", p.name, (v) => { p.name = v; saveProject(p); }));
  ed.appendChild(mkField("Root directory (local path)", "text", p.rootDir, (v) => { p.rootDir = v; saveProject(p); }));
  ed.appendChild(mkField("Project instructions", "textarea", p.instructions, (v) => { p.instructions = v; saveProject(p); }));
  ed.appendChild(mkField("Technology stack & conventions", "textarea", p.stack, (v) => { p.stack = v; saveProject(p); }));
  ed.appendChild(mkField("Key files & entry points", "textarea", p.keyFiles, (v) => { p.keyFiles = v; saveProject(p); }));
  ed.appendChild(mkField("Test / build commands", "textarea", p.testCommands, (v) => { p.testCommands = v; saveProject(p); }));
  ed.appendChild(mkField("Known constraints & decisions", "textarea", p.constraints, (v) => { p.constraints = v; saveProject(p); }));
  ed.appendChild(mkField("Protected files (never modified)", "textarea", p.protectedFiles, (v) => { p.protectedFiles = v; saveProject(p); }));

  const del = document.createElement("button");
  del.textContent = "Delete project";
  del.addEventListener("click", () => {
    if (confirm("Delete project \"" + p.name + "\"? Memory entries stay but become unassigned.")) {
      Projects.remove(p.id);
      editingProjectId = null;
      renderProjectList();
      $pj("prjEditor").innerHTML = "<p class='dim'>Select a project.</p>";
      renderMemory();
    }
  });
  ed.appendChild(del);

  renderMemory();
}

function saveProject(p) { Projects.upsert(p); renderProjectList(); $pj("saveState") && ($pj("saveState").textContent = "Saved " + new Date().toLocaleTimeString()); }

function mkField(label, kind, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const el = document.createElement(kind === "textarea" ? "textarea" : "input");
  if (kind !== "textarea") el.type = kind;
  el.value = value ?? "";
  if (kind === "textarea") el.rows = 2;
  el.addEventListener("input", () => onChange(el.value));
  wrap.appendChild(el);
  return wrap;
}

/* ---------- Memory panel ---------- */
function renderMemory() {
  const el = $pj("memList");
  el.innerHTML = "";
  const pid = editingProjectId;
  const mems = pid ? Memory.byProject(pid) : Memory.load();
  mems.forEach((m) => {
    const row = document.createElement("div");
    row.className = "mem-item";
    const cat = MEM_CATEGORIES.find((c) => c[0] === m.category);
    row.innerHTML =
      `<span class="mem-cat" style="background:${catColor(m.category)}22;color:${catColor(m.category)}">${escapeHtml(cat ? cat[1] : m.category)}</span>
       <span class="mem-text">${escapeHtml(m.text)}</span>
       <span class="mem-meta">${m.verified ? "✓ verified" : "unverified"} · ${new Date(m.createdAt).toLocaleDateString()}</span>`;
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "✕"; del.title = "Forget this entry";
    del.addEventListener("click", () => { Memory.remove(m.id); renderMemory(); });
    row.appendChild(del);
    el.appendChild(row);
  });
  if (!mems.length) el.innerHTML = "<p class='dim'>No memory entries.</p>";
}

function catColor(c) {
  return { fact: "#a78bfa", decision: "#34d399", finding: "#22d3ee", failure: "#f87171", wfperf: "#fbbf24", temp: "#8a9099" }[c] || "#8a9099";
}

function wireMemoryForm() {
  const add = $pj("memAdd");
  const cat = $pj("memCategory");
  MEM_CATEGORIES.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    cat.appendChild(o);
  });
  add.addEventListener("click", () => {
    const text = $pj("memText").value.trim();
    if (!text) return;
    Memory.add({
      projectId: editingProjectId || null,
      category: cat.value,
      text,
      source: "user",
      verified: cat.value === "decision" || cat.value === "finding",
    });
    $pj("memText").value = "";
    renderMemory();
  });
}

/* ---------- Init ---------- */
(function initProjects() {
  $pj("prjNew").addEventListener("click", () => {
    const p = blankProject();
    p.name = "Project " + (Projects.load().length + 1);
    Projects.upsert(p);
    editingProjectId = p.id;
    renderProjectList();
    loadProject(p.id);
  });

  // Project template picker (if present in the page markup)
  const tplSel = $pj("prjTemplate");
  const tplBtn = $pj("prjFromTemplate");
  if (tplSel && tplBtn) {
    Object.entries(PROJECT_TEMPLATES).forEach(([key, t]) => {
      const o = document.createElement("option");
      o.value = key; o.textContent = t.name;
      tplSel.appendChild(o);
    });
    tplBtn.addEventListener("click", () => {
      const p = projectFromTemplate(tplSel.value);
      if (!p) return;
      Projects.upsert(p);
      editingProjectId = p.id;
      renderProjectList();
      loadProject(p.id);
    });
  }

  wireMemoryForm();
  renderProjectList();
  const first = Projects.load()[0];
  if (first) loadProject(first.id);
  else renderMemory();
})();
