// Chat page logic — Phase 2: streaming, cancel, provider profiles, conversations, context inspector
// Note: `$` helper is declared in app.js and shared by all page scripts.
const log = $("log"), input = $("input");

let history = [];          // messages of the active conversation
let activeConvoId = null;
let currentController = null;  // AbortController for the in-flight request

/* ---------- Local server discovery (LM Studio, Ollama, llama.cpp, …) ---------- */
const LOCAL_PORTS = [
  { port: 1234, kind: "LM Studio" },
  { port: 11434, kind: "Ollama" },
  { port: 8080, kind: "llama.cpp" },
  { port: 8000, kind: "vLLM / TGI" },
  { port: 5000, kind: "Text-gen / Oobabooga" },
  { port: 1337, kind: "Local server" },
  { port: 4891, kind: "Jan" },
];

// Probe loopback ports for OpenAI-compatible /v1/models endpoints.
// Returns [{ port, kind, baseUrl, models: [ids] }] — never throws.
// Note: bare AbortSignal.timeout without .timeout() — pattern works in both
// the Electron renderer and plain Node.
async function scanLocalProviders() {
  const found = [];
  const probe = async ({ port, kind }) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch("http://127.0.0.1:" + port + "/v1/models", { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return;
      const data = await res.json();
      // Skip embedding-only models: they can't run chat completions
      const models = (data.data || []).map((m) => m.id).filter((id) => id && !/embed/i.test(id));
      if (models.length) found.push({ port, kind, baseUrl: "http://127.0.0.1:" + port + "/v1", models });
    } catch { /* nothing listening — normal */ }
  };
  await Promise.all(LOCAL_PORTS.map(probe));
  return found;
}

async function runScan() {
  const btn = $("provScan");
  btn.disabled = true;
  $("dockStatus").textContent = "Scanning local ports for model servers…";
  const found = await scanLocalProviders();
  const added = [];
  const existing = [];
  for (const srv of found) {
    if (Store.all().some((p) => p.baseUrl === srv.baseUrl)) { existing.push(srv); continue; }
    const p = Store.add({
      name: srv.kind + " (" + srv.port + ")",
      baseUrl: srv.baseUrl,
      apiKey: "",
      model: srv.models[0],
      local: true,
    });
    added.push(p.name + " → " + srv.models[0] + (srv.models.length > 1 ? " (+" + (srv.models.length - 1) + " more models)" : ""));
  }
  btn.disabled = false;
  refreshProviderSelect();
  if (added.length) {
    $("dockStatus").textContent = "Found " + found.length + " local server(s). Added: " + added.join("; ");
  } else if (existing.length) {
    $("dockStatus").textContent = "Found " + existing.length + " local server(s) — already in your provider list.";
  } else {
    $("dockStatus").textContent = "No local model servers found (tried ports 1234, 11434, 8080, 8000, 5000, 1337, 4891).";
  }
}

$("provScan").addEventListener("click", () => runScan().catch((e) => {
  $("provScan").disabled = false;
  $("dockStatus").textContent = "Scan failed: " + e.message;
}));

/* ---------- Provider UI ---------- */
function refreshProviderSelect() {
  const sel = $("provSelect");
  const active = Store.active();
  sel.innerHTML = "";
  Store.all().forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = (p.local ? "◉ " : "☁ ") + p.name + " — " + p.model;
    if (active && p.id === active.id) o.selected = true;
    sel.appendChild(o);
  });
  if (!Store.all().length) {
    const o = document.createElement("option");
    o.textContent = "No provider configured — click + Add";
    o.value = "";
    sel.appendChild(o);
  }
  updateCtxHeader();
}

function openProviderDlg(existing) {
  $("provName").value = existing?.name || "";
  $("provUrl").value = existing?.baseUrl || "";
  $("provKey").value = existing?.apiKey || "";
  $("provModel").value = existing?.model || "";
  $("provLocal").checked = existing ? existing.local : true;
  $("providerDlg").dataset.editId = existing?.id || "";
  $("providerDlg").showModal();
}

$("provNew").addEventListener("click", () => openProviderDlg(null));
$("provEdit").addEventListener("click", () => {
  const p = Store.active();
  if (p) openProviderDlg(p);
});
$("provDel").addEventListener("click", () => {
  const p = Store.active();
  if (p && confirm("Delete provider profile \"" + p.name + "\"?")) {
    Store.remove(p.id);
    refreshProviderSelect();
  }
});
$("provCancel").addEventListener("click", () => $("providerDlg").close());
$("providerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const editId = $("providerDlg").dataset.editId;
  const profile = {
    name: $("provName").value.trim(),
    baseUrl: $("provUrl").value.trim().replace(/\/$/, ""),
    apiKey: $("provKey").value,
    model: $("provModel").value.trim(),
    local: $("provLocal").checked,
  };
  if (editId) {
    profile.id = editId;
    Store.update(profile);
  } else {
    Store.add(profile);
  }
  $("providerDlg").close();
  refreshProviderSelect();
});
$("provSelect").addEventListener("change", () => {
  Store.setActive($("provSelect").value);
  updateCtxHeader();
});

function activeProvider() { return Store.active(); }

/* ---------- Context inspector ---------- */
function updateCtxHeader() {
  const p = activeProvider();
  $("ctxModel").textContent = p ? p.name + " → " + p.model + "\n" + p.baseUrl : "—";
  const sys = $("sysPrompt").value.trim();
  $("ctxSys").textContent = sys || "(none)";
  $("ctxCount").textContent = history.length + " messages";
  $("ctxChars").textContent = JSON.stringify(messagesForRequest()).length + " chars";
}

/* ---------- Conversations ---------- */
function newConvo() {
  activeConvoId = "c_" + Date.now();
  history = [];
  log.innerHTML = "";
  persistConvo();
  refreshConvoList();
  updateCtxHeader();
  $("dockStatus").textContent = "New conversation";
}

function persistConvo() {
  if (!activeConvoId) return;
  const first = history.find((m) => m.role === "user");
  Convos.upsert({
    id: activeConvoId,
    title: first ? first.content.slice(0, 40) : "New chat",
    updated: Date.now(),
    systemPrompt: $("sysPrompt").value.trim(),
    messages: history,
  });
}

function refreshConvoList(filter) {
  const list = Convos.load().filter((c) =>
    !filter || c.title.toLowerCase().includes(filter.toLowerCase()));
  const el = $("convoList");
  el.innerHTML = "";
  list.forEach((c) => {
    const row = document.createElement("div");
    row.className = "convo-item" + (c.id === activeConvoId ? " active" : "");
    const t = document.createElement("span");
    t.className = "title";
    t.textContent = c.title;
    t.addEventListener("click", () => loadConvo(c.id));
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Delete conversation";
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      Convos.remove(c.id);
      if (c.id === activeConvoId) { activeConvoId = null; history = []; log.innerHTML = ""; }
      refreshConvoList($("convoSearch").value);
    });
    row.append(t, del);
    el.appendChild(row);
  });
}

function loadConvo(id) {
  const c = Convos.get(id);
  if (!c) return;
  activeConvoId = id;
  history = c.messages || [];
  log.innerHTML = "";
  history.forEach((m) => addMsg(m.content, m.role === "user" ? "user" : "bot"));
  if (c.systemPrompt) $("sysPrompt").value = c.systemPrompt;
  refreshConvoList($("convoSearch").value);
  updateCtxHeader();
}

$("newChatBtn").addEventListener("click", newConvo);
$("convoSearch").addEventListener("input", (e) => refreshConvoList(e.target.value));

/* ---------- Messages / rendering ---------- */
function addMsg(text, cls) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function messagesForRequest() {
  const sys = $("sysPrompt").value.trim();
  return sys ? [{ role: "system", content: sys }, ...history] : [...history];
}

/* ---------- Send (streaming + cancel) ---------- */
async function send(retryPayload) {
  if (currentController) return; // one request at a time
  const p = activeProvider();
  if (!p) { addMsg("No provider configured. Click “+ Add” to create one.", "err"); return; }

  let messages;
  if (retryPayload) {
    messages = retryPayload; // regenerate: reuse existing history, drop last assistant turn
  } else {
    const text = input.value.trim();
    if (!text) return;
    addMsg(text, "user");
    history.push({ role: "user", content: text });
    input.value = "";
    messages = messagesForRequest();
  }

  if (!activeConvoId) activeConvoId = "c_" + Date.now();
  persistConvo();
  refreshConvoList($("convoSearch").value);

  const botDiv = addMsg("", "bot");
  botDiv.textContent = "";
  setBusy(true);
  $("dockStatus").textContent = "Streaming…";

  currentController = new AbortController();
  const started = performance.now();
  let usage = null;
  let gotAny = false;
  let reply = "";

  try {
    const res = await fetch(p.baseUrl + "/chat/completions", {
      method: "POST",
      signal: currentController.signal,
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { Authorization: "Bearer " + p.apiKey } : {}),
      },
      body: JSON.stringify({ model: p.model, messages, stream: true, stream_options: { include_usage: true } }),
    });
    if (!res.ok) throw new Error(res.status + " " + (await res.text()));

    // Redacted request view
    $("ctxRequest").textContent = JSON.stringify(
      { url: p.baseUrl + "/chat/completions", model: p.model, messages },
      null, 2);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (data === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(data); } catch { continue; }
        if (evt.usage) usage = evt.usage;
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          gotAny = true;
          reply += delta;
          botDiv.textContent = reply;
          log.scrollTop = log.scrollHeight;
        }
      }
    }

    if (gotAny) botDiv.dataset.partial = "1";

    if (!gotAny && !usage) {
      // Provider may not have streamed anything; fail with a clear message.
      throw new Error("Stream ended with no content. Try a provider that supports streaming, or non-streaming mode later.");
    }

    botDiv.className = "msg bot";
    history.push({ role: "assistant", content: reply });
    persistConvo();

    setConnectionStatus(true, p.baseUrl);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const usageText = usage
      ? "in " + usage.prompt_tokens + ", out " + usage.completion_tokens + " (provider-reported)"
      : "not reported by provider (estimate unavailable by design)";
    $("dockTokens").textContent = "tokens: " + usageText;
    $("ctxUsage").textContent = usage ? JSON.stringify(usage, null, 2) : "not reported";
    $("dockStatus").textContent = "Done in " + secs + "s";
  } catch (err) {
    if (err.name === "AbortError") {
      botDiv.className = "msg err";
      botDiv.textContent = "⏹ Generation cancelled." + (reply ? "\n(partial reply kept below)" : "");
      // Preserve any partial reply as an assistant message
      if (reply) {
        history.push({ role: "assistant", content: reply });
        addMsg(reply, "bot");
      }
      $("dockStatus").textContent = "Cancelled";
    } else {
      botDiv.className = "msg err";
      botDiv.textContent = "Error: " + err.message;
      setConnectionStatus(false, "Last request failed");
      $("dockStatus").textContent = "Request failed";
    }
  } finally {
    currentController = null;
    setBusy(false);
    persistConvo();
    updateCtxHeader();
  }
}

function setBusy(b) {
  $("sendBtn").disabled = b;
  $("stopBtn").disabled = !b;
  $("retryBtn").disabled = b || history.length < 2;
  input.disabled = b;
}

$("sendBtn").addEventListener("click", () => send());
$("stopBtn").addEventListener("click", () => currentController?.abort());
$("clearBtn").addEventListener("click", () => {
  history = [];
  log.innerHTML = "";
  persistConvo();
  updateCtxHeader();
  $("dockStatus").textContent = "Cleared";
});
$("retryBtn").addEventListener("click", () => {
  // Drop trailing assistant message(s) and regenerate
  while (history.length && history[history.length - 1].role === "assistant") history.pop();
  if (history.length) send(messagesForRequest());
  updateCtxHeader();
});

$("sysPrompt").addEventListener("input", () => { persistConvo(); updateCtxHeader(); });

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

/* ---------- Context inspector toggle ---------- */
$("ctxToggle").addEventListener("click", () => {
  const pane = $("ctxPane");
  const collapsed = pane.classList.toggle("collapsed");
  $("ctxToggle").textContent = collapsed ? "◂" : "Hide ▸";
});

/* ---------- Init ---------- */
refreshProviderSelect();
refreshConvoList();
if (Convos.load().length) {
  loadConvo(Convos.load()[0].id);
} else {
  newConvo();
}
updateCtxHeader();
