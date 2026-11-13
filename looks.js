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

  // ================= Inside an item =================
  // One sheet with three parts (pills at the top): Photos, Notes, Tracking.
  // The frame is drawn once per opening; switching part, ticking a day or
  // moving the progress slider only redraws the part below the pills.
  const PARTS = [["photos", "Photos"], ["notes", "Notes"], ["tracking", "Tracking"]];
  const sheet = { id: null, part: "photos", day: null }; // open item, shown part, the day the check-in block is for

  function scheduleText(it) {
    const s = it.schedule || { type: "daily" };
    if (s.type === "weekly") return `${C.weeklyTarget(it)}× a week`;
    if (s.type !== "days") return "Every day";
    const days = (s.days || []).slice().sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
    const key = days.join();
    if (key === "1,2,3,4,5") return "Weekdays";
    if (key === "6,0") return "Weekends";
    return days.map((x) => DAY_SHORT[x]).join(", ");
  }
  // Web addresses in notes become links (the text is escaped first)
  const linkify = (text) => esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  // First photo next to the latest: the before / after
  const beforeAfter = (it) => {
    const a = C.firstPhoto(it), b = C.latestPhoto(it);
    if (!a || a.id === b.id) return "";
    const fig = (p, word) => `<figure class="lk-shot-fig"><div class="lk-shot" style="aspect-ratio:${p.w || 3}/${p.h || 4}">${imgTag(p.full, word)}</div><figcaption><b>${word}</b> · ${fmtDate(p.date)}</figcaption></figure>`;
    return `<div class="lk-cmp-side">${fig(a, "Before")}${fig(b, "After")}</div>`;
  };

  function openItem(id, opts = {}) {
    const it = LooksStore.get(id);
    if (!it) return closeModal();
    if (sheet.id !== id || opts.fresh) { sheet.id = id; sheet.part = "photos"; sheet.day = L.today(); }
    if (opts.part) sheet.part = opts.part;
    if (!sheet.day || sheet.day > L.today()) sheet.day = L.today();
    const body = openModal(`${it.emoji ? it.emoji + " " : ""}${it.name}`, `
      <div class="lk-sheet">
        ${it.finished ? `<div class="lk-finished"><div class="stat-label">Finished ${fmtDate(it.finished)}</div>${beforeAfter(it)}</div>` : ""}
        <div class="seg lk-parts" role="radiogroup" aria-label="Part">${PARTS.map(([k, t]) =>
          `<label><input type="radio" name="lkPart" value="${k}"${k === sheet.part ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>
        <div class="lk-part" data-lk-part></div>
        <div class="form-actions"><button type="button" class="btn" data-lk="edit">Edit</button></div>
      </div>`);
    body.parentElement.classList.add("jr-view-box", "lk-box");
    wireSheet(body);
    fillImages(body);
    drawPart();
  }

  function drawPart() {
    const box = document.querySelector("#modal [data-lk-part]");
    const it = LooksStore.get(sheet.id);
    if (!box || !it) return;
    const scroller = box.closest(".modal-box"), y = scroller.scrollTop;
    box.innerHTML = PART_HTML[sheet.part](it);
    Pickers.enhance(box);
    fillImages(box);
    const chart = box.querySelector("[data-prog-chart]");
    if (chart) chart.innerHTML = progressChart(it, box.clientWidth);   // (the chart box itself has no width while empty)
    scroller.scrollTop = y;
  }

  const PART_HTML = {
    // ---- Photos: + Photo, Compare, then the timeline (newest first) ----
    photos(it) {
      const photos = C.photos(it);
      return `
        <div class="lk-bar">
          <label class="btn btn-primary jr-change">+ Photo<input type="file" accept="image/*" class="jr-file" data-photo-file></label>
          ${photos.length >= 2 ? `<button type="button" class="btn" data-lk="compare">Compare</button>` : ""}
        </div>
        ${photos.length ? `<div class="lk-shots">${photos.map((p) => `
          <button type="button" class="lk-shot" data-photo="${esc(p.id)}" aria-label="Photo from ${fmtDate(p.date)}">
            ${imgTag(p.thumb)}
            ${p.animated ? `<span class="jr-gif">GIF</span>` : ""}
            <span class="lk-shot-cap"><b>${fmtShort(p.date)}</b>${p.note ? `<span>${esc(p.note)}</span>` : ""}</span>
          </button>`).join("")}</div>` : `<div class="lk-none">No photos yet.</div>`}`;
    },

    // ---- Notes: how to do it, what I'm doing, dated updates ----
    notes(it) {
      const log = C.log(it);
      return `
        <h3 class="lk-h">How to do it</h3>
        <div class="lk-how" data-lk="how" role="button" tabindex="0">${it.how ? linkify(it.how) : `<span class="lk-placeholder">Info, tips, links…</span>`}</div>

        <h3 class="lk-h">What I'm doing</h3>
        ${it.actions.length ? `<div class="lf-list lf-in-sheet">${it.actions.map((a) => `
          <div class="lf-row lk-wrap" data-act="${esc(a.id)}" role="button" tabindex="0"><span class="lf-main"><span class="lf-title">${esc(a.text)}</span></span></div>`).join("")}</div>` : ""}
        <form class="lk-add" data-add-action novalidate>
          <input name="text" type="text" maxlength="140" autocomplete="off" placeholder="Add an action" aria-label="Add an action">
          <button type="submit" class="btn btn-sm">Add</button>
        </form>

        <h3 class="lk-h">Log<button type="button" class="btn btn-sm" data-lk="add-log">+ Update</button></h3>
        ${log.length ? `<div class="lf-list lf-in-sheet">${log.map((g) => `
          <div class="lf-row lk-wrap" data-log="${esc(g.id)}" role="button" tabindex="0"><span class="lf-main"><span class="lf-meta">${relDay(g.date)}</span><span class="lf-title">${esc(g.text)}</span></span></div>`).join("")}</div>`
          : `<div class="lk-none">No updates yet.</div>`}`;
    },

    // ---- Tracking: check-in, streaks, heatmap, progress, dates, finish ----
    tracking(it) {
      const today = L.today(), day = sheet.day || today;
      const on = C.isDone(it, day);
      const did = C.actionsDone(it, day);
      const cols = C.heatmap(it, today, 12);
      const monthOf = (s) => s.slice(0, 7);
      const months = cols.map((col, i) => (i === 0 || monthOf(col[0].date) !== monthOf(cols[i - 1][0].date)) ? UTC({ month: "short" }).format(L.toUTC(col[0].date)) : "");
      const cell = (c) => {
        const cls = ["lf-hm-cell", c.done ? "done" : "", !c.scheduled ? "off" : "", c.future ? "future" : "", c.date === today ? "today" : "", c.date === day ? "sel" : ""].filter(Boolean).join(" ");
        return c.future ? `<span class="${cls}"></span>`
          : `<button type="button" class="${cls}" data-hm="${c.date}" aria-pressed="${c.done}" aria-label="${fmtDay(c.date)}${c.done ? ", done" : ""}"></button>`;
      };
      const prog = C.progress(it);
      const left = C.daysLeft(it, today);
      const leftText = it.finished || left === null ? "" : left < 0 ? `<span class="neg">${plural(-left, "day")} over</span>` : left === 0 ? "Due today" : `${plural(left, "day")} left`;
      const started = it.start || it.created;
      return `
        <div class="lk-checkin">
          <button type="button" class="lk-check lk-check-big${on ? " on" : ""}" data-lk="check" aria-pressed="${on}">${ICON.check}<span>Worked on it ${day === today ? "today" : "· " + relDay(day)}</span></button>
          ${it.actions.length ? `<div class="lk-did">${it.actions.map((a) =>
            `<button type="button" class="chip${did.includes(a.id) ? " active" : ""}" data-did="${esc(a.id)}" aria-pressed="${did.includes(a.id)}">${esc(a.text)}</button>`).join("")}</div>` : ""}
        </div>
        <div class="lf-stats3">
          <div><span class="stat-label">Streak</span><b>${streakText(it, C.streak(it, today))}</b></div>
          <div><span class="stat-label">Best</span><b>${streakText(it, C.bestStreak(it, today))}</b></div>
          <div><span class="stat-label">Last 30 days</span><b>${C.consistency(it, today)}%</b></div>
        </div>
        <div class="lf-hm" role="group" aria-label="Last 12 weeks. Tap a day to tick or untick it.">
          <div class="lf-hm-months">${months.map((m) => `<span>${m}</span>`).join("")}</div>
          <div class="lf-hm-body">
            <div class="lf-hm-days" aria-hidden="true"><span>M</span><span></span><span>W</span><span></span><span>F</span><span></span><span></span></div>
            <div class="lf-hm-grid">${cols.map((col) => `<div class="lf-hm-col">${col.map(cell).join("")}</div>`).join("")}</div>
          </div>
        </div>

        <h3 class="lk-h">Progress<b class="lk-prog-num" data-prog-label>${prog}%</b></h3>
        <input type="range" class="jr-seek lk-range" min="0" max="100" step="1" value="${prog}" style="--p:${prog}%" aria-label="Progress" data-prog data-native>
        <div class="lk-chart" data-prog-chart></div>

        <div class="lf-list lf-in-sheet lk-plan">
          <div class="lf-row" data-lk="edit" role="button" tabindex="0">
            <span class="lf-main"><span class="lf-title">${esc(scheduleText(it))}</span>
              <span class="lf-meta">${started ? `Started ${fmtShort(started)}` : ""}${it.target ? ` · Target ${fmtShort(it.target)}` : ""}</span></span>
            ${leftText ? `<span class="lf-trail">${leftText}</span>` : ""}
          </div>
        </div>
        <button type="button" class="btn lk-finish" data-lk="${it.finished ? "reopen" : "finish"}">${it.finished ? "Reopen" : "Mark as finished"}</button>`;
    },
  };

  // Small line chart of progress (0–100%) over time, plain SVG sized to the sheet
  function progressChart(it, width) {
    const pts = C.progressPoints(it);
    if (!pts.length) return "";
    const W = Math.max(240, width || 0), H = 120, padX = 8, top = 12, bottom = 22, h = H - top - bottom;
    const x0 = L.toUTC(pts[0].date), x1 = Math.max(L.toUTC(C.asOf(it)), L.toUTC(pts[pts.length - 1].date), x0 + 86400000);
    const X = (date) => padX + ((L.toUTC(date) - x0) / (x1 - x0)) * (W - padX * 2);
    const Y = (v) => top + ((100 - v) / 100) * h;
    const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
    return `<svg class="chart lf-line" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">
      <line class="chart-zero" x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}"></line>
      <line class="lf-target" x1="0" x2="${W}" y1="${Y(100)}" y2="${Y(100)}"></line>
      <path class="lf-line-path" d="${path}"></path>
      ${pts.map((p) => `<circle class="lf-dot" cx="${X(p.date).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="3.5"></circle>`).join("")}
      <text class="chart-label" x="0" y="${H - 6}" text-anchor="start">${fmtShort(pts[0].date)}</text>
      <text class="chart-label" x="${W}" y="${H - 6}" text-anchor="end">${fmtShort(L.fromUTC(x1))}</text>
    </svg>`;
  }

  function wireSheet(body) {
    const id = sheet.id;
    const change = (fn) => LooksStore.commit((d) => fn(d.items.find((x) => x.id === id)));
    body.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("a")) return;                       // a link inside the notes
      const ph = t.closest("[data-photo]");
      if (ph) return photoForm(id, ph.dataset.photo);
      const hm = t.closest("[data-hm]");                 // heatmap: tick / untick that day, and show it in the check-in block
      if (hm) { sheet.day = hm.dataset.hm; check(id, sheet.day); drawPart(); const again = body.querySelector(`[data-hm="${sheet.day}"]`); if (again) again.focus(); return; }
      const did = t.closest("[data-did]");
      if (did) { change((it) => C.toggleAction(it, sheet.day, did.dataset.did)); return drawPart(); }
      const act = t.closest("[data-act]");
      if (act) return actionForm(id, act.dataset.act);
      const lg = t.closest("[data-log]");
      if (lg) return logForm(id, lg.dataset.log);
      const b = t.closest("[data-lk]");
      if (!b) return;
      const what = b.dataset.lk;
      if (what === "check") { check(id, sheet.day); return drawPart(); }
      if (what === "edit") return editForm(id, () => openItem(id));
      if (what === "compare") return compareView(id);
      if (what === "how") return howForm(id);
      if (what === "add-log") return logForm(id);
      if (what === "finish") {
        if (!confirm("Mark as finished? It moves to Done (you can reopen it).")) return;
        change((it) => { it.finished = L.today(); });
        toast("Finished 🎉");
        return openItem(id);
      }
      if (what === "reopen") { change((it) => { delete it.finished; }); return openItem(id); }
    });
    body.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button]")) { e.preventDefault(); e.target.click(); }
    });
    body.addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === "lkPart") { sheet.part = t.value; return drawPart(); }
      if (t.matches("[data-photo-file]")) { if (t.files[0]) photoForm(id, null, t.files[0]); return; }
      if (t.matches("[data-prog]")) {
        // One progress entry per day: moving the slider again today replaces today's
        const value = Math.max(0, Math.min(100, Math.round(Number(t.value) || 0))), today = L.today();
        change((it) => { it.progress = it.progress.filter((p) => p.date !== today).concat({ date: today, value }); });
        const chart = body.querySelector("[data-prog-chart]");
        if (chart) chart.innerHTML = progressChart(LooksStore.get(id), chart.parentElement.clientWidth);
      }
    });
    body.addEventListener("input", (e) => {
      if (!e.target.matches("[data-prog]")) return;
      e.target.style.setProperty("--p", e.target.value + "%");
      body.querySelector("[data-prog-label]").textContent = e.target.value + "%";
    });
    body.addEventListener("submit", (e) => {
      if (!e.target.matches("[data-add-action]")) return;
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      change((it) => { it.actions.push({ id: LooksStore.uid(), text }); });
      drawPart();
      const box = body.querySelector("[data-add-action] input");
      if (box) box.focus();
    });
  }

  // ---- Photo: new (a picked file) or an existing one (date, note, Delete) ----
  function photoForm(itemId, photoId, file) {
    const it = LooksStore.get(itemId);
    const p = photoId ? it.photos.find((x) => x.id === photoId) : null;
    if (photoId && !p) return openItem(itemId);
    let newFile = file || null;
    const today = L.today();
    const form = openForm(p ? "Photo" : "New photo", `
      <div class="jr-photo-pick">
        ${p ? `<button type="button" class="jr-view-photo" data-full aria-label="Show full screen">${imgTag(p.full)}</button>`
            : `<img data-photo-preview alt=""><label class="btn btn-sm jr-change">Choose another<input type="file" accept="image/*" class="jr-file" data-photo-file></label>`}
      </div>
      ${field("Date", dateInput("date", p ? p.date : today, "required"))}
      ${field("Note", textInput("note", p ? p.note : "", 'maxlength="200" autocomplete="off" placeholder="Optional"'))}`,
    async (v) => {
      if (!v.date) return "Pick a date.";
      if (v.date > today) return "That date hasn't happened yet.";
      if (p) return LooksStore.commit((d) => { Object.assign(d.items.find((x) => x.id === itemId).photos.find((x) => x.id === photoId), { date: v.date, note: v.note }); });
      if (!newFile) return "Choose a photo.";
      const stored = await storePhoto(newFile);
      const error = LooksStore.commit((d) => {
        d.items.find((x) => x.id === itemId).photos.push({ id: LooksStore.uid(), date: v.date, note: v.note, ...stored, created: Date.now() });
      });
      if (error) Media.del([stored.full, stored.thumb]).catch(() => {});
      return error;
    }, {
      submitLabel: p ? "Save" : "Add photo",
      after: () => openItem(itemId),
      onDelete: !p ? null : () => {
        const error = LooksStore.commit((d) => { const x = d.items.find((y) => y.id === itemId); x.photos = x.photos.filter((y) => y.id !== photoId); });
        if (!error) Media.del(C.mediaOfPhoto(p)).catch(() => {});
        return error;
      },
      confirmText: "Delete this photo? This can't be undone.",
    });
    fillImages(form);
    if (p) form.querySelector("[data-full]").addEventListener("click", () => fullScreen(p.full));
    else {
      const img = form.querySelector("[data-photo-preview]");
      const show = (f) => { const u = URL.createObjectURL(f); img.onload = () => URL.revokeObjectURL(u); img.src = u; };
      if (newFile) show(newFile);
      form.querySelector("[data-photo-file]").addEventListener("change", (e) => { if (e.target.files[0]) { newFile = e.target.files[0]; show(newFile); } });
    }
  }

  // Photo full screen: tap anywhere or Escape to close
  function fullScreen(mediaId) {
    const box = document.createElement("div");
    box.className = "jr-full";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Photo");
    box.tabIndex = -1;
    box.innerHTML = `<img alt=""><button type="button" class="jr-full-close" aria-label="Close">${ICON.close}</button>`;
    Media.url(mediaId).then((u) => { if (u) box.querySelector("img").src = u; });
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    box.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(box);
    box.focus();
  }

  // ---- Compare: any two photos, side by side or with a drag slider ----
  const cmp = { mode: "side" };
  function compareView(itemId) {
    const it = LooksStore.get(itemId);
    const photos = C.photos(it);
    if (photos.length < 2) return openItem(itemId);
    let a = C.firstPhoto(it).id, b = C.latestPhoto(it).id;
    const byId = (pid) => photos.find((p) => p.id === pid) || photos[0];
    const options = (sel) => photos.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(fmtDate(p.date) + (p.note ? " · " + p.note : ""))}</option>`).join("");
    const body = openModal("Compare", `
      <div class="lk-cmp">
        ${seg("cmpMode", [["side", "Side by side"], ["slider", "Slider"]], cmp.mode)}
        <div class="form-row lk-cmp-pick">
          ${field("Before", `<select name="cmpA">${options(a)}</select>`)}
          ${field("After", `<select name="cmpB">${options(b)}</select>`)}
        </div>
        <div data-cmp-view></div>
        <div class="form-actions"><button type="button" class="btn" data-cmp-back>Back</button></div>
      </div>`);
    body.parentElement.classList.add("jr-view-box", "lk-box");
    const view = body.querySelector("[data-cmp-view]");
    const draw = () => {
      const A = byId(a), B = byId(b);
      if (cmp.mode === "slider") {
        // Both pictures fill the same frame (the "after" photo's shape); the "before" one is clipped at the handle
        const ratio = (B.w || 3) / (B.h || 4);
        view.innerHTML = `
          <div class="lk-slider" data-slider style="aspect-ratio:${ratio};width:min(100%, calc(64vh * ${ratio}));--pos:50%">
            ${imgTag(B.full, "After")}
            <div class="lk-slider-top">${imgTag(A.full, "Before")}</div>
            <span class="lk-slider-tag l">${fmtShort(A.date)}</span><span class="lk-slider-tag r">${fmtShort(B.date)}</span>
            <span class="lk-slider-line" aria-hidden="true"><i></i></span>
          </div>
          <input type="range" class="jr-seek lk-range lk-slider-range" min="0" max="100" step="1" value="50" style="--p:50%" aria-label="Slide between before and after" data-slide data-native>`;
      } else {
        const fig = (p, word) => `<figure class="lk-shot-fig"><button type="button" class="lk-shot" data-full="${esc(p.full)}" style="aspect-ratio:${p.w || 3}/${p.h || 4}" aria-label="${word}, full screen">${imgTag(p.full, word)}</button><figcaption><b>${word}</b> · ${fmtDate(p.date)}</figcaption></figure>`;
        view.innerHTML = `<div class="lk-cmp-side">${fig(A, "Before")}${fig(B, "After")}</div>`;
      }
      fillImages(view);
    };
    const setPos = (pct) => {
      const s = view.querySelector("[data-slider]"), r = view.querySelector("[data-slide]");
      if (!s) return;
      const v = Math.max(0, Math.min(100, pct));
      s.style.setProperty("--pos", v + "%");
      r.value = Math.round(v);
      r.style.setProperty("--p", v + "%");
    };
    body.addEventListener("change", (e) => {
      if (e.target.name === "cmpMode") { cmp.mode = e.target.value; draw(); }
      if (e.target.name === "cmpA") { a = e.target.value; draw(); }
      if (e.target.name === "cmpB") { b = e.target.value; draw(); }
    });
    body.addEventListener("input", (e) => { if (e.target.matches("[data-slide]")) setPos(Number(e.target.value)); });
    body.addEventListener("click", (e) => {
      if (e.target.closest("[data-cmp-back]")) return openItem(itemId);
      const full = e.target.closest("[data-full]");
      if (full) fullScreen(full.dataset.full);
    });
    // Drag anywhere on the picture (sideways; up / down still scrolls the sheet)
    let dragging = false;
    const at = (e) => { const s = view.querySelector("[data-slider]"); const r = s.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
    view.addEventListener("pointerdown", (e) => {
      const s = e.target.closest("[data-slider]");
      if (!s) return;
      dragging = true;
      try { s.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      at(e);
    });
    view.addEventListener("pointermove", (e) => { if (dragging) at(e); });
    const stop = () => { dragging = false; };
    view.addEventListener("pointerup", stop);
    view.addEventListener("pointercancel", stop);
    draw();
  }

  // ---- Notes forms ----
  function howForm(itemId) {
    const it = LooksStore.get(itemId);
    openForm("How to do it", field("Info, tips, links", `<textarea name="how" rows="9">${esc(it.how)}</textarea>`),
      (v) => LooksStore.commit((d) => { d.items.find((x) => x.id === itemId).how = v.how; }),
      { after: () => openItem(itemId) });
  }

  // An action I'm taking: edit the text, move it up / down the list, Delete at the bottom
  function actionForm(itemId, actionId) {
    const it = LooksStore.get(itemId);
    const i = it.actions.findIndex((a) => a.id === actionId);
    if (i < 0) return openItem(itemId);
    const back = () => openItem(itemId);
    const form = openForm("Action", `
      ${field("What I'm doing", textInput("text", it.actions[i].text, 'required maxlength="140" autocomplete="off"'))}
      ${it.actions.length > 1 ? `<div class="form-extra">
        <button type="button" class="btn btn-sm" data-move="-1"${i === 0 ? " disabled" : ""}>Move up</button>
        <button type="button" class="btn btn-sm" data-move="1"${i === it.actions.length - 1 ? " disabled" : ""}>Move down</button>
      </div>` : ""}`,
    (v) => {
      if (!v.text) return "Say what you're doing.";
      return LooksStore.commit((d) => { d.items.find((x) => x.id === itemId).actions.find((a) => a.id === actionId).text = v.text; });
    }, {
      after: back,
      onDelete: () => LooksStore.commit((d) => {
        const x = d.items.find((y) => y.id === itemId);
        x.actions = x.actions.filter((a) => a.id !== actionId);
        for (const day of Object.keys(x.didActions)) {       // forget its ticks too
          x.didActions[day] = x.didActions[day].filter((a) => a !== actionId);
          if (!x.didActions[day].length) delete x.didActions[day];
        }
      }),
      confirmText: "Remove this action?",
    });
    form.addEventListener("click", (e) => {
      const m = e.target.closest("[data-move]");
      if (!m) return;
      LooksStore.commit((d) => {
        const list = d.items.find((x) => x.id === itemId).actions;
        const from = list.findIndex((a) => a.id === actionId), to = from + Number(m.dataset.move);
        if (to < 0 || to >= list.length) return;
        [list[from], list[to]] = [list[to], list[from]];
      });
      actionForm(itemId, actionId); // stay here so it can be moved again
    });
  }

  // A dated update on how it's going
  function logForm(itemId, logId) {
    const it = LooksStore.get(itemId);
    const g = logId ? it.log.find((x) => x.id === logId) : null;
    if (logId && !g) return openItem(itemId);
    const today = L.today();
    openForm(g ? "Update" : "New update", `
      ${field("Date", dateInput("date", g ? g.date : today, "required"))}
      ${field("How it's going", `<textarea name="text" rows="3" maxlength="600" placeholder="e.g. Noticeably lighter after 2 weeks">${esc(g ? g.text : "")}</textarea>`)}`,
    (v) => {
      if (!v.text) return "Write a short update.";
      if (!v.date) return "Pick a date.";
      if (v.date > today) return "That date hasn't happened yet.";
      return LooksStore.commit((d) => {
        const x = d.items.find((y) => y.id === itemId);
        if (g) Object.assign(x.log.find((y) => y.id === logId), { date: v.date, text: v.text });
        else x.log.push({ id: LooksStore.uid(), date: v.date, text: v.text, created: Date.now() });
      });
    }, {
      submitLabel: g ? "Save" : "Add",
      after: () => openItem(itemId),
      onDelete: !g ? null : () => LooksStore.commit((d) => { const x = d.items.find((y) => y.id === itemId); x.log = x.log.filter((y) => y.id !== logId); }),
      confirmText: "Delete this update?",
    });
  }

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
    open: (id) => openItem(id, { fresh: true }),
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
