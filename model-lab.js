// Model Lab — inventory, capability probing, role routing (Phase 7)
const $ml = (id) => document.getElementById(id);

// Model inventory entry: { id, providerId, modelId, notes, role, capabilities: {...}, probe: {...} }
const ModelInventory = {
  key: "iterai.modelInventory",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  saveAll(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  upsert(m) {
    const list = this.load();
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list[i] = m; else list.push(m);
    this.saveAll(list);
  },
  remove(id) { this.saveAll(this.load().filter((m) => m.id !== id)); },
};

const ROLES = ["Planner", "Coder", "Summarizer", "Critic", "Judge", "Fast classifier"];

let probeAbort = null;

/* ---------- Inventory rendering ---------- */
function refreshLab() {
  const wrap = $ml("labList");
  wrap.innerHTML = "";
  const providers = Store.all();
  const inv = ModelInventory.load();

  if (!providers.length) {
    wrap.innerHTML = "<p class='dim'>No providers configured. Add one on the Chat page first.</p>";
    return;
  }

  providers.forEach((p) => {
    const card = document.createElement("div");
    card.className = "lab-card";
    const entry = inv.find((m) => m.providerId === p.id) || null;
    card.innerHTML =
      `<div class="lab-card-head">
         <strong>${escapeHtml(p.name)}</strong>
         <span class="dim">${escapeHtml(p.baseUrl)}</span>
       </div>
       <div class="lab-row"><span>Model ID:</span><code>${escapeHtml(p.model)}</code></div>
       <div class="lab-row"><span>Endpoint type:</span><span>${p.local ? "local" : "remote"}</span></div>
       <div class="lab-row"><span>Last connection:</span><span id="labConn_${p.id}">${entry?.lastOk ? new Date(entry.lastOk).toLocaleString() : "not tested"}</span></div>`;
    const btnRow = document.createElement("div");
    btnRow.className = "lab-btnrow";

    const probe = document.createElement("button");
    probe.textContent = "Probe connection";
    probe.addEventListener("click", () => probeProvider(p, card));
    btnRow.appendChild(probe);

    const listModels = document.createElement("button");
    listModels.textContent = "List models";
    listModels.addEventListener("click", () => listModelsFor(p, card));
    btnRow.appendChild(listModels);

    // Local servers: sync the active chat model from the server's loaded/current models
    if (/^http:\/\/127\.0\.0\.1/.test(p.baseUrl)) {
      const syncModel = document.createElement("button");
      syncModel.textContent = "Sync active model";
      syncModel.title = "Set this provider's chat model to what the local server reports";
      syncModel.addEventListener("click", async () => {
        syncModel.disabled = true;
        try {
          const res = await fetch(p.baseUrl + "/models");
          if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 100));
          const data = await res.json();
          const ids = (data.data || []).map((m) => m.id).filter((id) => id && !/embed/i.test(id));
          if (!ids.length) throw new Error("no chat models reported");
          const m = entryFor(p.id);
          m.localModels = ids;
          ModelInventory.upsert(m);
          const cur = Store.active();
          if (cur && cur.id === p.id && !ids.includes(cur.model)) {
            cur.model = ids[0];
            Store.update(cur);
            refreshLab();
            if (window.__refreshProfileSelect) window.__refreshProfileSelect();
          }
          refreshLab();
        } catch (err) {
          const out = card.querySelector(".lab-probeout");
          out.textContent = "Sync failed: " + err.message;
        } finally { syncModel.disabled = false; }
      });
      btnRow.appendChild(syncModel);
    }

    card.appendChild(btnRow);

    // Role assignment
    const roleSel = document.createElement("select");
    const none = document.createElement("option");
    none.value = ""; none.textContent = "Role: none";
    roleSel.appendChild(none);
    ROLES.forEach((r) => {
      const o = document.createElement("option");
      o.value = r; o.textContent = "Role: " + r;
      if (entry?.role === r) o.selected = true;
      roleSel.appendChild(o);
    });
    roleSel.addEventListener("change", () => {
      const m = entryFor(p.id);
      m.role = roleSel.value;
      ModelInventory.upsert(m);
    });
    card.appendChild(roleSel);

    // Notes
    const notes = document.createElement("textarea");
    notes.placeholder = "User notes (context limits observed, quirks…)";
    notes.value = entry?.notes || "";
    notes.addEventListener("input", () => { const m = entryFor(p.id); m.notes = notes.value; ModelInventory.upsert(m); });
    card.appendChild(notes);

    // Probe results area
    const out = document.createElement("div");
    out.className = "lab-probeout pre";
    if (entry?.probe) out.textContent = JSON.stringify(entry.probe, null, 2);
    card.appendChild(out);

    wrap.appendChild(card);
  });
}

function entryFor(providerId) {
  const inv = ModelInventory.load();
  let m = inv.find((x) => x.providerId === providerId);
  if (!m) {
    m = { id: "mi_" + providerId, providerId, role: "", notes: "", probe: null, lastOk: null };
    ModelInventory.upsert(m);
  }
  return m;
}

/* ---------- Probing ---------- */
async function probeProvider(p, card) {
  const out = card.querySelector(".lab-probeout");
  out.textContent = "Probing…";
  const m = entryFor(p.id);
  const t0 = performance.now();
  try {
    const res = await fetch(p.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: "Bearer " + p.apiKey } : {}) },
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 10,
      }),
    });
    if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const ms = Math.round(performance.now() - t0);
    const usage = data.usage || null;
    m.probe = {
      ok: true,
      latencyMs: ms,
      reply: (data.choices?.[0]?.message?.content || "").slice(0, 100),
      usageReported: !!usage,
      tokensPerSec: usage && usage.completion_tokens ? (usage.completion_tokens / (ms / 1000)).toFixed(1) : null,
      testedAt: Date.now(),
    };
    m.lastOk = Date.now();
    ModelInventory.upsert(m);
    out.textContent = JSON.stringify(m.probe, null, 2);
    refreshLab();
  } catch (err) {
    m.probe = { ok: false, error: err.message, testedAt: Date.now() };
    ModelInventory.upsert(m);
    out.textContent = "Probe failed: " + err.message;
  }
}

async function listModelsFor(p, card) {
  const out = card.querySelector(".lab-probeout");
  out.textContent = "Fetching model list…";
  try {
    const res = await fetch(p.baseUrl + "/models", {
      headers: p.apiKey ? { Authorization: "Bearer " + p.apiKey } : {},
    });
    if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id);
    out.textContent = ids.length ? ids.join("\n") : "(no models listed by endpoint)";
  } catch (err) {
    out.textContent = "Model list unavailable: " + err.message + "\n(Not all local endpoints implement /models.)";
  }
}

/* ---------- Routing helper used by engine (Phase 5 integration point) ---------- */
// Resolve model override for a role; falls back to active provider's model.
window.modelForRole = function (role) {
  if (!role) return null;
  const inv = ModelInventory.load();
  const found = inv.find((m) => m.role === role);
  if (!found) return null;
  const p = Store.all().find((x) => x.id === found.providerId);
  return p ? { provider: p, model: p.model } : null;
};

/* ---------- Init ---------- */
(function initLab() {
  refreshLab();
})();
