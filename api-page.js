// API Server page (bridge UI + endpoint docs + tester)
const $ap = (id) => document.getElementById(id);

const ENDPOINTS = [
  ["GET", "/api/health", "Liveness probe"],
  ["GET", "/api/schema", "Machine-readable endpoint catalog"],
  ["GET", "/api/providers", "Provider profiles (keys never returned)"],
  ["GET", "/api/workflows", "List saved workflows"],
  ["POST", "/api/workflows/validate", "Validate a workflow graph"],
  ["POST", "/api/workflows/run", "Execute a saved workflow {workflowId, input}"],
  ["GET", "/api/runs", "List recent runs"],
  ["GET", "/api/runs/{id}", "Full run record + events"],
  ["GET", "/api/runs/{id}/events", "Run events only"],
  ["GET", "/api/projects", "List projects"],
  ["GET", "/api/memory", "Memory entries (?projectId=…)"],
  ["POST", "/api/memory", "Add memory entry {text, category, projectId} (marked unverified, source=api)"],
  ["POST", "/api/chat", "Chat completion via active provider {messages, model?, profileId?}"],
];

function initApiPage() {
  // Endpoint table
  const table = $ap("apiEndpoints");
  ENDPOINTS.forEach(([m, p, d]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><code>${m}</code></td><td><code>${p}</code></td><td class="dim">${d}</td>`;
    table.appendChild(tr);
  });

  // Load saved token
  (async () => {
    if (!window.iteraiBridge) return;
    const s = await window.iteraiBridge.getSettings();
    if (s?.token) $ap("apiToken").value = s.token;
    if (s?.port) $ap("apiBaseUrl").textContent = "http://127.0.0.1:" + s.port;
  })();

  // Token save
  $ap("apiTokenSave").addEventListener("click", async () => {
    if (!window.iteraiBridge) { $ap("apiHint").textContent = "Bridge unavailable (run inside Electron)."; return; }
    await window.iteraiBridge.setToken($ap("apiToken").value.trim());
    $ap("apiHint").textContent = "Token saved and applied live.";
  });

  // Status display
  function setStatus(s) {
    const el = $ap("apiRunState");
    if (!el) return;
    if (s.running) { el.className = "badge ok"; el.textContent = "running on port " + s.port; }
    else { el.className = "badge err"; el.textContent = "stopped" + (s.error ? " — " + s.error : ""); }
  }
  if (window.iteraiBridge) window.iteraiBridge.onApiStatus(setStatus);

  // Try-it buttons (call the real server over HTTP — proves external accessibility)
  async function tryCall(path) {
    const out = $ap("apiTryOut");
    out.textContent = "Calling " + path + " …";
    try {
      const token = $ap("apiToken").value.trim();
      const res = await fetch("http://127.0.0.1:3789" + path, {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      const data = await res.json();
      out.textContent = res.status + "\n" + JSON.stringify(data, null, 2).slice(0, 2000);
    } catch (e) {
      out.textContent = "Request failed: " + e.message;
    }
  }
  $ap("apiPing").addEventListener("click", () => tryCall("/api/health"));
  $ap("apiListWf").addEventListener("click", () => tryCall("/api/workflows"));
  $ap("apiListRuns").addEventListener("click", () => tryCall("/api/runs"));
}

/* ---------- Renderer → main snapshot sync ----------
 * Push a snapshot of all localStorage stores so the main process can serve
 * them over HTTP. Debounced; called on init and after visible changes.
 */
function pushSnapshot() {
  if (!window.iteraiBridge) return;
  const keys = ["iterai.providers", "iterai.convos", "iterai.workflows", "iterai.runs",
    "iterai.behaviorProfiles", "iterai.projects", "iterai.memory", "iterai.evalSuites", "iterai.modelInventory",
    "iterai.agentPresets", "iterai.agentRuns"];
  const snap = { activeProviderId: JSON.parse(localStorage.getItem("iterai.providers") || "{}").activeId || null };
  keys.forEach((k) => {
    try { snap[k.replace("iterai.", "")] = JSON.parse(localStorage.getItem(k) || "[]"); } catch {}
  });
  window.iteraiBridge.pushSnapshot(snap);
}

let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSnapshot, 400);
}

(function initPhaseApi() {
  initApiPage();
  pushSnapshot();
  // Push after any localStorage change we know about ( crude but effective: )
  window.addEventListener("focus", pushSnapshot);
  setInterval(pushSnapshot, 5000); // periodic sync while app runs
})();
