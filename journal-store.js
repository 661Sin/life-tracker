// ---------- Journal data storage ----------
// Text (titles, thoughts, tags, songs) lives in localStorage like PnL and Life.
// Photos and audio files are far too big for localStorage (about 5 MB in
// total), so they go in IndexedDB: a database built into the browser that can
// hold large files. Entries only keep the id of their file ("media id").

const JOURNAL_STORAGE_KEY = "lifeTracker.journal.v1";

function journalEmptyData() {
  return {
    version: 1,
    // { id, kind: "link"|"photo", url?, link?: (JournalCalc.parseLink result), thumb?, thumbAspect?,
    //   photo?: { full, thumb (media ids), w, h }, title, thoughts, tags: [names],
    //   want: bool, price?, buyUrl?, got? (date), created, updated }
    items: [],
    tags: [], // tag names the user created (also kept when unused)
    // { id, week (Monday "YYYY-MM-DD"), source: "link"|"file", url?, link?, audio? (media id), audioName?,
    //   cover? (image address from the link), coverMedia? (media id), title, artist, note, created }
    songs: [],
  };
}

const JournalStore = {
  data: null,

  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(JOURNAL_STORAGE_KEY)); } catch (e) { saved = null; }
    this.data = this.normalise(saved);
  },

  normalise(d) {
    const base = journalEmptyData();
    if (!d || typeof d !== "object") return base;
    for (const key of Object.keys(base)) if (Array.isArray(base[key]) && !Array.isArray(d[key])) d[key] = base[key];
    for (const it of d.items) { if (!Array.isArray(it.tags)) it.tags = []; it.want = !!it.want; }
    d.version = 1;
    return d;
  },

  save() {
    try {
      localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(this.data));
      if (typeof Sync !== "undefined") Sync.changed("journal"); // cloud: save to the account in the background
      return true;
    } catch (e) {
      alert("Couldn't save your Journal in this browser (storage full?). Export a backup to be safe.");
      return false;
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

  // Media ids an entry points to (so they can be deleted / exported with it)
  mediaOf(entry) {
    if (!entry) return [];
    return [entry.photo && entry.photo.full, entry.photo && entry.photo.thumb, entry.audio, entry.coverMedia].filter(Boolean);
  },
  allMediaIds() {
    return new Set([...this.data.items, ...this.data.songs].flatMap((e) => this.mediaOf(e)));
  },
  textBytes() {
    try { return (localStorage.getItem(JOURNAL_STORAGE_KEY) || "").length * 2; } catch (e) { return 0; }
  },

  importData(d) {
    if (!d || typeof d !== "object") throw new Error("This file doesn't contain Journal data.");
    this.data = this.normalise(d);
    this.save();
  },
};

// ---------- Media (photos and audio in IndexedDB) ----------
// Records: { id, blob, type, size, created }. Media.url(id) gives an address
// an <img> or <audio> can use (cached, so each file is read once).
const Media = {
  DB: "lifeTracker.media",
  STORE: "media",
  _db: null,
  _urls: new Map(),

  open() {
    if (this._db) return this._db;
    this._db = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("This browser can't store photos or audio."));
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Couldn't open the photo storage."));
    });
    this._db.catch(() => { this._db = null; });
    return this._db;
  },
  // Runs fn(store) in one transaction; resolves with the request result
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(this.STORE, mode);
      const req = fn(t.objectStore(this.STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Storage is full."));
    });
  },

  // opts.fromCloud: a copy just downloaded from the account (don't upload it back)
  async put(blob, id = JournalStore.uid(), opts = {}) {
    await this.tx("readwrite", (s) => s.put({ id, blob, type: blob.type, size: blob.size, created: Date.now() }));
    this.askToKeep();
    if (!opts.fromCloud && typeof Sync !== "undefined") Sync.mediaAdded(id);
    return id;
  },
  // Missing on this device (e.g. added on the phone): fetched from the account when logged in
  async get(id) {
    const r = await this.tx("readonly", (s) => s.get(id));
    if (r) return r.blob;
    return typeof Sync !== "undefined" ? Sync.fetchMedia(id) : null;
  },
  async del(ids) {
    ids = [].concat(ids).filter(Boolean);
    if (!ids.length) return;
    if (typeof Sync !== "undefined") Sync.mediaRemoved(ids);
    for (const id of ids) { const u = this._urls.get(id); if (u) { this._urls.delete(id); u.then((x) => x && URL.revokeObjectURL(x)); } }
    await this.tx("readwrite", (s) => { ids.forEach((id) => s.delete(id)); return null; });
  },
  all() { return this.tx("readonly", (s) => s.getAll()); },
  async clear() {
    this._urls.forEach((u) => u.then((x) => x && URL.revokeObjectURL(x)));
    this._urls.clear();
    await this.tx("readwrite", (s) => s.clear());
  },
  // Address for an <img>/<audio> (null if the file is missing)
  url(id) {
    if (!id) return Promise.resolve(null);
    if (!this._urls.has(id)) {
      // A miss isn't remembered: the file may still arrive from the account
      this._urls.set(id, this.get(id).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null)
        .then((u) => { if (!u) this._urls.delete(id); return u; }));
    }
    return this._urls.get(id);
  },
  // Total size in bytes, split into photos / audio
  async sizes() {
    const out = { photos: 0, audio: 0, count: 0 };
    const rows = await this.all().catch(() => []);
    for (const r of rows) { out.count++; if (/^audio\//.test(r.type)) out.audio += r.size || 0; else out.photos += r.size || 0; }
    return out;
  },

  // Ask the browser not to clear these files when space runs low (once)
  askToKeep() {
    if (this._asked || !navigator.storage || !navigator.storage.persist) return;
    this._asked = true;
    navigator.storage.persist().catch(() => {});
  },

  // Blob ↔ text for backups
  toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  },
  async fromDataUrl(s) { return (await fetch(s)).blob(); },

  // Animated pictures are stored as they are (a canvas would flatten them to one frame).
  // Returns "gif" | "webp" | "png" for an animated file, else null. GIFs always count;
  // WebP / PNG are animated when their header has an "ANIM" / "acTL" block.
  ANIMATED_MAX: 20 * 1024 * 1024,
  async animatedKind(file) {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    if (type === "image/gif" || name.endsWith(".gif")) return "gif";
    const webp = type === "image/webp" || name.endsWith(".webp");
    const png = type === "image/png" || type === "image/apng" || /\.a?png$/.test(name);
    if (!webp && !png) return null;
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    const find = (s) => {
      const c = [...s].map((x) => x.charCodeAt(0));
      outer: for (let i = 0; i <= head.length - 4; i++) {
        for (let j = 0; j < 4; j++) if (head[i + j] !== c[j]) continue outer;
        return i;
      }
      return -1;
    };
    if (webp) return find("ANIM") >= 0 ? "webp" : null;
    const actl = find("acTL"), idat = find("IDAT");
    return actl >= 0 && (idat < 0 || actl < idat) ? "png" : null;
  },
  // Width / height of a picture file without changing it
  async imageSize(file) {
    const u = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
        img.onerror = () => reject(new Error("That file isn't a picture this browser can read."));
        img.src = u;
      });
    } finally { setTimeout(() => URL.revokeObjectURL(u), 0); }
  },

  // Shrinks a photo: max `max` px wide (and tall), JPEG. Returns { blob, w, h }.
  async resizeImage(file, max = 1600, quality = 0.8) {
    // An <img> reads the file (browsers turn phone photos the right way up for it)
    const tmp = URL.createObjectURL(file);
    const src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't a photo this browser can read."));
      img.src = tmp;
    }).finally(() => setTimeout(() => URL.revokeObjectURL(tmp), 0));
    const w0 = src.naturalWidth, h0 = src.naturalHeight;
    const scale = Math.min(1, max / w0, (max * 1.5) / h0);
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000"; // transparent PNGs get a dark background instead of black-on-nothing
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    // toBlob is the fast way; if it never answers (seen in some browsers), turn a data: address into a file
    const viaText = () => {
      const s = atob(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      const bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      return new Blob([bytes], { type: "image/jpeg" });
    };
    const blob = await Promise.race([
      new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]) || viaText();
    return { blob, w, h };
  },
};

// ---------- Link info (title / cover from the site) ----------
// Asks the site's public "oEmbed" address (a standard way sites describe a
// link: title, author, thumbnail). Falls back to noembed.com, a free service
// that does the same for sites which block direct requests. Resolves with
// { title, author, thumb, thumbW, thumbH } or null (offline, unknown site).
const LinkInfo = {
  _cache: new Map(),
  endpoint(link) {
    const u = encodeURIComponent(link.url);
    return {
      youtube: `https://www.youtube.com/oembed?format=json&url=${u}`,
      vimeo: `https://vimeo.com/api/oembed.json?url=${u}`,
      tiktok: `https://www.tiktok.com/oembed?url=${u}`,
      spotify: `https://open.spotify.com/oembed?url=${u}`,
      soundcloud: `https://soundcloud.com/oembed?format=json&url=${u}`,
    }[link.provider] || null;
  },
  async getJson(url, ms = 6000) {
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl && ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!r.ok) return null;
      const j = await r.json();
      return j && !j.error ? j : null;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  },
  fetch(link) {
    if (!link || link.provider === "web" || link.provider === "instagram") return Promise.resolve(null);
    if (!this._cache.has(link.url)) {
      this._cache.set(link.url, (async () => {
        const ep = this.endpoint(link);
        let j = ep ? await this.getJson(ep) : null;
        if (!j) j = await this.getJson(`https://noembed.com/embed?url=${encodeURIComponent(link.url)}`);
        if (!j) { this._cache.delete(link.url); return null; }
        return { title: j.title || "", author: j.author_name || "", thumb: j.thumbnail_url || "",
                 thumbW: Number(j.thumbnail_width) || 0, thumbH: Number(j.thumbnail_height) || 0 };
      })());
    }
    return this._cache.get(link.url);
  },
};
