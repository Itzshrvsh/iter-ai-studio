// API request handlers — pure data functions, no Electron, testable from Node.
// The renderer exposes these to AI agents and external clients via server.js.

const routes = [];
function route(method, path, fn, desc) {
  routes.push({ method, path, fn, desc });
}

// Dispatch a request to a route. Supports ":id" path segments.
// Returns { status, body }. Pure except for handlers marked async (chat/run).
async function handler(request) {
  const pathParts = request.path.split("/").filter(Boolean);
  for (const r of routes) {
    const routeParts = r.path.split("/").filter(Boolean);
    if (r.method !== request.method || routeParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    routeParts.forEach((seg, i) => {
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(pathParts[i]);
      else if (seg !== pathParts[i]) ok = false;
    });
    if (!ok) continue;
    const result = await r.fn(request, params);
    if (result && typeof result === "object" && "status" in result && "body" in result) return result;
    return { status: 200, body: result };
  }
  return { status: 404, body: { error: "no such endpoint", path: request.path } };
}

// ---------- Data access helpers (shared with renderer via globals set at init) ----------
let ctx = {}; // { Store, Convos, Workflows, RunStore, BehaviorProfiles, Projects, Memory, ModelInventory, EvalSuites, ExecuteWorkflow, validateGraph, MakeRun }
function setContext(c) { ctx = c; }

// ---------- Health ----------
route("GET", "/api/health", () => ({
  ok: true,
  app: "ITER-AI Studio",
  version: 1,
  time: new Date().toISOString(),
}), "Liveness probe. No auth required beyond token if configured.");

// ---------- Providers ----------
route("GET", "/api/providers", () => ({
  providers: ctx.Store.all().map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, local: p.local, hasKey: !!p.apiKey })),
  activeId: ctx.Store.load().activeId,
}), "List configured provider profiles (API keys never returned).");

// ---------- Workflows ----------
route("GET", "/api/workflows", () => ({
  workflows: ctx.Workflows.load().map((w) => ({ id: w.id, name: w.name, nodes: w.nodes.length, edges: w.edges.length, updated: w.updated })),
}), "List saved workflows.");

route("POST", "/api/workflows/validate", (req) => {
  const { ok, errors } = ctx.validateGraph(req.body);
  return { ok, errors };
}, "Validate a workflow graph (nodes/edges) without saving.");

route("POST", "/api/workflows/run", async (req) => {
  if (!ctx.ExecuteWorkflow) return { status: 503, body: { error: "execution engine not wired in main process" } };
  const wf = ctx.Workflows.get(req.body.workflowId);
  if (!wf) return { status: 404, body: { error: "workflow not found" } };
  const { ok, errors } = ctx.validateGraph(wf);
  if (!ok) return { status: 400, body: { error: "workflow invalid", errors } };
  const run = await ctx.ExecuteWorkflow(wf, req.body.input || "", null, null);
  return { status: 202, body: { runId: run.id, state: run.state } };
}, "Execute a saved workflow. Returns runId + final state; fetch /api/runs/{id} for events.");

// ---------- Runs ----------
route("GET", "/api/runs", () => ({
  runs: ctx.RunStore.load().slice(0, 50).map((r) => ({ id: r.id, workflowName: r.workflowName, state: r.state, startedAt: r.startedAt })),
}), "List recent runs.");

route("GET", "/api/runs/:id", (req, params) => {
  const run = ctx.RunStore.get(params.id);
  if (!run) return { status: 404, body: { error: "run not found" } };
  return { run: { id: run.id, state: run.state, input: run.input, finalOutput: run.finalOutput, error: run.error, tokens: run.tokens, events: run.events } };
}, "Full run record including events.");

route("GET", "/api/runs/:id/events", (req, params) => {
  const run = ctx.RunStore.get(params.id);
  if (!run) return { status: 404, body: { error: "run not found" } };
  return { events: run.events };
}, "Run event stream (poll for updates).");

// ---------- Projects & Memory ----------
route("GET", "/api/projects", () => ({ projects: ctx.Projects.load() }), "List projects.");

route("GET", "/api/memory", (req) => ({
  memory: req.query.projectId ? ctx.Memory.byProject(req.query.projectId) : ctx.Memory.load(),
}), "List memory entries (optionally by projectId).");

route("POST", "/api/memory", (req) => {
  if (!req.body.text) return { status: 400, body: { error: "text required" } };
  const entry = ctx.Memory.add({
    projectId: req.body.projectId || null,
    category: req.body.category || "fact",
    text: req.body.text,
    source: "api",
    verified: false, // model/API-written entries are never marked verified
  });
  return { status: 201, body: entry };
}, "Append a memory entry. Written entries are marked unverified+source=api by design.");

// ---------- Chat completion passthrough ----------
route("POST", "/api/chat", async (req) => {
  const { messages, model, profileId } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return { status: 400, body: { error: "messages array required" } };
  const provider = ctx.Store.active();
  if (!provider) return { status: 400, body: { error: "no provider configured in app" } };
  const sys = profileId ? (ctx.BehaviorProfiles.get(profileId) || {}) : null;
  const payload = {
    model: model || provider.model,
    messages: sys?.roleObjective ? [{ role: "system", content: sys.roleObjective }, ...messages] : messages,
  };
  const res = await fetch(provider.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: "Bearer " + provider.apiKey } : {}) },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { status: res.status, body: data };
}, "Chat completion via the app's active provider. Accepts OpenAI-style {messages, model}.");

// ---------- Schema/docs ----------
route("GET", "/api/schema", () => ({
  endpoints: routes.map((r) => ({
    method: r.method,
    path: r.path.replace(/:id/, "{id}"),
    description: r.desc,
  })),
}), "Machine-readable endpoint catalog (self-documentation for AI agents).");

module.exports = { route, handler, routes, setContext, ctxObj: () => ctx };
