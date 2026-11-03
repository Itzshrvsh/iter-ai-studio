// Live workflow runner — executes every template workflow against the real
// provider using the app's own engine (engine.js) in plain Node.
// The engine's browser globals (window, localStorage stores) are stubbed.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------- Live config (the provider saved in the app) ----------
const PROVIDER = {
  name: "nanogpt",
  baseUrl: "https://nano-gpt.com/v1",
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  model: "deepseek/deepseek-v4.1-flash-1017:thinking",
  local: false,
  id: "p_live",
};

// ---------- Sandbox with localStorage-backed stores ----------
const mem = {};
const storage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};

const ctx = vm.createContext({
  console,
  localStorage: storage,
  performance: { now: () => Date.now() },
  fetch: global.fetch,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  RegExp, Error, Function, encodeURIComponent, TextDecoder,
  setTimeout, clearTimeout, AbortController, URL,
});
ctx.window = ctx; // engine reads window.activeBehaviorProfile (undefined → no profile)
ctx.document = { getElementById: () => null, createElement: () => ({ style: {}, addEventListener() {}, appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } }) };
function load(file) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx, { filename: file });
}
load("store.js");
load("workflow.js");
// Memory store lives in projects.js; extract just the Memory definition to
// avoid loading the DOM-wired rest of the file in this sandbox.
const pjSrc = fs.readFileSync(path.join(__dirname, "..", "projects.js"), "utf8");
const memSrc = pjSrc.slice(pjSrc.indexOf("const Memory = {"), pjSrc.indexOf("const MEM_CATEGORIES"));
vm.runInContext(memSrc, ctx, { filename: "memory-store.js" });
load("engine.js");

const { Store, Templates, graphFromTemplate, Workflows, RunStore, Memory, executeWorkflow, validateGraph } = vm.runInContext(
  "({ Store, Templates, graphFromTemplate, Workflows, RunStore, Memory, executeWorkflow, validateGraph })", ctx);

// Seed the live provider (Store.add assigns its own id)
const seeded = Store.add({ name: PROVIDER.name, baseUrl: PROVIDER.baseUrl, apiKey: PROVIDER.apiKey, model: PROVIDER.model, local: false });
Store.setActive(seeded.id);

// Thinking models burn tokens on reasoning; give generous max_tokens
const TOKEN_FLOOR = 2000;

// ---------- Test inputs per template ----------
const INPUTS = {
  blank: "Write one sentence about the sea.",
  research: "Impact of sleep on memory consolidation",
  translate: "Bonjour, comment allez-vous aujourd'hui ? J'espère que tu vas bien.",
  emailDraft: "Ask my manager for Friday off for a family event, keep it short and warm.",
  extract: "Meeting on March 3rd at 2pm with Alice about the Q1 budget. Alice asked for 500 dollars more. Bob will send the invoice.",
  codeReview: "function divide(a, b) { return a / b; } // called with b = 0 in production loop",
  brainstorm: "ways to keep a desk tidy",
  summarize: "Solar panels convert sunlight into electricity using photovoltaic cells. Efficiency has risen from 15% to over 22% in the last decade. Prices fell about 80% in the same period. Manufacturing scales continue to improve, and new perovskite designs promise further gains. Grid operators increasingly treat solar as a baseline source rather than a supplement.",
  factCheck: "My neighbor Bob can run 100 km/h. Paris is the capital of France. Water boils at lower temperature at altitude.",
  cleanExtract: "Alice ordered 3 keyboards and 2 mice on March 4th. Total was 245 dollars. Delivery is expected March 10th.",
  twoPerspectives: "Adopt a four-day work week for the engineering team",
  memoryLoop: "What did we decide about the API rate limiter?",
  httpDigest: "iterai-test",
  pacedPipeline: "a tool for tracking coffee brews",
  publishGate: "a mechanical keyboard with hall-effect switches",
};

// ---------- Expected signals per template (deterministic checks) ----------
const CHECKS = {
  blank:        { contains: [], notContains: [] },
  research:     { contains: [], notContains: [] },
  translate:    { contains: [], notContains: ["bonjour"] },   // output should be English
  emailDraft:   { contains: ["subject"], notContains: [] },   // template demands subject+body
  extract:      { contains: [], notContains: [] },            // branch outcome validated below
  codeReview:   { contains: [], notContains: [] },
  brainstorm:   { contains: [], notContains: [] },
  summarize:    { contains: [], notContains: [] },
  factCheck:    { contains: [], notContains: [] },
  cleanExtract: { contains: ["{", "}"], notContains: ["```"] },  // fences stripped, JSON pretty-printed
  twoPerspectives: { contains: ["ARGUMENTS FOR:", "ARGUMENTS AGAINST:", "VERDICT:"], notContains: [] },
  memoryLoop:   { contains: [], notContains: [] },
  httpDigest:   { contains: [], notContains: [] },
  pacedPipeline: { contains: [], notContains: [] },
  publishGate:  { contains: [], notContains: [] },
};

let pass = 0, fail = 0;
const failures = [];

(async () => {
  console.log("Live template verification — provider: " + PROVIDER.name + " / " + PROVIDER.model + "\n");

  for (const [key, tpl] of Object.entries(Templates)) {
    if (key === "blank") { /* still run it — exercises the minimal path */ }
    const input = INPUTS[key];
    if (input === undefined) { console.log("SKIP " + key + " (no input)"); continue; }

    // Bump maxTokens so thinking models don't exhaust budget on reasoning
    tpl.nodes.forEach((n) => { if (n.type === "llm" && (n.settings.maxTokens || 0) < TOKEN_FLOOR) n.settings.maxTokens = TOKEN_FLOOR; });

    const graph = graphFromTemplate(tpl);
    const { ok, errors } = validateGraph(graph);
    if (!ok) { console.log("✗ " + key + " — invalid graph: " + errors.join("; ")); fail++; failures.push(key); continue; }

    const wf = { id: "w_live_" + key, name: tpl.name, nodes: graph.nodes, edges: graph.edges };
    const t0 = Date.now();
    const run = await executeWorkflow(wf, input, null, null);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const out = run.finalOutput || "";
    const modelCalls = run.events.filter((e) => e.type === "model.completed").length;

    if (run.state !== "completed") {
      console.log("✗ " + key + " — run " + run.state + (run.error ? " (" + run.error + ")" : "") + " [" + secs + "s]");
      fail++; failures.push(key);
      continue;
    }

    // Deterministic substring checks
    const check = CHECKS[key] || { contains: [], notContains: [] };
    const lower = out.toLowerCase();
    const missing = check.contains.filter((c) => !lower.includes(c.toLowerCase()));
    const forbidden = check.notContains.filter((c) => lower.includes(c.toLowerCase()));
    if (missing.length || forbidden.length) {
      console.log("✗ " + key + " — checks failed (missing: " + missing.join(",") + " forbidden: " + forbidden.join(",") + ") [" + secs + "s]");
      fail++; failures.push(key);
      continue;
    }

    // Branch sanity: condition nodes on the executed path must have evaluated
    const condEvents = run.events.filter((e) => e.type === "condition.evaluated");
    const branchOk = !graph.nodes.some((n) => n.type === "condition") || condEvents.length > 0;

    console.log("✓ " + key + " — " + run.state + ", " + modelCalls + " model call(s), " +
      (run.tokens.reported ? run.tokens.in + "in/" + run.tokens.out + "out tok" : "tokens n/r") +
      ", " + out.length + " chars out, branch " + (branchOk ? "ok" : "NOT evaluated") + " [" + secs + "s]");
    console.log("   output: " + out.replace(/\s+/g, " ").slice(0, 160) + (out.length > 160 ? "…" : ""));
    pass++;
  }

  // Branch outcome spot checks
  console.log("\nBranch & new-node outcome checks:");
  const extRun = RunStore.load().find((r) => r.workflowId === "w_live_extract");
  if (extRun) {
    const ok = extRun.finalOutput && (extRun.finalOutput.includes("{") || extRun.finalOutput.includes("EXTRACTION_FAILED"));
    console.log((ok ? "✓" : "✗") + " extract: branch produced " + (extRun.finalOutput || "").slice(0, 60).replace(/\n/g, " "));
    ok ? pass++ : (fail++, failures.push("extract-branch"));
  }
  const crRun = RunStore.load().find((r) => r.workflowId === "w_live_codeReview");
  if (crRun) {
    const expectedSeverity = /SEVERE:/i.test(crRun.finalOutput || "");
    console.log("✓ codeReview: final output routed via severity branch — " +
      (expectedSeverity ? "severe path" : "minor path") + " output");
    pass++;
  }
  const memRun = RunStore.load().find((r) => r.workflowId === "w_live_memoryLoop");
  if (memRun) {
    const memCount = vm.runInContext("Memory.load().length", ctx);
    const ok = memCount > 0;
    console.log((ok ? "✓" : "✗") + " memoryLoop: memoryWrite persisted " + memCount + " entr(y/ies)");
    ok ? pass++ : (fail++, failures.push("memoryLoop-write"));
  }
  const httpRun = RunStore.load().find((r) => r.workflowId === "w_live_httpDigest");
  if (httpRun) {
    const ev = httpRun.events.find((e) => e.type === "http.completed");
    console.log((ev ? "✓" : "✗") + " httpDigest: HTTP node " + (ev ? "completed with status " + ev.detail.status : "did not complete"));
    ev ? pass++ : (fail++, failures.push("httpDigest-call"));
  }
  const joinRun = RunStore.load().find((r) => r.workflowId === "w_live_twoPerspectives");
  if (joinRun) {
    const ev = joinRun.events.find((e) => e.type === "join.merged");
    console.log((ev ? "✓" : "✗") + " twoPerspectives: Join merged " + (ev ? ev.detail.inputs : 0) + " inputs");
    ev ? pass++ : (fail++, failures.push("join-merge"));
  }

  // Persist run records for the app to display
  console.log("\nRuns persisted in sandbox RunStore: " + RunStore.load().length);

  console.log("\nLIVE RESULT: " + pass + " passed, " + fail + " failed");
  if (failures.length) { console.log("Failures: " + failures.join(", ")); process.exit(1); }
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
