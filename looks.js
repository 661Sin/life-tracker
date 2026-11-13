// ---------- Looksmax screens ----------
// One glass card per thing I'm working on (e.g. "Whiter teeth"): cover photo,
// streak, consistency, progress and a one-tap "Worked on it today". Tapping a
// card opens it: Photos (timeline + compare), Notes, Tracking.
// Data comes from LooksStore (looks-store.js), every number from LooksCalc
// (looks-calc.js), photo files from Media (journal-store.js).
//
// Design rules: one primary (blue) action per page, "+ Add"; everything else in
// ⋯; tap things to open / edit them (Delete at the bottom of their sheet).

(function () {
  const root = document.getElementById("looksmax-root");
  if (!root) return;

  const C = LooksCalc, L = LifeCalc;
  const D = () => LooksStore.data;

  // ================= Helpers =================
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const UTC = (fmt) => new Intl.DateTimeFormat("en-NZ", { ...fmt, timeZone: "UTC" });
  const F_DAY = UTC({ weekday: "short", day: "numeric", month: "short" });
  const F_DATE = UTC({ day: "numeric", month: "short", year: "numeric" });
  const F_SHORT = UTC({ day: "numeric", month: "short" });
  const fmtDay = (s) => F_DAY.format(L.toUTC(s));
  const fmtDate = (s) => F_DATE.format(L.toUTC(s));
  const fmtShort = (s) => F_SHORT.format(L.toUTC(s));
  const relDay = (s, today = L.today()) => {
    const n = L.daysBetween(today, s);
    return n === 0 ? "Today" : n === -1 ? "Yesterday" : n === 1 ? "Tomorrow" : fmtDay(s);
  };
  const streakText = (it, n) => plural(n, C.isWeekly(it) ? "week" : "day");

  const btn = (label, action, id = "", cls = "") =>
    `<button type="button" class="btn ${cls}" data-action="${action}"${id !== "" ? ` data-id="${esc(id)}"` : ""}>${label}</button>`;
  const moreMenu = (items) => !items.length ? "" : `
    <div class="menu-wrap">
      <button type="button" class="btn btn-ghost btn-icon" data-action="menu" aria-label="More options" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu card" hidden>${items.map(([label, action, id]) =>
        `<button type="button" class="menu-item" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${label}</button>`).join("")}</div>
    </div>`;
  const field = (label, control, hint = "") =>
    `<label class="field"><span class="field-label">${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ""}</label>`;
  const fieldDiv = (label, control) => `<div class="field"><span class="field-label">${label}</span>${control}</div>`;
  const row2 = (...f) => `<div class="form-row">${f.join("")}</div>`;
  const textInput = (name, value, extra = "") => `<input name="${name}" type="text" value="${esc(value)}" ${extra}>`;
  const dateInput = (name, value, extra = "") => `<input name="${name}" type="date" value="${value || ""}" ${extra}>`;
  const seg = (name, options, value) => `<div class="seg">${options.map(([v, t]) =>
    `<label><input type="radio" name="${name}" value="${esc(v)}"${String(v) === String(value) ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>`;
  const ICON = {
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  };

  // Small glass message at the bottom (same look as Life)
  function toast(text) {
    const t = document.createElement("div");
    t.className = "lf-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // Opens a form in the shared sheet. onSubmit(values, form) may be async and
  // returns an error message, or nothing on success (the sheet then closes, or
  // opts.after() runs instead, e.g. to go back to the item). opts.onDelete adds
  // a Delete button at the bottom (asks first). The page redraws by itself:
  // every save announces "lifetracker:looks".
  function openForm(title, fieldsHtml, onSubmit, opts = {}) {
    const body = openModal(title, `
      <form class="form" novalidate>
        ${fieldsHtml}
        <div class="form-error" hidden></div>
        <div class="form-actions">
          ${opts.onDelete ? `<button type="button" class="btn btn-ghost danger form-delete" data-form-delete>${opts.deleteLabel || "Delete"}</button>` : ""}
          <button type="button" class="btn" data-form-cancel>${opts.after ? "Back" : "Cancel"}</button>
          <button type="submit" class="btn btn-primary">${opts.submitLabel || "Save"}</button>
        </div>
      </form>`);
    const form = body.querySelector("form");
    const errorBox = form.querySelector(".form-error");
    const submit = form.querySelector("[type=submit]");
    const fail = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };
    const leave = () => { if (opts.after) opts.after(); else closeModal(); };
    form.querySelector("[data-form-cancel]").addEventListener("click", leave);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      const values = Object.fromEntries(new FormData(form));
      for (const k in values) if (typeof values[k] === "string") values[k] = values[k].trim();
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = "Saving…";
      let error;
      try { error = await onSubmit(values, form); } catch (err) { error = err.message || String(err); }
      submit.disabled = false;
      submit.textContent = label;
      if (error) return fail(error);
      leave();
    });
    const del = form.querySelector("[data-form-delete]");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(opts.confirmText || "Delete this? This can't be undone.")) return;
      const error = await opts.onDelete();
      if (error) return fail(error);
      if (opts.afterDelete) opts.afterDelete(); else leave();
    });
    return form;
  }

  // ---------- Pictures ----------
  // Photo files live in IndexedDB; <img data-media="id"> gets its address once
  // it comes near the screen. Addresses already looked up are reused straight
  // away so a redraw doesn't make pictures blink.
  const known = new Map(); // media id → object URL
  const imgTag = (id, alt = "", extra = "") =>
    `<img ${known.has(id) ? `src="${known.get(id)}"` : `data-media="${esc(id)}"`} alt="${esc(alt)}" ${extra}>`;
  function loadImg(img) {
    const id = img.dataset.media;
    Media.url(id).then((u) => {
      if (u) { known.set(id, u); img.src = u; img.removeAttribute("data-media"); }
      else if (img.parentElement) img.parentElement.classList.add("missing");
    });
  }
  const imgObs = "IntersectionObserver" in window
    ? new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { imgObs.unobserve(e.target); loadImg(e.target); } }), { rootMargin: "400px 0px" })
    : null;
  const fillImages = (box) => box.querySelectorAll("img[data-media]").forEach((img) => (imgObs ? imgObs.observe(img) : loadImg(img)));

  // Stores a picked picture the same way Journal does: a 1600px JPEG plus a
  // 600px thumbnail; GIFs / animated pictures are kept exactly as they are.
  async function storePhoto(file) {
    const anim = await Media.animatedKind(file).catch(() => null);
    if (anim) {
      if (file.size > Media.ANIMATED_MAX) throw new Error(`That ${anim === "gif" ? "GIF" : "animation"} is too big. Animated pictures can be up to ${Math.round(Media.ANIMATED_MAX / 1048576)} MB.`);
      const { w, h } = await Media.imageSize(file);
      const id = await Media.put(file.type ? file : new Blob([file], { type: "image/gif" }));
      return { full: id, thumb: id, w, h, animated: anim };
    }
    const full = await Media.resizeImage(file, 1600, 0.8);
    const small = await Media.resizeImage(full.blob, 600, 0.75);
    return { full: await Media.put(full.blob), thumb: await Media.put(small.blob), w: full.w, h: full.h };
  }

  // ================= Main page =================
  const ui = { doneOpen: false };

  const coverHtml = (it) => {
    const p = C.latestPhoto(it);
    return `<div class="lk-cover">${p ? imgTag(p.thumb) : `<span class="lk-cover-emoji" aria-hidden="true">${esc(it.emoji || "✨")}</span>`}</div>`;
  };
  // Finished: first photo next to the latest one (before / after)
  const pairHtml = (it) => {
    const a = C.firstPhoto(it), b = C.latestPhoto(it);
    if (!a || a.id === b.id) return coverHtml(it);
    return `<div class="lk-cover lk-pair">${imgTag(a.thumb, "Before")}${imgTag(b.thumb, "After")}</div>`;
  };

  function cardHtml(it, today) {
    const title = `${it.emoji ? `<span class="lf-emoji">${esc(it.emoji)}</span>` : ""}${esc(it.name)}`;
    if (it.finished) {
      return `<div class="lk-card done" data-action="open" data-id="${esc(it.id)}" role="button" tabindex="0">
          ${pairHtml(it)}
          <div class="lk-card-body">
            <div class="lk-card-title">${title}</div>
            <div class="lk-card-stats"><span>Finished ${fmtShort(it.finished)}</span><span>Best 🔥 ${C.bestStreak(it, today)}</span></div>
          </div>
        </div>`;
    }
    const on = C.isDone(it, today);
    const s = C.streak(it, today), prog = C.progress(it);
    return `<div class="lk-card" data-action="open" data-id="${esc(it.id)}" role="button" tabindex="0">
        ${coverHtml(it)}
        <div class="lk-card-body">
          <div class="lk-card-title">${title}</div>
          <div class="lk-card-stats"><span>${s ? `🔥 <b>${s}</b> ${C.isWeekly(it) ? "wk" : s === 1 ? "day" : "days"}` : "No streak yet"}</span><span><b>${C.consistency(it, today)}%</b> · 30d</span></div>
          <div class="lk-prog"><div class="bar"><span style="width:${prog}%"></span></div><span>${prog}%</span></div>
          <button type="button" class="lk-check${on ? " on" : ""}" data-action="check" data-id="${esc(it.id)}" aria-pressed="${on}">${ICON.check}<span>Worked on it today</span></button>
        </div>
      </div>`;
  }

  function pageHtml() {
    const d = D(), today = L.today();
    const active = C.active(d), finished = C.finished(d);
    const due = C.dueToday(d, today);
    const done = due.filter((it) => C.isDone(it, today)).length;
    let html = `
      <div class="lf-head">
        <div class="lf-hero">
          <div class="stat-label">Done today</div>
          <div class="lf-big">${due.length ? `${done}<span class="lf-of">/${due.length}</span>` : "—"}</div>
          ${due.length ? `<div class="bar lf-bar"><span class="${done === due.length ? "pos-fill" : ""}" style="width:${(done / due.length) * 100}%"></span></div>` : ""}
        </div>
        <div class="lf-actions">${moreMenu([["My sections…", "sections"], ["Export backup", "export"], ["Import backup…", "import"]])}${btn("+ Add", "add", "", "btn-primary")}</div>
      </div>`;
    if (!active.length) html += `<div class="card empty">${finished.length ? "Everything is finished." : "Nothing here yet."}</div>`;
    else html += `<div class="lk-grid">${active.map((it) => cardHtml(it, today)).join("")}</div>`;
    if (finished.length) {
      html += `<details class="history lf-collapse" data-done${ui.doneOpen ? " open" : ""}><summary>Done (${finished.length})</summary>
        <div class="lk-grid">${finished.map((it) => cardHtml(it, today)).join("")}</div></details>`;
    }
    return html;
  }

  // ================= Add / edit =================
  const EMOJIS = ["🦷", "💇", "🧴", "💪", "🧔", "😁", "🧖", "👁️", "🪥", "✂️", "🌞", "💧"];
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const nameFields = (it) => `
    ${row2(field("Name", textInput("name", it.name, 'required maxlength="60" autocomplete="off" placeholder="e.g. Whiter teeth"')),
           field("Emoji", textInput("emoji", it.emoji, 'maxlength="8" autocomplete="off" placeholder="✨"')))}
    <div class="lf-emoji-pick">${EMOJIS.map((e) => `<button type="button" class="chip" data-emoji="${e}">${e}</button>`).join("")}</div>`;
  const wireEmoji = (form) => form.addEventListener("click", (e) => {
    const em = e.target.closest("[data-emoji]");
    if (em) form.emoji.value = em.dataset.emoji;
  });

  // "How often" fields (same three choices as Life habits)
  function scheduleFields(s) {
    const days = s.type === "days" ? s.days || [] : [1, 2, 3, 4, 5];
    const times = Math.max(1, Math.min(7, Number(s.times) || 3));
    return `
      ${fieldDiv("How often", seg("stype", [["daily", "Every day"], ["days", "Some days"], ["weekly", "Times a week"]], s.type || "daily"))}
      <div data-days>${fieldDiv("On", `<div class="seg">${WEEK_ORDER.map((x) =>
        `<label><input type="checkbox" name="day" value="${x}"${days.includes(x) ? " checked" : ""}><span>${DAY_SHORT[x].slice(0, 2)}</span></label>`).join("")}</div>`)}</div>
      <div data-times>${fieldDiv("Times a week", seg("times", [1, 2, 3, 4, 5, 6, 7].map((n) => [n, n]), times))}</div>`;
  }
  function wireSchedule(form) {
    const sync = () => {
      const t = (form.querySelector("[name=stype]:checked") || {}).value;
      form.querySelector("[data-days]").hidden = t !== "days";
      form.querySelector("[data-times]").hidden = t !== "weekly";
    };
    form.addEventListener("change", sync);
    sync();
  }
  // Returns the schedule, or an error message
  function readSchedule(v, form) {
    if (v.stype === "days") {
      const picked = [...form.querySelectorAll("[name=day]:checked")].map((x) => Number(x.value));
      if (!picked.length) return "Pick at least one day.";
      return picked.length === 7 ? { type: "daily" } : { type: "days", days: picked };
    }
    if (v.stype === "weekly") return { type: "weekly", times: Number(v.times) || 1 };
    return { type: "daily" };
  }

  // + Add: a name, an emoji and (optionally) a first photo, which becomes the cover
  function addForm() {
    let file = null;
    const form = openForm("New", `
      ${nameFields({ name: "", emoji: "" })}
      <div class="jr-photo-pick lk-cover-pick">
        <img data-cover-preview alt="" hidden>
        <label class="btn btn-sm jr-change"><span data-cover-label>Add a cover photo</span><input type="file" accept="image/*" class="jr-file" data-cover-file></label>
      </div>`,
    async (v) => {
      if (!v.name) return "Give it a name.";
      const today = L.today();
      const photo = file ? await storePhoto(file) : null;
      return LooksStore.commit((d) => {
        d.items.push({
          id: LooksStore.uid(), name: v.name, emoji: v.emoji, created: today, schedule: { type: "daily" },
          done: [], didActions: {}, how: "", actions: [], log: [], progress: [],
          photos: photo ? [{ id: LooksStore.uid(), date: today, note: "", ...photo, created: Date.now() }] : [],
        });
      });
    }, { submitLabel: "Add" });
    wireEmoji(form);
    const img = form.querySelector("[data-cover-preview]");
    form.querySelector("[data-cover-file]").addEventListener("change", (e) => {
      if (!e.target.files[0]) return;
      file = e.target.files[0];
      const u = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(u);
      img.src = u;
      img.hidden = false;
      form.querySelector("[data-cover-label]").textContent = "Choose another";
    });
  }

  // Edit: name, emoji, how often, start and target dates. Delete at the bottom.
  function editForm(id, after) {
    const it = LooksStore.get(id);
    if (!it) return;
    const form = openForm("Edit", `
      ${nameFields(it)}
      ${scheduleFields(it.schedule || { type: "daily" })}
      ${row2(field("Start date", dateInput("start", it.start || it.created)), field("Target date", dateInput("target", it.target)))}`,
    (v, f) => {
      if (!v.name) return "Give it a name.";
      const schedule = readSchedule(v, f);
      if (typeof schedule === "string") return schedule;
      if (v.start && v.target && v.target < v.start) return "The target date is before the start date.";
      return LooksStore.commit((d) => {
        const x = d.items.find((y) => y.id === id);
        Object.assign(x, { name: v.name, emoji: v.emoji, schedule });
        if (v.start) x.start = v.start; else delete x.start;
        if (v.target) x.target = v.target; else delete x.target;
      });
    }, {
      after,
      onDelete: () => deleteItem(id),
      afterDelete: closeModal,
      confirmText: `Delete "${it.name}" with all its photos, notes and check-ins? This can't be undone.`,
    });
    wireEmoji(form);
    wireSchedule(form);
  }

  function deleteItem(id) {
    const it = LooksStore.get(id);
    const error = LooksStore.commit((d) => { d.items = d.items.filter((x) => x.id !== id); });
    if (!error && it) Media.del(C.mediaOf(it)).catch(() => {});
    return error;
  }

  // Tick / untick a day (today unless a date is given)
  function check(id, date = L.today()) {
    let now = false;
    LooksStore.commit((d) => { now = C.toggle(d.items.find((x) => x.id === id), date); });
    return now;
  }

  // Tapping a card opens the item (replaced further down by the full sheet)
  let openItem = (id) => editForm(id);

  // ================= Actions =================
  const ACTIONS = {
    menu: (id, el) => {
      const menu = el.parentElement.querySelector(".menu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      el.setAttribute("aria-expanded", String(open));
      if (open) { const first = menu.querySelector(".menu-item"); if (first) first.focus(); }
    },
    add: () => addForm(),
    open: (id) => openItem(id),
    check: (id) => check(id),
    sections: () => window.openSections && window.openSections(),
    export: () => Backup.download(),
    import: () => Backup.chooseAndImport(),
  };
  function closeMenus() {
    root.querySelectorAll(".menu:not([hidden])").forEach((m) => {
      m.hidden = true;
      const b = m.parentElement.querySelector("[data-action=menu]");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.dataset.action !== "menu") closeMenus();
    if (!b || !root.contains(b)) return;
    const fn = ACTIONS[b.dataset.action];
    if (fn) { e.preventDefault(); fn(b.dataset.id, b); }
  });
  root.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-action]")) { e.preventDefault(); e.target.click(); }
    if (e.key === "Escape") closeMenus();
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) closeMenus(); });
  root.addEventListener("toggle", (e) => { if (e.target.matches && e.target.matches("[data-done]")) ui.doneOpen = e.target.open; }, true);

  // ================= Drawing =================
  let onLooks = false, stale = true;
  function render() {
    if (!onLooks) { stale = true; return; }   // drawn when the tab is next opened
    stale = false;
    const y = window.scrollY;
    root.innerHTML = pageHtml();
    fillImages(root);
    window.scrollTo(0, y);
  }
  const readHash = () => { onLooks = location.hash.replace("#", "").split("/")[0] === "looksmax"; return onLooks; };
  window.addEventListener("hashchange", () => { if (readHash() && stale) render(); });
  document.addEventListener("lifetracker:looks", render);      // any save (here, Life → Today, a sync)
  document.addEventListener("lifetracker:imported", () => { known.clear(); stale = true; render(); }); // (photo files may have been replaced)

  // Redraw after midnight so "today" moves on
  let lastDay = L.today();
  setInterval(() => {
    if (L.today() === lastDay) return;
    lastDay = L.today();
    render();
  }, 60000);

  readHash();
  render();
})();
