const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const outFile = require("path").join(__dirname, "agentic-check-out.txt");
function write(s) { try { fs.appendFileSync(outFile, s + "\n"); } catch {} }
fs.writeFileSync(outFile, "");
process.on("uncaughtException", (e) => { write("UNCAUGHT " + e.stack); app.exit(1); });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.webContents.on("console-message", (e, level, msg) => { if (level >= 2) write("CONSOLE " + msg); });
  await win.loadFile(require("path").join(__dirname, "..", "index.html"));
  await new Promise((r) => setTimeout(r, 1200));
  const res = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    const t = (n, f) => Promise.resolve().then(f)
      .then(() => out.push("ok   " + n)).catch((e) => out.push("FAIL " + n + ": " + e.message));

    await t("nav item + page exist", () => {
      if (!document.querySelector('[data-page="agentic"]')) throw new Error("nav item missing");
      if (!document.getElementById("page-agentic")) throw new Error("page missing");
      ["acList","acNew","acTemplate","acRuns","acEditor","acWorkspace","acTask","acModel","acRun","acSteps","acConsole"].forEach((id) => {
        if (!document.getElementById(id)) throw new Error(id + " missing");
      });
    });
    await t("navigates and page becomes active", () => {
      navigate("agentic");
      if (!document.getElementById("page-agentic").classList.contains("active")) throw new Error("not active");
    });
    await t("template creates a persisted agent and renders editor", () => {
      document.getElementById("acTemplate").value = "bugfix";
      document.getElementById("acFromTemplate").click();
      const list = JSON.parse(localStorage.getItem("iterai.agentPresets"));
      if (!list.length) throw new Error("preset not saved");
      if (!document.getElementById("acEdName").value.includes("Bug")) throw new Error("editor not populated");
      if (!document.querySelectorAll("#acList .ac-item").length) throw new Error("list not rendered");
    });
    await t("editing + saving updates the stored preset", () => {
      document.getElementById("acEdName").value = "Named test agent";
      document.getElementById("acEdMaxSteps").value = "7";
      document.querySelector("#acEditor .ac-actions .primary").click();
      const list = JSON.parse(localStorage.getItem("iterai.agentPresets"));
      const p = list.find((x) => x.name === "Named test agent");
      if (!p) throw new Error("rename not saved");
      if (p.maxSteps !== 7) throw new Error("steps not saved: " + p.maxSteps);
    });
    await t("tool checkboxes restrict saved tools", () => {
      const boxes = [...document.querySelectorAll("#acEditor [data-ac-tool]")];
      const run = boxes.find((b) => b.value === "run_command");
      run.checked = false;
      document.querySelector("#acEditor .ac-actions .primary").click();
      const p = JSON.parse(localStorage.getItem("iterai.agentPresets")).find((x) => x.name === "Named test agent");
      if (p.tools.includes("run_command")) throw new Error("tool not removed");
    });
    await t("run history renders", () => {
      localStorage.setItem("iterai.agentRuns", JSON.stringify([{ id: "ar_1", presetName: "Named test agent", task: "demo", workspace: "C:/tmp", steps: 2, changed: ["a.js"], done: true, ended: Date.now() }]));
      acRenderRuns();
      if (!document.querySelectorAll("#acRuns .ac-run").length) throw new Error("run not rendered");
    });
    return out;
  })()`);
  write("AGENTIC-CHECK\n" + res.join("\n"));
  app.exit(res.some((r) => r.startsWith("FAIL")) ? 1 : 0);
});
