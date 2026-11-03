// Flow Architect page — canvas, node palette, inspector, validation (Phase 3)
// NOTE: `$` helper is declared in app.js and shared by all page scripts.

let currentWf = null;      // { id, name, nodes, edges }
let selectedNode = null;
let selectedEdge = null;
let dragCtx = null;        // { kind: "node"|"new"|"edge", ... }

/* ---------- Canvas ---------- */
function renderCanvas() {
  const canvas = $("wfCanvas");
  canvas.innerHTML = "";

  // Edges as SVG
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "wfEdges";
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
  const defCls = "wf-edge";

  // Y position of output port i on a node (must match the port dots below)
  const outPortY = (node, i) => node.y + Math.round(NODE_H * (i + 1) / (NodeTypes[node.type].outputs + 1));

  currentWf.edges.forEach((e) => {
    const from = currentWf.nodes.find((n) => n.id === e.from);
    const to = currentWf.nodes.find((n) => n.id === e.to);
    if (!from || !to) return;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const x1 = from.x + NODE_W, y1 = outPortY(from, e.outPort);
    const x2 = to.x, y2 = to.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    p.setAttribute("d", `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", selectedEdge === e.id ? "var(--accent)" : "var(--border)");
    p.setAttribute("stroke-width", "1.5");
    p.dataset.edgeId = e.id;
    p.style.pointerEvents = "stroke";
    p.style.cursor = "pointer";
    p.addEventListener("click", (ev) => { ev.stopPropagation(); selectEdge(e.id); });
    svg.appendChild(p);
  });
  canvas.appendChild(svg);

  // Nodes
  currentWf.nodes.forEach((n) => {
    const el = document.createElement("div");
    el.className = "wf-node" + (selectedNode === n.id ? " selected" : "");
    el.style.left = n.x + "px";
    el.style.top = n.y + "px";
    el.style.borderColor = NodeTypes[n.type].color;
    el.dataset.nodeId = n.id;
    const head = document.createElement("div");
    head.className = "wf-node-head";
    head.style.background = NodeTypes[n.type].color + "22";
    head.innerHTML = `<span class="wf-dot" style="background:${NodeTypes[n.type].color}"></span>` +
      escapeHtml(n.name) + ` <span class="wf-type">${NodeTypes[n.type].label}</span>`;
    const body = document.createElement("div");
    body.className = "wf-node-body";
    body.textContent = nodeSummary(n);
    el.append(head, body);

    // Connection ports: outputs on the right (drag to connect), inputs on the left
    const def = NodeTypes[n.type];
    for (let i = 0; i < def.outputs; i++) {
      const port = document.createElement("span");
      port.className = "wf-port out";
      port.style.borderColor = def.color;
      port.style.top = `calc(${Math.round(100 * (i + 1) / (def.outputs + 1))}% - 5px)`;
      port.title = "Drag to another node's input to connect";
      port.addEventListener("mousedown", (ev) => startEdgeDrag(ev, n, i));
      el.appendChild(port);
    }
    if (def.inputs > 0) {
      const port = document.createElement("span");
      port.className = "wf-port in";
      port.style.borderColor = def.color;
      port.style.top = "calc(50% - 5px)";
      port.title = "Input";
      el.appendChild(port);
    }

    el.addEventListener("mousedown", (ev) => { if (!ev.target.classList.contains("wf-port")) startNodeDrag(ev, n); });
    el.addEventListener("click", () => selectNode(n.id));
    canvas.appendChild(el);
  });

  updateValidationPanel();
}

const NODE_W = 150, NODE_H = 60;

/* ---------- Edge drawing: drag output port → input ---------- */
function startEdgeDrag(ev, fromNode, outPort) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const canvas = $("wfCanvas");
  const rect = canvas.getBoundingClientRect();
  const svg = canvas.querySelector("svg");
  const ghost = document.createElementNS("http://www.w3.org/2000/svg", "path");
  ghost.setAttribute("fill", "none");
  ghost.setAttribute("stroke", "var(--telemetry)");
  ghost.setAttribute("stroke-width", "2");
  ghost.setAttribute("stroke-dasharray", "5,4");
  svg.appendChild(ghost);

  dragCtx = {
    kind: "edge", fromNode, outPort, ghost,
    x0: fromNode.x + NODE_W, y0: fromNode.y + Math.round(NODE_H * (outPort + 1) / (NodeTypes[fromNode.type].outputs + 1)),
    rect,
  };
  drawGhost(ev.clientX - rect.left, ev.clientY - rect.top);
  window.addEventListener("mousemove", onEdgeDragMove);
  window.addEventListener("mouseup", onEdgeDragEnd);
}

function drawGhost(x, y) {
  const mx = (dragCtx.x0 + x) / 2;
  dragCtx.ghost.setAttribute("d", `M ${dragCtx.x0} ${dragCtx.y0} C ${mx} ${dragCtx.y0}, ${mx} ${y}, ${x} ${y}`);
}

function onEdgeDragMove(ev) {
  if (!dragCtx || dragCtx.kind !== "edge") return;
  drawGhost(ev.clientX - dragCtx.rect.left, ev.clientY - dragCtx.rect.top);
}

function onEdgeDragEnd(ev) {
  window.removeEventListener("mousemove", onEdgeDragMove);
  window.removeEventListener("mouseup", onEdgeDragEnd);
  if (!dragCtx || dragCtx.kind !== "edge") return;
  const { fromNode, outPort, ghost } = dragCtx;
  ghost.remove();
  dragCtx = null;

  const targetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".wf-node");
  const targetId = targetEl?.dataset?.nodeId;
  if (!targetId || targetId === fromNode.id) return;
  const to = currentWf.nodes.find((n) => n.id === targetId);
  if (!to) return;
  if (NodeTypes[to.type].inputs < 1) {
    $("dockStatus").textContent = "Can't connect: " + to.name + " has no input port.";
    return;
  }
  connectNodes(fromNode, outPort, to);
}

function connectNodes(from, outPort, to) {
  // dedupe: same source+port+target
  if (currentWf.edges.some((e) => e.from === from.id && e.outPort === outPort && e.to === to.id)) return;
  currentWf.edges.push({ id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), from: from.id, outPort, to: to.id });
  markDirty();
  $("dockStatus").textContent = "Connected " + from.name + " → " + to.name;
}

function nodeSummary(n) {
  const s = n.settings;
  if (n.type === "llm") return s.prompt ? s.prompt.slice(0, 80) : "(empty prompt)";
  if (n.type === "goal") return s.objective ? s.objective.slice(0, 80) : "(no objective)";
  if (n.type === "condition") return s.expression ? "if (" + s.expression.slice(0, 60) + ")" : "(no expression)";
  return s.label || "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Selection & inspector ---------- */
function selectNode(id) {
  selectedNode = id; selectedEdge = null;
  renderInspector();
  renderCanvas();
}
function selectEdge(id) {
  selectedEdge = id; selectedNode = null;
  renderInspector();
  renderCanvas();
}

function renderInspector() {
  const insp = $("wfInspector");
  insp.innerHTML = "";
  if (selectedNode) {
    const n = currentWf.nodes.find((x) => x.id === selectedNode);
    if (!n) return;
    const def = NodeTypes[n.type];

    const title = document.createElement("h3");
    title.textContent = def.label;
    insp.appendChild(title);

    // Name
    insp.appendChild(labeledInput("Name", "text", n.name, (v) => { n.name = v; }));

    // Type-specific fields
    def.fields.forEach(([key, label, kind]) => {
      insp.appendChild(labeledInput(label, kind, String(n.settings[key] ?? ""), (v) => {
        n.settings[key] = kind === "number" ? Number(v) || 0 : v;
        renderCanvas();
      }));
    });

    // Common: timeout / retry / failure behavior (retry is enforced by the engine loop below)
    insp.appendChild(labeledInput("Timeout (s)", "number", n.settings.timeout ?? 120, (v) => n.settings.timeout = Number(v) || 120));
    insp.appendChild(labeledInput("Retry limit", "number", n.settings.retries ?? 1, (v) => n.settings.retries = Math.max(1, Number(v) || 1)));
    const fb = document.createElement("select");
    [["stop", "On failure: stop"], ["retry", "On failure: retry"], ["skip", "On failure: skip"]]
      .forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if ((n.settings.onFailure || "stop") === v) o.selected = true; fb.appendChild(o); });
    fb.addEventListener("change", () => n.settings.onFailure = fb.value);
    const fbWrap = document.createElement("label");
    fbWrap.textContent = "Failure behavior";
    fbWrap.appendChild(fb);
    insp.appendChild(fbWrap);

    // Delete
    const del = document.createElement("button");
    del.textContent = "Delete node";
    del.addEventListener("click", () => {
      currentWf.nodes = currentWf.nodes.filter((x) => x.id !== n.id);
      currentWf.edges = currentWf.edges.filter((e) => e.from !== n.id && e.to !== n.id);
      selectedNode = null;
      renderInspector(); renderCanvas();
    });
    insp.appendChild(del);
  } else if (selectedEdge) {
    const e = currentWf.edges.find((x) => x.id === selectedEdge);
    if (!e) return;
    const title = document.createElement("h3");
    title.textContent = "Edge";
    insp.appendChild(title);
    const from = currentWf.nodes.find((n) => n.id === e.from);
    const to = currentWf.nodes.find((n) => n.id === e.to);
    const info = document.createElement("p");
    info.className = "wf-edge-info";
    info.textContent = (from?.name || "?") + " → " + (to?.name || "?");
    insp.appendChild(info);

    if (from && NodeTypes[from.type].outputs > 1) {
      const sel = document.createElement("select");
      [["0", "Output port 0 (true/main)"], ["1", "Output port 1 (false/alt)"]].forEach(([v, t]) => {
        const o = document.createElement("option"); o.value = v; o.textContent = t;
        if (String(e.outPort) === v) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener("change", () => { e.outPort = Number(sel.value); renderCanvas(); });
      const wrap = document.createElement("label");
      wrap.textContent = "Source port";
      wrap.appendChild(sel);
      insp.appendChild(wrap);
    }

    const del = document.createElement("button");
    del.textContent = "Delete edge";
    del.addEventListener("click", () => {
      currentWf.edges = currentWf.edges.filter((x) => x.id !== e.id);
      selectedEdge = null;
      renderInspector(); renderCanvas();
    });
    insp.appendChild(del);
  } else {
    insp.innerHTML = "<h3>Inspector</h3><p class='dim'>Select a node or edge.</p>";
  }
}

function labeledInput(labelText, kind, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  let el;
  if (kind === "textarea") {
    el = document.createElement("textarea");
    el.rows = 3;
  } else {
    el = document.createElement("input");
    el.type = kind === "number" ? "number" : "text";
  }
  el.value = value;
  el.addEventListener("input", () => onChange(el.value));
  wrap.appendChild(el);
  return wrap;
}

/* ---------- Drag interactions ---------- */
function startNodeDrag(ev, node) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const canvas = $("wfCanvas");
  const rect = canvas.getBoundingClientRect();
  dragCtx = { kind: "node", node, dx: ev.clientX - rect.left - node.x, dy: ev.clientY - rect.top - node.y };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onDragMove(ev) {
  if (!dragCtx) return;
  const canvas = $("wfCanvas");
  const rect = canvas.getBoundingClientRect();
  if (dragCtx.kind === "node") {
    dragCtx.node.x = Math.max(0, ev.clientX - rect.left - dragCtx.dx);
    dragCtx.node.y = Math.max(0, ev.clientY - rect.top - dragCtx.dy);
    renderCanvas();
  }
}

function onDragEnd() {
  dragCtx = null;
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
}

/* ---------- Palette ---------- */
function initPalette() {
  const pal = $("wfPalette");
  pal.innerHTML = "";
  Object.entries(NodeTypes).forEach(([type, def]) => {
    const b = document.createElement("button");
    b.className = "palette-item";
    b.innerHTML = `<span class="wf-dot" style="background:${def.color}"></span>${def.label}`;
    b.addEventListener("click", () => {
      const n = makeNode(type, 40 + Math.random() * 200, 40 + Math.random() * 200);
      currentWf.nodes.push(n);
      selectNode(n.id);
      markDirty();
    });
    pal.appendChild(b);
  });
}

/* ---------- Validation panel ---------- */
function updateValidationPanel() {
  const { ok, errors } = validateGraph(currentWf);
  const el = $("wfValidation");
  el.innerHTML = "";
  const badge = document.createElement("span");
  badge.className = "badge " + (ok ? "ok" : "err");
  badge.textContent = ok ? "✓ Valid" : "✗ " + errors.length + " problem(s)";
  el.appendChild(badge);
  errors.forEach((msg) => {
    const d = document.createElement("div");
    d.className = "wf-error";
    d.textContent = "• " + msg;
    el.appendChild(d);
  });
  $("wfSaveBtn").disabled = !ok;
  $("wfRunBtn").disabled = !ok;
  return { ok, errors };
}

/* ---------- Persistence ---------- */
function markDirty() {
  $("wfSaveBtn").textContent = "Save *";
  $("wfSaveBtn").classList.add("dirty");
  updateValidationPanel();
}

function saveWorkflow() {
  currentWf.name = $("wfName").value.trim() || "Untitled workflow";
  currentWf.updated = Date.now();
  Workflows.upsert(currentWf);
  $("wfSaveBtn").textContent = "Save";
  $("wfSaveBtn").classList.remove("dirty");
  refreshWorkflowList();
  $("dockStatus").textContent = "Workflow saved: " + currentWf.name;
}

function refreshWorkflowList() {
  const sel = $("wfSelect");
  sel.innerHTML = "";
  const list = Workflows.load();
  list.forEach((w) => {
    const o = document.createElement("option");
    o.value = w.id;
    o.textContent = w.name;
    if (currentWf && w.id === currentWf.id) o.selected = true;
    sel.appendChild(o);
  });
  if (!list.length) {
    const o = document.createElement("option");
    o.textContent = "No workflows yet";
    o.value = "";
    sel.appendChild(o);
  }
}

function loadWorkflowById(id) {
  const w = Workflows.get(id);
  if (!w) return;
  currentWf = JSON.parse(JSON.stringify(w)); // deep copy: edit a draft, publish on save
  $("wfName").value = w.name;
  selectedNode = null; selectedEdge = null;
  renderInspector(); renderCanvas();
}

function newWorkflow(tplKey) {
  const tpl = Templates[tplKey] || Templates.blank;
  const graph = graphFromTemplate(tpl);
  currentWf = { id: "w_" + Date.now(), name: tpl.name, nodes: graph.nodes, edges: graph.edges };
  $("wfName").value = currentWf.name;
  selectedNode = null; selectedEdge = null;
  markDirty();
  renderInspector(); renderCanvas();
  $("dockStatus").textContent = "New workflow from template: " + tpl.name;
}

/* ---------- Toolbar wiring ---------- */
$("wfSaveBtn").addEventListener("click", saveWorkflow);
$("wfSelect").addEventListener("change", (e) => loadWorkflowById(e.target.value));
$("wfValidateBtn").addEventListener("click", () => {
  const { ok, errors } = updateValidationPanel();
  $("dockStatus").textContent = ok ? "Workflow is valid" : errors[0];
});

$("wfNewBtn").addEventListener("click", () => newWorkflow($("wfTemplate").value));

/* ---------- Init when page shown ---------- */
initPalette();
newWorkflow("blank");
refreshWorkflowList();
// Default the workflow selector to the freshly-created blank draft if present
if (currentWf) {
  const opt = [...$("wfSelect").options].find((o) => o.value === currentWf.id);
  // (saved workflows only; the unsaved draft isn't in the list — fine) 
}

