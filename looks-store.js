// ---------- Looksmax data storage ----------
// Looksmax data lives in its own localStorage entry (and its own row in the
// account), separate from PnL, Life and Journal. Only raw entries are stored;
// streaks, consistency and progress are worked out by looks-calc.js.
// Progress photos are files in IndexedDB (Media, in journal-store.js), the same
// place as Journal photos; entries only keep their ids.

const LOOKS_STORAGE_KEY = "lifeTracker.looksmax.v1";

function looksEmptyData() {
  return {
    version: 1,
    // { id, name, emoji, created (date), start? (date), target? (date), finished? (date),
    //   schedule: {type:"daily"} | {type:"days", days:[0-6, 0=Sun]} | {type:"weekly", times},
    //   done: [dates worked on it],
    //   didActions: { "YYYY-MM-DD": [action ids ticked that day] },
    //   how: "free text: how to do it",
    //   actions: [{ id, text }]              what I'm doing, in my order
    //   log: [{ id, date, text, created }]   dated updates
    //   photos: [{ id, date, note, full, thumb (media ids), w, h, animated?, created }]
    //   progress: [{ date, value 0-100 }]    one per day }
    items: [],
  };
}

const LooksStore = {
  data: null,

  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LOOKS_STORAGE_KEY)); } catch (e) { saved = null; }
    this.data = this.normalise(saved);
  },

  // Fill in anything missing (older version, partial backup)
  normalise(d) {
    const base = looksEmptyData();
    if (!d || typeof d !== "object") return base;
    if (!Array.isArray(d.items)) d.items = [];
    for (const it of d.items) {
      for (const k of ["done", "actions", "log", "photos", "progress"]) if (!Array.isArray(it[k])) it[k] = [];
      if (!it.didActions || typeof it.didActions !== "object" || Array.isArray(it.didActions)) it.didActions = {};
      if (!it.schedule) it.schedule = { type: "daily" };
      if (typeof it.how !== "string") it.how = "";
    }
    d.version = 1;
    return d;
  },

  save() {
    try {
      localStorage.setItem(LOOKS_STORAGE_KEY, JSON.stringify(this.data));
      if (typeof Sync !== "undefined") Sync.changed("looksmax"); // cloud: save to the account in the background
    } catch (e) {
      alert("Couldn't save your Looksmax data in this browser (storage full?). Export a backup to be safe.");
    }
    // Life (Today, day score) and the Looksmax page both show this data: tell them to redraw
    document.dispatchEvent(new CustomEvent("lifetracker:looks"));
  },

  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  get(id) { return this.data.items.find((x) => x.id === id); },

  // Every change goes through here: tried on a copy, then saved.
  commit(change) {
    const draft = structuredClone(this.data);
    const error = change(draft);
    if (typeof error === "string") return error;
    this.data = draft;
    this.save();
    return null;
  },

  // Every photo file the data points to (kept when exporting a backup)
  allMediaIds() { return new Set(this.data.items.flatMap((it) => LooksCalc.mediaOf(it))); },

  importData(d) {
    if (!d || typeof d !== "object") throw new Error("This file doesn't contain Looksmax data.");
    this.data = this.normalise(d);
    this.save();
  },
};

LooksStore.load(); // straight away: Life (loaded next) counts these in the day score
