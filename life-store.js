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
    settings: { sleepTarget: 8, creditTargets: { 1: 80, 2: 60, 3: 60 } },
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

// ---------- Backup (PnL + Life in one file) ----------
// File shape: { app: "lifeTracker", version: 2, exported, pnl: {...}, life: {...} }.
// Older PnL-only backups (just the PnL data object) still import: they replace
// PnL and leave Life untouched.
const Backup = {
  exportText() {
    return JSON.stringify({ app: "lifeTracker", version: 2, exported: LifeCalc.today(), pnl: Store.data, life: LifeStore.data }, null, 2);
  },

  download() {
    const blob = new Blob([this.exportText()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `life-tracker-backup-${LifeCalc.today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  // Returns a short description of what was restored
  importText(text) {
    const d = JSON.parse(text); // throws if the file isn't valid JSON
    if (d && d.app === "lifeTracker" && (d.pnl || d.life)) {
      if (d.pnl) Store.importText(JSON.stringify(d.pnl));
      if (d.life) LifeStore.importData(d.life);
      return d.pnl && d.life ? "PnL and Life" : d.pnl ? "PnL" : "Life";
    }
    Store.importText(text); // old PnL-only backup (throws if it isn't one)
    return "PnL";
  },

  // Asks for a file, confirms, imports, then tells every section to redraw
  chooseAndImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      if (!confirm("Replace your current data with this backup? Export a backup of the current data first if you might need it.")) return;
      file.text().then((text) => {
        try {
          const what = this.importText(text);
          document.dispatchEvent(new CustomEvent("lifetracker:imported"));
          alert(`Backup imported (${what}).`);
        } catch (err) {
          alert("Couldn't import that file: " + err.message);
        }
      });
    });
    input.click();
  },
};
