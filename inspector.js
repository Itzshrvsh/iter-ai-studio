// Run Inspector page (Phase 5, core subset)
// NOTE: `$` helper is declared in app.js and shared by all page scripts.
const $ri = (id) => document.getElementById(id);
let viewedRunId = null;

function refreshRunList() {
  const sel = $ri("runSelect");
  sel.innerHTML = "";
  const runs = RunStore.load();
  runs.forEach((r) => {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = stateIcon(r.state) + " " + r.workflowName + " · " + new Date(r.startedAt).toLocaleTimeString();
    if (r.id === viewedRunId) o.selected = true;
    sel.appendChild(o);
  });
  if (!runs.length) {
    const o = document.createElement("option");
    o.textContent = "No runs yet — run a workflow from Flow Architect";
    o.value = "";
    sel.appendChild(o);
  }
}

function stateIcon(s) {
  return { running: "⏳", waiting_approval: "⏸", paused: "⏸", completed: "✓", failed: "✗", cancelled: "⏹" }[s] || "•";
}

function loadRun(id) {
  viewedRunId = id;
  const run = RunStore.get(id);
  if (!run) { $ri("runSummary").innerHTML = "<p class='dim'>Run not found.</p>"; return; }
  refreshRunList();

  // Header
  $ri("runState").innerHTML =
    `<span class="badge ${run.state === "completed" ? "ok" : run.state === "running" ? "warn" : "err"}">${stateIcon(run.state)} ${run.state}</span>`;

  // Timeline
  const tl = $ri("runTimeline");
  tl.innerHTML = "";
  const nodeById = Object.fromEntries((workflowForRun(run)?.nodes || []).map((n) => [n.id, n]));
  Object.entries(run.nodeStates).forEach(([nid, st]) => {
    const row = document.createElement("div");
    row.className = "tl-row";
    const icon = { completed: "✓", running: "⏳", failed: "✗" }[st.status] || "•";
    const name = nodeById[nid]?.name || nid;
    row.innerHTML = `<span class="tl-icon ${st.status}">${icon}</span>
      <span class="tl-name">${escapeHtml(name)}</span>
      <span class="tl-dim">${st.attempts ? "×" + st.attempts : ""} ${st.durationMs ? st.durationMs + "ms" : ""}</span>`;
    row.addEventListener("click", () => showNodeDetail(run, nid));
    tl.appendChild(row);
  });
  if (!Object.keys(run.nodeStates).length) tl.innerHTML = "<p class='dim'>No node activity.</p>";

  // Events
  const ev = $ri("runEvents");
  ev.innerHTML = "";
  run.events.slice(-60).forEach((e) => {
    const d = document.createElement("div");
    d.className = "ev-line";
    d.textContent = new Date(e.ts).toLocaleTimeString() + "  " + e.type + (e.nodeId ? "  [" + (nodeById[e.nodeId]?.name || e.nodeId) + "]" : "") + (e.detail ? "  " + JSON.stringify(e.detail).slice(0, 120) : "");
    ev.appendChild(d);
  });

  // Summary
  $ri("runSummary").innerHTML =
    `<p><strong>Workflow:</strong> ${escapeHtml(run.workflowName)}</p>
     <p><strong>Input:</strong></p><div class="pre">${escapeHtml(run.input || "")}</div>
     <p><strong>Final output:</strong></p><div class="pre">${escapeHtml(run.finalOutput || "(none)")}</div>
     <p><strong>Tokens:</strong> ${run.tokens.reported ? "in " + run.tokens.in + " / out " + run.tokens.out + " (provider-reported)" : "not reported"} </p>
     ${run.error ? `<p style="color:var(--error)"><strong>Error:</strong> ${escapeHtml(run.error)}</p>` : ""}`;
}

function workflowForRun(run) { return Workflows.get(run.workflowId); }

function showNodeDetail(run, nodeId) {
  const st = run.nodeStates[nodeId];
  const node = workflowForRun(run)?.nodes.find((n) => n.id === nodeId);
  $ri("runSummary").innerHTML =
    `<p><strong>Node:</strong> ${escapeHtml(node?.name || nodeId)}</p>
     <p><strong>Status:</strong> ${st.status}, attempts: ${st.attempts}, duration: ${st.durationMs}ms</p>
     <p><strong>Output:</strong></p><div class="pre">${escapeHtml(String(st.output ?? st.error ?? ""))}</div>
     <button onclick="viewedRunId && loadRun(viewedRunId)">← Back to summary</button>`;
}

// ---------- Live run bridge (called by flow page Run button) ----------
window.__startWorkflowRun = async function () {
  if (!currentWf) return;
  const { ok, errors } = validateGraph(currentWf);
  if (!ok) { alert("Fix validation errors first:\n" + errors.join("\n")); return; }
  const inputText = prompt("Task input for this run (can be blank):", "") ?? "";
  const controller = new AbortController();
  window.__activeRunController = controller;
  const wf = JSON.parse(JSON.stringify(currentWf));
  navigate("inspector");
  // Run in background; UI updates via events
  const run = await executeWorkflow(wf, inputText, (r) => {
    if (r.id === viewedRunId || !viewedRunId) { const keepId = viewedRunId || r.id; viewedRunId = keepId; loadRun(keepId); }
  }, controller.signal);
  RunStore.upsert(run);
  refreshRunList();
  $("dockStatus").textContent = "Run " + run.state;
  return run;
};

// Reuses the global escapeHtml declared in flow.js (loaded before this file).

/* ---------- Init ---------- */
(function initInspector() {
  // Enable and wire the Flow page Run button (engine is now loaded)
  const rb = document.getElementById("wfRunBtn");
  if (rb) { rb.disabled = false; rb.title = "Execute this workflow"; rb.addEventListener("click", () => window.__startWorkflowRun()); }

  $ri("runSelect").addEventListener("change", (e) => loadRun(e.target.value));
  const cancelBtn = $ri("runCancelBtn");
  cancelBtn.addEventListener("click", () => { window.__activeRunController?.abort(); });

  refreshRunList();
  const latest = RunStore.load()[0];
  if (latest) loadRun(latest.id);
})();
