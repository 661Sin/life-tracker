// ---------- Accounts and cloud sync (Supabase) ----------
// The app stays "offline-first": every section still lives in localStorage
// (and photos / audio in IndexedDB) so it opens instantly and works with no
// internet. This file keeps that local copy in step with the account:
//   - after each change: saves the section to the cloud in the background
//   - on open, when the app comes back to the front and when back online: pulls newer data
//   - same section changed on two devices: the newest change wins, the other
//     version is kept in "Earlier versions" (account menu) so nothing is lost
// Cloud table: user_data (user_id, section, data, changed_at, updated_at, device),
// photos / audio: Storage bucket "media", folder per user. See supabase/schema.sql.
//
// Local bookkeeping (localStorage "lifeTracker.sync"):
//   { owner: user id this device's data belongs to,
//     sections: { pnl|life|journal: { rev: cloud updated_at last seen, hash: data last in step, changedAt } },
//     up: [media ids to upload], del: [media ids to delete] }
// A section is "dirty" (needs uploading) when its data no longer matches `hash`.

const Sync = (function () {
  const OFF = { enabled: false, changed() {}, mediaAdded() {}, mediaRemoved() {}, fetchMedia: async () => null };
  if (typeof CLOUD_CONFIG === "undefined" || !window.supabase || !window.supabase.createClient) {
    document.documentElement.classList.remove("signed-out"); // no cloud (e.g. first visit offline): local only
    return OFF;
  }

  const sb = window.supabase.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: CLOUD_CONFIG.authKey },
  });

  const SECTIONS = {
    pnl: { label: "PnL", get: () => Store.data, put: (d) => { Store.data = Store.normalise(d); Store.save(); Store.runRecurring(); }, empty: () => Store.normalise(null) },
    life: { label: "Life", get: () => LifeStore.data, put: (d) => LifeStore.importData(d), empty: () => LifeStore.normalise(null) },
    journal: { label: "Journal", get: () => JournalStore.data, put: (d) => JournalStore.importData(d), empty: () => JournalStore.normalise(null) },
  };
  const NAMES = Object.keys(SECTIONS);
  const STATE_KEY = "lifeTracker.sync";
  const BUCKET = "media";

  // ---------- Small helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // Quick fingerprint of a section's data (FNV-1a), to notice changes cheaply
  const hash = (obj) => {
    const s = JSON.stringify(obj);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ":" + s.length;
  };
  const device = (() => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    if (/Windows/.test(ua)) return "Windows PC";
    if (/Macintosh/.test(ua)) return "Mac";
    return "Browser";
  })();
  const F_WHEN = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const when = (iso) => F_WHEN.format(new Date(iso));
  function toast(text) {
    const t = document.createElement("div");
    t.className = "lf-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  const isNetworkError = (e) => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String((e && (e.message || e)) || ""));

  // ---------- Local bookkeeping ----------
  const fresh = () => ({ owner: null, sections: {}, up: [], del: [] });
  let st;
  try { st = JSON.parse(localStorage.getItem(STATE_KEY)) || fresh(); } catch (e) { st = fresh(); }
  const persist = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch (e) { /* full: next save retries */ } };
  const sec = (s) => st.sections[s] || (st.sections[s] = { rev: null, hash: null, changedAt: 0 });
  const isDirty = (s) => hash(SECTIONS[s].get()) !== sec(s).hash;
  const hasContent = (s) => hash(SECTIONS[s].get()) !== hash(SECTIONS[s].empty());
  const pending = () => NAMES.some(isDirty) || st.up.length > 0 || st.del.length > 0;

  let user = null;      // logged-in user ({ id, email })
  let ready = false;    // first-login questions answered, syncing allowed
  let silent = 0;       // >0 while writing cloud data locally (those saves aren't "changes")
  let timer = null, busy = false, again = false, retryTimer = null;
  let recovering = /type=recovery/.test(location.hash); // opened from a password-reset email

  // ---------- Status indicator: Synced ✓ / Syncing… / Offline (will sync later) ----------
  const bar = document.createElement("div");
  bar.className = "cloud-bar";
  bar.hidden = true;
  bar.innerHTML = `
    <button type="button" class="cloud-status" data-cloud="status" aria-live="polite"><span class="cloud-dot"></span><span class="cloud-text"></span></button>
    <div class="cloud-acct">
      <button type="button" class="cloud-avatar" data-cloud="menu" aria-haspopup="true" aria-expanded="false" aria-label="Account"></button>
      <div class="menu card cloud-menu" hidden>
        <div class="cloud-who"><div class="cloud-name"></div><div class="cloud-email"></div></div>
        <button type="button" class="menu-item" data-cloud="username">Change username…</button>
        <button type="button" class="menu-item" data-cloud="versions">Earlier versions…</button>
        <button type="button" class="menu-item" data-cloud="password">Change password…</button>
        <button type="button" class="menu-item" data-cloud="logout">Log out</button>
        <button type="button" class="menu-item danger-item" data-cloud="delete">Delete account…</button>
      </div>
    </div>`;
  document.body.appendChild(bar);
  let status = "synced";
  function setStatus(kind) {
    status = kind;
    const waiting = pending();
    const [cls, short, long] = kind === "syncing" ? ["syncing", "Syncing…", "Syncing…"]
      : kind === "offline" ? ["offline", "Offline", waiting ? "Offline (will sync later)" : "Offline"]
      : kind === "error" ? ["error", "Not synced", "Not synced, will retry"]
      : waiting ? ["syncing", "Syncing…", "Syncing…"] : ["synced", "Synced ✓", "Synced ✓"];
    bar.dataset.state = cls;
    bar.querySelector(".cloud-text").innerHTML = `<span class="cloud-long">${long}</span><span class="cloud-short">${short}</span>`;
    bar.querySelector(".cloud-status").setAttribute("aria-label", `${long}. Tap to sync now.`);
  }

  // ---------- Applying cloud data to this device ----------
  let redraw = false;
  function apply(s, row) {
    silent++;
    try { SECTIONS[s].put(clone(row.data)); } finally { silent--; }
    Object.assign(sec(s), { rev: row.updated_at, hash: hash(SECTIONS[s].get()), changedAt: Date.parse(row.changed_at) || Date.now() });
    persist();
    redraw = true;
  }
  function redrawIfNeeded() {
    if (!redraw) return;
    redraw = false;
    document.dispatchEvent(new CustomEvent("lifetracker:imported"));
  }
  async function fetchRow(s) {
    const { data, error } = await sb.from("user_data").select("section, data, changed_at, updated_at, device").eq("section", s).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function keepVersion(s, data, changedAt, reason) {
    const { error } = await sb.from("user_data_history").insert({ section: s, data, changed_at: new Date(changedAt || Date.now()).toISOString(), device, reason });
    if (error) throw error;
  }

  // The same section changed here AND on another device: newest change wins,
  // the other version goes to Earlier versions.
  async function clash(s, row) {
    const L = sec(s);
    const remoteAt = Date.parse(row.changed_at) || 0;
    if ((L.changedAt || 0) > remoteAt) {
      L.rev = row.updated_at; // ours is newer: overwrite (the database keeps theirs as an earlier version)
      persist();
      toast(`${SECTIONS[s].label}: kept this device's newer changes. The other version is in Earlier versions.`);
      return "push";
    }
    await keepVersion(s, SECTIONS[s].get(), L.changedAt, "clash");
    apply(s, row);
    toast(`${SECTIONS[s].label}: newer changes from ${row.device || "another device"} loaded. This device's version is in Earlier versions.`);
    return "pulled";
  }

  // ---------- Pull ----------
  async function pull() {
    const { data: rows, error } = await sb.from("user_data").select("section, changed_at, updated_at");
    if (error) throw error;
    for (const s of NAMES) {
      const r = rows.find((x) => x.section === s);
      if (!r || r.updated_at === sec(s).rev) continue;
      const row = await fetchRow(s);
      if (!row) continue;
      if (!isDirty(s)) apply(s, row);
      else await clash(s, row);
    }
  }

  // ---------- Push ----------
  async function push(s, depth = 0) {
    const L = sec(s);
    const data = SECTIONS[s].get();
    const h = hash(data);
    const body = { data, changed_at: new Date(L.changedAt || Date.now()).toISOString(), device };
    let rows, error;
    if (L.rev) {
      ({ data: rows, error } = await sb.from("user_data").update(body).eq("section", s).eq("updated_at", L.rev).select("updated_at"));
      if (error) throw error;
      if (!rows.length) {               // saved elsewhere since we last looked
        const row = await fetchRow(s);
        if (!row) { L.rev = null; return depth < 2 ? push(s, depth + 1) : null; }
        if ((await clash(s, row)) === "push" && depth < 2) return push(s, depth + 1);
        return null;
      }
    } else {
      ({ data: rows, error } = await sb.from("user_data").insert({ section: s, ...body }).select("updated_at"));
      if (error && error.code === "23505") { // already exists in the cloud
        const row = await fetchRow(s);
        if ((await clash(s, row)) === "push" && depth < 2) return push(s, depth + 1);
        return null;
      }
      if (error) throw error;
    }
    L.rev = rows[0].updated_at;
    L.hash = h;
    persist();
    return null;
  }

  // ---------- Photos and audio ----------
  const path = (id) => `${user.id}/${id}`;
  async function localBlob(id) { const r = await Media.tx("readonly", (s) => s.get(id)); return r ? r.blob : null; }
  async function syncMedia() {
    for (const id of [...st.up]) {
      const blob = await localBlob(id);
      if (blob) {
        const { error } = await sb.storage.from(BUCKET).upload(path(id), blob, { contentType: blob.type || "application/octet-stream", upsert: true });
        if (error && !/exists/i.test(error.message || "")) throw error;
      }
      st.up = st.up.filter((x) => x !== id);
      persist();
    }
    if (st.del.length) {
      const ids = st.del.slice(0, 100);
      const { error } = await sb.storage.from(BUCKET).remove(ids.map(path));
      if (error) throw error;
      st.del = st.del.filter((x) => !ids.includes(x));
      persist();
    }
  }
  const downloads = new Map();
  function fetchMedia(id) {
    if (!user || !ready) return Promise.resolve(null);
    if (!downloads.has(id)) {
      downloads.set(id, (async () => {
        const { data, error } = await sb.storage.from(BUCKET).download(path(id));
        if (error || !data) return null;
        await Media.put(data, id, { fromCloud: true });
        return data;
      })().catch(() => null).finally(() => setTimeout(() => downloads.delete(id), 1000)));
    }
    return downloads.get(id);
  }

  // ---------- The sync loop ----------
  function schedule(ms = 1500) {
    if (!user || !ready) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }
  async function syncNow() {
    if (!user || !ready) return;
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(retryTimer);
    setStatus("syncing");
    try {
      if (!navigator.onLine) throw new Error("offline");
      await pull();
      for (const s of NAMES) if (isDirty(s)) await push(s);
      await syncMedia();
      redrawIfNeeded();
      setStatus("synced");
    } catch (e) {
      redrawIfNeeded();
      setStatus(isNetworkError(e) ? "offline" : "error");
      if (!isNetworkError(e)) console.warn("Sync problem:", e);
      retryTimer = setTimeout(syncNow, 30000);
    } finally {
      busy = false;
      if (again) { again = false; schedule(300); }
    }
  }

  // ---------- First log-in on this device ----------
  // Asked on the log-in screen (the app stays hidden until answered).
  function ask(title, text, buttons) {
    return new Promise((resolve) => {
      document.documentElement.classList.add("signed-out");
      authCard.innerHTML = `
        <img class="auth-logo" src="icons/icon-192.png" alt="">
        <h2 class="auth-q">${title}</h2>
        ${text ? `<p class="auth-note">${text}</p>` : ""}
        <div class="auth-actions">${buttons.map(([label, value, cls]) =>
          `<button type="button" class="btn ${cls || ""}" data-answer="${value}">${label}</button>`).join("")}</div>`;
      authCard.querySelector(".btn-primary, .btn").focus();
      authCard.onclick = (e) => {
        const b = e.target.closest("[data-answer]");
        if (!b) return;
        if (b.dataset.answer === "export") return Backup.download();
        authCard.onclick = null;
        resolve(b.dataset.answer);
      };
    });
  }
  async function localMediaIds() { return (await Media.all().catch(() => [])).map((r) => r.id); }

  async function firstLogin() {
    const { data, error } = await sb.from("user_data").select("section, data, changed_at, updated_at");
    if (error) throw error; // never treat "couldn't ask" as "the account is empty"
    const rows = data || [];
    const local = NAMES.filter(hasContent);
    const media = await localMediaIds();
    const hasLocal = local.length > 0 || media.length > 0;
    const summary = local.map((s) => SECTIONS[s].label).concat(media.length ? [`${media.length} photo${media.length === 1 ? "" : "s"} / audio`] : []).join(", ");

    if (!hasLocal) {                                   // nothing here: just use the account
      for (const r of rows) apply(r.section, r);
    } else if (!rows.length) {                        // empty account: offer to upload
      const a = await ask("Upload this device's data to your account?", esc(summary),
        [["Upload", "up", "btn-primary"], ["Export a backup first", "export", "btn-ghost"], ["Don't upload", "no", "btn-ghost danger"]]);
      if (a === "up") {
        for (const s of NAMES) Object.assign(sec(s), { rev: null, hash: null, changedAt: Date.now() });
        st.up = [...new Set([...st.up, ...media])];
      } else {
        await wipeLocal();
      }
    } else {                                          // both have data: pick one, the other is kept
      const a = await ask("Your account already has data", `This device has: ${esc(summary)}`,
        [["Use my account's data", "cloud", "btn-primary"], ["Replace it with this device's data", "device", "btn-ghost"]]);
      if (a === "cloud") {
        for (const s of local) await keepVersion(s, SECTIONS[s].get(), Date.now(), "device before login");
        await wipeLocal();
        for (const r of rows) apply(r.section, r);
      } else {
        for (const s of NAMES) {
          const r = rows.find((x) => x.section === s);
          Object.assign(sec(s), { rev: r ? r.updated_at : null, hash: null, changedAt: Date.now() });
        }
        st.up = [...new Set([...st.up, ...media])];
      }
    }
    st.owner = user.id;
    persist();
    redrawIfNeeded();
  }

  // Empties this device (log out, another account, "Don't upload")
  async function wipeLocal() {
    if (typeof Player !== "undefined") Player.stop();
    silent++;
    try {
      for (const k of [PNL_STORAGE_KEY, LIFE_STORAGE_KEY, JOURNAL_STORAGE_KEY]) localStorage.removeItem(k);
      await Media.clear().catch(() => {});
      Store.load();
      LifeStore.load();
      JournalStore.load();
    } finally { silent--; }
    const owner = st.owner;
    st = fresh();
    st.owner = owner;
    persist();
    redraw = true;
  }

  // ---------- Logged in / out ----------
  async function start(u) {
    if (user && user.id === u.id) return;
    user = { id: u.id, email: u.email, name: nameOf(u) };
    ready = false;
    try {
      if (st.owner && st.owner !== user.id) {
        if (pending() && !confirm("This device has changes from another account that never reached the cloud. Logging in removes them. Continue?")) {
          await sb.auth.signOut({ scope: "local" });
          user = null;
          return;
        }
        st.owner = null;
        await wipeLocal();
        st.owner = null;
      }
      if (!st.owner) await firstLogin();
    } catch (e) {
      if (isNetworkError(e) && st.owner === user.id) { /* offline: carry on with this device's copy */ }
      else {
        console.warn("Log-in problem:", e);
        showAuth("login", isNetworkError(e) ? "Couldn't reach your account. Check your internet and try again." : "Couldn't open your account. Try again in a moment.");
        user = null;
        return;
      }
    }
    ready = true;
    if (!recovering) hideAuth();
    bar.hidden = false;
    paintAccount();
    if (welcome) { toast(`Welcome, ${welcome}`); welcome = ""; }
    setStatus(navigator.onLine ? "syncing" : "offline");
    syncNow();
  }

  // ---------- Username ----------
  // Kept on the account itself (Supabase "user metadata"), so it follows the
  // person to every device. Accounts made before usernames show the start of the email.
  let welcome = ""; // set by a fresh sign-up: greeted once the app opens
  const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  const nameOf = (u) => cleanName(u && u.user_metadata && u.user_metadata.username) || String((u && u.email) || "").split("@")[0] || "Account";
  function paintAccount() {
    if (!user) return;
    bar.querySelector(".cloud-avatar").textContent = (user.name || "?")[0].toUpperCase();
    bar.querySelector(".cloud-avatar").setAttribute("aria-label", `Account: ${user.name}`);
    bar.querySelector(".cloud-name").textContent = user.name;
    bar.querySelector(".cloud-email").textContent = user.email || "";
  }

  // ---------- Log-in screen ----------
  const auth = document.createElement("div");
  auth.className = "auth";
  auth.setAttribute("role", "dialog");
  auth.setAttribute("aria-modal", "true");
  auth.setAttribute("aria-label", "Log in to Life Tracker");
  auth.innerHTML = `<div class="auth-card card"></div>`;
  document.body.appendChild(auth);
  const authCard = auth.querySelector(".auth-card");
  const EYE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6a10 10 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.6M6.4 7.1A17 17 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
  const PW_MIN = 6, NAME_MIN = 2, NAME_MAX = 24;
  const PW_HINT = `At least ${PW_MIN} characters`;
  const pwField = (name, label, auto, hint = "") => `
    <label class="field"><span class="field-label">${label}</span>
      <span class="auth-pw"><input name="${name}" type="password" autocomplete="${auto}" required>
      <button type="button" class="auth-eye" data-eye aria-label="Show password">${EYE}</button></span>
      ${hint ? `<span class="field-hint">${hint}</span>` : ""}</label>`;

  // What the person has typed so far, so switching Log in / Sign up / Forgot keeps it
  const draft = { email: "", username: "" };
  function remember() {
    const f = authCard.querySelector("form");
    if (!f) return;
    if (f.email) draft.email = f.email.value.trim();
    if (f.username) draft.username = cleanName(f.username.value);
  }
  const emailField = (auto) => `<label class="field"><span class="field-label">Email</span>
      <input name="email" type="email" autocomplete="${auto}" inputmode="email" autocapitalize="none" spellcheck="false" required value="${esc(draft.email)}"></label>`;
  const LOGO = `<img class="auth-logo" src="icons/icon-192.png" alt="">`;

  // The card's current screen is kept in data-screen; links that switch screen use data-go.
  // (They must be different names: the click handler below looks for data-go on the
  // way up from whatever was tapped, and the card itself must never match.)
  function showAuth(mode = "login", message = "") {
    document.documentElement.classList.add("signed-out");
    bar.hidden = true;
    const login = mode === "login", signup = mode === "signup";
    const error = `<div class="form-error" role="alert" ${message ? "" : "hidden"}>${esc(message)}</div>`;
    if (mode === "forgot") {
      authCard.innerHTML = `${LOGO}
        <h1 class="auth-title">Reset password</h1>
        <form class="form auth-form" novalidate>
          ${emailField("email")}
          ${error}
          <button type="submit" class="btn btn-primary auth-go">Send reset link</button>
          <button type="button" class="link auth-link" data-go="login">Back to log in</button>
        </form>`;
    } else if (mode === "newpw") {
      authCard.innerHTML = `${LOGO}
        <h1 class="auth-title">New password</h1>
        <form class="form auth-form" novalidate>
          ${pwField("password", "New password", "new-password", PW_HINT)}
          ${error}
          <button type="submit" class="btn btn-primary auth-go">Save password</button>
        </form>`;
    } else {
      authCard.innerHTML = `${LOGO}
        <h1 class="auth-title">Life Tracker</h1>
        <div class="seg auth-seg" role="radiogroup" aria-label="Log in or sign up">
          <label><input type="radio" name="authMode" value="login"${login ? " checked" : ""}><span>Log in</span></label>
          <label><input type="radio" name="authMode" value="signup"${signup ? " checked" : ""}><span>Sign up</span></label>
        </div>
        <form class="form auth-form" novalidate>
          ${signup ? `<label class="field"><span class="field-label">Username</span>
            <input name="username" type="text" autocomplete="nickname" autocapitalize="none" spellcheck="false" required maxlength="${NAME_MAX}" value="${esc(draft.username)}"></label>` : ""}
          ${emailField(login ? "username" : "email")}
          ${pwField("password", "Password", login ? "current-password" : "new-password", signup ? PW_HINT : "")}
          ${error}
          <button type="submit" class="btn btn-primary auth-go">${login ? "Log in" : "Create account"}</button>
          ${login ? `<button type="button" class="link auth-link" data-go="forgot">Forgot password?</button>` : ""}
        </form>`;
    }
    authCard.dataset.screen = mode;
    authCard.onclick = null;
    // Start in the first box that is still empty
    const boxes = [...authCard.querySelectorAll("form input")];
    const focusEl = boxes.find((i) => !i.value) || boxes[0];
    if (focusEl) setTimeout(() => { if (focusEl.isConnected) focusEl.focus(); }, 0);
  }
  function hideAuth() {
    document.documentElement.classList.remove("signed-out");
  }
  const authError = (msg, input) => {
    const box = authCard.querySelector(".form-error");
    if (box) { box.textContent = msg; box.hidden = !msg; box.classList.toggle("ok", false); }
    authCard.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
  };
  const authOk = (msg) => { const box = authCard.querySelector(".form-error"); if (box) { box.textContent = msg; box.hidden = false; box.classList.add("ok"); } };
  const friendly = (e) => {
    const m = String((e && e.message) || e || "");
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/already registered|already been registered|already exists/i.test(m)) return "That email already has an account. Log in instead.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first (check your inbox), then log in.";
    if (/signups? (are )?(not allowed|disabled)/i.test(m)) return "New accounts are switched off right now.";
    if (/password should be|weak password/i.test(m)) return `Pick a longer password (${PW_MIN} characters or more).`;
    if (/should be different|same.*password/i.test(m)) return "That is already your password. Pick a different one.";
    if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
    if (/address.*(invalid|not authorized)|not authorized|invalid.*email|email.*invalid/i.test(m)) return "That email address doesn't look right. Check it's typed correctly.";
    if (isNetworkError(e)) return "No internet connection. Try again when you're online.";
    return m || "Something went wrong. Try again.";
  };
  // Returns [message, input] for the first box that isn't filled in properly
  function checkFields(form, mode) {
    if (form.username) {
      form.username.value = cleanName(form.username.value);
      if (form.username.value.length < NAME_MIN) return [`Pick a username (${NAME_MIN} characters or more).`, form.username];
    }
    if (form.email) {
      form.email.value = form.email.value.trim();
      if (!form.email.value) return ["Enter your email address.", form.email];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value)) return ["That email address doesn't look right.", form.email];
    }
    if (form.password) {
      if (!form.password.value) return ["Enter your password.", form.password];
      if (mode !== "login" && form.password.value.length < PW_MIN) return [`Passwords need at least ${PW_MIN} characters.`, form.password];
    }
    return null;
  }
  function toggleEye(eye) {
    const input = eye.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.innerHTML = show ? EYE_OFF : EYE;
    eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }

  auth.addEventListener("change", (e) => { if (e.target.name === "authMode") { remember(); showAuth(e.target.value); } });
  auth.addEventListener("input", (e) => { if (e.target.hasAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid"); });
  auth.addEventListener("click", (e) => {
    const eye = e.target.closest("[data-eye]");
    if (eye) return toggleEye(eye);
    const go = e.target.closest("[data-go]");
    if (go) { remember(); showAuth(go.dataset.go); }
  });
  let submitting = false;
  auth.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    const form = e.target;
    const go = form.querySelector(".auth-go");
    const mode = authCard.dataset.screen;
    const bad = checkFields(form, mode);
    if (bad) return authError(bad[0], bad[1]);
    remember();
    const email = form.email ? form.email.value : "";
    const password = form.password ? form.password.value : "";
    const label = go.textContent;
    let entering = false; // logged in: the button stays busy until the app opens
    submitting = true;
    go.disabled = true;
    go.textContent = "One moment…";
    authError("");
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        entering = true;
      } else if (mode === "signup") {
        const username = form.username.value;
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl(), data: { username } } });
        if (error) throw error;
        // (With "Confirm email" on, Supabase answers an email that is already taken with a user that has no identities)
        if (data.user && data.user.identities && !data.user.identities.length) throw new Error("User already registered");
        if (!data.session) { showAuth("login"); authOk("Check your email to confirm your account, then log in."); return; }
        welcome = username;
        entering = true;
      } else if (mode === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (error) throw error;
        authOk("If that email has an account, a reset link is on its way.");
      } else if (mode === "newpw") {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        toast("Password changed");
        recovering = false;
        if (user && ready) hideAuth(); else { const { data } = await sb.auth.getSession(); if (data.session) start(data.session.user); }
      }
    } catch (err) {
      const msg = friendly(err);
      authError(msg, /password/i.test(msg) && form.password ? form.password : /email/i.test(msg) && form.email ? form.email : null);
    } finally {
      submitting = false;
      const restore = () => { if (go.isConnected) { go.disabled = false; go.textContent = label; } };
      if (entering) setTimeout(restore, 20000); else restore();
    }
  });
  const redirectUrl = () => (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : CLOUD_CONFIG.siteUrl);

  // ---------- Account menu ----------
  const menu = bar.querySelector(".cloud-menu");
  const avatar = bar.querySelector(".cloud-avatar");
  const closeMenu = () => { menu.hidden = true; avatar.setAttribute("aria-expanded", "false"); };
  document.addEventListener("click", (e) => { if (!bar.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cloud]");
    if (!b) return;
    const what = b.dataset.cloud;
    if (what === "menu") {
      menu.hidden = !menu.hidden;
      avatar.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) menu.querySelector(".menu-item").focus();
      return;
    }
    closeMenu();
    if (what === "status") return syncNow();
    if (what === "logout") return logOut();
    if (what === "password") return changePassword();
    if (what === "username") return changeUsername();
    if (what === "delete") return deleteAccount();
    if (what === "versions") return earlierVersions();
  });

  // A small form in the shared sheet; onSubmit returns an error or nothing
  function sheet(title, html, submitLabel, onSubmit, danger = false) {
    const body = openModal(title, `<form class="form" novalidate>${html}
      <div class="form-error" hidden></div>
      <div class="form-actions"><button type="button" class="btn" data-close-modal>Cancel</button>
      <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${submitLabel}</button></div></form>`);
    const form = body.querySelector("form");
    // (on the form, not the sheet: the sheet's body is reused, so listeners there would pile up)
    form.addEventListener("click", (e) => { const eye = e.target.closest("[data-eye]"); if (eye) toggleEye(eye); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]");
      const box = form.querySelector(".form-error");
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "One moment…";
      let err;
      try { err = await onSubmit(form); } catch (x) { err = friendly(x); }
      if (!btn.isConnected) return;
      btn.disabled = false;
      btn.textContent = label;
      if (err) { box.textContent = err; box.hidden = false; }
    });
    return form;
  }

  function changeUsername() {
    const form = sheet("Change username",
      `<label class="field"><span class="field-label">Username</span>
        <input name="username" type="text" autocomplete="nickname" autocapitalize="none" spellcheck="false" maxlength="${NAME_MAX}" value="${esc(user.name)}"></label>`,
      "Save", async (f) => {
        const username = cleanName(f.username.value);
        if (username.length < NAME_MIN) return `Pick a username (${NAME_MIN} characters or more).`;
        if (username !== user.name) {
          const { error } = await sb.auth.updateUser({ data: { username } });
          if (error) return friendly(error);
          user.name = username;
          paintAccount();
        }
        closeModal();
        toast("Username changed");
      });
    form.username.select();
  }

  function changePassword() {
    sheet("Change password", pwField("current", "Current password", "current-password") + pwField("password", "New password", "new-password", PW_HINT), "Save", async (f) => {
      if (!f.current.value) return "Enter your current password.";
      if (f.password.value.length < PW_MIN) return `Passwords need at least ${PW_MIN} characters.`;
      const check = await sb.auth.signInWithPassword({ email: user.email, password: f.current.value });
      if (check.error) return "Current password is wrong.";
      const { error } = await sb.auth.updateUser({ password: f.password.value });
      if (error) return friendly(error);
      closeModal();
      toast("Password changed");
    });
  }

  async function logOut() {
    await syncNow();
    if (pending() && !confirm("Some changes haven't reached the cloud yet (are you offline?). If you log out now they're lost from this device. Log out anyway?")) return;
    await sb.auth.signOut({ scope: "local" });
    await wipeLocal();
    st = fresh();
    persist();
    location.reload();
  }

  function deleteAccount() {
    sheet("Delete account",
      `<p class="cloud-warn">Deletes your account and ALL its data (PnL, Life, Journal, photos and audio) from the cloud and this device. This can't be undone.</p>
       <label class="field"><span class="field-label">Type DELETE to confirm</span><input name="confirm" type="text" autocomplete="off" autocapitalize="characters"></label>`,
      "Delete account", async (f) => {
        if (f.confirm.value.trim().toUpperCase() !== "DELETE") return "Type DELETE to confirm.";
        // Files first (Storage), then the rows and the account itself (delete_my_account)
        for (;;) {
          const { data: files, error } = await sb.storage.from(BUCKET).list(user.id, { limit: 100 });
          if (error) return friendly(error);
          if (!files.length) break;
          const { error: e2 } = await sb.storage.from(BUCKET).remove(files.map((x) => `${user.id}/${x.name}`));
          if (e2) return friendly(e2);
        }
        const { error } = await sb.rpc("delete_my_account");
        if (error) return friendly(error);
        await sb.auth.signOut({ scope: "local" }).catch(() => {});
        await wipeLocal();
        st = fresh();
        persist();
        location.reload();
      }, true);
  }

  async function earlierVersions() {
    const body = openModal("Earlier versions", `<div class="muted">Loading…</div>`);
    const { data: rows, error } = await sb.from("user_data_history")
      .select("id, section, replaced_at, changed_at, device, reason").order("replaced_at", { ascending: false }).limit(40);
    if (!body.isConnected) return;
    if (error) { body.innerHTML = `<div class="form-error">${esc(friendly(error))}</div>`; return; }
    if (!rows.length) { body.innerHTML = `<div class="card empty">No earlier versions yet.</div>`; return; }
    const why = { clash: "kept from a clash", "device before login": "this device before login", replaced: "replaced" };
    body.innerHTML = `<div class="card lf-list lf-in-sheet">${rows.map((r) => `
      <div class="lf-row" role="button" tabindex="0" data-version="${r.id}" data-section="${esc(r.section)}">
        <span class="lf-main"><span class="lf-title">${esc((SECTIONS[r.section] || {}).label || r.section)} · ${esc(when(r.changed_at || r.replaced_at))}</span>
        <span class="lf-meta">${esc(r.device || "")}${r.device ? " · " : ""}${esc(why[r.reason] || r.reason)}</span></span>
        <span class="lf-trail"><span class="muted">Restore</span></span>
      </div>`).join("")}</div>`;
    const restore = async (row) => {
      const s = row.dataset.section;
      if (!SECTIONS[s] || !confirm(`Restore this ${SECTIONS[s].label} version? What's there now is kept as an earlier version.`)) return;
      const { data, error: e } = await sb.from("user_data_history").select("data").eq("id", row.dataset.version).single();
      if (e) return alert(friendly(e));
      SECTIONS[s].put(clone(data.data));       // a normal change: syncs, and the current one is kept by the database
      document.dispatchEvent(new CustomEvent("lifetracker:imported"));
      closeModal();
      toast(`${SECTIONS[s].label} restored`);
    };
    body.addEventListener("click", (e) => { const r = e.target.closest("[data-version]"); if (r) restore(r); });
    body.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.version) restore(e.target); });
  }

  // ---------- Wiring ----------
  sb.auth.onAuthStateChange((event, session) => {
    // (Supabase asks not to call it again from inside this callback: run on the next tick)
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { recovering = true; showAuth("newpw"); return; }
      if (session && session.user) {
        if (!user || user.id !== session.user.id) start(session.user);
        else { user.email = session.user.email; user.name = nameOf(session.user); paintAccount(); } // e.g. username changed on another device
      }
      else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") { user = null; ready = false; showAuth("login"); }
      // Tidy reset-link leftovers out of the address (keeps the tab switching happy)
      if (/access_token|error_code|type=recovery/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + "#pnl");
    }, 0);
  });
  // A reset link that expired
  if (/error_code=/.test(location.hash)) {
    const p = new URLSearchParams(location.hash.slice(1));
    setTimeout(() => showAuth("forgot", (p.get("error_description") || "That link has expired.").replace(/\+/g, " ") + " Send a new one."), 0);
  }

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); else if (pending()) syncNow(); });
  window.addEventListener("online", () => syncNow());
  window.addEventListener("offline", () => setStatus("offline"));
  window.addEventListener("focus", () => schedule(200));

  return {
    enabled: true,
    client: sb,
    get user() { return user; },
    status: () => status,
    syncNow,
    changed(s) {
      if (silent || !SECTIONS[s]) return;
      sec(s).changedAt = Date.now();
      persist();
      setStatus(navigator.onLine ? "syncing" : "offline");
      schedule();
    },
    mediaAdded(id) {
      if (silent) return;
      st.del = st.del.filter((x) => x !== id);
      if (!st.up.includes(id)) st.up.push(id);
      persist();
      schedule();
    },
    mediaRemoved(ids) {
      if (silent || !user) return;
      st.up = st.up.filter((x) => !ids.includes(x));
      for (const id of ids) if (!st.del.includes(id)) st.del.push(id);
      persist();
      schedule();
    },
    fetchMedia,
    _state: () => st,
  };
})();
