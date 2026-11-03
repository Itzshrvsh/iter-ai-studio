// Unit tests for the IDE agent core (pure Node).
const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const {
  resolveInside, parseAction, buildSystemPrompt, createTools, runAgent,
} = require("../ide-agent.js");

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; failures.push(name + " — " + e.message); console.log("  ✗ " + name + " — " + e.message); }
}

(async () => {
  console.log("IDE agent core tests");

  console.log("\n— action parsing —");
  await test("parses a plain JSON action", () => {
    assert.deepStrictEqual(parseAction('{"tool":"read_file","path":"a.js"}'), { tool: "read_file", path: "a.js" });
  });
  await test("parses an action inside a fenced block", () => {
    const a = parseAction('Sure.\n```json\n{"tool":"list_dir","path":"."}\n```\nDone.');
    assert.strictEqual(a.tool, "list_dir");
  });
  await test("parses a nested-object action from prose", () => {
    const a = parseAction('Action: {"tool":"write_file","path":"x.js","content":"const o = {a:1};"} end.');
    assert.strictEqual(a.content, "const o = {a:1};");
  });
  await test("returns null on non-JSON", () => {
    assert.strictEqual(parseAction("I will now edit the file."), null);
  });
  await test("handles braces inside strings", () => {
    const a = parseAction('{"tool":"write_file","path":"t.txt","content":"a } b { c"}');
    assert.strictEqual(a.content, "a } b { c");
  });

  console.log("\n— path safety —");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iterai-ide-"));
  await test("relative path resolves inside root", () => {
    assert.strictEqual(resolveInside(root, "src/a.js"), path.join(root, "src", "a.js"));
  });
  await test("dot path resolves to root", () => {
    assert.strictEqual(resolveInside(root, "."), root);
  });
  await test("../ escape is rejected", () => {
    assert.throws(() => resolveInside(root, "../evil.txt"), /escapes/);
  });
  await test("absolute path outside root is rejected", () => {
    assert.throws(() => resolveInside(root, path.join(os.tmpdir(), "whatever.txt")), /escapes/);
  });

  console.log("\n— tools —");
  const tools = createTools(root);
  await test("write_file + read_file round-trip", async () => {
    tools.write_file({ path: "src/hello.txt", content: "hi there" });
    assert.strictEqual(tools.read_file({ path: "src/hello.txt" }), "hi there");
  });
  await test("write_file creates directories", () => {
    tools.write_file({ path: "deep/nested/x.txt", content: "x" });
    assert.ok(fs.existsSync(path.join(root, "deep", "nested", "x.txt")));
  });
  await test("list_dir lists entries and marks folders", () => {
    const out = tools.list_dir({ path: "." });
    assert.ok(out.includes("src/") && out.includes("deep/"));
  });
  await test("run_command runs in the project folder", async () => {
    const out = await tools.run_command({ command: process.platform === "win32" ? "cd" : "pwd" });
    assert.ok(out.includes(root) || out.toLowerCase().includes(path.basename(root).toLowerCase()));
  });
  await test("run_command reports exit codes", async () => {
    const out = await tools.run_command({ command: process.platform === "win32" ? "exit /b 3" : "exit 3" });
    assert.ok(/EXIT 3/.test(out), out);
  });
  await test("read_file missing path throws", () => {
    assert.throws(() => tools.read_file({}), /needs a path/);
  });

  console.log("\n— agent loop —");
  await test("executes actions until done and records history", async () => {
    const replies = [
      '{"tool":"write_file","path":"out.txt","content":"agent wrote this"}',
      '{"tool":"read_file","path":"out.txt"}',
      '{"tool":"done","summary":"file created"}',
    ];
    const events = [];
    const res = await runAgent({
      callModel: async () => replies.shift(),
      tools,
      systemPrompt: "sys",
      task: "make a file",
      maxSteps: 5,
      onEvent: (e) => events.push(e.type),
    });
    assert.strictEqual(res.done, true);
    assert.strictEqual(res.summary, "file created");
    assert.strictEqual(fs.readFileSync(path.join(root, "out.txt"), "utf8"), "agent wrote this");
    assert.deepStrictEqual(events, ["model", "tool", "model", "tool", "model", "done"]);
  });
  await test("unknown tool is corrected and loop continues", async () => {
    const replies = ['{"tool":"teleport"}', '{"tool":"done","summary":"ok"}'];
    const res = await runAgent({ callModel: async () => replies.shift(), tools, systemPrompt: "s", task: "t", maxSteps: 4 });
    assert.strictEqual(res.done, true);
    assert.ok(res.history.some((h) => h.note && h.note.includes("unknown tool")));
  });
  await test("invalid reply is corrected", async () => {
    const replies = ["I'll just chat instead.", '{"tool":"done","summary":"ok"}'];
    const res = await runAgent({ callModel: async () => replies.shift(), tools, systemPrompt: "s", task: "t", maxSteps: 4 });
    assert.strictEqual(res.done, true);
  });
  await test("approval rejection feeds back and loop continues", async () => {
    const replies = ['{"tool":"write_file","path":"denied.txt","content":"x"}', '{"tool":"done","summary":"skipped"}'];
    const res = await runAgent({
      callModel: async () => replies.shift(), tools, systemPrompt: "s", task: "t", maxSteps: 4,
      approve: async () => false,
    });
    assert.strictEqual(res.done, true);
    assert.ok(!fs.existsSync(path.join(root, "denied.txt")));
  });
  await test("step limit stops runaway loops", async () => {
    const res = await runAgent({
      callModel: async () => '{"tool":"list_dir","path":"."}', tools, systemPrompt: "s", task: "t", maxSteps: 3,
    });
    assert.strictEqual(res.done, false);
    assert.strictEqual(res.reason, "step limit reached");
    assert.strictEqual(res.steps, 3);
  });
  await test("tool errors are reported to the model, not thrown", async () => {
    const replies = ['{"tool":"read_file","path":"nope.txt"}', '{"tool":"done","summary":"ok"}'];
    const events = [];
    const res = await runAgent({
      callModel: async () => replies.shift(), tools, systemPrompt: "s", task: "t", maxSteps: 4,
      onEvent: (e) => events.push(e),
    });
    assert.strictEqual(res.done, true);
    const toolEvent = events.find((e) => e.type === "tool");
    assert.ok(/ERROR/.test(toolEvent.result));
  });
  await test("system prompt documents every tool", () => {
    const p = buildSystemPrompt(root);
    ["list_dir", "read_file", "write_file", "run_command", "done"].forEach((t) => assert.ok(p.includes(t)));
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log("\nResult: " + passed + " passed, " + failed + " failed");
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
})();
