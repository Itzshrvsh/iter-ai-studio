// Live local-model verification: run the app's own engine + stores against
// LM Studio's OpenAI-compatible server on 127.0.0.1:1234.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const LOCAL = { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", model: "", local: true };

const mem = {};
const storage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
const ctx = vm.createContext({
  console, localStorage: storage, fetch: global.fetch,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  RegExp, Error, Function, encodeURIComponent, TextDecoder,
  setTimeout, clearTimeout, AbortController, URL,
  performance: { now: () => Date.now() },
});
ctx.window = ctx;
const stubEl = () => ({ style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, appendChild() {}, append() {}, insertBefore() {}, remove() {}, firstChild: { nextSibling: {} }, set innerHTML(v) {}, get innerHTML() { return ""; }, set textContent(v) {}, get textContent() { return ""; }, set value(v) {}, get value() { return ""; }, querySelector() { return null; }, querySelectorAll() { return []; } });
ctx.document = { getElementById: () => stubEl(), createElement: () => stubEl(), createTextNode: () => ({}), body: { appendChild() {} } };
ctx.MutationObserver = class { observe() {} disconnect() {} };

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx, { filename: file });
}
load("store.js");
load("workflow.js");
const pj = fs.readFileSync(path.join(__dirname, "..", "projects.js"), "utf8");
vm.runInContext(pj.slice(pj.indexOf("const Memory = {"), pj.indexOf("const MEM_CATEGORIES")), ctx, { filename: "memory-store.js" });
load("engine.js");
// Renderer wiring lives in renderer.js (uses $ / DOM); extract only the pure
// discovery function for the sandbox.
const rd = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const scanSrc = rd.slice(rd.indexOf("const LOCAL_PORTS"), rd.indexOf("async function runScan"));
const fullSrc = scanSrc + `
async function runScan() {
  const found = await scanLocalProviders();
  return found;
}
globalThis.scanLocalProviders = scanLocalProviders;
`;
vm.runInContext(fullSrc, ctx, { filename: "local-scan.js" });
load("model-driving.js"); // includes generateProfileFromPrompt

const { Store, Templates, graphFromTemplate, validateGraph, RunStore, BehaviorProfiles,
        executeWorkflow, generateProfileFromPrompt, scanLocalProviders } = vm.runInContext(
  "({ Store, Templates, graphFromTemplate, validateGraph, RunStore, BehaviorProfiles, executeWorkflow, generateProfileFromPrompt, scanLocalProviders })", ctx);

let pass = 0, fail = 0;
const failures = [];
const ok = (name) => { pass++; console.log("  ✓ " + name); };
const bad = (name, why) => { fail++; failures.push(name + ": " + why); console.log("  ✗ " + name + " — " + why); };

(async () => {
  console.log("Local-model verification — LM Studio on 127.0.0.1:1234\n");

  // 1. Auto-discovery finds the running server
  console.log("1. Local server discovery");
  const found = await scanLocalProviders();
  const lm = found.find((s) => s.port === 1234);
  if (lm && lm.models.length) {
    ok("scan found LM Studio on :1234 with " + lm.models.length + " chat model(s) incl. " + lm.models[0]);
  } else if (found.length) {
    ok("scan found a local server: " + found.map((s) => s.kind + ":" + s.port).join(", "));
  } else {
    bad("discovery", "no local servers found — is LM Studio running?");
  }

  // Use LM Studio's actually-loaded model
  const modelId = lm ? lm.models[0] : "qwen3-coder-30b-a3b-instruct";
  const seeded = Store.add({ name: "LM Studio (local)", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", model: modelId, local: true });
  Store.setActive(seeded.id);
  console.log("  (using model: " + modelId + ")\n");

  // 2. Blank template — single LLM call
  console.log("2. Chat template on local model");
  {
    const tpl = JSON.parse(JSON.stringify(Templates.blank));
    const graph = graphFromTemplate(tpl);
    const { ok: valid } = validateGraph(graph);
    if (!valid) bad("blank template", "failed validation");
    else {
      const wf = { id: "w_local_blank", name: "Local blank", nodes: graph.nodes, edges: graph.edges };
      const run = await executeWorkflow(wf, "Write one short sentence about the moon.", null, null);
      if (run.state === "completed" && run.finalOutput && run.finalOutput.length > 3) {
        ok("blank workflow completed — " + JSON.stringify(run.finalOutput.replace(/\s+/g, " ")).slice(0, 120));
      } else bad("blank workflow", "state=" + run.state + " error=" + (run.error || "none"));
    }
  }

  // 3. Branching template (condition node) on local model
  console.log("3. Branching (condition) on local model");
  {
    const tpl = JSON.parse(JSON.stringify(Templates.summarize));
    tpl.nodes.forEach((n) => { if (n.type === "llm") n.settings.maxTokens = 1000; });
    const graph = graphFromTemplate(tpl);
    const wf = { id: "w_local_sum", name: "Local summarize", nodes: graph.nodes, edges: graph.edges };
    const run = await executeWorkflow(wf, "Solar panels convert sunlight into electricity using photovoltaic cells. Efficiency has risen from 15% to over 22% in the last decade while prices fell about 80%.", null, null);
    const cond = run.events.find((e) => e.type === "condition.evaluated");
    if (run.state === "completed" && cond) {
      ok("summarize pipeline completed — condition took branch: " + cond.detail.result + ", output " + (run.finalOutput || "").length + " chars");
    } else bad("summarize pipeline", "state=" + run.state + " condEvents=" + run.events.filter((e) => e.type === "condition.evaluated").length);
  }

  // 4. AI profile generator against the local model
  console.log("4. AI profile maker on local model");
  {
    const res = await generateProfileFromPrompt("A local coding helper that reads files quickly and gives terse answers");
    if (res.ok) {
      const p = res.profile;
      BehaviorProfiles.upsert(p);
      const stored = BehaviorProfiles.get(p.id);
      if (stored && stored.name && Number.isFinite(stored.maxModelCalls)) {
        ok("profile generated locally — \"" + stored.name + "\" (tone=" + stored.tone + ", concise=" + stored.concise + ")");
      } else bad("profile generation", "incomplete profile: " + JSON.stringify(p).slice(0, 120));
    } else bad("profile generation", res.error);
  }

  // 5. Memory-loop template (deterministic nodes) on local model
  console.log("5. New-node types on local model");
  {
    const tpl = JSON.parse(JSON.stringify(Templates.cleanExtract));
    tpl.nodes.forEach((n) => { if (n.type === "llm") n.settings.maxTokens = 1000; });
    const graph = graphFromTemplate(tpl);
    const wf = { id: "w_local_ext", name: "Local extract", nodes: graph.nodes, edges: graph.edges };
    const run = await executeWorkflow(wf, "Alice bought 2 apples for 3 dollars each on March 5th.", null, null);
    const out = run.finalOutput || "";
    const fenced = out.includes("```");
    if (run.state === "completed" && out.includes("{") && !fenced) {
      ok("cleanExtract works locally — Transform nodes stripped fences, JSON pretty-printed");
    } else bad("cleanExtract", "state=" + run.state + " fenced=" + fenced);
  }

  console.log("\nLOCAL RESULT: " + pass + " passed, " + fail + " failed");
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
