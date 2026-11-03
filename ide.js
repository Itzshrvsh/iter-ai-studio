// IDE Agent page — open a folder, browse/edit files, and run a coding agent
// that acts through tools (list/read/write/run) until the task is done.
const $ide = (id) => document.getElementById(id);
const idePath = require("path");
const ideFs = require("fs");
const IDE_AGENT = require("./ide-agent.js");

let ideRoot = localStorage.getItem("iterai.ide.root") || "";
let ideCurrentFile = null;
let ideDirty = false;
let ideAbort = null;
let ideRunning = false;
let ideChanged = new Set();

const IDE_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "target", ".cache", "__pycache__", ".venv", "venv"]);

/* ---------- Tree ---------- */
function ideRel(abs) { return idePath.relative(ideRoot, abs).split(idePath.sep).join("/") || "."; }

function renderTree(dir = ideRoot, container = $ide("ideTree"), depth = 0) {
  if (!container) return;
  if (depth === 0) container.innerHTML = "";
  let entries = [];
  try {
    entries = ideFs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !IDE_SKIP.has(e.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  } catch (e) {
    container.innerHTML = "<div class='dim' style='padding:6px'>" + e.message + "</div>";
    return;
  }
  if (!entries.length && depth === 0) container.innerHTML = "<div class='dim' style='padding:6px'>Folder is empty.</div>";
  entries.forEach((entry) => {
    const abs = idePath.join(dir, entry.name);
    const row = document.createElement("div");
    row.className = "ide-tree-row";
    row.style.paddingLeft = 6 + depth * 12 + "px";
    if (entry.isDirectory()) {
      row.innerHTML = "<span class='ide-tree-icon'>▸</span>" + entry.name + "/";
      row.title = abs;
      const kids = document.createElement("div");
      kids.style.display = "none";
      let loaded = false;
      row.addEventListener("click", () => {
        const open = kids.style.display !== "none";
        kids.style.display = open ? "none" : "block";
        row.firstChild.textContent = open ? "▸" : "▾";
        if (!open && !loaded) { loaded = true; renderTree(abs, kids, depth + 1); }
      });
      container.appendChild(row);
      container.appendChild(kids);
    } else {
      row.innerHTML = "<span class='ide-tree-icon'>·</span>" + entry.name;
      row.title = ideRel(abs);
      row.addEventListener("click", () => openFile(abs));
      container.appendChild(row);
    }
  });
}

/* ---------- File editing ---------- */
function openFile(abs) {
  if (ideDirty && !confirm("Discard unsaved changes to " + ideRel(ideCurrentFile) + "?")) return;
  try {
    const stat = ideFs.statSync(abs);
    if (stat.size > 1024 * 1024) return flash("File too large to open (>1 MB)");
    $ide("ideEditor").value = ideFs.readFileSync(abs, "utf8");
    ideCurrentFile = abs;
    ideDirty = false;
    $ide("ideActivePath").textContent = ideRel(abs);
    $ide("ideActivePath").className = "";
    $ide("ideSaveFile").disabled = true;
  } catch (e) { flash("Open failed: " + e.message); }
}

function saveFile() {
  if (!ideCurrentFile) return;
  try {
    ideFs.writeFileSync(ideCurrentFile, $ide("ideEditor").value, "utf8");
    ideDirty = false;
    $ide("ideSaveFile").disabled = true;
    $ide("ideActivePath").className = "dim";
    flash("Saved " + ideRel(ideCurrentFile));
  } catch (e) { flash("Save failed: " + e.message); }
}

function flash(msg) {
  $("dockStatus").textContent = msg;
}

/* ---------- Folder ---------- */
async function chooseFolder() {
  if (!window.iteraiBridge?.chooseFolder) {
    flash("Folder picker unavailable — run inside the desktop app.");
    return;
  }
  const dir = await window.iteraiBridge.chooseFolder();
  if (!dir) return;
  ideRoot = dir;
  ideCurrentFile = null;
  ideDirty = false;
  localStorage.setItem("iterai.ide.root", dir);
  $ide("ideRoot").textContent = dir;
  $ide("ideRoot").title = dir;
  $ide("ideActivePath").textContent = "No file open";
  $ide("ideEditor").value = "";
  $ide("ideConsole").textContent = "";
  renderTree();
  flash("Opened folder: " + dir);
}

/* ---------- Agent ---------- */
function ideLog(line, cls) {
  const el = $ide("ideConsole");
  const stamp = new Date().toLocaleTimeString();
  el.textContent += (el.textContent ? "\n" : "") + "[" + stamp + "] " + line;
  el.scrollTop = el.scrollHeight;
}

function ideStep(html) {
  const div = document.createElement("div");
  div.className = "ide-step";
  div.innerHTML = html;
  $ide("ideSteps").appendChild(div);
}

function populateModels() {
  const sel = $ide("ideModel");
  sel.innerHTML = "";
  Store.all().forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = (p.local ? "◉ " : "☁ ") + p.name + " — " + p.model;
    sel.appendChild(o);
  });
  const active = Store.active();
  if (active) sel.value = active.id;
  if (!Store.all().length) {
    const o = document.createElement("option");
    o.textContent = "No provider — add one on Chat";
    o.value = "";
    sel.appendChild(o);
  }
}

function escapeIde(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const ideApprove = async (action) => {
  if (!$ide("ideApproval").checked) return true;
  const desc = action.tool === "run_command"
    ? "Run command:\n" + action.command
    : action.tool === "write_file"
      ? "Write file: " + action.path + " (" + String(action.content || "").length + " chars)"
      : action.tool + " " + (action.path || "");
  return confirm(desc + "\n\nAllow?");
};

async function runIdeAgent() {
  if (ideRunning) return;
  if (!ideRoot) { flash("Open a folder first."); ideLog("No folder open."); return; }
  const task = $ide("ideTask").value.trim();
  if (!task) { flash("Describe the task first."); $ide("ideTask").focus(); return; }
  const provider = Store.all().find((p) => p.id === $ide("ideModel").value) || Store.active();
  if (!provider) { flash("No provider configured."); return; }

  ideRunning = true;
  ideAbort = new AbortController();
  ideChanged = new Set();
  $ide("ideRun").disabled = true;
  $ide("ideStop").disabled = false;
  $ide("ideState").textContent = "Running…";
  $ide("ideSteps").innerHTML = "";
  ideLog("Task: " + task);
  ideLog("Model: " + provider.name + " → " + provider.model);

  const tools = IDE_AGENT.createTools(ideRoot, { maxOutput: 6000 });

  const callModel = async (messages) => {
    const res = await fetch(provider.baseUrl + "/chat/completions", {
      method: "POST",
      signal: ideAbort.signal,
      headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: "Bearer " + provider.apiKey } : {}) },
      body: JSON.stringify({ model: provider.model, messages, max_tokens: 4000, temperature: 0.2 }),
    });
    if (!res.ok) throw new Error("Provider " + res.status + ": " + (await res.text()).slice(0, 300));
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    return choice?.content || choice?.reasoning || "";
  };

  try {
    const result = await IDE_AGENT.runAgent({
      callModel,
      tools,
      systemPrompt: IDE_AGENT.buildSystemPrompt(ideRoot),
      task,
      maxSteps: Math.max(1, Math.min(100, Number($ide("ideMaxSteps").value) || 20)),
      approve: ideApprove,
      signal: ideAbort.signal,
      onEvent: (ev) => {
        if (ev.type === "model") {
          const preview = String(ev.text || "").replace(/\s+/g, " ").slice(0, 120);
          ideStep("<b>step " + ev.step + "</b> · model: " + escapeIde(preview) + (preview.length >= 120 ? "…" : ""));
        } else if (ev.type === "tool") {
          let label = ev.action.tool;
          if (ev.action.tool === "write_file" || ev.action.tool === "read_file") label += " " + ev.action.path;
          if (ev.action.tool === "run_command") label += " `" + ev.action.command + "`";
          ideStep("<b>step " + ev.step + "</b> · " + escapeIde(label) +
            "<pre class='ide-toolout'>" + escapeIde(String(ev.result).slice(0, 400)) + "</pre>");
          ideLog("[" + ev.action.tool + "] " + (ev.action.path || ev.action.command || ""));
          if (ev.action.tool === "write_file") ideChanged.add(ev.action.path);
          if (ev.result) ideLog(String(ev.result).slice(0, 1200));
        } else if (ev.type === "done") {
          ideStep("<b>done</b> · " + escapeIde(ev.summary));
          ideLog("DONE: " + ev.summary);
        } else if (ev.type === "limit") {
          ideStep("<b>step limit</b> · reached " + ev.maxSteps + " steps");
        }
      },
    });
    $ide("ideState").textContent = result.done
      ? "Done in " + result.steps + " step(s): " + (result.summary || "")
      : "Stopped: " + (result.reason || "unknown");
    if (ideChanged.size) flash("Agent changed " + ideChanged.size + " file(s): " + [...ideChanged].join(", "));
    renderTree();
    if (ideCurrentFile && ideChanged.has(ideRel(ideCurrentFile))) openFile(ideCurrentFile);
  } catch (err) {
    if (err.name === "AbortError") {
      $ide("ideState").textContent = "Stopped by user.";
      ideLog("Stopped by user.");
    } else {
      $ide("ideState").textContent = "Error: " + err.message;
      ideLog("ERROR: " + err.message);
    }
  } finally {
    ideRunning = false;
    ideAbort = null;
    $ide("ideRun").disabled = false;
    $ide("ideStop").disabled = true;
    renderTree();
  }
}

/* ---------- Init ---------- */
(function initIde() {
  $ide("ideOpenFolder").addEventListener("click", chooseFolder);
  $ide("ideReloadTree").addEventListener("click", () => { if (ideRoot) renderTree(); });
  $ide("ideSaveFile").addEventListener("click", saveFile);
  $ide("ideRun").addEventListener("click", () => runIdeAgent().catch((e) => ideLog("ERROR: " + e.message)));
  $ide("ideStop").addEventListener("click", () => ideAbort?.abort());
  $ide("ideEditor").addEventListener("input", () => {
    if (!ideCurrentFile) return;
    ideDirty = true;
    $ide("ideSaveFile").disabled = false;
    $ide("ideActivePath").className = "ide-dirty";
    $ide("ideActivePath").textContent = ideRel(ideCurrentFile) + " *";
  });
  $ide("ideEditor").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); }
  });
  $ide("ideTask").addEventListener("input", () => localStorage.setItem("iterai.ide.task", $ide("ideTask").value));
  $ide("ideApproval").addEventListener("change", () => localStorage.setItem("iterai.ide.approval", $ide("ideApproval").checked ? "1" : "0"));
  $ide("ideMaxSteps").addEventListener("change", () => localStorage.setItem("iterai.ide.maxSteps", $ide("ideMaxSteps").value));

  $ide("ideTask").value = localStorage.getItem("iterai.ide.task") || "";
  $ide("ideApproval").checked = localStorage.getItem("iterai.ide.approval") === "1";
  $ide("ideMaxSteps").value = localStorage.getItem("iterai.ide.maxSteps") || "20";

  populateModels();
  if (ideRoot && ideFs.existsSync(ideRoot)) {
    $ide("ideRoot").textContent = ideRoot;
    $ide("ideRoot").title = ideRoot;
    renderTree();
  } else if (ideRoot) {
    ideRoot = "";
  }

  // Keep the model dropdown in sync when providers change on the chat page
  const sel = $ide("provSelect");
  if (sel) sel.addEventListener("change", populateModels);
  document.addEventListener("pagechange", (e) => { if (e.detail === "ide") populateModels(); });
})();
