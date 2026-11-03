// Execution engine (Phase 5, core subset)
// Deterministic workflow execution against the active provider, with persisted run events.
// Supported node types: goal, llm, condition, output.

const RunStore = {
  key: "iterai.runs",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  upsert(run) {
    const list = this.load();
    const i = list.findIndex((r) => r.id === run.id);
    if (i >= 0) list[i] = run; else list.unshift(run);
    this.saveAll(list);
  },
  get(id) { return this.load().find((r) => r.id === id) || null; },
};

function makeRun(workflow, inputText) {
  return {
    id: "r_" + Date.now(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    state: "running",          // running | waiting_approval | paused | completed | failed | cancelled
    startedAt: Date.now(),
    endedAt: null,
    input: inputText,
    events: [],
    nodeStates: {},            // nodeId -> { status, attempts, output, error, durationMs }
    outputs: {},               // nodeId -> last output (data flow)
    tokens: { in: 0, out: 0, reported: false },
  };
}

function addEvent(run, type, nodeId, detail) {
  run.events.push({
    ts: Date.now(),
    type,                      // run.started, node.started, model.completed, node.completed, run.completed, run.failed, run.cancelled, condition.evaluated...
    nodeId: nodeId || null,
    detail: detail || null,
  });
}

// Topological order via DFS from the goal node
function topoOrder(workflow) {
  const goal = workflow.nodes.find((n) => n.type === "goal");
  const adj = {};
  workflow.edges.forEach((e) => (adj[e.from] = adj[e.from] || []).push(e.to));
  const order = [];
  const seen = new Set();
  (function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    (adj[id] || []).forEach(visit);
  })(goal.id);
  return order;
}

// (topoOrder retained for future use; execution now uses branch-aware frontier walk)

// Substitute {input} and {prev} in a prompt template
function fillTemplate(tpl, input, prev) {
  return String(tpl)
    .replace(/\{input\}/g, input ?? "")
    .replace(/\{prev\}/g, prev ?? "");
}

// Deterministic text transforms for Transform nodes
function applyTransform(settings, text) {
  const s = String(text ?? "");
  const arg = settings.arg ?? "";
  switch (settings.op) {
    case "uppercase": return s.toUpperCase();
    case "lowercase": return s.toLowerCase();
    case "trim": return s.trim();
    case "firstChars": {
      const n = Math.max(0, Number(arg) || 0);
      return s.slice(0, n) + (s.length > n ? "…" : "");
    }
    case "stripFences": // remove ```lang ... ``` wrappers, keep inner content
      return s.replace(/```[a-zA-Z0-9]*\n?/g, "").replace(/```/g, "");
    case "jsonPretty": {
      try { return JSON.stringify(JSON.parse(s), null, 2); }
      catch (e) { return "JSON parse failed: " + e.message + "\n\n" + s; }
    }
    case "regexExtract": {
      try { const m = s.match(new RegExp(arg, "m")); return m ? (m[1] ?? m[0]) : "(no match)"; }
      catch (e) { return "Invalid regex: " + e.message; }
    }
    default: return s;
  }
}// Evaluate a condition expression safely-ish: only the `input` variable in scope.
function evalCondition(expr, input) {
  try {
    const fn = new Function("input", `"use strict"; return (${expr});`);
    return !!fn(input);
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Run a workflow.
 * @param workflow validated workflow object
 * @param inputText user input (goal objective or provided input)
 * @param onEvent callback(run) after each event, for live UI
 * @param signal AbortSignal for cancellation
 */
async function executeWorkflow(workflow, inputText, onEvent, signal) {
  const profile = (typeof window !== "undefined" && window.activeBehaviorProfile)
    ? BehaviorProfiles.get(window.activeBehaviorProfile)
    : null;
  const provider = Store.active();
  if (!provider) throw new Error("No provider configured.");

  const run = makeRun(workflow, inputText);
  addEvent(run, "run.started", null, { workflow: workflow.name, provider: provider.baseUrl, model: provider.model });
  onEvent?.(run);

  const nodeById = Object.fromEntries(workflow.nodes.map((n) => [n.id, n]));
  let lastOutput = inputText;
  let modelCalls = 0;
  const maxCalls = profile?.maxModelCalls ?? 50;

  const goal = nodeById[workflow.nodes.find((n) => n.type === "goal").id];
  const goalInput = goal.settings.objective
    ? goal.settings.objective + (inputText ? "\n\nUser input: " + inputText : "")
    : inputText;

  try {
    // Branch-aware traversal: conditions route to only ONE successor.
    const frontier = [goal.id];
    const executed = new Set();
    while (frontier.length) {
      const nodeId = frontier.shift();
      if (executed.has(nodeId)) continue; // diamond merges run once
      executed.add(nodeId);
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "RunCancelled" });
      const node = nodeById[nodeId];
      const st = { status: "running", attempts: 0, output: null, error: null, durationMs: 0 };
      run.nodeStates[nodeId] = st;
      addEvent(run, "node.started", nodeId, { name: node.name, type: node.type });
      onEvent?.(run);
      const t0 = performance.now();

      // Memory-write nodes run concurrently with the frontier walk; dedupe here
      if (node.type === "join") {
        // Wait until all inbound branches that will reach us have executed.
        // A branch is "pending" if its source hasn't completed AND its source
        // is not on the frontier anymore (i.e. it was condition-skipped).
        const inbound = workflow.edges.filter((e) => e.to === nodeId).map((e) => e.from);
        const pending = inbound.filter((src) => {
          if (executed.has(src)) return false;
          // source not yet executed: it's still coming via the frontier
          return frontier.includes(src) || !run.nodeStates[src]; // conservative: wait
        });
        if (pending.length) { frontier.push(nodeId); continue; } // revisit later
      }

      if (node.type === "goal") {
        st.output = goalInput;
        st.status = "completed";
      } else if (node.type === "llm") {
        if (modelCalls >= maxCalls) throw new Error("Budget reached: max model calls (" + maxCalls + ").");
        const prompt = fillTemplate(node.settings.prompt, lastOutput, lastOutput);
        const sys = node.settings.systemPrompt || profile?.roleObjective || "";
        const maxAttempts = Math.max(1, node.settings.retries ?? 1);
        let usage = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          st.attempts = attempt;
          try {
            modelCalls++;
            if (modelCalls > maxCalls) throw new Error("Budget reached: max model calls (" + maxCalls + ").");
            usage = await callLLM(run, provider, sys, prompt, node.settings, signal, (partial) => {
              st.output = partial; onEvent?.(run);
            });
            break;
          } catch (e) {
            if (e.name === "AbortError" || signal?.aborted) throw e;
            addEvent(run, "recovery.attempt", nodeId, { attempt, error: e.message.slice(0, 200) });
            if (attempt === maxAttempts) {
              if (node.settings.onFailure === "skip") { st.status = "skipped"; st.error = e.message; break; }
              throw e;
            }
          }
        }
        if (st.status !== "skipped") {
          if (usage) { run.tokens.in += usage.prompt_tokens || 0; run.tokens.out += usage.completion_tokens || 0; run.tokens.reported = true; }
          st.output = run._lastReply;   // final completion (streaming only updated partials)
          st.status = "completed";
        }
      } else if (node.type === "condition") {
        const res = evalCondition(node.settings.expression, lastOutput);
        if (res && res.error) {
          st.status = "failed"; st.error = "Expression error: " + res.error;
          addEvent(run, "validation.failed", nodeId, { error: res.error });
          onEvent?.(run);
          throw new Error("Condition \"" + node.name + "\" failed: " + res.error);
        }
        st.output = res ? "true" : "false";
        st.status = "completed";
        st.durationMs = Math.round(performance.now() - t0);
        addEvent(run, "condition.evaluated", nodeId, { result: st.output });
        // Route: outPort 0 = true, outPort 1 = false. Only the taken branch runs.
        const outEdge = workflow.edges.find((e) => e.from === nodeId && e.outPort === (res ? 0 : 1));
        if (outEdge) frontier.push(outEdge.to);
        run.lastBranch = { from: nodeId, took: outEdge ? outEdge.to : null };
        onEvent?.(run);
        continue;
      } else if (node.type === "transform") {
        st.output = applyTransform(node.settings, lastOutput);
        st.status = "completed";
      } else if (node.type === "delay") {
        const ms = Math.min(60000, Math.max(0, Number(node.settings.ms) || 0));
        await new Promise((r) => setTimeout(r, ms));
        st.output = lastOutput; // pass-through
        st.status = "completed";
        addEvent(run, "delay.done", nodeId, { ms });
      } else if (node.type === "memoryRead") {
        const list = node.settings.projectId
          ? Memory.byProject(node.settings.projectId)
          : Memory.load();
        const picked = list.slice(0, Math.max(1, Number(node.settings.maxEntries) || 10));
        st.output = lastOutput + (picked.length
          ? "\n\n--- Project memory ---\n" + picked.map((m) => "[" + m.category + (m.verified ? " ✓" : "") + "] " + m.text).join("\n")
          : "\n\n--- Project memory ---\n(no entries)");
        st.status = "completed";
        addEvent(run, "memory.read", nodeId, { entries: picked.length });
      } else if (node.type === "memoryWrite") {
        const entry = Memory.add({
          projectId: null,
          category: node.settings.category || "temp",
          text: String(lastOutput ?? "").slice(0, 2000),
          source: "workflow",
          verified: false,
        });
        st.output = lastOutput; // pass-through
        st.status = "completed";
        addEvent(run, "memory.written", nodeId, { entryId: entry.id, category: entry.category });
      } else if (node.type === "http") {
        if (modelCalls >= maxCalls) throw new Error("Budget reached: max model calls (" + maxCalls + ").");
        const url = fillTemplate(node.settings.url, lastOutput, lastOutput).trim();
        if (!/^https?:\/\//i.test(url)) throw new Error("HTTP node \"" + node.name + "\": url must start with http(s)://");
        const method = (node.settings.method || "GET").toUpperCase();
        const timeoutMs = Math.max(1, Number(node.settings.timeout) || 15) * 1000;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            method,
            signal: ctrl.signal,
            headers: method === "POST" ? { "Content-Type": "application/json" } : {},
            body: method === "POST" ? fillTemplate(node.settings.body, lastOutput, lastOutput) : undefined,
          });
          const text = (await res.text()).slice(0, 20000);
          st.output = "HTTP " + res.status + "\n" + text;
          st.status = "completed";
          addEvent(run, "http.completed", nodeId, { status: res.status, bytes: text.length });
        } finally { clearTimeout(timer); }
      } else if (node.type === "join") {
        // Collect outputs from all inbound edges' sources (diamond merge / fan-in)
        const incoming = workflow.edges.filter((e) => e.to === nodeId).map((e) => run.outputs[e.from]);
        const tplStr = String(node.settings.template ?? "{0}\n---\n{1}");
        st.output = tplStr.replace(/\{(\d)\}/g, (_, i) => incoming[Number(i)] ?? "");
        st.status = "completed";
        addEvent(run, "join.merged", nodeId, { inputs: incoming.filter((x) => x != null).length });
      } else if (node.type === "output") {
        st.output = lastOutput;
        st.status = "completed";
        run.finalOutput = lastOutput;
      }

      st.durationMs = Math.round(performance.now() - t0);
      run.outputs[nodeId] = st.output;
      // Skipped nodes must not poison the data flow: keep lastOutput unchanged.
      if (st.status !== "skipped" && st.output != null) lastOutput = st.output;
      addEvent(run, "node.completed", nodeId, { durationMs: st.durationMs });
      workflow.edges.filter((e) => e.from === nodeId).forEach((e) => frontier.push(e.to));
      onEvent?.(run);
    }

    run.state = "completed";
    run.endedAt = Date.now();
    addEvent(run, "run.completed", null, { tokens: run.tokens });
    if (run.finalOutput == null) {
      // Output node unreachable on the executed path (e.g. condition took a branch with no Output).
      run.state = "failed";
      run.error = "Workflow finished without reaching an Output node on the executed branch.";
      addEvent(run, "run.failed", null, { error: run.error });
    }
  } catch (err) {
    if (err.name === "RunCancelled" || signal?.aborted) {
      run.state = "cancelled";
      addEvent(run, "run.cancelled", null, {});
    } else {
      run.state = "failed";
      run.error = err.message;
      addEvent(run, "run.failed", null, { error: err.message });
    }
    run.endedAt = Date.now();
  }
  onEvent?.(run);
  RunStore.upsert(run);
  return run;
}

// Single LLM call with retry per node settings
async function callLLM(run, provider, sys, prompt, settings, signal, onPartial) {
  const messages = sys ? [{ role: "system", content: sys }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
  addEvent(run, "model.requested", null, { promptChars: prompt.length, model: settings.modelOverride || provider.model });
  const maxTokens = settings.maxTokens ?? 512;
  const body = {
    model: settings.modelOverride || provider.model,
    messages,
    max_tokens: maxTokens,
    temperature: settings.temperature ?? 0.7,
    stream: true,
    stream_options: { include_usage: true },
  };
  const res = await fetch(provider.baseUrl + "/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: "Bearer " + provider.apiKey } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Provider " + res.status + ": " + (await res.text()).slice(0, 300));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", reply = "", usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const d = s.slice(5).trim();
      if (d === "[DONE]") continue;
      let evt; try { evt = JSON.parse(d); } catch { continue; }
      if (evt.usage) usage = evt.usage;
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) { reply += delta; onPartial?.(reply); }
    }
  }
  addEvent(run, "model.completed", null, { replyChars: reply.length, usage: usage || "not reported" });
  run._lastReply = reply; // engine writes back the actual completion (st.output currently holds partials)
  return usage;
}

// Node (tests / main-process API) export guard
if (typeof module !== "undefined" && module.exports) {
  module.exports = { executeWorkflow, fillTemplate, evalCondition, applyTransform, topoOrder, callLLM };
}