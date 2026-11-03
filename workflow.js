// Workflow domain model, validation, templates, storage (Phase 3)
// Workflow = structured data, NOT canvas state. Canvas positions live in node.x/y.

const NodeTypes = {
  goal: {
    label: "Goal", color: "#a78bfa",
    inputs: 0, outputs: 1,
    settings: { objective: "", constraints: "", doneCriteria: "" },
    fields: [
      ["objective", "Objective", "textarea"],
      ["constraints", "Constraints", "textarea"],
      ["doneCriteria", "Definition of done", "textarea"],
    ],
  },
  llm: {
    label: "LLM Call", color: "#22d3ee",
    inputs: 1, outputs: 1,
    settings: { prompt: "", systemPrompt: "", modelOverride: "", maxTokens: 512, temperature: 0.7 },
    fields: [
      ["prompt", "Prompt template (use {input}, {prev})", "textarea"],
      ["systemPrompt", "System prompt override", "textarea"],
      ["modelOverride", "Model override (blank = active provider)", "text"],
      ["maxTokens", "Max output tokens", "number"],
      ["temperature", "Temperature (0–2)", "number"],
    ],
  },
  condition: {
    label: "Condition", color: "#fbbf24",
    inputs: 1, outputs: 2, // out0 = true, out1 = false
    settings: { expression: "" },
    fields: [
      ["expression", "Expression (JS, has access to input; truthy = pass)", "textarea"],
    ],
  },
  output: {
    label: "Output", color: "#34d399",
    inputs: 1, outputs: 0,
    settings: { label: "" },
    fields: [["label", "Output label", "text"]],
  },
  transform: {
    label: "Transform", color: "#a3e635",
    inputs: 1, outputs: 1,
    settings: { op: "trim", arg: "" },
    fields: [
      ["op", "Operation", "select", [
        ["trim", "Trim whitespace"],
        ["uppercase", "UPPERCASE"],
        ["lowercase", "lowercase"],
        ["firstChars", "First N chars (arg = N)"],
        ["stripFences", "Strip markdown code fences"],
        ["jsonPretty", "Pretty-print JSON"],
        ["regexExtract", "Regex extract (arg = pattern)"],
      ]],
      ["arg", "Argument (for ops that use it)", "text"],
    ],
  },
  delay: {
    label: "Delay", color: "#94a3b8",
    inputs: 1, outputs: 1,
    settings: { ms: 1000 },
    fields: [["ms", "Wait (milliseconds)", "number"]],
  },
  memoryRead: {
    label: "Memory read", color: "#f472b6",
    inputs: 1, outputs: 1,
    settings: { projectId: "", maxEntries: 10 },
    fields: [
      ["projectId", "Project ID (blank = all memory)", "text"],
      ["maxEntries", "Max entries", "number"],
    ],
  },
  memoryWrite: {
    label: "Memory write", color: "#f472b6",
    inputs: 1, outputs: 1,
    settings: { category: "finding" },
    fields: [
      ["category", "Category", "select", [
        ["fact", "Stable project fact"],
        ["decision", "User-approved decision"],
        ["finding", "Verified technical finding"],
        ["failure", "Known failure & fix"],
        ["wfperf", "Workflow performance note"],
        ["temp", "Temporary task state"],
      ]],
    ],
  },
  http: {
    label: "HTTP call", color: "#fb923c",
    inputs: 1, outputs: 1,
    settings: { url: "", method: "GET", body: "", timeout: 15 },
    fields: [
      ["url", "URL ({input} / {prev} usable)", "text"],
      ["method", "Method", "select", [["GET", "GET"], ["POST", "POST"]]],
      ["body", "JSON body template (POST only)", "textarea"],
      ["timeout", "Timeout (seconds)", "number"],
    ],
  },
  join: {
    label: "Join", color: "#38bdf8",
    inputs: 2, outputs: 1,
    settings: { template: "{0}\n---\n{1}" },
    fields: [
      ["template", "Merge template ({0}, {1} = incoming outputs)", "textarea"],
    ],
  },
};

const Templates = {
  blank: { name: "Blank", nodes: [
    { type: "goal", x: 60, y: 140 },
    { type: "llm", x: 320, y: 140, settings: { prompt: "Process this input:\n{input}" } },
    { type: "output", x: 580, y: 140 },
  ], edges: [[0, 0, 1], [1, 0, 2]] }, // [nodeIdx, outPort, nodeIdx]

  research: { name: "Research", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Analyze the topic below. Output two sections:\nKEY ASPECTS — the 5 most important aspects\nRISKS — counterpoints, limitations, or open questions\n\nTopic: {input}",
      maxTokens: 1200, temperature: 0.4 } },
    { type: "llm", x: 560, y: 160, settings: {
      prompt: "Using the analysis below, write a balanced, self-contained summary of the topic. Cover both the key aspects and the risks. Output only the final summary.\n\nAnalysis:\n{prev}",
      maxTokens: 800, temperature: 0.3 } },
    { type: "output", x: 820, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3]] },

  // Goal → translate → proofread → output (sequential refine chain)
  translate: { name: "Translate", nodes: [
    { type: "goal", x: 60, y: 140 },
    { type: "llm", x: 300, y: 140, settings: {
      prompt: "Translate the following text to natural, idiomatic English. Output ONLY the translation, no commentary.\n\n{input}",
      systemPrompt: "You are a professional translator. Preserve meaning and tone; never add explanations.",
      maxTokens: 800, temperature: 0.3 } },
    { type: "llm", x: 540, y: 140, settings: {
      prompt: "Proofread this translation. Fix grammar and awkward phrasing. Output ONLY the corrected text.\n\n{prev}",
      systemPrompt: "You are a copy editor. Output only the corrected text.",
      maxTokens: 800, temperature: 0.2 } },
    { type: "output", x: 780, y: 140 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3]] },

  // Goal → draft → critique+rewrite → output
  emailDraft: { name: "Email draft", nodes: [
    { type: "goal", x: 60, y: 140 },
    { type: "llm", x: 300, y: 140, settings: {
      prompt: "Draft a professional email based on this request. Output only the email (subject + body).\n\nRequest: {input}",
      maxTokens: 600, temperature: 0.7 } },
    { type: "llm", x: 540, y: 140, settings: {
      prompt: "Critique the email below against the original request, then output the improved final version. Output ONLY the final email.\n\nOriginal request:\n{input}\n\nDraft:\n{prev}",
      maxTokens: 800, temperature: 0.4 } },
    { type: "output", x: 780, y: 140 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3]] },

  // Goal → extract JSON → condition (valid JSON?) → format / error-note → output (both branches merge)
  extract: { name: "Extract JSON", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Extract structured data from the text below as a single JSON object. Output ONLY the JSON, no code fences, no commentary.\n\n{input}",
      systemPrompt: "You output only valid minified JSON. No markdown fences.",
      maxTokens: 600, temperature: 0.1 } },
    { type: "condition", x: 540, y: 160, settings: { expression: "input.trim().startsWith('{') && input.includes('}') && input.includes(':')" } },
    { type: "llm", x: 760, y: 70, settings: {
      prompt: "The extracted JSON follows. Validate its structure mentally, then pretty-print it as clean JSON with one key-value pair per line. Output only the JSON.\n\n{prev}",
      maxTokens: 600, temperature: 0.1 } },
    { type: "llm", x: 760, y: 260, settings: {
      prompt: "JSON extraction failed (output did not look like JSON). Output a single line: 'EXTRACTION_FAILED' followed by a one-sentence reason based on:\n{prev}",
      maxTokens: 200, temperature: 0.1 } },
    { type: "output", x: 1000, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [2, 1, 4], [3, 0, 5], [4, 0, 5]] },

  // Goal → review → severity condition → detailed-fix path or brief path → output
  codeReview: { name: "Code review", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Review the following code. Output a list of issues, each starting with 'SEVERE:' or 'MINOR:'.\n\n{input}",
      systemPrompt: "You are a senior code reviewer. Be specific; quote the offending lines.",
      maxTokens: 800, temperature: 0.3 } },
    { type: "condition", x: 540, y: 160, settings: { expression: "input.includes('SEVERE:')" } },
    { type: "llm", x: 760, y: 70, settings: {
      prompt: "Severe issues were found. For each SEVERE issue below, write a concrete patch suggestion (before/after). Output the patches only.\n\n{prev}",
      maxTokens: 900, temperature: 0.2 } },
    { type: "llm", x: 760, y: 260, settings: {
      prompt: "Only minor issues were found. Rewrite the issue list as short, friendly bullet-point suggestions.\n\n{prev}",
      maxTokens: 500, temperature: 0.4 } },
    { type: "output", x: 1000, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [2, 1, 4], [3, 0, 5], [4, 0, 5]] },

  // Goal → brainstorm → self-check condition → refine loop exit → output
  brainstorm: { name: "Brainstorm", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Generate 10 diverse, non-obvious ideas for: {input}\nNumber them 1-10, one line each.",
      maxTokens: 700, temperature: 1.0 } },
    { type: "condition", x: 540, y: 160, settings: { expression: "(input.match(/\\d\\./g) || []).length >= 5" } },
    { type: "llm", x: 760, y: 70, settings: {
      prompt: "These ideas were generated for the goal. Score each idea 1-5 for feasibility and impact, then output a table sorted by score.\n\nIdeas:\n{prev}\n\nGoal context: {input}",
      maxTokens: 700, temperature: 0.2 } },
    { type: "llm", x: 760, y: 260, settings: {
      prompt: "The idea list was too short or unnumbered. Regenerate exactly 10 numbered one-line ideas for: {input}",
      maxTokens: 700, temperature: 0.8 } },
    { type: "output", x: 1000, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [2, 1, 4], [3, 0, 5], [4, 0, 5]] },

  // Goal → long summary → shortening condition → TL;DR / keep → output
  summarize: { name: "Summarize", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Summarize the following text, capturing every key point:\n\n{input}",
      maxTokens: 700, temperature: 0.3 } },
    { type: "condition", x: 540, y: 160, settings: { expression: "input.length <= 600" } },
    { type: "llm", x: 760, y: 70, settings: {
      prompt: "The summary below is still too long. Compress it to at most 3 sentences without losing key points. Output only the summary.\n\n{prev}",
      maxTokens: 400, temperature: 0.2 } },
    { type: "output", x: 1000, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [2, 1, 4]] },

  // Goal → claim extraction → verification → verdict condition → output
  factCheck: { name: "Fact-check", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Extract every factual claim from the text below. Output a numbered list, one claim per line.\n\n{input}",
      maxTokens: 600, temperature: 0.2 } },
    { type: "llm", x: 540, y: 160, settings: {
      prompt: "For each claim below, classify it as VERIFIED, PLAUSIBLE, or UNSUPPORTED, with a one-line justification. Never claim verification without a concrete reason.\n\nClaims:\n{prev}",
      systemPrompt: "You are a careful fact-checker. Distinguish 'verified by reasoning' from 'verified by knowledge'.",
      maxTokens: 900, temperature: 0.2 } },
    { type: "condition", x: 780, y: 160, settings: { expression: "input.includes('UNSUPPORTED')" } },
    { type: "llm", x: 1000, y: 70, settings: {
      prompt: "Some claims below were classified UNSUPPORTED. Output ONLY those claims as a numbered list titled 'Claims needing sources:'.\n\n{prev}",
      maxTokens: 400, temperature: 0.1 } },
    { type: "llm", x: 1000, y: 260, settings: {
      prompt: "All claims below passed checking. Output a one-line summary: 'All N claims verified or plausible.'\n\n{prev}",
      maxTokens: 200, temperature: 0.1 } },
    { type: "output", x: 1240, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [3, 1, 5], [4, 0, 6], [5, 0, 6]] },

  // ===== New-node templates (transform / delay / memory / join / http) =====

  // Extract JSON → clean fences via Transform → pretty-print — no LLM needed after extraction
  cleanExtract: { name: "Extract & clean JSON", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Extract key facts from the text as one JSON object. Output ONLY JSON.\n\n{input}",
      maxTokens: 800, temperature: 0.1 } },
    { type: "transform", x: 540, y: 160, settings: { op: "stripFences", arg: "" } },
    { type: "transform", x: 760, y: 160, settings: { op: "jsonPretty", arg: "" } },
    { type: "output", x: 980, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4]] },

  // Merge two LLM perspectives with the Join node (fan-out → fan-in)
  twoPerspectives: { name: "Two perspectives (Join)", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 70, settings: {
      prompt: "Argue FOR the following proposal in 3 bullet points:\n\n{input}",
      maxTokens: 500, temperature: 0.7 } },
    { type: "llm", x: 300, y: 260, settings: {
      prompt: "Argue AGAINST the following proposal in 3 bullet points:\n\n{input}",
      maxTokens: 500, temperature: 0.7 } },
    { type: "join", x: 560, y: 160, settings: { template: "ARGUMENTS FOR:\n{0}\n\nARGUMENTS AGAINST:\n{1}" } },
    { type: "llm", x: 790, y: 160, settings: {
      prompt: "Reproduce the two argument lists below EXACTLY as given (keep the 'ARGUMENTS FOR:' and 'ARGUMENTS AGAINST:' headings), then add a final line starting with 'VERDICT:' containing your balanced one-line recommendation.\n\n{prev}",
      maxTokens: 700, temperature: 0.2 } },
    { type: "output", x: 1020, y: 160 },
  ], edges: [[0, 0, 1], [0, 0, 2], [1, 0, 3], [2, 0, 3], [3, 0, 4], [4, 0, 5]] },

  // Memory-augmented chat prep: read memory → LLM uses it → write the finding back
  memoryLoop: { name: "Memory loop (read→use→write)", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "memoryRead", x: 300, y: 160, settings: { maxEntries: 10 } },
    { type: "llm", x: 540, y: 160, settings: {
      prompt: "Task: {input}\n\nBelow are remembered project notes. Use what is relevant; ignore the rest.\n\n{prev}",
      maxTokens: 900, temperature: 0.4 } },
    { type: "memoryWrite", x: 780, y: 160, settings: { category: "finding" } },
    { type: "transform", x: 990, y: 160, settings: { op: "firstChars", arg: "500" } },
    { type: "output", x: 1190, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [4, 0, 5]] },

  // API-free fetch + summarize: hit a public API, LLM digests the response
  httpDigest: { name: "Fetch & digest (HTTP)", nodes: [
    { type: "goal", x: 60, y: 140 },
    { type: "http", x: 300, y: 140, settings: {
      url: "https://httpbin.org/get?topic={input}",
      method: "GET", timeout: 15 } },
    { type: "transform", x: 540, y: 140, settings: { op: "firstChars", arg: "1500" } },
    { type: "llm", x: 760, y: 140, settings: {
      prompt: "A HTTP endpoint returned the payload below (fetched for query: {input}). Summarize in 3 bullets what the response contains.\n\n{prev}",
      maxTokens: 500, temperature: 0.3 } },
    { type: "output", x: 1000, y: 140 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4]] },

  // Rate-limited multi-call chain: delay between two API steps
  pacedPipeline: { name: "Paced two-step pipeline", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Generate a single creative name for a coding assistant. Output only the name.\n\nContext: {input}",
      maxTokens: 200, temperature: 1.0 } },
    { type: "delay", x: 540, y: 160, settings: { ms: 500 } },
    { type: "llm", x: 760, y: 160, settings: {
      prompt: "The name below was generated. Write a one-line slogan for it.\n\nName: {prev}\n\nOriginal context: {input}",
      maxTokens: 200, temperature: 0.8 } },
    { type: "output", x: 1000, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4]] },

  // Format-fallback chain: LLM → uppercase transform → condition → verbose/compact summary → Join-free merge
  publishGate: { name: "Publish gate (format & check)", nodes: [
    { type: "goal", x: 60, y: 160 },
    { type: "llm", x: 300, y: 160, settings: {
      prompt: "Write a product blurb (2-3 sentences) for: {input}",
      maxTokens: 400, temperature: 0.8 } },
    { type: "transform", x: 540, y: 160, settings: { op: "trim", arg: "" } },
    { type: "condition", x: 760, y: 160, settings: { expression: "input.length >= 40" } },
    { type: "llm", x: 980, y: 70, settings: {
      prompt: "The blurb below passed length review. Add a punchy one-line tagline at the end. Output the final text only.\n\n{prev}",
      maxTokens: 300, temperature: 0.6 } },
    { type: "llm", x: 980, y: 260, settings: {
      prompt: "The blurb below was too short. Expand it to 3 full sentences. Output the final text only.\n\n{prev}",
      maxTokens: 400, temperature: 0.5 } },
    { type: "output", x: 1220, y: 160 },
  ], edges: [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [3, 1, 5], [4, 0, 6], [5, 0, 6]] },
};

const Workflows = {
  key: "iterai.workflows",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  upsert(wf) {
    const list = this.load();
    const i = list.findIndex((w) => w.id === wf.id);
    if (i >= 0) list[i] = wf; else list.push(wf);
    this.saveAll(list);
  },
  get(id) { return this.load().find((w) => w.id === id) || null; },
  remove(id) { this.saveAll(this.load().filter((w) => w.id !== id)); },
};

let _nodeCounter = 0;
function makeNode(type, x, y, settingsOverride) {
  const def = NodeTypes[type];
  return {
    id: "n" + (++_nodeCounter) + "_" + Math.random().toString(36).slice(2, 6),
    type, x, y,
    name: def.label,
    settings: { ...def.settings, ...(settingsOverride || {}) },
  };
}

// Build graph from template definition
function graphFromTemplate(tpl) {
  const nodes = tpl.nodes.map((n) => makeNode(n.type, n.x, n.y, n.settings));
  const edges = tpl.edges.map(([fromIdx, outPort, toIdx], i) => ({
    id: "e" + i, from: nodes[fromIdx].id, outPort, to: nodes[toIdx].id,
  }));
  return { nodes, edges };
}

// ---- Validation ----
// Returns { ok, errors: [] }
function validateGraph(graph) {
  const errors = [];
  const { nodes, edges } = graph;
  if (!nodes.length) errors.push("Graph is empty.");

  const goals = nodes.filter((n) => n.type === "goal");
  if (goals.length !== 1) errors.push("Graph must have exactly one Goal node (found " + goals.length + ").");
  const outputs = nodes.filter((n) => n.type === "output");
  if (outputs.length !== 1) errors.push("Graph must have exactly one Output node (found " + outputs.length + ").");

  // Edge integrity
  const ids = new Set(nodes.map((n) => n.id));
  edges.forEach((e) => {
    if (!ids.has(e.from) || !ids.has(e.to)) errors.push("Edge " + e.id + " references a missing node.");
    const from = nodes.find((n) => n.id === e.from);
    const to = nodes.find((n) => n.id === e.to);
    if (from && NodeTypes[from.type].outputs <= e.outPort)
      errors.push("Edge from \"" + from.name + "\" uses a non-existent output port.");
    if (to && NodeTypes[to.type].inputs < 1)
      errors.push("Edge into \"" + to.name + "\" but it has no input port.");
  });

  // Cycle check (DFS)
  const adj = {};
  edges.forEach((e) => (adj[e.from] = adj[e.from] || []).push(e.to));
  const state = {}; // 0=unvisited 1=in-stack 2=done
  const stack = [];
  function dfs(id) {
    if (state[id] === 1) { errors.push("Graph contains a cycle: " + [...stack, id].map((i) => nodes.find((n) => n.id === i)?.name || i).join(" → ")); return; }
    if (state[id]) return;
    state[id] = 1; stack.push(id);
    (adj[id] || []).forEach(dfs);
    state[id] = 2; stack.pop();
  }
  nodes.forEach((n) => dfs(n.id));

  // Reachability from goal
  if (goals.length === 1) {
    const reach = new Set();
    (function walk(id) {
      if (reach.has(id)) return;
      reach.add(id);
      (adj[id] || []).forEach(walk);
    })(goals[0].id);
    nodes.forEach((n) => { if (!reach.has(n.id)) errors.push("Node \"" + n.name + "\" is not reachable from the Goal."); });
  }

  // Node-specific settings
  nodes.forEach((n) => {
    if (n.type === "llm" && !n.settings.prompt.trim())
      errors.push("LLM node \"" + n.name + "\" has an empty prompt template.");
    if (n.type === "condition" && !n.settings.expression.trim())
      errors.push("Condition node \"" + n.name + "\" has an empty expression.");
    if (n.type === "http" && !String(n.settings.url || "").trim())
      errors.push("HTTP node \"" + n.name + "\" has no URL.");
    if (n.type === "join") {
      const inCount = edges.filter((e) => e.to === n.id).length;
      if (inCount < 2)
        errors.push("Join node \"" + n.name + "\" needs at least 2 incoming edges (has " + inCount + ").");
      if (inCount > 2)
        errors.push("Join node \"" + n.name + "\" accepts 2 incoming edges (has " + inCount + ").");
    }
  });

  return { ok: errors.length === 0, errors };
}

// Node (tests) export guard
if (typeof module !== "undefined" && module.exports) {
  module.exports = { NodeTypes, Templates, Workflows, makeNode, graphFromTemplate, validateGraph };
}