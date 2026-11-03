// Command Center — starter kits (one-click template bundles)
// A kit bundles: a workflow (from Templates), a behavior profile (from
// PROFILE_TEMPLATES), and an evaluation suite (from SUITE_TEMPLATES, which
// auto-creates its starter workflow). Everything is saved to the real stores.
const $cc = (id) => document.getElementById(id);

const KITS = [
  { id: "researchKit",     title: "Research",     workflow: "research",        profile: "researchAnalyst", suite: "research" },
  { id: "summarizeKit",    title: "Summarize",    workflow: "summarize",       profile: "terseAssistant",  suite: "summarizer" },
  { id: "translateKit",    title: "Translate",    workflow: "translate",       profile: "safeDefault",     suite: "translator" },
  { id: "coderKit",        title: "Code review",  workflow: "codeReview",      profile: "preciseCoder",    suite: "codeReviewer" },
  { id: "jsonKit",         title: "Extract JSON", workflow: "cleanExtract",    profile: "preciseCoder",    suite: "jsonExtractor" },
  { id: "writerKit",       title: "Writing",      workflow: "emailDraft",      profile: "brainstormer",    suite: "brainstormer" },
  { id: "factKit",         title: "Fact-check",   workflow: "factCheck",       profile: "researchAnalyst", suite: "factChecker" },
  { id: "debateKit",       title: "Two perspectives", workflow: "twoPerspectives", profile: "researchAnalyst", suite: "research" },
  { id: "memoryKit",       title: "Memory loop",  workflow: "memoryLoop",      profile: "safeDefault",     suite: "brainstormer" },
  { id: "httpKit",         title: "Fetch & digest", workflow: "httpDigest",    profile: "terseAssistant",  suite: "summarizer" },
];

function installKit(kit) {
  const created = [];
  const missing = [];

  // 1. Workflow (validated before saving)
  let wf = null;
  if (Templates[kit.workflow]) {
    const graph = graphFromTemplate(Templates[kit.workflow]);
    const { ok, errors } = validateGraph(graph);
    if (!ok) return { ok: false, error: "Template failed validation: " + errors.join("; ") };
    wf = { id: "w_" + Date.now() + "_kf", name: Templates[kit.workflow].name, nodes: graph.nodes, edges: graph.edges };
    Workflows.upsert(wf);
    created.push("workflow: " + wf.name);
  } else missing.push("workflow " + kit.workflow);

  // 2. Behavior profile (reuse if one with the same name exists)
  let profile = null;
  if (PROFILE_TEMPLATES[kit.profile]) {
    profile = BehaviorProfiles.load().find((p) => p.name === PROFILE_TEMPLATES[kit.profile].name);
    if (!profile) {
      profile = profileFromTemplate(kit.profile);
      BehaviorProfiles.upsert(profile);
      created.push("profile: " + profile.name);
    } else {
      created.push("profile: " + profile.name + " (reused)");
    }
  } else missing.push("profile " + kit.profile);

  // 3. Eval suite (creates its own starter workflow from the suite template)
  let suite = null;
  if (SUITE_TEMPLATES[kit.suite]) {
    suite = suiteFromTemplate(kit.suite);
    EvalSuites.upsert(suite);
    created.push("eval suite: " + suite.name + " (" + suite.cases.length + " cases)");
  } else missing.push("suite " + kit.suite);

  if (missing.length) return { ok: false, error: "Missing template pieces: " + missing.join(", ") };
  return { ok: true, created, workflowId: wf?.id || suite?.workflowId };
}

function renderKits() {
  const wrap = $cc("kitList");
  if (!wrap) return;
  wrap.innerHTML = "";
  KITS.forEach((kit) => {
    const card = document.createElement("div");
    card.className = "kit-card";
    const title = document.createElement("strong");
    title.textContent = kit.title;
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Install";
    btn.addEventListener("click", () => {
      const res = installKit(kit);
      const out = $cc("kitResult");
      out.style.display = "block";
      if (res.ok) {
        out.textContent = "Installed:\n- " + res.created.join("\n- ") +
          "\n\nRun it: Flow Architect → select the workflow → Run ▸\nEvaluate it: Evaluations → select the suite → ▶ Run evaluation";
        $("dockStatus").textContent = "Kit installed: " + kit.title;
      } else {
        out.textContent = "Kit failed: " + res.error;
      }
    });
    card.append(title, btn);
    wrap.appendChild(card);
  });
}

renderKits();
