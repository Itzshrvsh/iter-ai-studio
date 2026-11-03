// Test runner for ITER-AI Studio — plain Node, no test framework needed.
// Run: node tests/run-tests.js
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ✓ " + name); })
    .catch((e) => { failed++; failures.push(name + " — " + e.message); console.log("  ✗ " + name + " — " + e.message); });
}

// ---------- helper: minimal in-memory store factory (mirrors stores-node API) ----------
function memoryStore() {
  const state = { providers: [], activeProviderId: null, workflows: [], runs: [], memory: [], behaviorProfiles: [], projects: [], evalSuites: [], modelInventory: [], convos: [], settings: {} };
  const generic = (key) => ({
    load: () => state[key] || [],
    saveAll: (l) => (state[key] = l),
    upsert: (item) => {
      const list = state[key] || [];
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      state[key] = list;
    },
    get: (id) => (state[key] || []).find((x) => x.id === id) || null,
    remove: (id) => (state[key] = (state[key] || []).filter((x) => x.id !== id)),
  });
  return {
    state,
    providers: { ...generic("providers"), active: () => state.providers.find((p) => p.id === state.activeProviderId) || null, setActive: (id) => (state.activeProviderId = id), all: () => state.providers },
    workflows: generic("workflows"),
    runs: generic("runs"),
    memory: { ...generic("memory"), add: (e) => { e.id = "m_" + Math.random(); e.createdAt = Date.now(); state.memory.unshift(e); return e; }, byProject: (pid) => state.memory.filter((m) => m.projectId === pid) },
    projects: generic("projects"),
    behaviorProfiles: generic("behaviorProfiles"),
    evalSuites: generic("evalSuites"),
    modelInventory: generic("modelInventory"),
    convos: generic("convos"),
  };
}

// ---------- unit: workflow validation ----------
const { validateGraph, makeNode, graphFromTemplate } = require("../workflow");
const { handler, setContext } = require("../api-handlers");
const { createApiServer } = require("../server");

async function unitTests() {
  console.log("\n— Unit: workflow validation —");
  await test("blank template graph is valid", () => {
    const g = graphFromTemplate(require("../workflow").Templates.blank);
    const { ok, errors } = validateGraph(g);
    assert.ok(ok, errors.join("; "));
  });
  await test("research template graph is valid", () => {
    const g = graphFromTemplate(require("../workflow").Templates.research);
    const { ok, errors } = validateGraph(g);
    assert.ok(ok, errors.join("; "));
  });
  await test("cycle detection works", () => {
    const a = makeNode("goal", 0, 0), b = makeNode("llm", 1, 1), c = makeNode("output", 2, 2);
    const g = { nodes: [a, b, c], edges: [
      { id: "e1", from: a.id, outPort: 0, to: b.id },
      { id: "e2", from: b.id, outPort: 0, to: c.id },
      { id: "e3", from: c.id, outPort: 0, to: b.id }, // cycle b->c->b
    ] };
    const { ok, errors } = validateGraph(g);
    assert.ok(!ok);
    assert.ok(errors.some((e) => /cycle/i.test(e)), "expected cycle error, got: " + errors.join("; "));
  });
  await test("unreachable node is reported", () => {
    const a = makeNode("goal", 0, 0), b = makeNode("output", 1, 0), orphan = makeNode("llm", 2, 2);
    orphan.settings.prompt = "x";
    const g = { nodes: [a, b, orphan], edges: [{ id: "e1", from: a.id, outPort: 0, to: b.id }] };
    const { ok, errors } = validateGraph(g);
    assert.ok(!ok && errors.some((e) => /not reachable/i.test(e)));
  });
  await test("two goals rejected", () => {
    const a = makeNode("goal", 0, 0), a2 = makeNode("goal", 1, 1), b = makeNode("output", 2, 2);
    const g = { nodes: [a, a2, b], edges: [{ id: "e1", from: a.id, outPort: 0, to: b.id }] };
    const { ok, errors } = validateGraph(g);
    assert.ok(!ok && errors.some((e) => /exactly one Goal/i.test(e)));
  });
  await test("empty LLM prompt rejected", () => {
    const a = makeNode("goal", 0, 0), b = makeNode("llm", 1, 0), c = makeNode("output", 2, 0);
    b.settings.prompt = "   ";
    const g = { nodes: [a, b, c], edges: [{ id: "e1", from: a.id, outPort: 0, to: b.id }, { id: "e2", from: b.id, outPort: 0, to: c.id }] };
    const { ok, errors } = validateGraph(g);
    assert.ok(!ok && errors.some((e) => /empty prompt/i.test(e)));
  });
  await test("template fill substitutes {input}/{prev}", () => {
    const { fillTemplate } = require("../engine");
    assert.strictEqual(fillTemplate("Say {input} then {prev}", "hi", "yo"), "Say hi then yo");
  });
}

// ---------- unit: API handlers (no server) ----------
async function handlerTests() {
  console.log("\n— Unit: API handlers —");
  const stores = memoryStore();
  stores.providers.upsert({ id: "p1", name: "Test", baseUrl: "http://x", model: "m", apiKey: "sk-secret", local: true });
  stores.providers.setActive("p1");
  stores.workflows.upsert({ id: "w1", name: "Demo", nodes: [], edges: [] });
  stores.memory.add({ projectId: "prj1", category: "fact", text: "uses vite" });
  setContext({
    Store: stores.providers, Convos: stores.convos, Workflows: stores.workflows,
    RunStore: stores.runs, BehaviorProfiles: stores.behaviorProfiles, Projects: stores.projects,
    Memory: stores.memory, ModelInventory: stores.modelInventory, EvalSuites: stores.evalSuites,
    validateGraph, ExecuteWorkflow: null,
  });

  await test("GET /api/health returns ok", async () => {
    const r = await handler({ method: "GET", path: "/api/health", query: {}, body: {} });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
  });
  await test("GET /api/providers hides API keys", async () => {
    const r = await handler({ method: "GET", path: "/api/providers", query: {}, body: {} });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.providers[0].hasKey, true);
    assert.ok(!JSON.stringify(r.body).includes("sk-secret"), "key leaked!");
  });
  await test("GET /api/schema lists all routes", async () => {
    const r = await handler({ method: "GET", path: "/api/schema", query: {}, body: {} });
    assert.ok(r.body.endpoints.length >= 10);
  });
  await test("unknown route 404s", async () => {
    const r = await handler({ method: "GET", path: "/api/nope", query: {}, body: {} });
    assert.strictEqual(r.status, 404);
  });
  await test("POST /api/memory marks entry unverified + source=api", async () => {
    const r = await handler({ method: "POST", path: "/api/memory", query: {}, body: { text: "from api", category: "fact", projectId: "prj1" } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.verified, false);
    assert.strictEqual(r.body.source, "api");
    assert.strictEqual(stores.memory.byProject("prj1").length, 2);
  });
  await test("POST /api/memory requires text", async () => {
    const r = await handler({ method: "POST", path: "/api/memory", query: {}, body: {} });
    assert.strictEqual(r.status, 400);
  });
  await test("run unknown workflow 404s", async () => {
    setContext({ ...require("../api-handlers").ctxObj(), ExecuteWorkflow: async () => ({ id: "r", state: "completed" }) });
    const r = await handler({ method: "POST", path: "/api/workflows/run", query: {}, body: { workflowId: "zz" } });
    assert.strictEqual(r.status, 404);
  });
  await test("run invalid workflow 400s with errors", async () => {
    stores.workflows.upsert({ id: "wbad", name: "Bad", nodes: [], edges: [] });
    const r = await handler({ method: "POST", path: "/api/workflows/run", query: {}, body: { workflowId: "wbad" } });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.errors.length);
  });
  await test("path param :id resolves", async () => {
    stores.runs.upsert({ id: "r1", state: "completed", events: [] });
    const r = await handler({ method: "GET", path: "/api/runs/r1", query: {}, body: {} });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.run.id, "r1");
  });
}

// ---------- integration: real HTTP server ----------
async function integrationTests() {
  console.log("\n— Integration: HTTP server —");
  const stores = memoryStore();
  stores.providers.upsert({ id: "p1", name: "Test", baseUrl: "http://x", model: "m", apiKey: "", local: true });
  stores.providers.setActive("p1");
  setContext({
    Store: stores.providers, Convos: stores.convos, Workflows: stores.workflows,
    RunStore: stores.runs, BehaviorProfiles: stores.behaviorProfiles, Projects: stores.projects,
    Memory: stores.memory, ModelInventory: stores.modelInventory, EvalSuites: stores.evalSuites,
    validateGraph, ExecuteWorkflow: null,
  });

  let livePort = null;
  const srv = createApiServer({ port: 0, host: "127.0.0.1", token: "testtoken" }, handler, (status) => {
    if (status.port) livePort = status.port;
  });
  srv.start();
  await new Promise((res) => setTimeout(res, 300));
  if (!livePort) throw new Error("server did not report a port");

  function req(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const options = {
        host: "127.0.0.1", port: livePort, method, path,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          Authorization: "Bearer testtoken",
          ...headers,
        },
      };
      const r = http.request(options, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
      });
      r.on("error", reject);
      if (data) r.write(data);
      r.end();
    });
  }

  await test("server binds and health endpoint works", async () => {
    const r = await req("GET", "/api/health");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
  });

  await test("auth rejects wrong token", async () => {
    const r = await req("GET", "/api/health", null, { Authorization: "Bearer wrong" });
    assert.strictEqual(r.status, 401);
  });

  await test("auth rejects missing token", async () => {
    const r = await req("GET", "/api/health", null, { Authorization: "" });
    assert.strictEqual(r.status, 401);
  });

  await test("malformed JSON body 400s", async () => {
    const raw = await new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port: livePort, method: "POST", path: "/api/memory", headers: { "Content-Type": "application/json", Authorization: "Bearer testtoken" } }, (res) => {
        let b = ""; res.on("data", (c) => b += c); res.on("end", () => resolve({ status: res.statusCode, body: b }));
      });
      r.on("error", reject);
      r.write("{not json");
      r.end();
    });
    assert.strictEqual(raw.status, 400);
  });

  await test("updateToken applies without restart", async () => {
    srv.updateToken("newtok");
    const bad = await req("GET", "/api/health", null, { Authorization: "Bearer testtoken" });
    const good = await req("GET", "/api/health", null, { Authorization: "Bearer newtok" });
    srv.updateToken("testtoken"); // restore
    assert.strictEqual(bad.status, 401);
    assert.strictEqual(good.status, 200);
  });

  await test("workflows list over HTTP matches store", async () => {
    stores.workflows.upsert({ id: "w1", name: "HTTP demo", nodes: [], edges: [] });
    const r = await req("GET", "/api/workflows");
    assert.ok(r.body.workflows.some((w) => w.id === "w1"));
  });

  srv.stop();
}

// ---------- unit: all templates are valid & executable ----------
async function templateTests() {
  console.log("\n— Unit: template library —");
  const { Templates, graphFromTemplate } = require("../workflow");
  const { fillTemplate, evalCondition } = require("../engine");

  await test("every workflow template validates via validateGraph", () => {
    const bad = [];
    Object.entries(Templates).forEach(([key, tpl]) => {
      const graph = graphFromTemplate(tpl);
      const { ok, errors } = validateGraph(graph);
      if (!ok) bad.push(key + ": " + errors.join("; "));
    });
    assert.ok(bad.length === 0, bad.join(" | ") || "all valid");
  });

  await test("workflow templates have unique names", () => {
    const names = Object.values(Templates).map((t) => t.name);
    assert.strictEqual(new Set(names).size, names.length, "duplicate template names");
  });

  await test("all condition expressions are evaluable and branch-sane", () => {
    const problems = [];
    Object.entries(Templates).forEach(([key, tpl]) => {
      const condIdx = tpl.nodes.map((n, i) => [n, i]).filter(([n]) => n.type === "condition");
      condIdx.forEach(([node, idx]) => {
        const expr = node.settings.expression;
        assert.ok(expr && expr.trim(), key + ": condition node " + idx + " has empty expression");
        const truthy = evalCondition(expr, "test input with SEVERE: yes and 1. 2. 3. 4. 5. items {a:1}");
        if (truthy && truthy.error) problems.push(key + ": " + truthy.error);
        const falsy = evalCondition(expr, "");
        if (falsy && falsy.error) problems.push(key + ": " + falsy.error);
        // both output ports of every condition must be wired
        const outPorts = tpl.edges.filter((e) => e[0] === idx).map((e) => e[1]);
        [0, 1].forEach((p) => {
          if (!outPorts.includes(p)) problems.push(key + ": condition " + idx + " outPort " + p + " unwired");
        });
      });
    });
    assert.ok(problems.length === 0, problems.join(" | ") || "all expressions safe");
  });

  await test("branching templates actually branch (condition present)", () => {
    ["extract", "codeReview", "brainstorm", "summarize", "factCheck"].forEach((k) => {
      assert.ok(Templates[k].nodes.some((n) => n.type === "condition"), k + " has no condition node");
    });
  });

  await test("template prompts contain {input} or {prev} where data flows", () => {
    const problems = [];
    Object.entries(Templates).forEach(([key, tpl]) => {
      const goal = tpl.nodes.findIndex((n) => n.type === "goal");
      tpl.nodes.forEach((n, i) => {
        if (n.type !== "llm") return;
        const p = n.settings.prompt || "";
        const prevFed = tpl.edges.some(([from, , to]) => to === i && from !== goal);
        if (!p.includes("{input}") && !p.includes("{prev}"))
          problems.push(key + ": llm " + i + " prompt has no {input}/{prev} placeholder");
        if (prevFed && !p.includes("{prev}") && !p.includes("{input}"))
          problems.push(key + ": llm " + i + " receives upstream data but never substitutes it");
      });
    });
    assert.ok(problems.length === 0, problems.join(" | ") || "placeholders ok");
  });

  await test("summarize length-gate expression behaves as documented", () => {
    assert.strictEqual(evalCondition("input.length <= 600", "x".repeat(600)), true);
    assert.strictEqual(evalCondition("input.length <= 600", "x".repeat(601)), false);
  });

  await test("extract JSON-gate expression behaves as documented", () => {
    const expr = "input.trim().startsWith('{') && input.includes('}') && input.includes(':')";
    assert.strictEqual(evalCondition(expr, '{"name":"Alice"}'), true);
    assert.strictEqual(evalCondition(expr, "plain text"), false);
  });

  await test("codeReview severity-gate expression behaves as documented", () => {
    assert.strictEqual(evalCondition("input.includes('SEVERE:')", "SEVERE: null deref"), true);
    assert.strictEqual(evalCondition("input.includes('SEVERE:')", "MINOR: naming"), false);
  });

  await test("brainstorm count-gate expression behaves as documented", () => {
    const expr = "(input.match(/\\d\\./g) || []).length >= 5";
    assert.strictEqual(evalCondition(expr, "1. a 2. b 3. c 4. d 5. e"), true);
    assert.strictEqual(evalCondition(expr, "1. a 2. b"), false);
    assert.strictEqual(evalCondition(expr, "no numbers at all"), false);
  });
}

// ---------- unit: profile / project / suite templates & kits ----------
async function metaTemplateTests() {
  console.log("\n— Unit: profile / project / suite templates —");
  const mf = {};
  mf.modelDriving = fs.readFileSync(path.join(__dirname, "..", "model-driving.js"), "utf8");
  // Extract pure pieces instead of loading the whole DOM-wired file:
  const grab = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));

  const profileSrc = grab(mf.modelDriving, "const DEFAULT_PROFILE", "// ---- Field schema");
  const projectsSrc = fs.readFileSync(path.join(__dirname, "..", "projects.js"), "utf8");
  const projTplSrc = grab(projectsSrc, "const PROJECT_TEMPLATES", "/* ---------- Project list");
  const evalsSrc = fs.readFileSync(path.join(__dirname, "..", "evaluations.js"), "utf8");
  const suiteTplSrc = grab(evalsSrc, "const SUITE_TEMPLATES", "/* ---------- Suite list");

  const sandboxSrc = profileSrc + "\n" + projTplSrc + "\n" + suiteTplSrc + `
    function profileFromTemplate(key){ const t = PROFILE_TEMPLATES[key]; if(!t) return null; return { ...structuredClone(DEFAULT_PROFILE), ...t, id: "bp_test" }; }
    function blankProject(){ return { id:"prj_test", name:"", rootDir:"", instructions:"", stack:"", keyFiles:"", testCommands:"", constraints:"", protectedFiles:"" }; }
    function projectFromTemplate(key){ const t = PROJECT_TEMPLATES[key]; if(!t) return null; const p = blankProject(); Object.entries(t).forEach(([k,v])=>p[k]=v); return p; }
    globalThis.__meta = { DEFAULT_PROFILE, PROFILE_TEMPLATES, PROJECT_TEMPLATES, SUITE_TEMPLATES, profileFromTemplate, projectFromTemplate };
  `;
  const ctx = vm.createContext({ console, structuredClone, Object, JSON, Array, String, Number, Date });
  vm.runInContext(sandboxSrc, ctx, { filename: "meta-templates.js" });
  const { DEFAULT_PROFILE, PROFILE_TEMPLATES, PROJECT_TEMPLATES, SUITE_TEMPLATES, profileFromTemplate, projectFromTemplate } = vm.runInContext("__meta", ctx);

  await test("profile templates only override known DEFAULT_PROFILE keys", () => {
    const unknown = [];
    Object.entries(PROFILE_TEMPLATES).forEach(([k, t]) => {
      Object.keys(t).forEach((f) => {
        if (!(f in DEFAULT_PROFILE)) unknown.push(k + "." + f);
      });
    });
    // brainstormer intentionally carries an advisory note field
    const real = unknown.filter((u) => u !== "brainstormer.temperatureNote");
    assert.deepStrictEqual(real, [], "unknown profile keys: " + real.join(", "));
  });

  await test("profile templates keep numeric/boolean field types", () => {
    Object.entries(PROFILE_TEMPLATES).forEach(([k, t]) => {
      const p = profileFromTemplate(k);
      ["concise", "maxTasks", "maxContextChars", "reserveForOutput", "maxHistoryMessages",
       "maxToolCalls", "verificationAttempts", "maxRecoveryAttempts", "maxGraphEdits",
       "maxModelCalls", "maxTotalTokens"].forEach((numKey) => {
        if (numKey in p) assert.strictEqual(typeof p[numKey], "number", k + "." + numKey + " is not a number");
      });
      ["structuredOutput", "explainDecisions", "requirePlanReview", "includeHistory",
       "stopOnRepeatError", "secretRedaction"].forEach((bKey) => {
        if (bKey in p) assert.strictEqual(typeof p[bKey], "boolean", k + "." + bKey + " is not a boolean");
      });
      assert.ok(typeof p.name === "string" && p.name.length > 0, k + " has empty name");
    });
  });

  await test("profile template select-option values are enum-valid", () => {
    const enums = { tone: ["neutral", "friendly", "terse", "formal"], askVsAssume: ["ask", "assume"],
      planStrategy: ["direct", "staged"], networkPolicy: ["disabled", "allowlist", "unrestricted"],
      verifyWith: ["none", "self-check", "command"], adaptationMode: ["manual", "suggest", "frozen"],
      onBudgetReached: ["pause", "stop", "approve"] };
    Object.entries(PROFILE_TEMPLATES).forEach(([k, t]) => {
      Object.entries(enums).forEach(([field, allowed]) => {
        if (field in t) assert.ok(allowed.includes(t[field]), k + "." + field + " = " + t[field] + " not in " + allowed.join("|"));
      });
    });
  });

  await test("project templates prefill non-empty guidance", () => {
    Object.entries(PROJECT_TEMPLATES).forEach(([k, t]) => {
      assert.ok(t.name && t.instructions && t.constraints, k + " missing name/instructions/constraints");
      const p = projectFromTemplate(k);
      assert.ok(p.instructions.length > 20, k + " instructions too thin to be useful");
      assert.strictEqual(p.name, t.name);
    });
  });

  await test("suite templates have valid case shapes + unique workflow refs", () => {
    const wfRefs = new Set();
    Object.entries(SUITE_TEMPLATES).forEach(([k, t]) => {
      assert.ok(t.name && t.cases.length >= 2, k + " needs name and ≥2 cases");
      t.cases.forEach((c, i) => {
        assert.ok(typeof c.input === "string", k + " case " + i + " input missing");
        assert.ok(typeof c.expectContains === "string" && typeof c.expectNotContains === "string",
          k + " case " + i + " expect fields must be strings");
        if (c.workflowTemplate) wfRefs.add(c.workflowTemplate);
      });
      if (t.workflowTemplate) wfRefs.add(t.workflowTemplate);
    });
    const { Templates } = require("../workflow");
    wfRefs.forEach((ref) => assert.ok(Templates[ref], "suite references unknown workflow template: " + ref));
  });

  await test("kits reference only existing templates", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "command-center.js"), "utf8");
    const start = src.indexOf("const KITS");
    const end = src.indexOf("function installKit");
    assert.ok(start >= 0 && end > start, "KITS not found in command-center.js");
    const kits = eval("(" + src.slice(src.indexOf("[", start), src.indexOf("function installKit")).trimEnd().replace(/;\s*$/, "") + ")");
    const { Templates } = require("../workflow");
    const profileKeys = Object.keys(PROFILE_TEMPLATES);
    const suiteKeys = Object.keys(SUITE_TEMPLATES);
    kits.forEach((kit) => {
      assert.ok(Templates[kit.workflow], kit.id + ": unknown workflow " + kit.workflow);
      assert.ok(profileKeys.includes(kit.profile), kit.id + ": unknown profile " + kit.profile);
      assert.ok(suiteKeys.includes(kit.suite), kit.id + ": unknown suite " + kit.suite);
    });
    assert.ok(kits.length >= 5, "expected a full kit shelf");
  });
}

// ---------- unit: AI profile generator (coercion + JSON extraction) ----------
async function profileGenTests() {
  console.log("\n— Unit: AI profile generator —");
  const src = fs.readFileSync(path.join(__dirname, "..", "model-driving.js"), "utf8");
  const gen = src.slice(src.indexOf("const DEFAULT_PROFILE"), src.indexOf("// ---- Field schema for the editor ----"));
  const ctx = vm.createContext({ console, JSON, Object, Array, String, Number, Boolean, Math, Date, Error });
  vm.runInContext(gen + `
    globalThis.__g = { DEFAULT_PROFILE, coerceProfile, extractProfileJson, generateProfileFromPrompt: null };
  `, ctx, { filename: "profile-gen.js" });
  const { coerceProfile, extractProfileJson } = vm.runInContext("__g", ctx);

  await test("extracts JSON from fenced model output", () => {
    const raw = extractProfileJson('Sure! Here you go:\n```json\n{"name":"Test","tone":"terse"}\n```');
    assert.ok(raw && raw.name === "Test" && raw.tone === "terse");
  });
  await test("extracts JSON embedded in prose", () => {
    const raw = extractProfileJson('Here is the profile: {"name":"X","concise":2} hope it helps');
    assert.ok(raw && raw.concise === 2);
  });
  await test("returns null on garbage", () => {
    assert.strictEqual(extractProfileJson("no json here"), null);
    assert.strictEqual(extractProfileJson(""), null);
    assert.strictEqual(extractProfileJson("{broken"), null);
  });
  await test("coerceProfile clamps numbers to schema ranges", () => {
    const p = coerceProfile({ name: "T", concise: 9, maxTasks: -3, maxModelCalls: 9999, maxTotalTokens: 99999999 }, "F");
    assert.strictEqual(p.concise, 3);
    assert.strictEqual(p.maxTasks, 1);
    assert.strictEqual(p.maxModelCalls, 500);
    assert.strictEqual(p.maxTotalTokens, 10000000);
  });
  await test("coerceProfile rejects invalid enum values with defaults", () => {
    const p = coerceProfile({ tone: "sarcastic", askVsAssume: "maybe", planStrategy: "chaos", verifyWith: "vibes", networkPolicy: "always" }, "F");
    assert.strictEqual(p.tone, "neutral");
    assert.strictEqual(p.askVsAssume, "ask");
    assert.strictEqual(p.planStrategy, "staged");
    assert.strictEqual(p.verifyWith, "none");   // DEFAULT_PROFILE.verifyWith
    assert.strictEqual(p.networkPolicy, "disabled");
  });
  await test("coerceProfile forces name string and keeps booleans strict", () => {
    const p = coerceProfile({ name: 42, structuredOutput: "yes", secretRedaction: false }, "Fallback Name");
    assert.strictEqual(p.name, "Fallback Name"); // non-string name rejected
    assert.strictEqual(p.structuredOutput, false); // default: non-bool left as default
    assert.strictEqual(p.secretRedaction, false);  // real bool applied
  });
  await test("coerceProfile on empty object yields complete usable profile", () => {
    const p = coerceProfile({}, "Auto");
    assert.strictEqual(p.name, "Auto");
    assert.strictEqual(typeof p.maxModelCalls, "number");
    assert.ok(p.maxModelCalls >= 1);
  });
}

// ---------- run all ----------
(async () => {
  console.log("ITER-AI Studio test suite");
  await unitTests();
  await templateTests();
  await metaTemplateTests();
  await profileGenTests();
  await handlerTests();
  await integrationTests();
  console.log("\nResult: " + passed + " passed, " + failed + " failed");
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
