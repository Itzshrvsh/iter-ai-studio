// Provider profiles + conversation store (Phase 2)
const Store = {
  key: "iterai.providers",
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || { profiles: [], activeId: null }; }
    catch { return { profiles: [], activeId: null }; }
  },
  save(state) { localStorage.setItem(this.key, JSON.stringify(state)); },
  add(profile) {
    const s = this.load();
    profile.id = "p_" + Date.now();
    s.profiles.push(profile);
    if (!s.activeId) s.activeId = profile.id;
    this.save(s);
    return profile;
  },
  update(profile) {
    const s = this.load();
    const i = s.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) s.profiles[i] = profile;
    this.save(s);
  },
  remove(id) {
    const s = this.load();
    s.profiles = s.profiles.filter((p) => p.id !== id);
    if (s.activeId === id) s.activeId = s.profiles[0]?.id || null;
    this.save(s);
    return s.activeId;
  },
  setActive(id) { const s = this.load(); s.activeId = id; this.save(s); },
  active() {
    const s = this.load();
    return s.profiles.find((p) => p.id === s.activeId) || null;
  },
  all() { return this.load().profiles; },
};

const Convos = {
  key: "iterai.convos",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  save(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  upsert(c) {
    const list = this.load();
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = c; else list.unshift(c);
    this.save(list);
  },
  get(id) { return this.load().find((c) => c.id === id) || null; },
  remove(id) { this.save(this.load().filter((c) => c.id !== id)); },
};
