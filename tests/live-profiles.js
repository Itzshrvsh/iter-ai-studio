// Live end-to-end test of the AI profile generator: real provider call,
// real coercion, real store persistence — using the app's own code path.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PROVIDER = {
  baseUrl: "https://nano-gpt.com/v1",
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  model: "deepseek/deepseek-v4.1-flash-1017:thinking",
};

const mem = {};
const storage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
const ctx = vm.createContext({
  console, localStorage: storage, fetch: global.fetch,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  RegExp, Error, Function, setTimeout, clearTimeout, AbortController, URL,
});
ctx.window = ctx;
ctx.document = { getElementById: () => null, createElement: () => ({ style: {}, addEventListener() {}, appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } }), body: { appendChild() {} } };
// Elements returned by getElementById must survive property writes (renderProfileList etc.)
const stubEl = () => ({ style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, appendChild() {}, append() {}, insertBefore() {}, remove() {}, firstChild: { nextSibling: {} }, set innerHTML(v) {}, get innerHTML() { return ""; }, set textContent(v) {}, get textContent() { return ""; }, set value(v) {}, get value() { return ""; }, querySelector() { return null; }, querySelectorAll() { return []; } });
ctx.document = { getElementById: () => stubEl(), createElement: () => stubEl(), createTextNode: () => ({}), body: { appendChild() {} } };

ctx.MutationObserver = class { observe() {} disconnect() {} };
function load(file) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx, { filename: file });
}
load("store.js");
load("model-driving.js"); // DOM-guarded: profileSelect integration no-ops without chatBar

const { Store, BehaviorProfiles, generateProfileFromPrompt, composePrompt } = vm.runInContext(
  "({ Store, BehaviorProfiles, generateProfileFromPrompt, composePrompt })", ctx);

const seeded = Store.add({ name: "nanogpt", baseUrl: PROVIDER.baseUrl, apiKey: PROVIDER.apiKey, model: PROVIDER.model, local: false });
Store.setActive(seeded.id);

const PROMPTS = [
  "A strict code reviewer that plans carefully, verifies with commands, and hates chatty output",
  "A friendly writing coach for a novelist, loose and creative, no verification needed",
  "A security auditor that assumes everything is dangerous, asks before doing anything, wants structured reports",
];

(async () => {
  console.log("Live AI profile generation — provider: " + PROVIDER.model + "\n");
  let pass = 0, fail = 0;
  const failures = [];

  for (const desc of PROMPTS) {
    const t0 = Date.now();
    const res = await generateProfileFromPrompt(desc);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      console.log("✗ \"" + desc.slice(0, 50) + "…\" — " + res.error + " [" + secs + "s]");
      fail++; failures.push(desc);
      continue;
    }
    const p = res.profile;
    // Persistence + prompt composition round-trip
    BehaviorProfiles.upsert(p);
    const stored = BehaviorProfiles.get(p.id);
    const prompt = composePrompt(stored);
    const ok =
      stored && stored.name && stored.roleObjective &&
      ["neutral", "friendly", "terse", "formal"].includes(stored.tone) &&
      Number.isFinite(stored.maxModelCalls) && stored.maxModelCalls >= 1 &&
      prompt && prompt.length > 30;

    if (ok) {
      console.log("✓ [" + secs + "s] " + stored.name);
      console.log("   tone=" + stored.tone + " concise=" + stored.concise + " " + stored.askVsAssume +
        " plan=" + stored.planStrategy + "/" + stored.maxTasks + " verify=" + stored.verifyWith +
        " budget=" + stored.maxModelCalls + " calls/" + stored.maxTotalTokens + " tok" +
        " net=" + stored.networkPolicy);
      console.log("   objective: " + stored.roleObjective.slice(0, 110));
      console.log("   effective prompt (" + prompt.length + " chars): " + prompt.replace(/\n/g, " | ").slice(0, 140) + "…");
      pass++;
    } else {
      console.log("✗ profile failed sanity checks: " + JSON.stringify(p).slice(0, 200));
      fail++; failures.push(desc);
    }
  }

  console.log("\nProfiles now in store: " + BehaviorProfiles.load().map((p) => p.name).join(", "));
  console.log("\nLIVE RESULT: " + pass + " passed, " + fail + " failed");
  if (failures.length) process.exit(1);
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
