// IDE agent core — pure logic (no DOM, no Electron), testable from Node.
// Implements a bounded tool-use loop over a project folder.
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const TOOLS = ["list_dir", "read_file", "write_file", "run_command", "done"];

// Resolve a path and guarantee it stays inside the project root.
function resolveInside(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("path escapes project folder: " + rel);
  }
  return target;
}

// Extract the first JSON action object from a model reply.
// Tolerates fenced blocks, surrounding prose, and pretty-printed JSON.
function parseAction(text) {
  if (!text) return null;
  const src = String(text).replace(/```json|```/g, "").trim();

  // 1) direct JSON
  try {
    const obj = JSON.parse(src);
    if (obj && typeof obj.tool === "string") return obj;
  } catch {}

  // 2) scan for balanced {...} objects and take the first with a "tool" key
  for (let start = src.indexOf("{"); start >= 0; start = src.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(src.slice(start, i + 1));
            if (obj && typeof obj.tool === "string") return obj;
          } catch {}
          break;
        }
      }
    }
  }
  return null;
}

function buildSystemPrompt(root) {
  return [
    "You are an autonomous coding agent working in the project folder: " + root,
    "Respond with EXACTLY ONE JSON object and no other prose. One action per reply.",
    "Available actions:",
    '{"tool":"list_dir","path":"."}',
    '{"tool":"read_file","path":"relative/path"}',
    '{"tool":"write_file","path":"relative/path","content":"full file content"}',
    '{"tool":"run_command","command":"command to run in the project folder"}',
    '{"tool":"done","summary":"what was accomplished"}',
    "Rules:",
    "- Use only relative paths inside the project folder.",
    "- Read a file before rewriting it when possible.",
    "- Keep changes minimal and consistent with existing code.",
    "- When the task is complete, call done with a short summary.",
    "- Never invent tool output; tool results are provided to you after each action.",
  ].join("\n");
}

// Filesystem/command tools bound to a root folder.
function createTools(root, opts = {}) {
  const commandTimeout = opts.commandTimeout ?? 120000;
  const maxFileChars = opts.maxFileChars ?? 200000;
  const maxOutput = opts.maxOutput ?? 6000;

  return {
    list_dir({ path: rel = "." }) {
      const dir = resolveInside(root, rel);
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !["node_modules", ".git", "dist", "build", ".cache"].includes(e.name))
        .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
        .sort((a, b) => (a.endsWith("/") === b.endsWith("/") ? a.localeCompare(b) : a.endsWith("/") ? -1 : 1));
      return entries.join("\n") || "(empty)";
    },

    read_file({ path: rel }) {
      if (!rel) throw new Error("read_file needs a path");
      const file = resolveInside(root, rel);
      const stat = fs.statSync(file);
      if (stat.size > maxFileChars) {
        return "(" + file + " is " + stat.size + " bytes; showing first " + maxFileChars + ")\n" +
          fs.readFileSync(file, "utf8").slice(0, maxFileChars);
      }
      return fs.readFileSync(file, "utf8");
    },

    write_file({ path: rel, content = "" }) {
      if (!rel) throw new Error("write_file needs a path");
      const file = resolveInside(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      return "Wrote " + content.length + " chars to " + rel;
    },

    run_command({ command }) {
      if (!command) throw new Error("run_command needs a command");
      return new Promise((resolve, reject) => {
        exec(command, { cwd: root, timeout: commandTimeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          const out = ((stdout || "") + (stderr || "")).trim();
          const clipped = out.length > maxOutput ? out.slice(0, maxOutput) + "\n…(truncated)" : out;
          if (err && err.killed) return resolve("TIMEOUT after " + commandTimeout + "ms\n" + clipped);
          if (err) return resolve("EXIT " + (err.code ?? "?") + "\n" + clipped);
          resolve("OK\n" + clipped);
        });
      });
    },
  };
}

// Bounded agent loop.
// callModel(messages) -> Promise<string reply>
// approve(action) -> Promise<boolean> (optional; omit for fully autonomous)
// onEvent({type,...}) for UI logging.
async function runAgent({ callModel, tools, systemPrompt, task, maxSteps = 20, approve, onEvent, signal }) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  const history = [];

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) return { done: false, reason: "cancelled", steps: step - 1, messages, history };
    const reply = await callModel(messages);
    onEvent?.({ type: "model", step, text: reply });
    history.push({ role: "assistant", reply });

    const action = parseAction(reply);
    if (!action) {
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: "Invalid reply. Send exactly ONE JSON action object, e.g. {\"tool\":\"list_dir\",\"path\":\".\"}." });
      history.push({ role: "system", note: "unparsable model reply" });
      continue;
    }
    if (action.tool === "done") {
      const summary = String(action.summary || "").slice(0, 1000);
      onEvent?.({ type: "done", step, summary });
      history.push({ role: "done", summary });
      return { done: true, summary, steps: step, messages, history };
    }
    if (!tools[action.tool]) {
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: "Unknown tool \"" + action.tool + "\". Use one of: " + Object.keys(tools).join(", ") + ", done." });
      history.push({ role: "system", note: "unknown tool " + action.tool });
      continue;
    }
    if (approve && !(await approve(action))) {
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: "User declined this action. Choose a different action or call done." });
      history.push({ role: "declined", action });
      continue;
    }

    let result;
    try {
      result = await tools[action.tool](action);
    } catch (err) {
      result = "ERROR: " + err.message;
    }
    onEvent?.({ type: "tool", step, action, result: String(result).slice(0, 2000) });
    history.push({ role: "tool", action, result: String(result).slice(0, 20000) });
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: "TOOL RESULT (" + action.tool + "):\n" + String(result).slice(0, 6000) });
  }

  onEvent?.({ type: "limit", maxSteps });
  return { done: false, reason: "step limit reached", steps: maxSteps, messages, history };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TOOLS, resolveInside, parseAction, buildSystemPrompt, createTools, runAgent };
}
