// ---------- Life data storage ----------
// Life data lives in its own localStorage entry, separate from PnL, so the
// two never get in each other's way. Only raw entries are stored; streaks,
// averages, progress and records are always worked out by life-calc.js.

const LIFE_STORAGE_KEY = "lifeTracker.life.v1";

function lifeEmptyData() {
  return {
    version: 1,
    // { id, name, emoji, schedule: {type:"daily"} | {type:"days", days:[0-6]} | {type:"weekly", times}, created, archived?, done: [dates] }
    habits: [],
    // { id, title, emoji, kind: "tasks"|"number", deadline?, created, start?, target?, unit?, updates: [{ id, date, value }], achieved? (date) }
    goals: [],
    // { id, title, due?, priority: "low"|"med"|"high", goalId?, standardId?, repeat?: "daily"|"weekly"|"monthly", done? (date), created, nextId? }
    tasks: [],
    // { id, code, title, subject, level (1-3), credits, due?, status }
    standards: [],
    // { id, date, type: "gym"|"run"|"sport"|"other", minutes, notes, exercises: [{ name, sets: [{ reps, kg }] }], created }
    workouts: [],
    bodyweight: [], // { id, date, kg }
    sleep: [],      // { id, date (the morning you woke up), bed: "HH:MM", wake: "HH:MM", quality: 1-5 }
    checkins: {},   // "Update my day" progress: { "YYYY-MM-DD": step reached } (removed when finished)
    // dayScore: colour thresholds (%) and which parts count, see LifeCalc.dayScore
    settings: { sleepTarget: 8, creditTargets: { 1: 80, 2: 60, 3: 60 }, dayScore: { ...LifeCalc.DAY_SCORE } },
  };
}

const LifeStore = {
  data: null,

  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LIFE_STORAGE_KEY)); } catch (e) { saved = null; }
    this.data = this.normalise(saved);
  },

  // Fill in anything missing (older version, partial backup)
  normalise(d) {
    const base = lifeEmptyData();
    if (!d || typeof d !== "object") return base;
    for (const key of Object.keys(base)) {
      if (Array.isArray(base[key]) && !Array.isArray(d[key])) d[key] = base[key];
    }
    d.settings = { ...base.settings, ...(d.settings || {}) };
    d.settings.creditTargets = { ...base.settings.creditTargets, ...(d.settings.creditTargets || {}) };
    d.settings.dayScore = { ...base.settings.dayScore, ...(d.settings.dayScore || {}) };
    if (!d.checkins || typeof d.checkins !== "object" || Array.isArray(d.checkins)) d.checkins = {};
    for (const h of d.habits) { if (!Array.isArray(h.done)) h.done = []; if (!h.schedule) h.schedule = { type: "daily" }; }
    for (const g of d.goals) if (!Array.isArray(g.updates)) g.updates = [];
    for (const w of d.workouts) if (!Array.isArray(w.exercises)) w.exercises = [];
    d.version = 1;
    return d;
  },

  save() {
    try {
      localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      alert("Couldn't save your data in this browser. Export a backup to be safe.");
    }
  },

  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  get(list, id) { return this.data[list].find((x) => x.id === id); },

  // Every change goes through here: tried on a copy, then saved.
  commit(change) {
    const draft = structuredClone(this.data);
    const error = change(draft);
    if (typeof error === "string") return error;
    this.data = draft;
    this.save();
    return null;
  },

  importData(d) {
    if (!d || typeof d !== "object") throw new Error("This file doesn't contain Life data.");
    this.data = this.normalise(d);
    this.save();
  },
};

// ---------- Backup (PnL + Life + Journal in one file) ----------
// File shape: { app: "lifeTracker", version: 3, exported, pnl, life, journal, media? }.
//   media (optional, photos / audio): [{ id, type, data ("data:..." text) }]
// Older files still import: version 2 (PnL + Life) leaves Journal untouched;
// PnL-only backups (just the PnL data object) replace PnL only. A backup
// without media keeps the photos / audio already in this browser.
const Backup = {
  hasJournal: () => typeof JournalStore !== "undefined" && !!JournalStore.data,

  async build(withMedia) {
    const out = { app: "lifeTracker", version: 3, exported: LifeCalc.today(), pnl: Store.data, life: LifeStore.data };
    if (this.hasJournal()) out.journal = JournalStore.data;
    if (withMedia && this.hasJournal()) {
      const keep = JournalStore.allMediaIds();
      const rows = (await Media.all()).filter((r) => keep.has(r.id));
      out.media = [];
      for (const r of rows) out.media.push({ id: r.id, type: r.type, data: await Media.toDataUrl(r.blob) });
    }
    return JSON.stringify(out, null, withMedia ? 0 : 2);
  },
  exportText() { return JSON.stringify({ app: "lifeTracker", version: 3, exported: LifeCalc.today(), pnl: Store.data, life: LifeStore.data, journal: this.hasJournal() ? JournalStore.data : undefined }, null, 2); },

  fileName: (withMedia) => `life-tracker-backup-${LifeCalc.today()}${withMedia ? "-with-media" : ""}.json`,

  // PC: a normal download
  save(text, withMedia) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = this.fileName(withMedia);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  // Phones (iPhone Safari especially): files go through the share sheet
  // (Save to Files, AirDrop, Mail, Messages…), the reliable way to save one there.
  wantsShare() {
    if (!navigator.canShare || !window.matchMedia("(pointer: coarse)").matches) return false;
    try { return navigator.canShare({ files: [new File(["{}"], "test.json", { type: "application/json" })] }); } catch (e) { return false; }
  },
  // The share sheet only opens straight from a tap, so once the file is ready the
  // sheet shows a "Save or send backup" button to tap.
  offerFile(text, withMedia) {
    const file = new File([text], this.fileName(withMedia), { type: "application/json" });
    const body = openModal("Export backup", `
      <div class="bk-ready">
        <div class="stat-label">${withMedia ? "Backup with photos &amp; audio" : "Backup"}</div>
        <div class="bk-size">${JournalCalc.bytes(file.size)}</div>
        <button type="button" class="btn btn-primary bk-share">Save or send backup</button>
      </div>`);
    body.querySelector(".bk-share").addEventListener("click", () => {
      navigator.share({ files: [file], title: "Life Tracker backup" })
        .then(() => closeModal())
        .catch((err) => { if (err && err.name === "AbortError") return; this.save(text, withMedia); closeModal(); });
    });
  },
  deliver(text, withMedia) { if (this.wantsShare()) this.offerFile(text, withMedia); else { this.save(text, withMedia); closeModal(); } },

  // Export: when there are Journal photos / audio, asks whether to include them
  async download() {
    let sizes = { photos: 0, audio: 0, count: 0 };
    if (this.hasJournal() && JournalStore.allMediaIds().size) sizes = await Media.sizes().catch(() => sizes);
    if (!sizes.count) return this.deliver(await this.build(false), false);
    const B = JournalCalc.bytes;
    const body = openModal("Export backup", `
      <div class="jr-choices">
        <button type="button" class="jr-choice" data-bk="media"><b>With photos &amp; audio</b><span>${B((sizes.photos + sizes.audio) * 1.34)}</span></button>
        <button type="button" class="jr-choice" data-bk="text"><b>Text only</b><span>${B(this.exportText().length)}</span></button>
      </div>`);
    body.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-bk]");
      if (!b) return;
      const withMedia = b.dataset.bk === "media";
      body.querySelectorAll("[data-bk]").forEach((x) => { x.disabled = true; });
      b.querySelector("span").textContent = "Preparing…";
      try { this.deliver(await this.build(withMedia), withMedia); }
      catch (err) { alert("Couldn't export: " + err.message); closeModal(); }
    });
  },

  // Returns a short description of what was restored
  async importText(text) {
    const d = JSON.parse(text); // throws if the file isn't valid JSON
    if (d && d.app === "lifeTracker" && (d.pnl || d.life || d.journal)) {
      const parts = [];
      if (d.pnl) { Store.importText(JSON.stringify(d.pnl)); parts.push("PnL"); }
      if (d.life) { LifeStore.importData(d.life); parts.push("Life"); }
      if (d.journal && this.hasJournal()) { JournalStore.importData(d.journal); parts.push("Journal"); }
      if (Array.isArray(d.media) && d.media.length && this.hasJournal()) {
        await Media.clear();
        for (const m of d.media) await Media.put(await Media.fromDataUrl(m.data), m.id);
        parts.push(`${d.media.length} photo${d.media.length === 1 ? "" : "s"} / audio`);
      }
      return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
    }
    Store.importText(text); // old PnL-only backup (throws if it isn't one)
    return "PnL";
  },

  // Asks for a file, confirms, imports, then tells every section to redraw
  chooseAndImport() {
    // Kept in the page while picking (iPhone Safari can ignore a file box that isn't);
    // accepts .json however the phone labels it
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json,text/plain";
    input.hidden = true;
    input.setAttribute("data-native", "");
    document.body.appendChild(input);
    setTimeout(() => input.remove(), 10 * 60 * 1000);
    input.addEventListener("change", () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      if (!confirm("Replace your current data with this backup? Export a backup of the current data first if you might need it.")) return;
      file.text().then((text) => this.importText(text)).then((what) => {
        document.dispatchEvent(new CustomEvent("lifetracker:imported"));
        alert(`Backup imported (${what}).`);
      }).catch((err) => alert("Couldn't import that file: " + err.message));
    });
    input.click();
  },
};
