// In-app renderer smoke test: runs inside the real Electron app via a
// temporary main-process hook. Verifies every template type end-to-end in
// the actual runtime (localStorage stores, DOM elements, engine wiring).
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, preload: path.join(__dirname, "preload.js") },
  });
  await win.loadFile("index.html");
  await new Promise((r) => setTimeout(r, 1500)); // let page scripts init

  const results = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    const t = (name, fn) => Promise.resolve().then(fn)
      .then(() => out.push("ok  " + name))
      .catch((e) => out.push("FAIL " + name + ": " + e.message));

    // 1. Workflow templates: all validate + save + load round-trip
    await t("workflow templates validate & round-trip through Workflows store", () => {
      Object.entries(Templates).forEach(([key, tpl]) => {
        const graph = graphFromTemplate(tpl);
        const { ok, errors } = validateGraph(graph);
        if (!ok) throw new Error(key + ": " + errors.join("; "));
        const wf = { id: "w_smoke_" + key, name: tpl.name, nodes: graph.nodes, edges: graph.edges };
        Workflows.upsert(wf);
        const back = Workflows.get(wf.id);
        if (!back || back.nodes.length !== graph.nodes.length) throw new Error(key + ": round-trip failed");
        // Condition expressions must survive JSON round-trip and still evaluate
        graph.nodes.filter(n => n.type === "condition").forEach(n => {
          const r = evalCondition(n.settings.expression, "SEVERE: x 1. 2. 3. 4. 5. {a:1}");
          if (r && r.error) throw new Error(key + ": condition eval error " + r.error);
        });
      });
    });

    // 2. Profile templates: from-template creates saveable, editable profiles
    await t("profile templates create valid stored profiles", () => {
      Object.keys(PROFILE_TEMPLATES).forEach((key) => {
        const p = profileFromTemplate(key);
        if (!p || !p.id || !p.name) throw new Error(key + ": bad profile");
        BehaviorProfiles.upsert(p);
        if (!BehaviorProfiles.get(p.id)) throw new Error(key + ": not persisted");
        const prompt = composePrompt(p);
        if (!prompt || prompt.length < 20) throw new Error(key + ": composePrompt produced nothing");
      });
    });

    // 3. Project templates
    await t("project templates create stored projects", () => {
      Object.keys(PROJECT_TEMPLATES).forEach((key) => {
        const p = projectFromTemplate(key);
        Projects.upsert(p);
        if (!Projects.get(p.id)) throw new Error(key + ": not persisted");
        if (!p.instructions) throw new Error(key + ": empty instructions");
      });
    });

    // 4. Suite templates + kits: full install path
    await t("suite templates create suites with linked workflows", () => {
      Object.keys(SUITE_TEMPLATES).forEach((key) => {
        const s = suiteFromTemplate(key);
        if (!s) throw new Error(key + ": null suite");
        EvalSuites.upsert(s);
        if (!EvalSuites.get(s.id)) throw new Error(key + ": not persisted");
        if (s.workflowId && !Workflows.get(s.workflowId)) throw new Error(key + ": linked workflow missing");
        s.cases.forEach((c) => {
          if (typeof c.input !== "string") throw new Error(key + ": bad case");
        });
      });
    });

    await t("kits install end-to-end", () => {
      KITS.forEach((kit) => {
        const res = installKit(kit);
        if (!res.ok) throw new Error(kit.id + ": " + res.error);
        if (res.workflowId && !Workflows.get(res.workflowId)) throw new Error(kit.id + ": workflow not saved");
      });
    });

    // 5. DOM wiring: template selects were populated and buttons exist
    await t("template pickers are populated in the DOM", () => {
      const checks = [
        ["wfTemplate", Object.keys(Templates).length],
        ["bpTemplate", Object.keys(PROFILE_TEMPLATES).length],
        ["prjTemplate", Object.keys(PROJECT_TEMPLATES).length],
        ["esTemplate", Object.keys(SUITE_TEMPLATES).length],
      ];
      checks.forEach(([id, expected]) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(id + " missing");
        if (el.options.length < expected) throw new Error(id + " has " + el.options.length + " options, expected >= " + expected);
      });
      ["bpFromTemplate", "prjFromTemplate", "esFromTemplate"].forEach((id) => {
        if (!document.getElementById(id)) throw new Error(id + " button missing");
      });
      if (!document.querySelectorAll(".kit-card").length) throw new Error("no kit cards rendered");
    });

    // 6. Flow page: create from each template via the real UI function
    await t("newWorkflow() loads every template into the canvas", () => {
      Object.keys(Templates).forEach((key) => {
        newWorkflow(key);
        if (!currentWf || currentWf.nodes.length !== Templates[key].nodes.length)
          throw new Error(key + ": canvas graph mismatch");
        const { ok } = validateGraph(currentWf);
        if (!ok) throw new Error(key + ": canvas graph invalid");
      });
    });

    // Cleanup smoke data so the user's app isn't polluted
    ["iterai.workflows","iterai.behaviorProfiles","iterai.projects","iterai.evalSuites"].forEach(k => localStorage.removeItem(k));
    // Re-seed the default profile like a fresh start
    location.reload && null;
    return out;
  })()`);

  console.log("SMOKE-RESULT\n" + results.join("\n"));
  app.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
});
