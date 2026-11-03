// Agentic Coding page — save reusable coding-agent presets and launch them
// against a project folder using the same bounded tool loop as the IDE agent.
const $ac = (id) => document.getElementById(id);
const acPath = require("path");
const acFs = require("fs");

const AC_TOOLS = ["list_dir", "read_file", "write_file", "run_command"];

const AgentPresets = {
  key: "iterai.agentPresets",
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

const AgentRuns = {
  key: "iterai.agentRuns",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list.slice(0, 20))); },
  add(run) { const list = this.load(); list.unshift(run); this.saveAll(list); },
};

const AC_TEMPLATES = {
  feature: {
    name: "Feature implementer",
    instructions: "Implement the requested feature completely. Read the relevant files before editing. Keep changes minimal and consistent with the existing code. Run the project's tests or a focused check when possible. Do not add dependencies without being asked.",
    tools: ["list_dir", "read_file", "write_file", "run_command"],
    maxSteps: 30,
    approval: true,
  },
  bugfix: {
    name: "Bug fixer",
    instructions: "Reproduce the bug first when possible, then find the root cause. Prefer a focused fix over a rewrite. After changing code, run the narrowest command that proves the bug is fixed. Report what was actually verified.",
    tools: ["list_dir", "read_file", "write_file", "run_command"],
    maxSteps: 30,
    approval: true,
  },
  tests: {
    name: "Test writer",
    instructions: "Add focused automated tests for the requested behavior. Follow the existing test framework and naming style. Run the new tests and report the exact command and result. Do not change production code unless a test exposes a real defect.",
    tools: ["list_dir", "read_file", "write_file", "run_command"],
    maxSteps: 25,
    approval: true,
  },
  refactor: {
    name: "Safe refactorer",
    instructions: "Refactor only what the task requires. Preserve observable behavior and public interfaces. Work in small edits, run tests after each meaningful change, and stop if verification fails.",
    tools: ["list_dir", "read_file", "write_file", "run_command"],
    maxSteps: 30,
    approval: true,
  },
  review: {
    name: "Code reviewer (read-only)",
    instructions: "Inspect the project and review the requested area. Look for correctness bugs, edge cases, security problems, and consistency issues. Cite file paths and lines in the summary. Do not modify files.",
    tools: ["list_dir", "read_file"],
    maxSteps: 20,
    approval: false,
  },
};

let acCurrentId = null;
let acRunning = false;
let acAbort = null;

function acBlankPreset() {
  return {
    id: "ac_" + Date.now(),
    name: "New coding agent",
    instructions: "",
    defaultTask: "",
    workspace: "",
    providerId: "",
    maxSteps: 20,
    approval: true,
    tools: AC_TOOLS.slice(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function acEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Preset list ---------- */
function acRenderList() {
  const wrap = $ac("acList");
  wrap.innerHTML = "";
  const list = AgentPresets.load();
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "dim";
    empty.style.fontSize = "11px";
    empty.style.padding = "4px 6px";
    empty.textContent = "No saved agents yet.";
    wrap.appendChild(empty);
    return;
  }
  list.forEach((p) => {
    const row = document.createElement("div");
    row.className = "ac-item" + (p.id === acCurrentId ? " active" : "");
    const name = document.createElement("span");
    name.className = "ac-item-name";
    name.textContent = p.name;
    const meta = document.createElement("span");
    meta.className = "ac-item-meta";
    meta.textContent = (p.tools || []).length + " tools";
    row.append(name, meta);
    row.title = p.instructions || p.name;
    row.addEventListener("click", () => acSelect(p.id));
    wrap.appendChild(row);
  });
}

function acSelect(id) {
  const p = AgentPresets.get(id);
  if (!p) return;
  acCurrentId = id;
  acRenderList();
  acRenderEditor(p);
  acSyncLaunch(p);
}

/* ---------- Editor ---------- */
function acRenderEditor(p) {
  const el = $ac("acEditor");
  el.innerHTML = "";

  const title = document.createElement("div");
  title.className = "ac-editor-head";
  title.innerHTML = "<h2>Agent preset</h2><span class='dim'>Saved locally · reusable across projects</span>";
  el.appendChild(title);

  el.appendChild(acField("Name", "acEdName", "input", p.name, "e.g. Electron feature agent"));
  el.appendChild(acField("Instructions", "acEdInstructions", "textarea", p.instructions,
    "Standing instructions added to the agent's system prompt. Describe scope, conventions, verification steps, and what not to touch."));
  el.appendChild(acField("Default task", "acEdTask", "textarea", p.defaultTask,
    "Pre-fills the launch task — you can still edit it before each run."));
  el.appendChild(acField("Workspace folder", "acEdWorkspace", "input", p.workspace,
    "Absolute path to the project the agent may read and write. Leave blank to choose at launch."));

  const modelField = document.createElement("label");
  modelField.className = "ac-field";
  const modelLabel = document.createElement("span");
  modelLabel.textContent = "Default model";
  const modelSel = document.createElement("select");
  modelSel.id = "acEdModel";
  acFillModelSelect(modelSel, p.providerId);
  modelField.append(modelLabel, modelSel);
  el.appendChild(modelField);

  const row = document.createElement("div");
  row.className = "ac-editor-row";
  const steps = acField("Max steps", "acEdMaxSteps", "input", String(p.maxSteps || 20));
  steps.querySelector("input").type = "number";
  steps.querySelector("input").min = "1";
  steps.querySelector("input").max = "100";
  row.appendChild(steps);
  const chk = document.createElement("label");
  chk.className = "ac-chk ac-chk-inline";
  chk.innerHTML = "<input type='checkbox' id='acEdApproval'> Ask before each write / command";
  chk.querySelector("input").checked = !!p.approval;
  row.appendChild(chk);
  el.appendChild(row);

  const toolsHead = document.createElement("h4");
  toolsHead.textContent = "Allowed tools";
  el.appendChild(toolsHead);
  const toolsWrap = document.createElement("div");
  toolsWrap.className = "ac-tools";
  AC_TOOLS.forEach((tool) => {
    const label = document.createElement("label");
    label.className = "ac-chk";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = tool;
    box.checked = (p.tools || AC_TOOLS).includes(tool);
    box.dataset.acTool = "1";
    label.append(box, document.createTextNode(tool));
    toolsWrap.appendChild(label);
  });
  el.appendChild(toolsWrap);

  const actions = document.createElement("div");
  actions.className = "ac-actions";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save agent";
  save.addEventListener("click", () => acSaveFromEditor(true));
  const del = document.createElement("button");
  del.textContent = "Delete";
  del.addEventListener("click", () => {
    const cur = AgentPresets.get(acCurrentId);
    if (!cur) return;
    if (!confirm('Delete coding agent "' + cur.name + '"?')) return;
    AgentPresets.remove(cur.id);
    const rest = AgentPresets.load();
    acCurrentId = rest[0]?.id || null;
    acRenderList();
    if (acCurrentId) acSelect(acCurrentId); else acBlankEditor();
    $("dockStatus").textContent = "Deleted coding agent";
  });
  actions.append(save, del);
  el.appendChild(actions);
}

function acField(labelText, inputId, kind, value, placeholder) {
  const label = document.createElement("label");
  label.className = "ac-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.appendChild(span);
  const input = document.createElement(kind === "textarea" ? "textarea" : "input");
  input.id = inputId;
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  if (kind === "textarea") input.rows = inputId === "acEdInstructions" ? 6 : 3;
  label.appendChild(input);
  return label;
}

function acFillModelSelect(sel, providerId) {
  sel.innerHTML = "";
  Store.all().forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = (p.local ? "◉ " : "☁ ") + p.name + " — " + p.model;
    sel.appendChild(o);
  });
  if (!Store.all().length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "No provider — add one on Chat";
    sel.appendChild(o);
  }
  const active = Store.active();
  sel.value = (providerId && Store.all().some((p) => p.id === providerId))
    ? providerId
    : (active ? active.id : "");
}

function acBlankEditor() {
  const el = $ac("acEditor");
  el.innerHTML = "<div class='empty-state'><h2>No agent selected</h2><p>Create an agent or install a preset on the left.</p></div>";
}

function acReadEditor() {
  const tools = [...document.querySelectorAll("#acEditor [data-ac-tool]")]
    .filter((b) => b.checked).map((b) => b.value);
  return {
    name: $ac("acEdName")?.value.trim() || "",
    instructions: $ac("acEdInstructions")?.value.trim() || "",
    defaultTask: $ac("acEdTask")?.value.trim() || "",
    workspace: $ac("acEdWorkspace")?.value.trim() || "",
    providerId: $ac("acEdModel")?.value || "",
    maxSteps: Math.max(1, Math.min(100, Number($ac("acEdMaxSteps")?.value) || 20)),
    approval: !!$ac("acEdApproval")?.checked,
    tools,
  };
}

function acSaveFromEditor(announce) {
  const p = AgentPresets.get(acCurrentId);
  if (!p) return null;
  const data = acReadEditor();
  if (!data.name) { $("dockStatus").textContent = "Give the agent a name first."; return null; }
  const next = { ...p, ...data, updatedAt: Date.now() };
  AgentPresets.upsert(next);
  acRenderList();
  acSyncLaunch(next);
  if (announce) $("dockStatus").textContent = "Saved coding agent: " + next.name;
  return next;
}

/* ---------- Launch panel ---------- */
function acSyncLaunch(p) {
  $ac("acWorkspace").value = p.workspace || "";
  $ac("acTask").value = p.defaultTask || "";
  acFillModelSelect($ac("acModel"), p.providerId);
  $ac("acApproval").checked = !!p.approval;
  $ac("acMaxSteps").value = p.maxSteps || 20;
  $ac("acState").textContent = "";
  $ac("acSteps").innerHTML = "";
  $ac("acConsole").textContent = "";
}

function acLog(line) {
  const el = $ac("acConsole");
  const stamp = new Date().toLocaleTimeString();
  el.textContent += (el.textContent ? "\n" : "") + "[" + stamp + "] " + line;
  el.scrollTop = el.scrollHeight;
}

function acStep(html) {
  const div = document.createElement("div");
  div.className = "ac-step";
  div.innerHTML = html;
  $ac("acSteps").appendChild(div);
}

function acRel(workspace, abs) {
  try { return acPath.relative(workspace, abs).split(acPath.sep).join("/"); }
  catch { return abs; }
}

async function acChooseFolder() {
  if (!window.iteraiBridge?.chooseFolder) {
    $("dockStatus").textContent = "Folder picker unavailable — run inside the desktop app.";
    return;
  }
  const dir = await window.iteraiBridge.chooseFolder();
  if (!dir) return;
  $ac("acWorkspace").value = dir;
  if ($ac("acEdWorkspace")) $ac("acEdWorkspace").value = dir;
  acSaveFromEditor(false);
  $("dockStatus").textContent = "Workspace: " + dir;
}

async function acRun() {
  if (acRunning) return;
  if (!acCurrentId) { $("dockStatus").textContent = "Select or create a coding agent first."; return; }

  // Capture the launch panel before saving — saving re-syncs the panel from the preset.
  const launchTask = ($ac("acTask").value || "").trim();
  const launchWorkspace = ($ac("acWorkspace").value || "").trim();
  const preset = acSaveFromEditor(false);
  if (!preset) return;
  $ac("acTask").value = launchTask;
  $ac("acWorkspace").value = launchWorkspace;

  const workspace = launchWorkspace;
  if (!workspace) { $("dockStatus").textContent = "Choose a workspace folder first."; $ac("acWorkspace").focus(); return; }
  if (!acFs.existsSync(workspace)) { $("dockStatus").textContent = "Workspace does not exist: " + workspace; return; }

  const task = launchTask;
  if (!task) { $("dockStatus").textContent = "Describe the task first."; $ac("acTask").focus(); return; }

  const providerId = $ac("acModel").value;
  const provider = Store.all().find((p) => p.id === providerId) || Store.active();
  if (!provider) { $("dockStatus").textContent = "No model provider configured."; return; }

  const allowed = preset.tools && preset.tools.length ? preset.tools : AC_TOOLS;
  const allTools = IDE_AGENT.createTools(workspace, { maxOutput: 6000 });
  const tools = {};
  allowed.forEach((t) => { if (allTools[t]) tools[t] = allTools[t]; });

  const approval = $ac("acApproval").checked;
  const maxSteps = Math.max(1, Math.min(100, Number($ac("acMaxSteps").value) || preset.maxSteps || 20));
  const approve = async (action) => {
    if (!approval) return true;
    const desc = action.tool === "run_command"
      ? "Run command:\n" + action.command
      : action.tool === "write_file"
        ? "Write file: " + action.path + " (" + String(action.content || "").length + " chars)"
        : action.tool + " " + (action.path || "");
    return confirm(desc + "\n\nAllow?");
  };

  const callModel = async (messages) => {
    const res = await fetch(provider.baseUrl + "/chat/completions", {
      method: "POST",
      signal: acAbort.signal,
      headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: "Bearer " + provider.apiKey } : {}) },
      body: JSON.stringify({ model: provider.model, messages, max_tokens: 4000, temperature: 0.2 }),
    });
    if (!res.ok) throw new Error("Provider " + res.status + ": " + (await res.text()).slice(0, 300));
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    return choice?.content || choice?.reasoning || "";
  };

  acRunning = true;
  acAbort = new AbortController();
  $ac("acRun").disabled = true;
  $ac("acStop").disabled = false;
  $ac("acState").textContent = "Running…";
  $ac("acSteps").innerHTML = "";
  $ac("acConsole").textContent = "";

  const started = Date.now();
  const changed = new Set();
  const sys = IDE_AGENT.buildSystemPrompt(workspace) +
    (preset.instructions ? "\n\nAgent preset — " + preset.name + ":\n" + preset.instructions : "");

  acLog("Agent: " + preset.name);
  acLog("Workspace: " + workspace);
  acLog("Model: " + provider.name + " → " + provider.model);
  acLog("Task: " + task);
  acLog("Tools: " + (allowed.join(", ") || "(none)"));

  let outcome = { done: false, reason: "not started", steps: 0, summary: "" };
  try {
    outcome = await IDE_AGENT.runAgent({
      callModel,
      tools,
      systemPrompt: sys,
      task,
      maxSteps,
      approve,
      signal: acAbort.signal,
      onEvent: (ev) => {
        if (ev.type === "model") {
          const preview = String(ev.text || "").replace(/\s+/g, " ").slice(0, 140);
          acStep("<b>step " + ev.step + "</b> · model: " + acEscape(preview) + (preview.length >= 140 ? "…" : ""));
        } else if (ev.type === "tool") {
          let label = ev.action.tool;
          if (ev.action.tool === "write_file" || ev.action.tool === "read_file") label += " " + ev.action.path;
          if (ev.action.tool === "run_command") label += " `" + ev.action.command + "`";
          acStep("<b>step " + ev.step + "</b> · " + acEscape(label) +
            "<pre class='ac-toolout'>" + acEscape(String(ev.result).slice(0, 500)) + "</pre>");
          acLog("[" + ev.action.tool + "] " + (ev.action.path || ev.action.command || ""));
          if (ev.action.tool === "write_file") changed.add(ev.action.path);
          if (ev.result) acLog(String(ev.result).slice(0, 1200));
        } else if (ev.type === "done") {
          acStep("<b>done</b> · " + acEscape(ev.summary));
          acLog("DONE: " + ev.summary);
        } else if (ev.type === "limit") {
          acStep("<b>step limit</b> · reached " + ev.maxSteps + " steps");
        }
      },
    });
    $ac("acState").textContent = outcome.done
      ? "Done in " + outcome.steps + " step(s): " + (outcome.summary || "")
      : "Stopped: " + (outcome.reason || "unknown");
    if (changed.size) $("dockStatus").textContent = "Agent changed " + changed.size + " file(s): " + [...changed].join(", ");
  } catch (err) {
    if (err.name === "AbortError") {
      outcome = { done: false, reason: "cancelled by user", steps: outcome.steps, summary: "" };
      $ac("acState").textContent = "Stopped by user.";
      acLog("Stopped by user.");
    } else {
      outcome = { done: false, reason: err.message, steps: outcome.steps, summary: "" };
      $ac("acState").textContent = "Error: " + err.message;
      acLog("ERROR: " + err.message);
    }
  } finally {
    acRunning = false;
    acAbort = null;
    $ac("acRun").disabled = false;
    $ac("acStop").disabled = true;
    AgentRuns.add({
      id: "ar_" + Date.now(),
      presetId: preset.id,
      presetName: preset.name,
      task,
      workspace,
      provider: provider.name + " → " + provider.model,
      done: !!outcome.done,
      reason: outcome.reason || "",
      summary: outcome.summary || "",
      steps: outcome.steps || 0,
      changed: [...changed],
      started,
      ended: Date.now(),
    });
    acRenderRuns();
  }
}

function acRenderRuns() {
  const wrap = $ac("acRuns");
  wrap.innerHTML = "";
  const runs = AgentRuns.load();
  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "dim";
    empty.style.fontSize = "11px";
    empty.style.padding = "4px 6px";
    empty.textContent = "No runs yet.";
    wrap.appendChild(empty);
    return;
  }
  runs.forEach((r) => {
    const row = document.createElement("div");
    row.className = "ac-run";
    const top = document.createElement("div");
    top.className = "ac-run-top";
    const name = document.createElement("span");
    name.className = "ac-run-name";
    name.textContent = r.presetName;
    const state = document.createElement("span");
    state.className = "ac-run-state " + (r.done ? "ok" : "warn");
    state.textContent = r.done ? "done" : "stopped";
    top.append(name, state);
    const meta = document.createElement("div");
    meta.className = "ac-run-meta";
    meta.textContent = (r.steps || 0) + " steps · " + (r.changed?.length || 0) + " file(s) · " + new Date(r.ended).toLocaleString();
    const task = document.createElement("div");
    task.className = "ac-run-task";
    task.textContent = r.task;
    row.append(top, meta, task);
    row.title = (r.summary ? r.summary + "\n\n" : "") + "Workspace: " + r.workspace;
    wrap.appendChild(row);
  });
}

/* ---------- Templates ---------- */
function acInstallTemplate(key) {
  const t = AC_TEMPLATES[key];
  if (!t) return;
  const p = acBlankPreset();
  p.name = t.name;
  p.instructions = t.instructions;
  p.tools = t.tools.slice();
  p.maxSteps = t.maxSteps;
  p.approval = t.approval;
  AgentPresets.upsert(p);
  acCurrentId = p.id;
  acRenderList();
  acSelect(p.id);
  $("dockStatus").textContent = "Added coding agent preset: " + p.name;
}

/* ---------- Init ---------- */
(function initAgentic() {
  const tpl = $ac("acTemplate");
  Object.entries(AC_TEMPLATES).forEach(([key, t]) => {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = t.name;
    tpl.appendChild(o);
  });

  $ac("acNew").addEventListener("click", () => {
    const p = acBlankPreset();
    AgentPresets.upsert(p);
    acCurrentId = p.id;
    acRenderList();
    acSelect(p.id);
    $("dockStatus").textContent = "New coding agent — give it a name and instructions.";
  });
  $ac("acFromTemplate").addEventListener("click", () => acInstallTemplate(tpl.value));
  $ac("acChooseFolder").addEventListener("click", () => acChooseFolder().catch((e) => acLog("ERROR: " + e.message)));
  $ac("acRun").addEventListener("click", () => acRun().catch((e) => acLog("ERROR: " + e.message)));
  $ac("acStop").addEventListener("click", () => acAbort?.abort());

  $ac("acWorkspace").addEventListener("change", () => {
    if ($ac("acEdWorkspace")) $ac("acEdWorkspace").value = $ac("acWorkspace").value;
    acSaveFromEditor(false);
  });
  $ac("acMaxSteps").addEventListener("change", () => {
    if ($ac("acEdMaxSteps")) $ac("acEdMaxSteps").value = $ac("acMaxSteps").value;
    acSaveFromEditor(false);
  });
  $ac("acApproval").addEventListener("change", () => {
    if ($ac("acEdApproval")) $ac("acEdApproval").checked = $ac("acApproval").checked;
    acSaveFromEditor(false);
  });
  $ac("acModel").addEventListener("change", () => {
    if ($ac("acEdModel")) $ac("acEdModel").value = $ac("acModel").value;
    acSaveFromEditor(false);
  });

  acRenderList();
  acRenderRuns();

  const saved = AgentPresets.load();
  if (saved.length) {
    acCurrentId = saved[0].id;
    acSelect(acCurrentId);
  } else {
    acBlankEditor();
  }

  // Keep the model dropdown current when providers are added/edited elsewhere.
  const provSel = document.getElementById("provSelect");
  if (provSel) provSel.addEventListener("change", () => {
    const p = AgentPresets.get(acCurrentId);
    if (p) acFillModelSelect($ac("acModel"), p.providerId);
  });
  document.addEventListener("pagechange", (e) => {
    if (e.detail !== "agentic") return;
    acRenderList();
    acRenderRuns();
    const p = AgentPresets.get(acCurrentId);
    if (p) acFillModelSelect($ac("acModel"), p.providerId);
  });
})();
