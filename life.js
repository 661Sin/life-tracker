// ---------- Life screens ----------
// Draws the Life sub-pages (Today, Habits, Plans, Fitness, School, Sleep) and
// handles their forms. Data comes from LifeStore (life-store.js); every number
// comes from LifeCalc (life-calc.js). Sub-pages live in the URL hash:
// #life/today, #life/habits, ...
//
// Design rules: one orange action per page, everything else in the ⋯ menu;
// the key number big; tap a row to open it (Delete / Archive at the bottom).

(function () {
  const root = document.getElementById("life-root");
  if (!root) return;

  const VIEWS = [
    ["today", "Today"],
    ["habits", "Habits"],
    ["plans", "Plans"],
    ["fitness", "Fitness"],
    ["school", "School"],
    ["sleep", "Sleep"],
  ];
  let view = "today";
  const L = LifeCalc;
  const D = () => LifeStore.data;

  // ================= Formatting helpers =================
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const num = (v) => (v === "" || v == null ? 0 : Number(v));
  const UTC = (fmt) => new Intl.DateTimeFormat("en-NZ", { ...fmt, timeZone: "UTC" });
  const F_DAY = UTC({ weekday: "short", day: "numeric", month: "short" });
  const F_LONG = UTC({ weekday: "long", day: "numeric", month: "long" });
  const F_DATE = UTC({ day: "numeric", month: "short", year: "numeric" });
  const F_SHORT = UTC({ day: "numeric", month: "short" });
  const fmtDay = (s) => F_DAY.format(L.toUTC(s));
  const fmtDate = (s) => (s ? F_DATE.format(L.toUTC(s)) : "—");
  const fmtShort = (s) => F_SHORT.format(L.toUTC(s));
  // "Today", "Tomorrow", "Yesterday", or "Mon 16 Nov"
  const relDay = (s, today = L.today()) => {
    const n = L.daysBetween(today, s);
    return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : fmtDay(s);
  };
  // Due label: "Today", "Tomorrow", "In 5 days", "2 days overdue"
  const dueText = (due, today = L.today()) => {
    const n = L.daysBetween(today, due);
    if (n < 0) return `${plural(-n, "day")} overdue`;
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return n <= 14 ? `In ${n} days` : fmtShort(due);
  };
  const fmtHours = (h) => {
    if (h === null || h === undefined) return "—";
    const m = Math.round(h * 60);
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  };
  const fmtNum = (n) => (Math.round(n * 100) / 100).toLocaleString("en-NZ");
  const pct = (x) => `${Math.round(x * 100)}%`;

  // ================= Building blocks =================
  const btn = (label, action, id = "", cls = "") =>
    `<button type="button" class="btn ${cls}" data-action="${action}"${id !== "" ? ` data-id="${esc(id)}"` : ""}>${label}</button>`;
  // ⋯ menu: items = [[label, action, id?]]
  const moreMenu = (items) => !items.length ? "" : `
    <div class="menu-wrap">
      <button type="button" class="btn btn-ghost btn-icon" data-action="menu" aria-label="More options" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu card" hidden>${items.map(([label, action, id]) =>
        `<button type="button" class="menu-item" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${label}</button>`).join("")}</div>
    </div>`;
  // Page top: the key number on the left, ⋯ and the one orange action on the right
  const head = ({ label, big, sub = "", bar = null, primary = null, menu = [], tap = "" }) => `
    <div class="lf-head">
      <div class="lf-hero${tap ? " lf-tap" : ""}"${tap ? ` data-action="${tap}" role="button" tabindex="0"` : ""}>
        <div class="stat-label">${label}</div>
        <div class="lf-big">${big}</div>
        ${bar !== null ? `<div class="bar lf-bar"><span style="width:${Math.max(0, Math.min(100, bar * 100))}%"></span></div>` : ""}
        ${sub ? `<div class="lf-sub">${sub}</div>` : ""}
      </div>
      <div class="lf-actions">${moreMenu(menu)}${primary ? btn(primary[0], primary[1], primary[2] || "", "btn-primary") : ""}</div>
    </div>`;
  // A tappable row: lead (emoji / tick), title + meta, trailing value
  const rowEl = ({ action, id = "", lead = "", title, meta = "", trail = "", cls = "" }) => `
    <div class="lf-row ${cls}" data-action="${action}" data-id="${esc(id)}" role="button" tabindex="0">
      ${lead ? `<span class="lf-lead">${lead}</span>` : ""}
      <span class="lf-main"><span class="lf-title">${title}</span>${meta ? `<span class="lf-meta">${meta}</span>` : ""}</span>
      ${trail ? `<span class="lf-trail">${trail}</span>` : ""}
    </div>`;
  const tick = (on, action, id, label) =>
    `<button type="button" class="lf-tick${on ? " on" : ""}" data-action="${action}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${esc(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg></button>`;
  const listCard = (rows, cls = "") => `<div class="card lf-list ${cls}">${rows.join("")}</div>`;
  const section = (title, body, extra = "") => `<h3 class="group-title lf-group">${title}${extra}</h3>${body}`;
  const emptyCard = (text) => `<div class="card empty">${text}</div>`;
  const collapsed = (title, body) => `<details class="history lf-collapse"><summary>${title}</summary>${body}</details>`;

  // ---- Form fields ----
  const field = (label, control, hint = "") =>
    `<label class="field"><span class="field-label">${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ""}</label>`;
  const fieldDiv = (label, control, hint = "") =>
    `<div class="field"><span class="field-label">${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ""}</div>`;
  const row2 = (...f) => `<div class="form-row">${f.join("")}</div>`;
  const textInput = (name, value, extra = "") => `<input name="${name}" type="text" value="${esc(value)}" ${extra}>`;
  const numInput = (name, value, extra = "") => `<input name="${name}" type="number" inputmode="decimal" step="any" value="${value ?? ""}" ${extra}>`;
  const dateInput = (name, value, extra = "") => `<input name="${name}" type="date" value="${value || ""}" ${extra}>`;
  const timeInput = (name, value, extra = "") => `<input name="${name}" type="time" step="300" value="${value || ""}" ${extra}>`;
  const textArea = (name, value) => `<textarea name="${name}" rows="2">${esc(value)}</textarea>`;
  const select = (name, options, selected, extra = "") =>
    `<select name="${name}" ${extra}>${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(selected ?? "") ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  // Row of pill buttons (radio inputs underneath), like Cash / Bank in PnL
  const seg = (name, options, value) => `<div class="seg">${options.map(([v, t]) =>
    `<label><input type="radio" name="${name}" value="${esc(v)}"${String(v) === String(value) ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>`;

  // Opens a form in the shared sheet. onSubmit(values, form) returns an error
  // message, or nothing on success (then it closes and the page redraws).
  // opts.onDelete: a Delete button at the bottom (asks first). opts.deleteLabel
  // changes its wording (e.g. "Archive"); opts.confirmText the question.
  function openForm(title, fieldsHtml, onSubmit, opts = {}) {
    const body = openModal(title, `
      <form class="form">
        ${fieldsHtml}
        <div class="form-error" hidden></div>
        <div class="form-actions">
          ${opts.onDelete ? `<button type="button" class="btn btn-ghost danger form-delete" data-form-delete>${opts.deleteLabel || "Delete"}</button>` : ""}
          <button type="button" class="btn" data-close-modal>Cancel</button>
          ${onSubmit ? `<button type="submit" class="btn btn-primary">${opts.submitLabel || "Save"}</button>` : ""}
        </div>
      </form>`);
    const form = body.querySelector("form");
    const errorBox = form.querySelector(".form-error");
    const fail = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      const values = Object.fromEntries(new FormData(form));
      for (const k in values) if (typeof values[k] === "string") values[k] = values[k].trim();
      const error = onSubmit(values, form);
      if (error) return fail(error);
      closeModal();
      render();
      if (opts.after) opts.after();
    });
    const del = form.querySelector("[data-form-delete]");
    if (del) del.addEventListener("click", () => {
      if (!confirm(opts.confirmText || "Delete this? This can't be undone.")) return;
      const error = opts.onDelete();
      if (error) return fail(error);
      closeModal();
      render();
    });
    return form;
  }
  const formValues = (form) => Object.fromEntries(new FormData(form));
  function upsertIn(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  }
  function removeFrom(list, id) {
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list.splice(i, 1);
  }
  function save(change) {
    const error = LifeStore.commit(change);
    if (error) alert(error); else render();
    return error;
  }

  // Small glass message at the bottom, e.g. "New PR: Bench 82.5 kg"
  function toast(text) {
    const t = document.createElement("div");
    t.className = "lf-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    if (canAnimate()) t.animate([{ opacity: 0, transform: "translate(-50%, 16px) scale(0.96)" }, { opacity: 1, transform: "translate(-50%, 0)" }],
      { duration: 320, easing: cssVar("--ease-spring") || "ease-out" });
    setTimeout(() => {
      if (!canAnimate()) return t.remove();
      const a = t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" });
      a.onfinish = () => t.remove();
    }, 2600);
  }

  // ================= Pages =================
  const PAGES = {};
  const ACTIONS = {};

  // ---------- Today ----------
  // The daily check-in: habits to tick, tasks due, school due soon, last
  // night's sleep, and Log workout as the one main action.
  const QUALITY = [["1", "😫", "Awful"], ["2", "😕", "Poor"], ["3", "😐", "OK"], ["4", "🙂", "Good"], ["5", "😄", "Great"]];

  PAGES.today = (d) => {
    const today = L.today();
    const habits = d.habits.filter((h) => L.dueToday(h, today));
    const done = habits.filter((h) => L.isDone(h, today)).length;
    const active = d.habits.filter((h) => !h.archived);
    const streak = Math.max(0, ...active.map((h) => (L.isWeekly(h) ? 0 : L.streak(h, today))));
    const b = L.taskBuckets(d.tasks, today);
    const dueTasks = [...b.overdue, ...b.today];
    const school = L.dueStandards(d.standards, today, 14);
    const night = d.sleep.find((s) => s.date === today);

    const subBits = [];
    if (streak > 1) subBits.push(`🔥 ${streak}-day streak`);
    if (night) subBits.push(`<button type="button" class="lf-chip" data-action="edit-sleep" data-id="${esc(night.id)}">😴 ${fmtHours(L.sleepHours(night.bed, night.wake))}</button>`);
    let html = head({
      label: F_LONG.format(L.toUTC(today)),
      big: habits.length ? `${done}<span class="lf-of">/${habits.length}</span>` : String(dueTasks.length),
      sub: [habits.length ? (done === habits.length ? "All habits done" : "habits done") : plural(dueTasks.length, "task") + " due", ...subBits].join(" · "),
      bar: habits.length ? done / habits.length : null,
      primary: ["Log workout", "add-workout"],
      menu: [["Log sleep…", "add-sleep"], ["New task…", "add-task"], ["Export backup", "export"], ["Import backup…", "import"]],
    });

    if (!night) html += sleepQuick(d, today);

    if (habits.length) {
      html += section("Habits", listCard(habits.map((h) => {
        const on = L.isDone(h, today);
        const s = L.streak(h, today);
        const meta = L.isWeekly(h) ? `${L.weekCount(h, today)}/${L.weeklyTarget(h)} this week` : s ? `🔥 ${plural(s, "day")}` : "";
        return rowEl({ action: "tick-habit", id: h.id, cls: on ? "done" : "", lead: tick(on, "tick-habit", h.id, `${h.name} done today`),
          title: `${h.emoji ? `<span class="lf-emoji">${esc(h.emoji)}</span>` : ""}${esc(h.name)}`, meta });
      })));
    }

    if (dueTasks.length) html += section("Due", listCard(dueTasks.map((t) => taskRow(t, today))));

    if (school.length) {
      html += section("School · next 14 days", listCard(school.map((s) => rowEl({
        action: "edit-standard", id: s.id, cls: s.due < today ? "overdue" : "",
        lead: `<span class="lf-code">${esc(s.subject ? s.subject.slice(0, 3) : "NCEA")}</span>`,
        title: esc(s.title || s.code), meta: [esc(s.code), plural(Number(s.credits) || 0, "credit"), esc(s.status)].filter(Boolean).join(" · "),
        trail: `<span class="${s.due < today ? "neg" : ""}">${dueText(s.due, today)}</span>`,
      }))));
    }

    if (!habits.length && !dueTasks.length && !school.length && night) {
      html += emptyCard(`Nothing else today. <a href="#life/habits">Add a habit</a> to check in daily.`);
    } else if (!active.length && !d.tasks.length && !d.standards.length) {
      html += emptyCard(`<a href="#life/habits">Add a habit</a> to start your daily check-in.`);
    }
    return html;
  };

  // Last night's sleep in a couple of taps: bed and wake times start at your
  // usual ones; tapping how you slept saves it.
  function sleepQuick(d, today) {
    const last = d.sleep.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const bed = last ? last.bed : "23:00", wake = last ? last.wake : "07:00";
    return `<div class="card lf-sleep" data-sleep-quick>
      <div class="lf-sleep-head"><h3>Last night</h3><b class="lf-sleep-hours" data-sleep-hours>${fmtHours(L.sleepHours(bed, wake))}</b></div>
      <div class="form-row lf-sleep-times">
        ${field("Bed", timeInput("qbed", bed))}
        ${field("Woke", timeInput("qwake", wake))}
      </div>
      <div class="lf-quality" role="group" aria-label="How did you sleep? Tap to save">
        ${QUALITY.map(([v, e, t]) => `<button type="button" class="lf-q" data-action="quick-sleep" data-id="${v}" aria-label="${t}"><span>${e}</span><small>${t}</small></button>`).join("")}
      </div>
      <p class="field-hint">Tap how you slept to save.</p>
    </div>`;
  }
  ACTIONS["quick-sleep"] = (q) => {
    const box = root.querySelector("[data-sleep-quick]");
    const bed = box.querySelector("[name=qbed]").value, wake = box.querySelector("[name=qwake]").value;
    if (!bed || !wake) return alert("Set your bed and wake times first.");
    const today = L.today();
    const item = { id: LifeStore.uid(), date: today, bed, wake, quality: Number(q) };
    if (!save((d) => { d.sleep = d.sleep.filter((s) => s.date !== today); d.sleep.push(item); })) {
      toast(`Sleep saved: ${fmtHours(L.sleepHours(bed, wake))}`);
    }
  };

  ACTIONS["tick-habit"] = (id, el) => {
    const day = (el && el.dataset && el.dataset.date) || L.today(); // heatmap cells pass a past day
    save((d) => {
      const h = d.habits.find((x) => x.id === id);
      h.done = h.done.includes(day) ? h.done.filter((x) => x !== day) : [...h.done, day].sort();
    });
  };

  // ---------- Tasks (shared by Today and Plans) ----------
  const PRIORITY_LABEL = { high: "High", med: "Medium", low: "Low" };
  function taskRow(t, today) {
    const overdue = !t.done && t.due && t.due < today;
    const goal = t.goalId ? LifeStore.get("goals", t.goalId) : null;
    const std = t.standardId ? LifeStore.get("standards", t.standardId) : null;
    const meta = [
      t.due ? `<span class="${overdue ? "neg" : ""}">${t.done ? fmtShort(t.due) : dueText(t.due, today)}</span>` : "",
      t.priority === "high" ? `<span class="lf-flag">High</span>` : "",
      goal ? esc((goal.emoji ? goal.emoji + " " : "") + goal.title) : "",
      std ? esc(std.code) : "",
      t.repeat ? `↻ ${t.repeat}` : "",
    ].filter(Boolean).join(" · ");
    return rowEl({ action: "edit-task", id: t.id, cls: (t.done ? "done" : "") + (overdue ? " overdue" : ""),
      lead: tick(!!t.done, "tick-task", t.id, `${t.title} done`), title: esc(t.title), meta });
  }

  // ================= Actions =================
  Object.assign(ACTIONS, {
    menu: (id, el) => {
      const menu = el.parentElement.querySelector(".menu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      el.setAttribute("aria-expanded", String(open));
      if (open) { const first = menu.querySelector(".menu-item"); if (first) first.focus(); }
    },
    export: () => Backup.download(),
    import: () => Backup.chooseAndImport(),
  });
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
  // Rows are <div role="button">: Enter / Space open them like a button
  root.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-action]")) { e.preventDefault(); e.target.click(); }
    if (e.key === "Escape") closeMenus();
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) closeMenus(); });
  // Today's sleep card: keep the hours up to date while times change
  root.addEventListener("change", (e) => {
    const box = e.target.closest("[data-sleep-quick]");
    if (!box) return;
    const out = box.querySelector("[data-sleep-hours]");
    out.textContent = fmtHours(L.sleepHours(box.querySelector("[name=qbed]").value, box.querySelector("[name=qwake]").value));
  });

  // ================= Drawing =================
  // Same as PnL: the sub-tab bar is drawn once (so its bubble can slide); only
  // the page below is replaced. animate = slide the new page in.
  const viewIndex = (key) => VIEWS.findIndex(([k]) => k === key);
  let lastScrollY = 0;
  function render(animate = false) {
    let nav = root.querySelector(".subnav");
    if (!nav) {
      root.innerHTML = `<nav class="subnav" aria-label="Life pages">${VIEWS.map(([key, label]) =>
        `<a href="#life/${key}" class="subnav-link" data-view="${key}">${label}</a>`).join("")}</nav><div class="pnl-pages lf-pages"></div>`;
      nav = root.querySelector(".subnav");
    }
    nav.querySelectorAll(".subnav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
    const holder = root.querySelector(".lf-pages");
    const old = holder.querySelector(".pnl-page:not(.leaving)");
    const page = document.createElement("div");
    page.className = "pnl-page lf-page";
    page.dataset.view = view;
    const keepY = !animate && old && old.dataset.view === view ? window.scrollY : null;
    page.innerHTML = PAGES[view](D());
    holder.insertBefore(page, old);
    const dir = animate && old ? Math.sign(viewIndex(view) - viewIndex(old.dataset.view)) : 0;
    if (old) slidePage(old, page, dir, () => old.remove());
    if (keepY !== null) window.scrollTo(0, keepY);
    if (page.querySelector("[data-chart]")) drawCharts(page);
    moveBubble(nav);
    scrollActiveIntoView(nav);
  }
  // Charts are sized to their card, so they're drawn once the page is in place
  const CHARTS = {};
  function drawCharts(page) {
    page.querySelectorAll("[data-chart]").forEach((el) => { if (CHARTS[el.dataset.chart]) CHARTS[el.dataset.chart](el); });
  }
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!onLife) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { const p = root.querySelector(".lf-page:not(.leaving)"); if (p) drawCharts(p); }, 150);
  });

  let onLife = false;
  function readHash() {
    const [tab, sub] = location.hash.replace("#", "").split("/");
    onLife = tab === "life";
    if (!onLife) return false;
    view = VIEWS.some(([k]) => k === sub) ? sub : "today";
    return true;
  }
  window.addEventListener("hashchange", () => { const was = onLife; if (readHash()) render(was); });
  document.addEventListener("lifetracker:imported", () => render());

  // Redraw after midnight so "today" moves on
  let lastDay = L.today();
  setInterval(() => {
    if (L.today() === lastDay) return;
    lastDay = L.today();
    render();
  }, 60000);

  LifeStore.load();
  readHash();
  render();
})();
