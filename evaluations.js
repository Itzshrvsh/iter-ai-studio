// Evaluations & Workflow Evolution (Phase 8)
// Fixture-based comparison of workflow versions; promotion requires explicit approval.

const EvalSuites = {
  key: "iterai.evalSuites",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  upsert(s) {
    const list = this.load();
    const i = list.findIndex((x) => x.id === s.id);
    if (i >= 0) list[i] = s; else list.push(s);
    this.saveAll(list);
  },
  get(id) { return this.load().find((x) => x.id === id) || null; },
  remove(id) { this.saveAll(this.load().filter((x) => x.id !== id)); },
};

// Case: { id, name, input, expectContains, expectNotContains }
// Verification is deterministic substring checks — honest, no model-judging.

const $ev = (id) => document.getElementById(id);
let editingSuiteId = null;
let evalAbort = null;
let evalRunning = false;

function blankSuite() {
  return {
    id: "es_" + Date.now(),
    name: "",
    workflowId: null,
    baselineRunId: null,   // result snapshot for the stable version
    candidateRunId: null,  // result snapshot for the candidate
    repeat: 1,
    cases: [],
  };
}

// ---- Ready-made suite templates ----
// Cases use deterministic substring checks only (honest verification).
// expectContains / expectNotContains are comma-separated.
const SUITE_TEMPLATES = {
  summarizer: {
    name: "Summarizer sanity checks",
    workflowTemplate: "summarize",
    cases: [
      { name: "Summary is produced", input: "Solar panels convert sunlight into electricity using photovoltaic cells. Efficiency has risen from 15% to over 22% in the last decade. Prices fell about 80% in the same period.", expectContains: "solar", expectNotContains: "" },
      { name: "No fabricated numbers kept honest", input: "A short one-sentence text about dogs.", expectContains: "dog", expectNotContains: "as an ai language model" },
      { name: "Empty-ish input still completes", input: ".", expectContains: "", expectNotContains: "" },
    ],
  },
  translator: {
    name: "Translator checks",
    workflowTemplate: "translate",
    cases: [
      { name: "French to English", input: "Bonjour, comment allez-vous aujourd'hui ?", expectContains: "hello", expectNotContains: "comment" },
      { name: "Output has no translator commentary", input: "Der schnelle braune Fuchs springt über den faulen Hund.", expectContains: "fox", expectNotContains: "translation,translate" },
      { name: "Idiom survives", input: "It's raining cats and dogs.", expectContains: "", expectNotContains: "as an ai" },
    ],
  },
  jsonExtractor: {
    name: "JSON extractor checks",
    workflowTemplate: "extract",
    cases: [
      { name: "Clean extraction", input: "Meeting on March 3rd at 2pm with Alice about the Q1 budget. Alice asked for 500 dollars more.", expectContains: "alice", expectNotContains: "EXTRACTION_FAILED" },
      { name: "Degenerate input handled", input: "???", expectContains: "EXTRACTION_FAILED", expectNotContains: "" },
    ],
  },
  codeReviewer: {
    name: "Code reviewer checks",
    workflowTemplate: "codeReview",
    cases: [
      { name: "Buggy code flags SEVERE", input: "function divide(a, b) { return a / b; } // called with b = 0 in production", expectContains: "severe", expectNotContains: "" },
      { name: "Clean code stays calm", input: "function add(a, b) { return a + b; }", expectContains: "", expectNotContains: "severe" },
    ],
  },
  brainstormer: {
    name: "Brainstorm checks",
    workflowTemplate: "brainstorm",
    cases: [
      { name: "Produces numbered ideas", input: "ways to keep a desk tidy", expectContains: "1.", expectNotContains: "as an ai" },
      { name: "Handles abstract topic", input: "the concept of time in cities", expectContains: "", expectNotContains: "" },
    ],
  },
  factChecker: {
    name: "Fact-check checks",
    workflowTemplate: "factCheck",
    cases: [
      { name: "Flags unverifiable claims", input: "My neighbor Bob can run 100 km/h. Paris is the capital of France.", expectContains: "claims needing sources", expectNotContains: "" },
      { name: "Everyday claims pass", input: "Water boils at lower temperature at altitude.", expectContains: "", expectNotContains: "as an ai" },
    ],
  },
  research: {
    name: "Research pipeline checks",
    workflowTemplate: "research",
    cases: [
      { name: "Balanced output", input: "remote work productivity", expectContains: "", expectNotContains: "" },
      { name: "Risk section present", input: "adopting AI coding assistants in a small team", expectContains: "", expectNotContains: "" },
    ],
  },
};

// Create a suite (and its matching starter workflow) from a template.
// The workflow is saved to Workflows and linked on the suite, so the kit is runnable immediately.
function suiteFromTemplate(key) {
  const tpl = SUITE_TEMPLATES[key];
  if (!tpl) return null;
  const s = blankSuite();
  s.name = tpl.name;
  s.cases = tpl.cases.map((c) => ({ ...c, id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6) }));
  if (tpl.workflowTemplate && Templates[tpl.workflowTemplate]) {
    const graph = graphFromTemplate(Templates[tpl.workflowTemplate]);
    const wf = { id: "w_" + Date.now(), name: tpl.name + " — workflow", nodes: graph.nodes, edges: graph.edges };
    Workflows.upsert(wf);
    s.workflowId = wf.id;
  }
  return s;
}

/* ---------- Suite list & editor ---------- */
function renderSuiteList() {
  const el = $ev("esList");
  el.innerHTML = "";
  EvalSuites.load().forEach((s) => {
    const row = document.createElement("div");
    row.className = "bp-item" + (s.id === editingSuiteId ? " active" : "");
    row.textContent = s.name || "(unnamed suite)";
    row.addEventListener("click", () => loadSuite(s.id));
    el.appendChild(row);
  });
  if (!EvalSuites.load().length) el.innerHTML = "<p class='dim'>No suites yet.</p>";
}

function loadSuite(id) {
  const s = EvalSuites.get(id);
  if (!s) return;
  editingSuiteId = id;
  renderSuiteList();
  const ed = $ev("esEditor");
  ed.innerHTML = "";

  // Name
  ed.appendChild(evField("Suite name", "text", s.name, (v) => { s.name = v; EvalSuites.upsert(s); renderSuiteList(); }));

  // Workflow picker
  const wfWrap = document.createElement("label");
  wfWrap.textContent = "Workflow under test";
  const wfSel = document.createElement("select");
  wfSel.innerHTML = "<option value=''>— select —</option>";
  Workflows.load().forEach((w) => {
    const o = document.createElement("option");
    o.value = w.id; o.textContent = w.name;
    if (s.workflowId === w.id) o.selected = true;
    wfSel.appendChild(o);
  });
  wfSel.addEventListener("change", () => { s.workflowId = wfSel.value || null; EvalSuites.upsert(s); });
  wfWrap.appendChild(wfSel);
  ed.appendChild(wfWrap);

  // Repeat count
  ed.appendChild(evField("Repeats per case (model variability)", "number", s.repeat || 1, (v) => { s.repeat = Math.max(1, Number(v) || 1); EvalSuites.upsert(s); }));

  // Cases
  const casesHead = document.createElement("h4");
  casesHead.textContent = "Test cases";
  ed.appendChild(casesHead);
  s.cases.forEach((c, i) => {
    ed.appendChild(caseEditor(s, c, i));
  });
  const addCase = document.createElement("button");
  addCase.textContent = "+ Add case";
  addCase.addEventListener("click", () => {
    s.cases.push({ id: "c_" + Date.now(), name: "Case " + (s.cases.length + 1), input: "", expectContains: "", expectNotContains: "" });
    EvalSuites.upsert(s);
    loadSuite(s.id);
  });
  ed.appendChild(addCase);

  // Run buttons
  const runRow = document.createElement("div");
  runRow.className = "ev-runrow";
  const runEval = document.createElement("button");
  runEval.className = "primary";
  runEval.textContent = "▶ Run evaluation";
  runEval.addEventListener("click", () => runEvaluation(s, runEval));
  const cancelEval = document.createElement("button");
  cancelEval.textContent = "Stop";
  cancelEval.disabled = true;
  cancelEval.addEventListener("click", () => evalAbort?.abort());
  runRow.append(runEval, cancelEval);
  ed.appendChild(runRow);

  // Results
  const results = document.createElement("div");
  results.id = "evResults";
  ed.appendChild(results);
  renderEvalResults(s.lastResults || null);

  // Snapshot tools (only meaningful after a run)
  const snapRow = document.createElement("div");
  snapRow.className = "ev-runrow";
  const snapBase = document.createElement("button");
  snapBase.textContent = "Snapshot as baseline";
  snapBase.addEventListener("click", () => {
    if (!s.lastResults) { alert("Run the evaluation first."); return; }
    s.baselineSnapshot = s.lastResults;
    EvalSuites.upsert(s);
    loadSuite(s.id);
    $("dockStatus").textContent = "Baseline snapshot saved";
  });
  const snapCand = document.createElement("button");
  snapCand.textContent = "Snapshot as candidate";
  snapCand.addEventListener("click", () => {
    if (!s.lastResults) { alert("Run the evaluation first."); return; }
    s.candidateSnapshot = s.lastResults;
    EvalSuites.upsert(s);
    loadSuite(s.id);
    $("dockStatus").textContent = "Candidate snapshot saved";
  });
  const rollBack = document.createElement("button");
  rollBack.textContent = "Restore previous baseline";
  rollBack.addEventListener("click", () => {
    if (!s.rollbackSnapshot) { alert("No previous baseline stored."); return; }
    s.candidateSnapshot = s.baselineSnapshot;
    s.baselineSnapshot = s.rollbackSnapshot;
    delete s.rollbackSnapshot;
    EvalSuites.upsert(s);
    loadSuite(s.id);
    $("dockStatus").textContent = "Baseline restored";
  });
  snapRow.append(snapBase, snapCand, rollBack);
  ed.appendChild(snapRow);
}

function caseEditor(s, c, idx) {
  const box = document.createElement("div");
  box.className = "ev-case";
  box.appendChild(evField("Name", "text", c.name, (v) => { c.name = v; EvalSuites.upsert(s); }));
  box.appendChild(evField("Input (sent to workflow)", "textarea", c.input, (v) => { c.input = v; EvalSuites.upsert(s); }));
  box.appendChild(evField("Expect output to contain (comma-separated)", "text", c.expectContains, (v) => { c.expectContains = v; EvalSuites.upsert(s); }));
  box.appendChild(evField("Expect output NOT to contain", "text", c.expectNotContains, (v) => { c.expectNotContains = v; EvalSuites.upsert(s); }));
  const del = document.createElement("button");
  del.textContent = "Delete case";
  del.addEventListener("click", () => { s.cases.splice(idx, 1); EvalSuites.upsert(s); loadSuite(s.id); });
  box.appendChild(del);
  return box;
}

function evField(label, kind, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const el = document.createElement(kind === "textarea" ? "textarea" : "input");
  if (kind !== "textarea") el.type = kind;
  el.value = value ?? "";
  el.addEventListener("input", () => onChange(el.value));
  wrap.appendChild(el);
  return wrap;
}

/* ---------- Execution ---------- */
async function runEvaluation(s, btn) {
  if (evalRunning) { $ev("dockStatus").textContent = "Evaluation already running"; return; }
  const wf = Workflows.get(s.workflowId);
  if (!wf) { alert("Select a workflow first."); return; }
  if (!s.cases.length) { alert("Add at least one test case."); return; }
  if (!Store.active()) { alert("No provider configured."); return; }

  evalRunning = true;
  evalAbort = new AbortController();
  btn.disabled = true;
  const results = { startedAt: Date.now(), suiteId: s.id, workflowId: wf.id, workflowName: wf.name, cases: [], running: true };

  try {
    for (const c of s.cases) {
      const caseRes = { caseId: c.id, name: c.name, attempts: [], passCount: 0, tokensIn: 0, tokensOut: 0, reported: false, durationMs: 0 };
      for (let r = 0; r < (s.repeat || 1); r++) {
        if (evalAbort.signal.aborted) throw Object.assign(new Error("cancelled"), { name: "RunCancelled" });
        $ev("evResults").textContent = "Running: " + c.name + (s.repeat > 1 ? " (repeat " + (r + 1) + "/" + s.repeat + ")" : "") + "…";
        const run = await executeWorkflow(wf, c.input, null, evalAbort.signal);
        const out = run.finalOutput || "";
        const lower = out.toLowerCase();
        const mustHave = c.expectContains.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
        const mustNot = c.expectNotContains.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
        const missing = mustHave.filter((m) => !lower.includes(m));
        const forbidden = mustNot.filter((m) => lower.includes(m));
        const pass = run.state === "completed" && !missing.length && !forbidden.length;
        caseRes.attempts.push({
          pass, runState: run.state, missing, forbidden,
          outputPreview: out.slice(0, 200),
          tokens: run.tokens, durationMs: run.endedAt - run.startedAt,
        });
        if (pass) caseRes.passCount++;
        if (run.tokens.reported) { caseRes.tokensIn += run.tokens.in; caseRes.tokensOut += run.tokens.out; caseRes.reported = true; }
        caseRes.durationMs += run.endedAt - run.startedAt;
      }
      results.cases.push(caseRes);
      renderEvalResults({ ...results, running: true });
    }
    results.running = false;
    results.completedAt = Date.now();
    // Snapshot into the suite
    s.lastResults = results;
    EvalSuites.upsert(s);
    renderEvalResults(results);
    $("dockStatus").textContent = "Evaluation finished";
  } catch (err) {
    results.running = false;
    if (err.name !== "RunCancelled") results.error = err.message;
    s.lastResults = results;
    EvalSuites.upsert(s);
    renderEvalResults(results);
  } finally {
    evalRunning = false;
    evalAbort = null;
    btn.disabled = false;
  }
}

/* ---------- Results rendering: metrics table ---------- */
function renderEvalResults(results) {
  const el = $ev("evResults");
  if (!el) return;
  el.innerHTML = "";
  if (!results || !results.cases) { el.innerHTML = "<p class='dim'>No results yet. Run the evaluation.</p>"; return; }

  const totalAttempts = results.cases.reduce((a, c) => a + c.attempts.length, 0);
  const totalPass = results.cases.reduce((a, c) => a + c.passCount, 0);
  const totalTokens = results.cases.reduce((a, c) => a + c.tokensIn + c.tokensOut, 0);
  const totalMs = results.cases.reduce((a, c) => a + c.durationMs, 0);

  const summary = document.createElement("div");
  summary.className = "ev-summary";
  summary.innerHTML =
    `<div><strong>Completion (acceptance) rate:</strong> ${totalAttempts ? Math.round(100 * totalPass / totalAttempts) + "%" : "—"} <span class="dim">(${totalPass}/${totalAttempts} verified by substring checks)</span></div>
     <div><strong>Tokens:</strong> ${results.cases.some((c) => c.reported) ? totalTokens + " total (provider-reported)" : "not reported"}</div>
     <div><strong>Wall time:</strong> ${(totalMs / 1000).toFixed(1)}s</div>
     ${results.running ? "<div class='ev-running'>⏳ Running…</div>" : results.error ? "<div style='color:var(--error)'>" + escapeHtml(results.error) + "</div>" : ""}`;
  el.appendChild(summary);

  // Per-case table
  const table = document.createElement("table");
  table.className = "ev-table";
  table.innerHTML = "<tr><th>Case</th><th>Pass</th><th>Tokens</th><th>Time</th><th>Detail</th></tr>";
  results.cases.forEach((c) => {
    const tr = document.createElement("tr");
    const passRate = c.attempts.length ? Math.round(100 * c.passCount / c.attempts.length) + "%" : "—";
    const detail = c.attempts.map((a, i) =>
      (c.attempts.length > 1 ? "#" + (i + 1) + " " : "") +
      (a.pass ? "✓" : "✗ " + (a.missing?.length ? "missing: " + a.missing.join(", ") : "") + (a.forbidden?.length ? " forbidden: " + a.forbidden.join(", ") : ""))
    ).join(" | ");
    tr.innerHTML =
      `<td>${escapeHtml(c.name)}</td>
       <td>${passRate}</td>
       <td>${c.reported ? c.tokensIn + "+" + c.tokensOut : "n/r"}</td>
       <td>${(c.durationMs / 1000).toFixed(1)}s</td>
       <td class="ev-detail">${escapeHtml(detail)}</td>`;
    table.appendChild(tr);
  });
  el.appendChild(table);

  // Baseline vs candidate comparison
  const suite = EvalSuites.get(editingSuiteId);
  if (suite?.baselineSnapshot && suite?.candidateSnapshot) {
    const cmp = document.createElement("div");
    cmp.className = "ev-compare";
    cmp.innerHTML = compareSnapshots(suite.baselineSnapshot, suite.candidateSnapshot);
    const note = document.createElement("p");
    note.className = "dim";
    note.style.fontSize = "10px";
    note.textContent = "Snapshots persist on the suite. Use 'Restore previous baseline' to roll back.";
    cmp.appendChild(note);
    el.appendChild(cmp);
  }
}

/* ---------- Snapshot comparison helpers (used by loadSuite UI) ---------- */
function snapshotMetrics(results) {
  const attempts = results.cases.reduce((a, c) => a + c.attempts.length, 0);
  const pass = results.cases.reduce((a, c) => a + c.passCount, 0);
  const tokens = results.cases.reduce((a, c) => a + c.tokensIn + c.tokensOut, 0);
  const ms = results.cases.reduce((a, c) => a + c.durationMs, 0);
  return { attempts, pass, tokens, ms, rate: attempts ? pass / attempts : 0 };
}

function compareSnapshots(base, cand) {
  const b = snapshotMetrics(base), c = snapshotMetrics(cand);
  const dRate = Math.round(100 * (c.rate - b.rate));
  const dTok = c.reported && b.reported ? c.tokens - b.tokens : null;
  const row = (label, bv, cv, hint) =>
    `<tr><td>${label}</td><td>${bv}</td><td>${cv}</td><td>${hint}</td></tr>`;
  return `<h4 style="color:var(--accent)">Baseline vs candidate</h4>
    <table class="ev-table">
      <tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Δ</th></tr>
      ${row("Acceptance rate", Math.round(100 * b.rate) + "%", Math.round(100 * c.rate) + "%", (dRate >= 0 ? "+" : "") + dRate + "pp")}
      ${row("Tokens", b.reported ? b.tokens : "n/r", c.reported ? c.tokens : "n/r", dTok === null ? "—" : (dTok >= 0 ? "+" : "") + dTok)}
      ${row("Wall time", (b.ms / 1000).toFixed(1) + "s", (c.ms / 1000).toFixed(1) + "s", ((c.ms - b.ms) / 1000).toFixed(1) + "s")}
    </table>`;
}

/* ---------- Candidate promotion (manual, explicit) ---------- */
// NOTE: superseded by per-suite "Snapshot as baseline / candidate" buttons in loadSuite().

/* ---------- Init ---------- */
(function initEvals() {
  $ev("esNew").addEventListener("click", () => {
    const s = blankSuite();
    s.name = "Suite " + (EvalSuites.load().length + 1);
    EvalSuites.upsert(s);
    editingSuiteId = s.id;
    renderSuiteList();
    loadSuite(s.id);
  });

  // Suite template picker (if present in the page markup)
  const tplSel = $ev("esTemplate");
  const tplBtn = $ev("esFromTemplate");
  if (tplSel && tplBtn) {
    Object.entries(SUITE_TEMPLATES).forEach(([key, t]) => {
      const o = document.createElement("option");
      o.value = key; o.textContent = t.name;
      tplSel.appendChild(o);
    });
    tplBtn.addEventListener("click", () => {
      const s = suiteFromTemplate(tplSel.value);
      if (!s) return;
      EvalSuites.upsert(s);
      editingSuiteId = s.id;
      renderSuiteList();
      loadSuite(s.id);
      $("dockStatus").textContent = "Created suite + starter workflow from template";
    });
  }

  renderSuiteList();
  const first = EvalSuites.load()[0];
  if (first) loadSuite(first.id);
})();
