// Model Driving — behavior & policy studio (Phase 4)
// Profiles inherit: global → project → workflow → node. Here: global profiles + node overrides only (UI marks scope).
// NOTE: window.activeBehaviorProfile is intentionally NOT set anywhere yet —
// profile selection only fills the chat system prompt (see hookChatSystemPrompt).
// The engine therefore uses profile defaults until per-run profile binding lands.

const BehaviorProfiles = {
  key: "iterai.behaviorProfiles",
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

const DEFAULT_PROFILE = {
  id: null,
  name: "Default",
  // A. Behavior
  roleObjective: "",
  tone: "neutral",            // neutral | friendly | terse | formal
  concise: 2,                 // 0..3
  askVsAssume: "ask",         // ask | assume
  structuredOutput: false,
  explainDecisions: false,
  // B. Planning
  planStrategy: "staged",     // direct | staged
  maxTasks: 5,
  requirePlanReview: true,
  // C. Context
  maxContextChars: 6000,      // budget proxy until tokenizer exists
  reserveForOutput: 800,
  includeHistory: true,
  maxHistoryMessages: 8,
  // D. Tool use (frontend-advertised; backend enforcement is Phase 5+)
  toolAllowlist: "",
  networkPolicy: "disabled",  // disabled | allowlist | unrestricted
  maxToolCalls: 10,
  // E. Verification
  verifyWith: "none",         // none | self-check | command
  verifyCommand: "",
  verificationAttempts: 2,
  // F. Recovery
  maxRecoveryAttempts: 3,
  stopOnRepeatError: true,
  // G. Adaptation
  adaptationMode: "manual",   // manual | suggest | frozen
  maxGraphEdits: 0,
  // H. Budget & limits
  maxModelCalls: 20,
  maxTotalTokens: 100000,
  onBudgetReached: "pause",  // pause | stop | approve
  // I. Safety
  approvalFor: "writes,installs",  // comma list
  secretRedaction: true,
};

function blankProfile() {
  return JSON.parse(JSON.stringify({ ...DEFAULT_PROFILE, id: "bp_" + Date.now() }));
}

// ---- Ready-made profile templates ----
// Each is merged over DEFAULT_PROFILE; `name` is required, everything else overrides defaults.
const PROFILE_TEMPLATES = {
  safeDefault: {
    name: "Safe Default",
    tone: "neutral", concise: 2, askVsAssume: "ask",
    planStrategy: "staged", maxTasks: 5, requirePlanReview: true,
    networkPolicy: "disabled", maxToolCalls: 0,
    verifyWith: "self-check", verificationAttempts: 2,
    maxRecoveryAttempts: 3, stopOnRepeatError: true,
    maxModelCalls: 20, maxTotalTokens: 100000,
    approvalFor: "writes,installs", secretRedaction: true,
  },
  preciseCoder: {
    name: "Precise Coder",
    roleObjective: "You are a careful software engineer. Prefer minimal, correct changes over rewrites.",
    tone: "terse", concise: 3, askVsAssume: "assume",
    structuredOutput: true, explainDecisions: false,
    planStrategy: "staged", maxTasks: 8, requirePlanReview: false,
    maxContextChars: 12000, reserveForOutput: 2000, includeHistory: true, maxHistoryMessages: 10,
    verifyWith: "command", verificationAttempts: 3,
    maxRecoveryAttempts: 5, stopOnRepeatError: true,
    maxModelCalls: 60, maxTotalTokens: 400000,
  },
  researchAnalyst: {
    name: "Research Analyst",
    roleObjective: "You are a balanced research analyst. Distinguish facts from inference, and always note what you could not determine.",
    tone: "formal", concise: 1, askVsAssume: "ask",
    structuredOutput: true, explainDecisions: true,
    planStrategy: "staged", maxTasks: 5, requirePlanReview: true,
    maxContextChars: 20000, reserveForOutput: 3000,
    verifyWith: "self-check", verificationAttempts: 2,
    maxModelCalls: 30, maxTotalTokens: 200000,
  },
  terseAssistant: {
    name: "Terse Assistant",
    tone: "terse", concise: 3, askVsAssume: "assume",
    structuredOutput: false, explainDecisions: false,
    planStrategy: "direct",
    maxContextChars: 4000, reserveForOutput: 500, includeHistory: true, maxHistoryMessages: 4,
    verifyWith: "none",
    maxModelCalls: 10, maxTotalTokens: 30000,
  },
  brainstormer: {
    name: "Brainstormer",
    roleObjective: "You generate many diverse ideas without self-censoring, then help pick the best.",
    tone: "friendly", concise: 1, askVsAssume: "assume",
    structuredOutput: false, explainDecisions: false,
    planStrategy: "direct",
    temperatureNote: "pairs well with LLM nodes at temperature ≥ 0.9",
    maxModelCalls: 15, maxTotalTokens: 80000,
  },
};

function profileFromTemplate(key) {
  const tpl = PROFILE_TEMPLATES[key];
  if (!tpl) return null;
  const p = blankProfile();
  Object.entries(tpl).forEach(([k, v]) => { p[k] = v; });
  return p;
}

/* ---------- Profile generation from a natural-language prompt (AI-assisted) ----------
 * Sends the user's description to the active provider with a strict JSON schema,
 * then coerces/validates every field against DEFAULT_PROFILE. Invalid values fall
 * back to defaults — a broken model response can never produce a broken profile.
 */
const PROFILE_META_SCHEMA =
  'Design a behavior-profile for an AI assistant. Reply with ONLY a minified JSON object, no markdown fences, no commentary. Schema:\n' +
  '{"name":string,"roleObjective":string,"tone":"neutral"|"friendly"|"terse"|"formal",' +
  '"concise":0|1|2|3,"askVsAssume":"ask"|"assume","structuredOutput":boolean,"explainDecisions":boolean,' +
  '"planStrategy":"direct"|"staged","maxTasks":1-20,"requirePlanReview":boolean,' +
  '"maxContextChars":500-100000,"reserveForOutput":0-20000,"includeHistory":boolean,"maxHistoryMessages":0-100,' +
  '"toolAllowlist":string(comma-separated paths or ""),"networkPolicy":"disabled"|"allowlist"|"unrestricted","maxToolCalls":0-200,' +
  '"verifyWith":"none"|"self-check"|"command","verificationAttempts":1-5,' +
  '"maxRecoveryAttempts":1-10,"stopOnRepeatError":boolean,' +
  '"maxModelCalls":1-500,"maxTotalTokens":1000-10000000,"approvalFor":string(comma list),"secretRedaction":boolean}\n' +
  'Choose values that best match the user description. roleObjective must be 1-2 sentences of concrete persona instructions. name: 2-4 words.';

function coerceProfile(raw, fallbackName) {
  if (!raw || typeof raw !== "object") return null;
  const p = blankProfile();
  const str = (v, dflt) => (typeof v === "string" ? v.trim() : dflt);
  const bool = (v) => (typeof v === "boolean" ? v : undefined);
  const num = (v, min, max, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
  };
  const oneOf = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

  p.name = str(raw.name, "").slice(0, 40) || fallbackName;
  p.roleObjective = str(raw.roleObjective, "");
  p.tone = oneOf(raw.tone, ["neutral", "friendly", "terse", "formal"], DEFAULT_PROFILE.tone);
  p.concise = num(raw.concise, 0, 3, DEFAULT_PROFILE.concise);
  p.askVsAssume = oneOf(raw.askVsAssume, ["ask", "assume"], DEFAULT_PROFILE.askVsAssume);
  if (bool(raw.structuredOutput) !== undefined) p.structuredOutput = bool(raw.structuredOutput);
  if (bool(raw.explainDecisions) !== undefined) p.explainDecisions = bool(raw.explainDecisions);
  p.planStrategy = oneOf(raw.planStrategy, ["direct", "staged"], DEFAULT_PROFILE.planStrategy);
  p.maxTasks = num(raw.maxTasks, 1, 20, DEFAULT_PROFILE.maxTasks);
  if (bool(raw.requirePlanReview) !== undefined) p.requirePlanReview = bool(raw.requirePlanReview);
  p.maxContextChars = num(raw.maxContextChars, 500, 100000, DEFAULT_PROFILE.maxContextChars);
  p.reserveForOutput = num(raw.reserveForOutput, 0, 20000, DEFAULT_PROFILE.reserveForOutput);
  if (bool(raw.includeHistory) !== undefined) p.includeHistory = bool(raw.includeHistory);
  p.maxHistoryMessages = num(raw.maxHistoryMessages, 0, 100, DEFAULT_PROFILE.maxHistoryMessages);
  p.toolAllowlist = str(raw.toolAllowlist, "");
  p.networkPolicy = oneOf(raw.networkPolicy, ["disabled", "allowlist", "unrestricted"], DEFAULT_PROFILE.networkPolicy);
  p.maxToolCalls = num(raw.maxToolCalls, 0, 200, DEFAULT_PROFILE.maxToolCalls);
  p.verifyWith = oneOf(raw.verifyWith, ["none", "self-check", "command"], DEFAULT_PROFILE.verifyWith);
  p.verificationAttempts = num(raw.verificationAttempts, 1, 5, DEFAULT_PROFILE.verificationAttempts);
  p.maxRecoveryAttempts = num(raw.maxRecoveryAttempts, 1, 10, DEFAULT_PROFILE.maxRecoveryAttempts);
  if (bool(raw.stopOnRepeatError) !== undefined) p.stopOnRepeatError = bool(raw.stopOnRepeatError);
  p.maxModelCalls = num(raw.maxModelCalls, 1, 500, DEFAULT_PROFILE.maxModelCalls);
  p.maxTotalTokens = num(raw.maxTotalTokens, 1000, 10000000, DEFAULT_PROFILE.maxTotalTokens);
  p.approvalFor = str(raw.approvalFor, DEFAULT_PROFILE.approvalFor);
  if (bool(raw.secretRedaction) !== undefined) p.secretRedaction = bool(raw.secretRedaction);
  return p;
}

// Extract a JSON object from model output (tolerates fences and stray prose)
function extractProfileJson(text) {
  if (!text) return null;
  let s = String(text).replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); }
  catch { return null; }
}

// Ask the active provider to design a profile from a free-text description.
// Returns { ok, profile?, error? } — never throws.
async function generateProfileFromPrompt(description) {
  const provider = Store.active();
  if (!provider) return { ok: false, error: "No provider configured — add one on the Chat page." };
  if (!description || !description.trim()) return { ok: false, error: "Describe the profile first." };
  try {
    const res = await fetch(provider.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: "Bearer " + provider.apiKey } : {}) },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: "You output only valid minified JSON. No markdown fences, no commentary." },
          { role: "user", content: PROFILE_META_SCHEMA + "\n\nUser description: " + description.trim() },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return { ok: false, error: "Provider " + res.status + ": " + (await res.text()).slice(0, 200) };
    const data = await res.json();
    const raw = extractProfileJson(data.choices?.[0]?.message?.content);
    if (!raw) return { ok: false, error: "Model did not return valid JSON. Try rephrasing, or retry." };
    const profile = coerceProfile(raw, "Custom profile");
    if (!profile) return { ok: false, error: "Model response was not a usable profile object." };
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- Field schema for the editor ----
// [key, label, control, meta]
// control: text | textarea | number | select | checkbox
// meta for select: [value,label][]  ; for number: [min,max,step]
const PROFILE_FIELDS = [
  ["— Behavior", null],
  ["roleObjective", "Role & objective", "textarea"],
  ["tone", "Tone", "select", [["neutral", "Neutral"], ["friendly", "Friendly"], ["terse", "Terse"], ["formal", "Formal"]]],
  ["concise", "Conciseness (0=verbose, 3=terse)", "number", [0, 3, 1]],
  ["askVsAssume", "Ask versus assume", "select", [["ask", "Ask when unsure"], ["assume", "Assume and proceed"]]],
  ["structuredOutput", "Require structured output", "checkbox"],
  ["explainDecisions", "Explain decisions mode", "checkbox"],
  ["— Planning", null],
  ["planStrategy", "Planning strategy", "select", [["direct", "Direct"], ["staged", "Staged (bounded steps)"]]],
  ["maxTasks", "Max tasks per plan", "number", [1, 20, 1]],
  ["requirePlanReview", "Require plan review before execution", "checkbox"],
  ["— Context", null],
  ["maxContextChars", "Max context chars/request (est.)", "number", [500, 100000, 100]],
  ["reserveForOutput", "Reserve chars for output", "number", [0, 20000, 100]],
  ["includeHistory", "Include conversation history", "checkbox"],
  ["maxHistoryMessages", "Max history messages", "number", [0, 100, 1]],
  ["— Tool use", null],
  ["toolAllowlist", "Tool allowlist (comma-separated)", "text"],
  ["networkPolicy", "Network access", "select", [["disabled", "Disabled"], ["allowlist", "Allowlisted domains only"], ["unrestricted", "Unrestricted (warning)"]]],
  ["maxToolCalls", "Max tool calls per task", "number", [0, 200, 1]],
  ["— Verification", null],
  ["verifyWith", "Verification method", "select", [["none", "None"], ["self-check", "Self-check (model judges, marked unverified)"], ["command", "Command check"]]],
  ["verifyCommand", "Verify command", "text"],
  ["verificationAttempts", "Verification attempts", "number", [1, 5, 1]],
  ["— Recovery", null],
  ["maxRecoveryAttempts", "Max recovery attempts", "number", [1, 10, 1]],
  ["stopOnRepeatError", "Stop after repeated identical errors", "checkbox"],
  ["— Adaptation", null],
  ["adaptationMode", "Workflow adaptation mode", "select", [["manual", "Manual — never change"], ["suggest", "Suggest — propose for approval"], ["frozen", "Frozen — lock everything"]]],
  ["maxGraphEdits", "Max graph edits per run (auto modes)", "number", [0, 20, 1]],
  ["— Budget & limits", null],
  ["maxModelCalls", "Max model calls per task", "number", [1, 500, 1]],
  ["maxTotalTokens", "Max cumulative tokens (est.)", "number", [1000, 10000000, 1000]],
  ["onBudgetReached", "When budget reached", "select", [["pause", "Pause"], ["stop", "Stop"], ["approve", "Ask approval"]]],
  ["— Safety", null],
  ["approvalFor", "Require approval for (comma list)", "text"],
  ["secretRedaction", "Redact secrets in logs", "checkbox"],
];

// NOTE: `$` helper is declared in app.js and shared by all page scripts.
const md = (id) => document.getElementById(id);
let editingProfileId = null;

function renderProfileList() {
  const list = md("bpList");
  list.innerHTML = "";
  BehaviorProfiles.load().forEach((p) => {
    const row = document.createElement("div");
    row.className = "bp-item" + (p.id === editingProfileId ? " active" : "");
    row.textContent = p.name;
    row.addEventListener("click", () => loadProfile(p.id));
    list.appendChild(row);
  });
  if (!BehaviorProfiles.load().length)
    list.innerHTML = "<p class='dim'>No profiles yet.</p>";
}

function loadProfile(id) {
  const p = BehaviorProfiles.get(id);
  if (!p) return;
  editingProfileId = id;
  renderProfileList();
  renderProfileEditor(p);
}

function renderProfileEditor(p) {
  const ed = md("bpEditor");
  ed.innerHTML = "";

  const name = labeledField("Profile name", "text", p.name, (v) => { p.name = v; BehaviorProfiles.upsert(p); renderProfileList(); });
  ed.appendChild(name);

  PROFILE_FIELDS.forEach((f) => {
    const [key, label, control, meta] = f;
    if (!label) { // section header
      const h = document.createElement("h4");
      h.textContent = key.slice(2);
      ed.appendChild(h);
      return;
    }
    let field;
    if (control === "select") {
      field = labeledSelect(label, meta, p[key], (v) => { p[key] = v; save(p); });
    } else if (control === "checkbox") {
      field = labeledCheckbox(label, p[key], (v) => { p[key] = v; save(p); });
    } else if (control === "number") {
      field = labeledField(label, "number", p[key], (v) => { p[key] = Number(v); save(p); }, meta);
    } else {
      field = labeledField(label, control, p[key], (v) => { p[key] = v; save(p); });
    }
    ed.appendChild(field);
  });

  // Effective-settings preview + delete
  const prev = document.createElement("button");
  prev.textContent = "Preview effective prompt";
  prev.addEventListener("click", () => showPromptPreview(p));
  ed.appendChild(prev);

  const del = document.createElement("button");
  del.textContent = "Delete profile";
  del.addEventListener("click", () => {
    BehaviorProfiles.remove(p.id);
    editingProfileId = null;
    renderProfileList();
    md("bpEditor").innerHTML = "<p class='dim'>Select a profile.</p>";
  });
  ed.appendChild(del);
}

function save(p) { BehaviorProfiles.upsert(p); md("saveState").textContent = "Saved " + new Date().toLocaleTimeString(); }

function labeledField(label, type, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const el = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") el.type = type;
  el.value = value ?? "";
  el.addEventListener("input", () => onChange(el.value));
  wrap.appendChild(el);
  return wrap;
}

function labeledSelect(label, options, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const el = document.createElement("select");
  options.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (v === value) o.selected = true;
    el.appendChild(o);
  });
  el.addEventListener("change", () => onChange(el.value));
  wrap.appendChild(el);
  return wrap;
}

function labeledCheckbox(label, value, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "chk";
  const el = document.createElement("input");
  el.type = "checkbox";
  el.checked = !!value;
  el.addEventListener("change", () => onChange(el.checked));
  wrap.append(el, document.createTextNode(" " + label));
  return wrap;
}

// Compose the effective system prompt from a profile
function composePrompt(p) {
  let s = "";
  if (p.roleObjective) s += p.roleObjective + "\n\n";
  s += `Tone: ${p.tone}. Conciseness: ${["verbose", "balanced", "concise", "terse"][p.concise] ?? p.concise}.`;
  s += `\nIf unsure: ${p.askVsAssume === "ask" ? "ask the user instead of guessing" : "state assumptions explicitly and proceed"}.`;
  if (p.structuredOutput) s += "\nAlways answer in structured form (headings/bullets).";
  if (p.explainDecisions) s += "\nBriefly explain the reasoning behind decisions.";
  if (p.planStrategy === "staged")
    s += `\nBreak work into at most ${p.maxTasks} bounded tasks; each must state objective and expected output.`;
  if (p.requirePlanReview && p.planStrategy === "staged")
    s += "\nPresent the plan and wait for review before executing.";
  if (p.networkPolicy === "disabled") s += "\nDo not request network access.";
  if (p.verifyWith !== "none") s += `\nVerification: ${p.verifyWith === "command" ? "propose the check command \u201C" + (p.verifyCommand || "?") + "\u201D" : "self-check your answer"} (up to ${p.verificationAttempts} attempts).`;
  s += `\nNever modify your own budgets, safety rules, or approval requirements.`;
  return s.trim();
}

function showPromptPreview(p) {
  let dlg = md("bpPreviewDlg");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "bpPreviewDlg";
    dlg.innerHTML = `<h3>Effective prompt</h3><pre id="bpPreviewText" class="pre" style="max-height:50vh;min-width:420px;white-space:pre-wrap"></pre>
      <menu style="display:flex;justify-content:flex-end"><button onclick="this.closest('dialog').close()">Close</button></menu>`;
    document.body.appendChild(dlg);
  }
  dlg.querySelector("#bpPreviewText").textContent = composePrompt(p) || "(empty)";
  dlg.showModal();
}

/* Chat integration: a profile selector lives on the chat bar area (injected) */
(function integrateChatProfile() {
  const bar = md("chatBar");
  if (!bar) return;
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;flex-direction:column;font-size:10px;color:var(--text-dim);justify-content:center";
  wrap.textContent = "Profile";
  const sel = document.createElement("select");
  sel.id = "profileSelect";
  sel.style.cssText = "padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)";
  wrap.appendChild(sel);
  bar.insertBefore(wrap, bar.firstChild.nextSibling);

  function refresh() {
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = ""; none.textContent = "(none)";
    sel.appendChild(none);
    BehaviorProfiles.load().forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name;
      sel.appendChild(o);
    });
  }
  sel.addEventListener("change", () => {
    localStorage.setItem("iterai.activeProfileId", sel.value);
    // Dispatch so hookChatSystemPrompt can react even though it also listens:
    // (both listeners fire; the later-registered one wins the value)
  });
  refresh();
  sel.value = localStorage.getItem("iterai.activeProfileId") || "";
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: false });
  window.__refreshProfileSelect = refresh;
})();

// If a profile is selected, the system prompt field on the chat page is overridden.
(function hookChatSystemPrompt() {
  const sysPromptEl = md("sysPrompt");
  const profileSel = md("profileSelect");
  if (!sysPromptEl || !profileSel) return;
  // Expose the active profile id so the engine can honor budgets (Phase 5 hook)
  Object.defineProperty(window, "activeBehaviorProfile", {
    get: () => localStorage.getItem("iterai.activeProfileId") || null,
    configurable: true,
  });
  profileSel.addEventListener("change", () => {
    const p = BehaviorProfiles.get(profileSel.value);
    if (p) sysPromptEl.value = composePrompt(p);
    else sysPromptEl.value = "";
  });
})();

/* ---------- Init ---------- */
(function initModelDriving() {
  // Seed one default profile
  if (!BehaviorProfiles.load().length) {
    const p = blankProfile();
    BehaviorProfiles.upsert(p);
    editingProfileId = p.id;
  }
  renderProfileList();
  const first = BehaviorProfiles.load()[0];
  if (first) loadProfile(first.id);

  // bpNew wiring (button lives in the Model Driving page markup)
  md("bpNew").addEventListener("click", () => {
    const p = blankProfile();
    p.name = "Profile " + (BehaviorProfiles.load().length + 1);
    BehaviorProfiles.upsert(p);
    editingProfileId = p.id;
    renderProfileList();
    renderProfileEditor(p);
    if (window.__refreshProfileSelect) window.__refreshProfileSelect();
  });

  // Profile template picker (if present in the page markup)
  const tplSel = md("bpTemplate");
  const tplBtn = md("bpFromTemplate");
  if (tplSel && tplBtn) {
    Object.entries(PROFILE_TEMPLATES).forEach(([key, t]) => {
      const o = document.createElement("option");
      o.value = key; o.textContent = t.name;
      tplSel.appendChild(o);
    });
    tplBtn.addEventListener("click", () => {
      const p = profileFromTemplate(tplSel.value);
      if (!p) return;
      BehaviorProfiles.upsert(p);
      editingProfileId = p.id;
      renderProfileList();
      renderProfileEditor(p);
      if (window.__refreshProfileSelect) window.__refreshProfileSelect();
    });
  }

  // AI profile generator: describe it in plain language → ready-made profile
  const aiBtn = md("bpGenerate");
  const aiInput = md("bpPrompt");
  const aiState = md("bpGenState");
  if (aiBtn && aiInput) {
    aiBtn.addEventListener("click", async () => {
      const desc = aiInput.value.trim();
      if (!desc) { if (aiState) aiState.textContent = "Describe the profile first."; return; }
      aiBtn.disabled = true;
      if (aiState) aiState.textContent = "Designing profile… (asking " + (Store.active()?.name || "provider") + ")";
      const res = await generateProfileFromPrompt(desc);
      aiBtn.disabled = false;
      if (!res.ok) {
        if (aiState) aiState.textContent = "Failed: " + res.error;
        return;
      }
      const p = res.profile;
      p.id = "bp_" + Date.now();
      BehaviorProfiles.upsert(p);
      editingProfileId = p.id;
      renderProfileList();
      renderProfileEditor(p);
      if (window.__refreshProfileSelect) window.__refreshProfileSelect();
      if (aiState) aiState.textContent = "Created \"" + p.name + "\" — review the fields below, they are all editable.";
      aiInput.value = "";
    });
  }

  if (window.__refreshProfileSelect) window.__refreshProfileSelect();
})();
