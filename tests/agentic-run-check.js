const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const outFile = path.join(__dirname, "agentic-run-out.txt");
function write(s) { try { fs.appendFileSync(outFile, s + "\n"); } catch {} }
fs.writeFileSync(outFile, "");

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "iterai-ac-"));
fs.writeFileSync(path.join(ws, "a.txt"), "hello");

const replies = [
  '{"tool":"read_file","path":"a.txt"}',
  '{"tool":"write_file","path":"b.txt","content":"from agent"}',
  '{"tool":"done","summary":"wrote b.txt"}',
];

const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: replies.shift() || '{"tool":"done","summary":"end"}' } }] }));
  });
});

app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const win = new BrowserWindow({ width: 1400, height: 900, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await win.loadFile(path.join(__dirname, "..", "index.html"));
  await new Promise((r) => setTimeout(r, 1000));
  const res = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    const t = (n, f) => Promise.resolve().then(f)
      .then(() => out.push("ok   " + n)).catch((e) => out.push("FAIL " + n + ": " + e.message));

    await t("full agent run writes files and records history", async () => {
      localStorage.setItem("iterai.providers", JSON.stringify({ profiles: [{ id: "p_x", name: "Mock", baseUrl: "http://127.0.0.1:${port}/v1", apiKey: "", model: "mock", local: true }], activeId: "p_x" }));
      localStorage.setItem("iterai.agentPresets", JSON.stringify([{ id: "ac_x", name: "Mock agent", instructions: "test", defaultTask: "", workspace: ${JSON.stringify(ws)}, providerId: "p_x", maxSteps: 10, approval: false, tools: ["list_dir","read_file","write_file"] }]));
      localStorage.setItem("iterai.agentRuns", "[]");
      acCurrentId = null;
      acRenderList();
      acSelect("ac_x");
      document.getElementById("acTask").value = "write b.txt";
      document.getElementById("acApproval").checked = false;
      document.getElementById("acRun").click();
      const t0 = Date.now();
      while (document.getElementById("acRun").disabled && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
      const state = document.getElementById("acState").textContent;
      if (!/Done in/.test(state)) throw new Error("state: " + state);
      const runs = JSON.parse(localStorage.getItem("iterai.agentRuns"));
      if (runs.length !== 1) throw new Error("run not recorded");
      if (!runs[0].changed.includes("b.txt")) throw new Error("changed files missing");
      if (!document.querySelectorAll("#acSteps .ac-step").length) throw new Error("trace empty");
    });
    return out;
  })()`);
  write("AGENTIC-RUN-CHECK\n" + res.join("\n"));
  try {
    const b = fs.readFileSync(path.join(ws, "b.txt"), "utf8");
    write("b.txt content: " + b);
    if (b !== "from agent") write("FAIL workspace file mismatch");
  } catch (e) { write("FAIL b.txt missing: " + e.message); }
  srv.close();
  app.exit();
});
