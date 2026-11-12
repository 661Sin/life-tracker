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
  // A goal value with its unit: "$1,500", "85 kg"
  const withUnit = (n, unit) => !unit ? fmtNum(n) : /^[$€£]/.test(unit) ? unit + fmtNum(n) : `${fmtNum(n)} ${unit}`;

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
  const CHARTS = {}; // name → draw(el), for charts sized to their card

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
        ${field("Bed", timeInput("qbed", bed, "required"))}
        ${field("Woke", timeInput("qwake", wake, "required"))}
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
  function taskRow(t, today, inGoal = false) {
    const overdue = !t.done && t.due && t.due < today;
    const goal = t.goalId && !inGoal ? LifeStore.get("goals", t.goalId) : null;
    const std = t.standardId ? LifeStore.get("standards", t.standardId) : null;
    const meta = [
      t.due ? `<span class="${overdue ? "neg" : ""}">${t.done ? fmtShort(t.due) : dueText(t.due, today)}</span>` : "",
      t.priority === "high" ? `<span class="lf-flag">High</span>` : "",
      goal ? esc((goal.emoji ? goal.emoji + " " : "") + goal.title) : "",
      std ? esc(std.code) : "",
      t.repeat ? `↻ ${t.repeat}` : "",
    ].filter(Boolean).join(" · ");
    return rowEl({ action: "edit-task", id: t.id, cls: "task" + (t.done ? " done" : "") + (overdue ? " overdue" : ""),
      lead: tick(!!t.done, "tick-task", t.id, `${t.title} done`), title: esc(t.title), meta });
  }

  // ---------- Habits ----------
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  function scheduleText(h) {
    const s = h.schedule || { type: "daily" };
    if (s.type === "weekly") return `${L.weeklyTarget(h)}× a week`;
    if (s.type !== "days") return "Every day";
    const days = (s.days || []).slice().sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
    const key = days.join();
    if (key === "1,2,3,4,5") return "Weekdays";
    if (key === "6,0") return "Weekends";
    if (days.length === 7) return "Every day";
    return days.map((x) => DAY_SHORT[x]).join(", ");
  }
  const streakUnit = (h, n) => plural(n, L.isWeekly(h) ? "week" : "day");

  PAGES.habits = (d) => {
    const today = L.today();
    const active = d.habits.filter((h) => !h.archived);
    const archived = d.habits.filter((h) => h.archived);
    const due = active.filter((h) => L.dueToday(h, today));
    const done = due.filter((h) => L.isDone(h, today)).length;
    let html = head({
      label: "Done today",
      big: due.length ? `${done}<span class="lf-of">/${due.length}</span>` : "—",
      bar: due.length ? done / due.length : null,
      primary: ["New habit", "add-habit"],
      menu: archived.length ? [[`Archived habits (${archived.length})`, "archived-habits"]] : [],
    });
    if (!active.length) return html + emptyCard("No habits yet.");
    html += listCard(active.map((h) => {
      const on = L.isDone(h, today);
      const s = L.streak(h, today);
      return rowEl({
        action: "open-habit", id: h.id, cls: on ? "done" : "",
        lead: tick(on, "tick-habit", h.id, `${h.name} done today`),
        title: `${h.emoji ? `<span class="lf-emoji">${esc(h.emoji)}</span>` : ""}${esc(h.name)}`,
        meta: esc(scheduleText(h)) + (L.isWeekly(h) ? ` · ${L.weekCount(h, today)}/${L.weeklyTarget(h)} this week` : ""),
        trail: s ? `🔥 ${s}<span class="muted"> ${L.isWeekly(h) ? "wk" : "d"}</span>` : `<span class="muted">—</span>`,
      });
    }));
    return html;
  };

  // Stats + 12-week heatmap for the habit sheet. Tapping a past day ticks it.
  function habitStats(h) {
    const today = L.today();
    const cols = L.heatmap(h, today, 12);
    const monthOf = (s) => s.slice(0, 7);
    const months = cols.map((col, i) => (i === 0 || monthOf(col[0].date) !== monthOf(cols[i - 1][0].date))
      ? UTC({ month: "short" }).format(L.toUTC(col[0].date)) : "");
    const cell = (c) => {
      const cls = ["lf-hm-cell", c.done ? "done" : "", !c.scheduled ? "off" : "", c.future ? "future" : "", c.date === today ? "today" : ""].filter(Boolean).join(" ");
      return c.future ? `<span class="${cls}"></span>`
        : `<button type="button" class="${cls}" data-hm="${c.date}" aria-pressed="${c.done}" aria-label="${fmtDay(c.date)}${c.done ? ", done" : ""}"></button>`;
    };
    return `
      <div class="lf-stats3">
        <div><span class="stat-label">Streak</span><b>${streakUnit(h, L.streak(h, today))}</b></div>
        <div><span class="stat-label">Best</span><b>${streakUnit(h, L.bestStreak(h, today))}</b></div>
        <div><span class="stat-label">Last 30 days</span><b>${L.completion(h, today, 30)}%</b></div>
      </div>
      <div class="lf-hm" role="group" aria-label="Last 12 weeks. Tap a day to tick or untick it.">
        <div class="lf-hm-months">${months.map((m) => `<span>${m}</span>`).join("")}</div>
        <div class="lf-hm-body">
          <div class="lf-hm-days" aria-hidden="true"><span>M</span><span></span><span>W</span><span></span><span>F</span><span></span><span></span></div>
          <div class="lf-hm-grid">${cols.map((col) => `<div class="lf-hm-col">${col.map(cell).join("")}</div>`).join("")}</div>
        </div>
      </div>`;
  }

  const EMOJIS = ["📚", "💧", "🏃", "🧘", "💪", "🛏️", "🥗", "🧠", "✍️", "🎸", "🙏", "📵"];
  function habitForm(id) {
    const h = id ? LifeStore.get("habits", id) : { name: "", emoji: "", schedule: { type: "daily" } };
    const s = h.schedule || { type: "daily" };
    const days = s.type === "days" ? s.days || [] : [1, 2, 3, 4, 5];
    const archived = !!h.archived;
    const form = openForm(id ? `${h.emoji ? h.emoji + " " : ""}${h.name}` : "New habit", `
      ${id ? `<div data-habit-stats>${habitStats(h)}</div>` : ""}
      ${row2(field("Habit", textInput("name", h.name, 'required placeholder="e.g. Read 20 pages"')),
             field("Emoji", textInput("emoji", h.emoji, 'maxlength="8" placeholder="📚"')))}
      <div class="lf-emoji-pick">${EMOJIS.map((e) => `<button type="button" class="chip" data-emoji="${e}">${e}</button>`).join("")}</div>
      ${fieldDiv("How often", seg("stype", [["daily", "Every day"], ["days", "Some days"], ["weekly", "Times a week"]], s.type || "daily"))}
      <div data-days>${fieldDiv("On", `<div class="seg">${WEEK_ORDER.map((x) =>
        `<label><input type="checkbox" name="day" value="${x}"${days.includes(x) ? " checked" : ""}><span>${DAY_SHORT[x].slice(0, 2)}</span></label>`).join("")}</div>`)}</div>
      <div data-times>${fieldDiv("Times a week", seg("times", [1, 2, 3, 4, 5, 6, 7].map((n) => [n, n]), L.weeklyTarget(h)))}</div>`,
    (v, f) => {
      if (!v.name) return "Give the habit a name.";
      let schedule = { type: "daily" };
      if (v.stype === "days") {
        const picked = [...f.querySelectorAll("[name=day]:checked")].map((x) => Number(x.value));
        if (!picked.length) return "Pick at least one day.";
        schedule = picked.length === 7 ? { type: "daily" } : { type: "days", days: picked };
      } else if (v.stype === "weekly") schedule = { type: "weekly", times: Number(v.times) || 1 };
      return LifeStore.commit((d) => {
        const cur = id ? d.habits.find((x) => x.id === id) : null;
        const item = { ...(cur || { id: LifeStore.uid(), created: L.today(), done: [] }), name: v.name, emoji: v.emoji, schedule };
        if (archived) delete item.archived; // saving an archived habit restores it
        upsertIn(d.habits, item);
      });
    }, {
      submitLabel: archived ? "Restore" : id ? "Save" : "Add habit",
      onDelete: !id ? null : archived
        ? () => LifeStore.commit((d) => removeFrom(d.habits, id))
        : () => LifeStore.commit((d) => { d.habits.find((x) => x.id === id).archived = L.today(); }),
      deleteLabel: archived ? "Delete forever" : "Archive",
      confirmText: archived ? "Delete this habit and all its history? This can't be undone."
        : "Archive this habit? Its history is kept, and you can restore it from ⋯ → Archived habits.",
    });

    const sync = () => {
      const t = (form.querySelector("[name=stype]:checked") || {}).value;
      form.querySelector("[data-days]").hidden = t !== "days";
      form.querySelector("[data-times]").hidden = t !== "weekly";
    };
    form.addEventListener("change", sync);
    sync();
    form.addEventListener("click", (e) => {
      const em = e.target.closest("[data-emoji]");
      if (em) { form.emoji.value = em.dataset.emoji; return; }
      const cell = e.target.closest("[data-hm]");
      if (cell && id) {
        // Tick / untick a past day straight away (separate from Save)
        const day = cell.dataset.hm;
        LifeStore.commit((d) => {
          const x = d.habits.find((y) => y.id === id);
          x.done = x.done.includes(day) ? x.done.filter((y) => y !== day) : [...x.done, day].sort();
        });
        form.querySelector("[data-habit-stats]").innerHTML = habitStats(LifeStore.get("habits", id));
        const again = form.querySelector(`[data-hm="${day}"]`);
        if (again) again.focus();
        render();
      }
    });
  }

  function archivedHabits() {
    const list = D().habits.filter((h) => h.archived);
    const body = openModal("Archived habits", list.length ? listCard(list.map((h) => rowEl({
      action: "", id: h.id, title: `${h.emoji ? `<span class="lf-emoji">${esc(h.emoji)}</span>` : ""}${esc(h.name)}`,
      meta: `Archived ${fmtDate(h.archived)} · best ${streakUnit(h, L.bestStreak(h, L.today()))}`,
    })), "lf-in-sheet") : `<p class="muted">No archived habits.</p>`);
    body.addEventListener("click", (e) => { const r = e.target.closest(".lf-row"); if (r) habitForm(r.dataset.id); });
    body.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".lf-row")) habitForm(e.target.dataset.id); });
  }

  Object.assign(ACTIONS, {
    "add-habit": () => habitForm(),
    "open-habit": (id) => habitForm(id),
    "archived-habits": archivedHabits,
  });

  // ---------- Plans: goals + tasks ----------
  PAGES.plans = (d) => {
    const today = L.today();
    const goals = d.goals.filter((g) => !L.goalAchieved(g, d.tasks));
    const achieved = d.goals.filter((g) => L.goalAchieved(g, d.tasks));
    const inbox = d.tasks.filter((t) => !t.goalId || !LifeStore.get("goals", t.goalId));
    const b = L.taskBuckets(inbox, today);
    const all = L.taskBuckets(d.tasks, today);
    const dueNow = all.overdue.length + all.today.length;
    let html = head({
      label: "Due today",
      big: String(dueNow),
      sub: [all.overdue.length ? `<span class="neg">${all.overdue.length} overdue</span>` : "",
        plural(d.tasks.filter((t) => !t.done).length, "open task")].filter(Boolean).join(" · "),
      primary: ["New task", "add-task"],
      menu: [["New goal…", "add-goal"]],
    });

    if (goals.length) html += `<div class="lf-goals">${goals.map((g) => goalCard(g, d.tasks, today)).join("")}</div>`;

    const group = (title, list) => list.length ? section(title, listCard(list.map((t) => taskRow(t, today)))) : "";
    html += group("Today", [...b.overdue, ...b.today]) + group("Upcoming", b.upcoming) + group("No date", b.noDate);
    if (!b.overdue.length && !b.today.length && !b.upcoming.length && !b.noDate.length) {
      html += emptyCard(goals.length ? "No tasks outside your goals." : "No tasks or goals yet.");
    }
    const done = inbox.filter((t) => t.done).sort((a, c) => (a.done < c.done ? 1 : -1));
    if (done.length) html += collapsed(`Done (${done.length})`, listCard(done.slice(0, 40).map((t) => taskRow(t, today))));
    if (achieved.length) html += collapsed(`Achieved (${achieved.length})`, `<div class="lf-goals">${achieved.map((g) => goalCard(g, d.tasks, today)).join("")}</div>`);
    return html;
  };

  function goalCard(g, tasks, today) {
    const p = L.goalProgress(g, tasks);
    const pace = L.goalPace(g, tasks, today);
    const done = L.goalAchieved(g, tasks);
    const n = g.kind === "number" ? esc(`${withUnit(L.goalCurrent(g), g.unit)} / ${withUnit(Number(g.target), g.unit)}`)
      : `${L.goalTasks(g, tasks).filter((t) => t.done).length} / ${L.goalTasks(g, tasks).length} tasks`;
    const when = done ? "Achieved" : pace.daysLeft === null ? "No deadline"
      : pace.daysLeft < 0 ? `<span class="neg">${plural(-pace.daysLeft, "day")} past deadline</span>`
      : pace.daysLeft === 0 ? "Due today" : `${plural(pace.daysLeft, "day")} left`;
    const track = done || pace.onTrack === null ? "" : pace.onTrack ? `<span class="pos">On track</span>` : `<span class="neg">Behind</span>`;
    return `<div class="card lf-goal" data-action="open-goal" data-id="${esc(g.id)}" role="button" tabindex="0">
        <div class="lf-goal-top"><span class="lf-goal-title">${g.emoji ? `<span class="lf-emoji">${esc(g.emoji)}</span>` : ""}${esc(g.title)}</span><b>${pct(p)}</b></div>
        <div class="bar"><span class="${done ? "pos-fill" : ""}" style="width:${Math.max(2, p * 100)}%"></span></div>
        <div class="lf-goal-meta"><span>${n}</span><span>${[when, track].filter(Boolean).join(" · ")}</span></div>
      </div>`;
  }

  // ---- Task form ----
  function taskForm(id, preset = {}) {
    const t = id ? LifeStore.get("tasks", id) : { title: "", due: "", priority: "med", goalId: "", standardId: "", repeat: "", ...preset };
    const d = D();
    const goals = d.goals.filter((g) => !L.goalAchieved(g, d.tasks) || g.id === t.goalId);
    const stds = d.standards.slice().sort((a, b) => (a.subject || "").localeCompare(b.subject || "") || (a.code || "").localeCompare(b.code || ""));
    openForm(id ? "Edit task" : "New task", `
      ${field("Task", textInput("title", t.title, 'required placeholder="e.g. Book driving theory test"'))}
      ${row2(field("Due", dateInput("due", t.due)), field("Repeat", select("repeat", [["", "Doesn't repeat"], ["daily", "Every day"], ["weekly", "Every week"], ["monthly", "Every month"]], t.repeat || "")))}
      ${fieldDiv("Priority", seg("priority", [["low", "Low"], ["med", "Medium"], ["high", "High"]], t.priority || "med"))}
      ${goals.length ? field("Goal", select("goalId", [["", "No goal"], ...goals.map((g) => [g.id, `${g.emoji ? g.emoji + " " : ""}${g.title}`])], t.goalId || "")) : ""}
      ${stds.length ? field("School standard", select("standardId", [["", "None"], ...stds.map((s) => [s.id, `${s.code} · ${s.title}`])], t.standardId || "")) : ""}`,
    (v) => {
      if (!v.title) return "Give the task a name.";
      return LifeStore.commit((dd) => {
        const cur = id ? dd.tasks.find((x) => x.id === id) : { id: LifeStore.uid(), created: L.today() };
        const item = { ...cur, title: v.title, due: v.due || "", priority: v.priority || "med", goalId: v.goalId || "", standardId: v.standardId || "", repeat: v.repeat || "" };
        for (const k of ["due", "goalId", "standardId", "repeat"]) if (!item[k]) delete item[k];
        upsertIn(dd.tasks, item);
      });
    }, {
      submitLabel: id ? "Save" : "Add task",
      onDelete: id ? () => LifeStore.commit((dd) => removeFrom(dd.tasks, id)) : null,
      confirmText: "Delete this task? This can't be undone.",
      after: preset.after,
    });
  }

  // Tick a task. A repeating one also creates its next copy (unticking
  // removes that copy again if it hasn't been started on).
  function toggleTask(dd, id) {
    const t = dd.tasks.find((x) => x.id === id);
    const today = L.today();
    if (!t.done) {
      t.done = today;
      if (t.repeat) {
        const next = { ...t, id: LifeStore.uid(), due: L.nextDue(t.due, t.repeat, today), created: today };
        delete next.done; delete next.nextId;
        dd.tasks.push(next);
        t.nextId = next.id;
      }
    } else {
      delete t.done;
      if (t.nextId) {
        const n = dd.tasks.find((x) => x.id === t.nextId);
        if (n && !n.done) removeFrom(dd.tasks, n.id);
        delete t.nextId;
      }
    }
  }

  // ---- Goals ----
  function goalForm() {
    const form = openForm("New goal", `
      ${row2(field("Goal", textInput("title", "", 'required placeholder="e.g. Bench 100kg"')), field("Emoji", textInput("emoji", "", 'maxlength="8" placeholder="🎯"')))}
      ${fieldDiv("Progress is", seg("kind", [["tasks", "Tasks done"], ["number", "A number"]], "tasks"))}
      <div data-number>${row2(field("Start", numInput("start", "", 'placeholder="e.g. 70"')), field("Target", numInput("target", "", 'placeholder="e.g. 100"')))}
        ${field("Unit", textInput("unit", "", 'placeholder="e.g. kg, $, km"'))}</div>
      ${field("Deadline", dateInput("deadline", ""))}`,
    (v) => {
      if (!v.title) return "Give the goal a name.";
      const item = { id: LifeStore.uid(), title: v.title, emoji: v.emoji, kind: v.kind, created: L.today(), updates: [] };
      if (v.deadline) item.deadline = v.deadline;
      if (v.kind === "number") {
        if (v.target === "") return "Enter the target number.";
        if (num(v.target) === num(v.start)) return "The target needs to be different from the start.";
        Object.assign(item, { start: num(v.start), target: num(v.target), unit: v.unit });
      }
      const err = LifeStore.commit((dd) => dd.goals.push(item));
      if (!err) setTimeout(() => goalSheet(item.id), 0);
      return err;
    }, { submitLabel: "Add goal" });
    const sync = () => { form.querySelector("[data-number]").hidden = formValues(form).kind !== "number"; };
    form.addEventListener("change", sync);
    sync();
  }

  function goalSheet(id) {
    const g = LifeStore.get("goals", id);
    if (!g) return;
    const d = D(), today = L.today();
    const p = L.goalProgress(g, d.tasks);
    const pace = L.goalPace(g, d.tasks, today);
    const isNum = g.kind === "number";
    const tasks = L.sortTasks(L.goalTasks(g, d.tasks));
    const open = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done);
    const paceLine = L.goalAchieved(g, d.tasks) ? `<span class="pos">Achieved${g.achieved ? " " + fmtDate(g.achieved) : ""}</span>`
      : pace.daysLeft === null ? "No deadline"
      : `${pace.onTrack ? `<span class="pos">On track</span>` : `<span class="neg">Behind: about ${pct(pace.expected)} by now</span>`} · ${pace.daysLeft < 0 ? `${plural(-pace.daysLeft, "day")} past ${fmtShort(g.deadline)}` : `${plural(pace.daysLeft, "day")} left (${fmtShort(g.deadline)})`}`;
    const ups = (g.updates || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));

    const form = openForm(`${g.emoji ? g.emoji + " " : ""}${g.title}`, `
      <div class="lf-goal-hero">
        <div class="lf-big">${pct(p)}${isNum ? `<span class="lf-unit">${esc(`${withUnit(L.goalCurrent(g), g.unit)} / ${withUnit(Number(g.target), g.unit)}`)}</span>` : ""}</div>
        <div class="bar"><span style="width:${Math.max(2, p * 100)}%"></span></div>
        <div class="lf-sub">${paceLine}</div>
      </div>
      ${isNum ? `
        <div class="lf-chart-box" data-goal-chart></div>
        <div class="lf-inline">
          ${field("New value", numInput("logValue", "", `placeholder="${fmtNum(L.goalCurrent(g))}"`))}
          ${field("Date", dateInput("logDate", today))}
          <button type="button" class="btn" data-log>Log</button>
        </div>
        ${ups.length ? `<div class="lf-list lf-in-sheet">${ups.map((u) => rowEl({ action: "", id: u.id,
          title: esc(withUnit(Number(u.value), g.unit)), trail: `<span class="muted">${fmtDate(u.date)}</span>`, cls: "lf-update" })).join("")}</div>
          <p class="field-hint">Tap an update to remove it.</p>` : ""}` : `
        <div class="lf-list lf-in-sheet">${open.concat(done).map((t) => taskRow(t, today, true)).join("") || `<p class="muted">No tasks yet.</p>`}</div>
        <div class="lf-inline">${field("Add a task", textInput("newTask", "", 'placeholder="Next step…"'))}<button type="button" class="btn" data-add-task>Add</button></div>`}
      <details class="more"><summary>Goal settings</summary><div class="form">
        ${row2(field("Goal", textInput("title", g.title, "required")), field("Emoji", textInput("emoji", g.emoji, 'maxlength="8"')))}
        ${isNum ? row2(field("Start", numInput("start", g.start)), field("Target", numInput("target", g.target))) + field("Unit", textInput("unit", g.unit)) : ""}
        ${field("Deadline", dateInput("deadline", g.deadline))}
        <label class="check"><input type="checkbox" name="achieved"${g.achieved ? " checked" : ""}> Mark as achieved</label>
      </div></details>`,
    (v) => {
      if (!v.title) return "Give the goal a name.";
      if (isNum && num(v.target) === num(v.start)) return "The target needs to be different from the start.";
      return LifeStore.commit((dd) => {
        const x = dd.goals.find((y) => y.id === id);
        Object.assign(x, { title: v.title, emoji: v.emoji });
        if (v.deadline) x.deadline = v.deadline; else delete x.deadline;
        if (isNum) Object.assign(x, { start: num(v.start), target: num(v.target), unit: v.unit });
        if (v.achieved && !x.achieved) x.achieved = today;
        if (!v.achieved) delete x.achieved;
      });
    }, {
      onDelete: () => LifeStore.commit((dd) => {
        removeFrom(dd.goals, id);
        dd.tasks.forEach((t) => { if (t.goalId === id) delete t.goalId; });
      }),
      confirmText: "Delete this goal? Its tasks are kept, moved to your inbox.",
    });

    const chartBox = form.querySelector("[data-goal-chart]");
    if (chartBox) chartBox.innerHTML = goalChart(g, chartBox.clientWidth || 480);
    const reopen = () => { render(); goalSheet(id); };
    form.addEventListener("click", (e) => {
      const tk = e.target.closest("[data-action=tick-task]");
      if (tk) { LifeStore.commit((dd) => toggleTask(dd, tk.dataset.id)); return reopen(); }
      const tr = e.target.closest("[data-action=edit-task]");
      if (tr) return taskForm(tr.dataset.id, { after: () => goalSheet(id) });
      if (e.target.closest("[data-add-task]")) {
        const title = form.newTask.value.trim();
        if (!title) return form.newTask.focus();
        LifeStore.commit((dd) => dd.tasks.push({ id: LifeStore.uid(), title, priority: "med", goalId: id, created: today }));
        reopen();
        const again = document.querySelector("#modal [name=newTask]");
        if (again) again.focus();
        return;
      }
      if (e.target.closest("[data-log]")) {
        if (form.logValue.value === "") return form.logValue.focus();
        const u = { id: LifeStore.uid(), date: form.logDate.value || today, value: num(form.logValue.value) };
        LifeStore.commit((dd) => dd.goals.find((y) => y.id === id).updates.push(u));
        return reopen();
      }
      const up = e.target.closest(".lf-update");
      if (up && confirm("Remove this update?")) {
        LifeStore.commit((dd) => { const x = dd.goals.find((y) => y.id === id); x.updates = x.updates.filter((u) => u.id !== up.dataset.id); });
        reopen();
      }
    });
    // Enter in "Add a task" / "New value" adds it instead of saving the sheet
    form.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.name === "newTask") { e.preventDefault(); form.querySelector("[data-add-task]").click(); }
      if (e.target.name === "logValue") { e.preventDefault(); form.querySelector("[data-log]").click(); }
    });
  }

  // ---- Line chart (number goals, bodyweight) ----
  // points: [{ date, value }]. Optional target (dashed line) and pace line
  // (from → to, faint) for goals. Plain SVG, sized to its box.
  function lineChart({ width, height = 170, points, from, to, target = null, pace = null, unit = "" }) {
    const W = Math.max(240, width), padL = 6, padR = 6, top = 16, bottom = 22, H = height - top - bottom;
    if (!points.length) return "";
    const xs = points.map((p) => L.toUTC(p.date));
    const x0 = Math.min(L.toUTC(from || points[0].date), ...xs), x1 = Math.max(L.toUTC(to || points[points.length - 1].date), ...xs, x0 + 86400000);
    const vals = points.map((p) => p.value).concat(target !== null ? [target] : [], pace ? [pace.fromValue, pace.toValue] : []);
    let y0 = Math.min(...vals), y1 = Math.max(...vals);
    const padV = (y1 - y0) * 0.12 || Math.abs(y1) * 0.05 || 1;
    y0 -= padV; y1 += padV;
    const X = (ms) => padL + ((ms - x0) / (x1 - x0)) * (W - padL - padR);
    const Y = (v) => top + ((y1 - v) / (y1 - y0)) * H;
    const path = points.map((p, i) => `${i ? "L" : "M"}${X(L.toUTC(p.date)).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
    const last = points[points.length - 1];
    const label = (ms, anchor) => `<text class="chart-label" x="${X(ms)}" y="${height - 6}" text-anchor="${anchor}">${fmtShort(L.fromUTC(ms))}</text>`;
    return `<svg class="chart lf-line" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="Progress chart">
      ${target !== null ? `<line class="lf-target" x1="0" x2="${W}" y1="${Y(target)}" y2="${Y(target)}"></line>
        <text class="chart-label" x="${W - 2}" y="${Y(target) - 5}" text-anchor="end">Target ${esc(withUnit(target, unit))}</text>` : ""}
      ${pace ? `<line class="lf-pace" x1="${X(L.toUTC(pace.from))}" y1="${Y(pace.fromValue)}" x2="${X(L.toUTC(pace.to))}" y2="${Y(pace.toValue)}"></line>` : ""}
      <path class="lf-line-path" d="${path}"></path>
      ${points.map((p) => `<circle class="lf-dot" cx="${X(L.toUTC(p.date))}" cy="${Y(p.value)}" r="3.5"></circle>`).join("")}
      <text class="lf-line-last" x="${Math.min(W - 4, X(L.toUTC(last.date)) + 6)}" y="${Y(last.value) - 8}" text-anchor="${X(L.toUTC(last.date)) > W - 60 ? "end" : "start"}">${fmtNum(last.value)}</text>
      ${label(x0, "start")}${label(x1, "end")}
    </svg>`;
  }
  function goalChart(g, width) {
    const start = { date: g.created || L.today(), value: Number(g.start) || 0 };
    const ups = (g.updates || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((u) => ({ date: u.date, value: Number(u.value) }));
    const points = [start, ...ups.filter((u) => u.date >= start.date)];
    return lineChart({
      width, points, from: start.date, to: g.deadline || null, target: Number(g.target), unit: g.unit || "",
      pace: g.deadline ? { from: start.date, fromValue: start.value, to: g.deadline, toValue: Number(g.target) } : null,
    });
  }

  Object.assign(ACTIONS, {
    "add-task": () => taskForm(null, view === "plans" || view === "today" ? { due: view === "today" ? L.today() : "" } : {}),
    "edit-task": (id) => taskForm(id),
    "tick-task": (id) => save((dd) => toggleTask(dd, id)),
    "add-goal": goalForm,
    "open-goal": (id) => goalSheet(id),
  });

  // ---------- School (Te Kura / NZQA standards) ----------
  const statusTone = (s) => L.isPassed({ status: s }) ? "pos" : s === "Not achieved" ? "neg" : "muted";
  const currentLevel = (d) => String(Math.max(1, ...d.standards.map((s) => Number(s.level) || 1)));

  PAGES.school = (d) => {
    const today = L.today();
    const cr = L.credits(d.standards);
    const lv = currentLevel(d);
    const C = cr[lv] || { gained: 0, pending: 0 };
    const target = Number(d.settings.creditTargets[lv]) || 0;
    const others = Object.keys(cr).filter((k) => k !== lv).sort()
      .map((k) => `L${k} ${cr[k].gained}/${Number(d.settings.creditTargets[k]) || 0}`);
    let html = head({
      label: `Level ${lv} credits`,
      big: `${C.gained}<span class="lf-of">/${target}</span>`,
      bar: target ? C.gained / target : null,
      sub: [C.pending ? `${C.pending} still to come` : "", ...others].filter(Boolean).join(" · "),
      primary: ["Add standard", "add-standard"],
      menu: [["Credit targets…", "credit-targets"]],
      tap: d.standards.length ? "credit-breakdown" : "",
    });
    if (!d.standards.length) return html + emptyCard("No standards yet.");

    const due = L.dueStandards(d.standards, today, 3650);
    if (due.length) html += section("Due", listCard(due.map((s) => standardRow(s, today, true))));

    const subjects = [...new Set(d.standards.map((s) => s.subject || "Other"))].sort();
    for (const sub of subjects) {
      const list = d.standards.filter((s) => (s.subject || "Other") === sub)
        .sort((a, b) => (Number(a.level) - Number(b.level)) || (a.code || "").localeCompare(b.code || ""));
      const got = L.sum(list.filter(L.isPassed.bind(L)), (s) => Number(s.credits) || 0);
      html += section(esc(sub), listCard(list.map((s) => standardRow(s, today, false))), ` <span class="badge">${got} credits</span>`);
    }
    return html;
  };

  function standardRow(s, today, showDue) {
    const overdue = s.due && s.due < today && !L.isFinished(s);
    return rowEl({
      action: "edit-standard", id: s.id, cls: overdue ? "overdue" : "",
      lead: `<span class="lf-code">L${esc(s.level || 1)}</span>`,
      title: esc(s.title || s.code),
      meta: [esc(s.code), plural(Number(s.credits) || 0, "credit"), showDue ? esc(s.subject) : s.due && !L.isFinished(s) ? `due ${fmtShort(s.due)}` : ""].filter(Boolean).join(" · "),
      trail: showDue ? `<span class="${overdue ? "neg" : ""}">${dueText(s.due, today)}</span>` : `<span class="${statusTone(s.status)}">${esc(s.status || "Not started")}</span>`,
    });
  }

  function standardForm(id) {
    const d = D();
    const s = id ? LifeStore.get("standards", id) : { code: "", title: "", subject: "", level: currentLevel(d), credits: "", due: "", status: "Not started" };
    const subjects = [...new Set(d.standards.map((x) => x.subject).filter(Boolean))].sort();
    const form = openForm(id ? s.code || "Standard" : "Add standard", `
      ${row2(field("Code", textInput("code", s.code, 'placeholder="e.g. AS91924" autocapitalize="characters"')), field("Credits", numInput("credits", s.credits, 'min="0" step="1" inputmode="numeric"')))}
      ${field("Title", textInput("title", s.title, 'required placeholder="e.g. Demonstrate understanding of…"'))}
      ${field("Subject", textInput("subject", s.subject, 'placeholder="e.g. Maths"'))}
      ${subjects.length ? `<div class="lf-emoji-pick">${subjects.map((x) => `<button type="button" class="chip" data-subject="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}
      ${row2(fieldDiv("Level", seg("level", [["1", "1"], ["2", "2"], ["3", "3"]], String(s.level || 1))), field("Due", dateInput("due", s.due)))}
      ${field("Status", select("status", L.STATUSES.map((x) => [x, x]), s.status || "Not started"))}`,
    (v) => {
      if (!v.title && !v.code) return "Enter the standard's code or title.";
      if (v.credits !== "" && !(num(v.credits) >= 0)) return "Credits must be 0 or more.";
      return LifeStore.commit((dd) => {
        const cur = id ? dd.standards.find((x) => x.id === id) : { id: LifeStore.uid() };
        const item = { ...cur, code: v.code.toUpperCase(), title: v.title, subject: v.subject, level: Number(v.level) || 1, credits: num(v.credits), status: v.status };
        if (v.due) item.due = v.due; else delete item.due;
        upsertIn(dd.standards, item);
      });
    }, {
      submitLabel: id ? "Save" : "Add standard",
      onDelete: id ? () => LifeStore.commit((dd) => { removeFrom(dd.standards, id); dd.tasks.forEach((t) => { if (t.standardId === id) delete t.standardId; }); }) : null,
      confirmText: "Delete this standard? This can't be undone.",
    });
    form.addEventListener("click", (e) => { const b = e.target.closest("[data-subject]"); if (b) form.subject.value = b.dataset.subject; });
  }

  // Tap the credits: gained vs target per level, split into A / M / E
  function creditBreakdown() {
    const d = D();
    const cr = L.credits(d.standards);
    const levels = Object.keys(cr).sort();
    openModal("Credits", levels.map((k) => {
      const c = cr[k], target = Number(d.settings.creditTargets[k]) || 0;
      const scale = Math.max(target, c.gained, 1);
      const w = (n) => `${(n / scale) * 100}%`;
      return `<div class="lf-credit">
        <div class="lf-goal-top"><span class="lf-goal-title">Level ${k}</span><b>${c.gained}<span class="lf-of"> / ${target}</span></b></div>
        <div class="lf-stack" role="img" aria-label="Excellence ${c.E}, Merit ${c.M}, Achieved ${c.A} credits">
          <span class="e" style="width:${w(c.E)}"></span><span class="m" style="width:${w(c.M)}"></span><span class="a" style="width:${w(c.A)}"></span>
        </div>
        <div class="lf-legend">
          <span><i class="e"></i>Excellence <b>${c.E}</b></span><span><i class="m"></i>Merit <b>${c.M}</b></span><span><i class="a"></i>Achieved <b>${c.A}</b></span>
        </div>
        <div class="lf-sub">${[c.pending ? `${c.pending} still to come` : "", c.notAchieved ? `${c.notAchieved} not achieved` : "",
          `Merit or better: ${c.M + c.E}/50 for an endorsement`].filter(Boolean).join(" · ")}</div>
      </div>`;
    }).join("") || `<p class="muted">No standards yet.</p>`);
  }

  function creditTargetsForm() {
    const t = D().settings.creditTargets;
    openForm("Credit targets", `
      <div class="form-row three">${["1", "2", "3"].map((k) => field(`Level ${k}`, numInput("t" + k, t[k], 'min="0" step="1" inputmode="numeric"'))).join("")}</div>`,
    (v) => LifeStore.commit((dd) => { for (const k of ["1", "2", "3"]) dd.settings.creditTargets[k] = Math.max(0, Math.round(num(v["t" + k]))); }));
  }

  Object.assign(ACTIONS, {
    "add-standard": () => standardForm(),
    "edit-standard": (id) => standardForm(id),
    "credit-breakdown": creditBreakdown,
    "credit-targets": creditTargetsForm,
  });

  // ---------- Bar chart (sleep, workouts per week) ----------
  // items: [{ key, label, value (null = nothing logged), good? }]. Optional
  // dashed target line. Hover / tap a bar → onPick(key) shows its details.
  function barChart({ width, items, target = null, height = 170, valueLabel = (v) => String(v), pick = null }) {
    const W = Math.max(240, width), top = 18, labelH = 22, H = height - top - labelH;
    const max = Math.max(target || 0, ...items.map((i) => i.value || 0)) * 1.1 || 1;
    const col = W / items.length;
    const barW = Math.max(6, Math.min(26, col - 8));
    const y = (v) => top + H - (v / max) * H;
    const narrow = col < 26;
    const bars = items.map((it, i) => {
      const x = i * col + (col - barW) / 2;
      const h = it.value ? Math.max(2, (it.value / max) * H) : 0;
      const r = Math.min(5, barW / 2, h);
      const yTop = top + H - h;
      const path = h ? `M${x},${top + H}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + barW - r}Q${x + barW},${yTop} ${x + barW},${yTop + r}V${top + H}Z` : "";
      const showLabel = !narrow || i % 2 === items.length % 2 || i === items.length - 1;
      return `<g class="chart-col lf-bar-col${it.key === pick ? " sel" : ""}" data-key="${esc(it.key)}">
          <rect class="chart-hit" x="${i * col}" y="0" width="${col}" height="${height}"></rect>
          ${h ? `<path class="${it.good ? "chart-pos" : "lf-bar-muted"}" d="${path}"></path>` : `<rect class="lf-bar-empty" x="${x}" y="${top + H - 2}" width="${barW}" height="2" rx="1"></rect>`}
          ${showLabel ? `<text class="chart-label" x="${i * col + col / 2}" y="${height - 6}" text-anchor="middle">${esc(it.label)}</text>` : ""}
        </g>`;
    }).join("");
    return `<svg class="chart" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="Bar chart">
      <line class="chart-zero" x1="0" x2="${W}" y1="${top + H}" y2="${top + H}"></line>
      ${bars}
      ${target ? `<line class="lf-target" x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}"></line>
        <text class="chart-label" x="${W}" y="${y(target) - 5}" text-anchor="end">${esc(valueLabel(target))}</text>` : ""}
    </svg>`;
  }
  // Hover (mouse) or tap a bar: highlight it and fill in its detail line
  const chartPicks = {};
  function wireBars(box, name, detail) {
    const show = (key) => {
      if (!key) return;
      chartPicks[name] = key;
      box.querySelectorAll(".lf-bar-col").forEach((g) => g.classList.toggle("sel", g.dataset.key === key));
      const out = box.parentElement.querySelector("[data-chart-detail]");
      if (out) out.innerHTML = detail(key);
    };
    box.addEventListener("mouseover", (e) => { const g = e.target.closest(".lf-bar-col"); if (g) show(g.dataset.key); });
    box.addEventListener("click", (e) => { const g = e.target.closest(".lf-bar-col"); if (g) show(g.dataset.key); });
    return show;
  }

  // ---------- Sleep ----------
  const qualityOf = (q) => QUALITY.find(([v]) => Number(v) === Number(q));
  const hoursBig = (h) => {
    if (h === null) return "—";
    const m = Math.round(h * 60);
    return `${Math.floor(m / 60)}<span class="lf-unit">h</span> ${String(m % 60).padStart(2, "0")}<span class="lf-unit">m</span>`;
  };

  PAGES.sleep = (d) => {
    const today = L.today();
    const target = Number(d.settings.sleepTarget) || 8;
    const s7 = L.sleepStats(d.sleep, today, 7), s30 = L.sleepStats(d.sleep, today, 30);
    let html = head({
      label: "7-night average",
      big: hoursBig(s7.hours),
      sub: [s30.nights ? `30 nights ${fmtHours(s30.hours)}` : "", s7.bedtime ? `Bedtime ~${s7.bedtime}` : "", `Target ${fmtNum(target)}h`].filter(Boolean).join(" · "),
      primary: ["Log sleep", "add-sleep"],
      menu: [["Sleep target…", "sleep-target"]],
    });
    if (!d.sleep.length) return html + emptyCard("No nights logged yet. Log last night from Today.");
    html += `<div class="card chart-card"><h3>Last 14 nights</h3><div data-chart="sleep"></div><div class="chart-detail" data-chart-detail></div></div>`;
    const list = d.sleep.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const rows = (arr) => listCard(arr.map((s) => {
      const q = qualityOf(s.quality);
      const h = L.sleepHours(s.bed, s.wake);
      return rowEl({ action: "edit-sleep", id: s.id, lead: `<span class="lf-big-emoji">${q ? q[1] : "🌙"}</span>`,
        title: relDay(s.date, today), meta: `${s.bed} → ${s.wake}${q ? " · " + q[2] : ""}`,
        trail: `<span class="${h >= target ? "pos" : ""}">${fmtHours(h)}</span>` });
    }));
    html += section("Nights", rows(list.slice(0, 14)));
    if (list.length > 14) html += collapsed(`Older (${list.length - 14})`, rows(list.slice(14)));
    return html;
  };

  CHARTS.sleep = (el) => {
    const d = D(), today = L.today();
    const target = Number(d.settings.sleepTarget) || 8;
    const nights = L.lastNights(d.sleep, today, 14);
    const pick = chartPicks.sleep && nights.some((n) => n.date === chartPicks.sleep) ? chartPicks.sleep
      : (nights.slice().reverse().find((n) => n.entry) || nights[nights.length - 1]).date;
    el.innerHTML = barChart({
      width: el.clientWidth, target, pick, valueLabel: (v) => `${fmtNum(v)}h`,
      items: nights.map((n) => ({ key: n.date, label: UTC({ weekday: "narrow" }).format(L.toUTC(n.date)), value: n.hours, good: n.hours !== null && n.hours >= target })),
    });
    const detail = (key) => {
      const n = nights.find((x) => x.date === key);
      if (!n || !n.entry) return `<span class="muted">${relDay(key, today)}: not logged</span>`;
      const q = qualityOf(n.entry.quality);
      return `<div class="preview"><span>${relDay(key, today)}</span><span>${n.entry.bed} → ${n.entry.wake}</span><span><b>${fmtHours(n.hours)}</b></span>${q ? `<span>${q[1]} ${q[2]}</span>` : ""}</div>`;
    };
    if (!el._wired) { el._show = wireBars(el, "sleep", detail); el._wired = true; }
    el._show(pick);
  };

  function sleepForm(id, preset = {}) {
    const d = D();
    const last = d.sleep.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const s = id ? LifeStore.get("sleep", id) : { date: L.today(), bed: last ? last.bed : "23:00", wake: last ? last.wake : "07:00", quality: "", ...preset };
    const form = openForm(id ? `Night before ${fmtDay(s.date)}` : "Log sleep", `
      ${field("Woke up on", dateInput("date", s.date, "required"))}
      <div class="form-row lf-pair">${field("Bed", timeInput("bed", s.bed, "required"))}${field("Woke", timeInput("wake", s.wake, "required"))}</div>
      ${fieldDiv("How did you sleep?", `<div class="lf-quality lf-quality-pick">${QUALITY.map(([v, e, t]) =>
        `<label class="lf-q"><input type="radio" name="quality" value="${v}"${String(s.quality) === v ? " checked" : ""}><span>${e}</span><small>${t}</small></label>`).join("")}</div>`)}
      <div class="preview big" data-preview></div>`,
    (v) => {
      if (!v.date || !v.bed || !v.wake) return "Enter the date and both times.";
      const clash = D().sleep.find((x) => x.date === v.date && x.id !== id);
      if (clash) return `You already logged the night before ${fmtDay(v.date)}. Open it from the list to change it.`;
      return LifeStore.commit((dd) => upsertIn(dd.sleep, { id: id || LifeStore.uid(), date: v.date, bed: v.bed, wake: v.wake, quality: Number(v.quality) || null }));
    }, {
      submitLabel: id ? "Save" : "Log sleep",
      onDelete: id ? () => LifeStore.commit((dd) => removeFrom(dd.sleep, id)) : null,
      confirmText: "Delete this night? This can't be undone.",
    });
    const preview = form.querySelector("[data-preview]");
    const update = () => { const v = formValues(form); preview.innerHTML = v.bed && v.wake ? `<span>Slept <b>${fmtHours(L.sleepHours(v.bed, v.wake))}</b></span>` : ""; };
    form.addEventListener("change", update);
    form.addEventListener("input", update);
    update();
  }

  function sleepTargetForm() {
    openForm("Sleep target", `${field("Hours a night", numInput("target", D().settings.sleepTarget, 'min="1" max="14" step="0.25"'))}`,
      (v) => {
        const t = num(v.target);
        if (!(t >= 1 && t <= 14)) return "Enter between 1 and 14 hours.";
        return LifeStore.commit((dd) => { dd.settings.sleepTarget = t; });
      });
  }

  Object.assign(ACTIONS, {
    "add-sleep": () => sleepForm(),
    "edit-sleep": (id) => sleepForm(id),
    "sleep-target": sleepTargetForm,
  });

  // ---------- Fitness ----------
  const TYPES = { gym: ["🏋️", "Gym"], run: ["🏃", "Run"], sport: ["⚽", "Sport"], other: ["✨", "Other"] };
  const typeOf = (w) => TYPES[w.type] || TYPES.other;
  const kgText = (n) => `${fmtNum(n)} kg`;

  PAGES.fitness = (d) => {
    const today = L.today();
    const weeks = L.weeklyWorkouts(d.workouts, today, 12);
    const now = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
    const last = L.sortWorkouts(d.workouts).pop();
    let html = head({
      label: "Workouts this week",
      big: String(now.count),
      sub: [now.minutes ? `${now.minutes} min` : "", `${prev.count} last week`].filter(Boolean).join(" · "),
      primary: ["Log workout", "add-workout"],
      menu: [...(last ? [["Repeat last workout", "repeat-workout"]] : []), ["Personal records", "records"], ["Bodyweight", "bodyweight"]],
    });
    if (!d.workouts.length) return html + emptyCard("No workouts yet.");
    html += `<div class="card chart-card"><h3>Workouts per week</h3><div data-chart="workouts"></div><div class="chart-detail" data-chart-detail></div></div>`;
    const prs = L.records(d.workouts).prs;
    const list = L.sortWorkouts(d.workouts).reverse();
    const rows = (arr) => listCard(arr.map((w) => {
      const [emoji, label] = typeOf(w);
      const names = (w.exercises || []).map((e) => e.name).filter(Boolean);
      return rowEl({
        action: "edit-workout", id: w.id, lead: `<span class="lf-big-emoji">${emoji}</span>`,
        title: `${label}${w.minutes ? ` · ${w.minutes} min` : ""}`,
        meta: [relDay(w.date, today), names.length ? esc(names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "")) : esc(w.notes)].filter(Boolean).join(" · "),
        trail: prs[w.id] ? `<span class="lf-pr">🏆 PR</span>` : "",
      });
    }));
    html += section("Recent", rows(list.slice(0, 15)));
    if (list.length > 15) html += collapsed(`Older (${list.length - 15})`, rows(list.slice(15)));
    return html;
  };

  CHARTS.workouts = (el) => {
    const d = D(), today = L.today();
    const weeks = L.weeklyWorkouts(d.workouts, today, 12);
    const pick = chartPicks.workouts && weeks.some((w) => w.start === chartPicks.workouts) ? chartPicks.workouts : weeks[weeks.length - 1].start;
    el.innerHTML = barChart({
      width: el.clientWidth, pick,
      items: weeks.map((w) => ({ key: w.start, label: fmtShort(w.start).split(" ")[0], value: w.count || null, good: true })),
    });
    const detail = (key) => {
      const w = weeks.find((x) => x.start === key);
      return `<div class="preview"><span>Week of ${fmtShort(key)}</span><span><b>${plural(w.count, "workout")}</b></span>${w.minutes ? `<span>${w.minutes} min</span>` : ""}</div>`;
    };
    if (!el._wired) { el._show = wireBars(el, "workouts", detail); el._wired = true; }
    el._show(pick);
  };

  // ---- Workout form ----
  // Gym workouts have exercises, each with sets of reps × kg. Picking an
  // exercise you've done before fills in your last sets. Beating a record
  // shows "New PR" on that exercise as you type.
  function workoutForm(id, preset = null) {
    const d = D();
    const w = id ? LifeStore.get("workouts", id)
      : preset ? { ...structuredClone(preset), id: undefined, created: undefined, date: L.today(), notes: "" }
      : { date: L.today(), type: "gym", minutes: "", notes: "", exercises: [] };
    const known = L.exerciseNames(d.workouts);
    const lastGym = L.sortWorkouts(d.workouts).reverse().find((x) => x.type === "gym" && (x.exercises || []).length && x.id !== id);
    // Records from every other workout, to spot a new PR while typing
    const others = L.records(d.workouts.filter((x) => x.id !== id)).best;
    const recordFor = (name) => others.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());

    const setRow = (s = { reps: "", kg: "" }, i = 0) => `
      <div class="lf-set" data-set>
        <span class="lf-set-n">${i + 1}</span>
        <input type="number" inputmode="numeric" min="0" step="1" placeholder="reps" value="${s.reps ?? ""}" data-reps aria-label="Reps">
        <span class="muted">×</span>
        <input type="number" inputmode="decimal" min="0" step="any" placeholder="kg" value="${s.kg ?? ""}" data-kg aria-label="Weight in kg">
        <span class="muted">kg</span>
        <button type="button" class="btn btn-sm btn-ghost" data-set-remove aria-label="Remove set">−</button>
      </div>`;
    const exBlock = (e) => {
      const r = recordFor(e.name);
      return `<div class="lf-ex" data-ex data-name="${esc(e.name)}">
        <div class="lf-ex-head"><b>${esc(e.name)}</b><span class="lf-pr" data-ex-pr></span>
          <span class="muted small">${r ? `Best ${kgText(r.kg)}` : "First time"}</span>
          <button type="button" class="btn btn-sm btn-ghost" data-ex-remove aria-label="Remove ${esc(e.name)}">✕</button></div>
        <div data-sets>${(e.sets && e.sets.length ? e.sets : [{}]).map(setRow).join("")}</div>
        <button type="button" class="btn btn-sm" data-add-set>+ Set</button>
      </div>`;
    };

    const form = openForm(id ? `${typeOf(w)[1]} · ${fmtDay(w.date)}` : "Log workout", `
      ${row2(field("Date", dateInput("date", w.date, "required")), field("Minutes", numInput("minutes", w.minutes, 'min="0" step="1" inputmode="numeric" placeholder="e.g. 60"')))}
      ${fieldDiv("Type", seg("type", Object.entries(TYPES).map(([k, [e, t]]) => [k, `${e} ${t}`]), w.type || "gym"))}
      <div data-gym>
        ${!id && lastGym && !preset ? `<button type="button" class="link" data-copy-last>Copy last gym workout (${fmtDay(lastGym.date)})</button>` : ""}
        <div data-exercises>${(w.exercises || []).map(exBlock).join("")}</div>
        <div class="lf-add-ex">
          ${field("Add exercise", select("pickExercise", [["", "Choose…"], ...known.map((n) => [n, n]), ["__new", "+ New exercise"]], ""))}
          <div class="lf-inline" data-new-ex hidden>${field("New exercise", textInput("newExercise", "", 'placeholder="e.g. Bench press"'))}<button type="button" class="btn" data-add-new>Add</button></div>
        </div>
      </div>
      ${field("Notes", textArea("notes", w.notes))}`,
    (v, f) => {
      const exercises = [];
      for (const ex of f.querySelectorAll("[data-ex]")) {
        const sets = [...ex.querySelectorAll("[data-set]")].map((s) => ({ reps: num(s.querySelector("[data-reps]").value), kg: num(s.querySelector("[data-kg]").value) }))
          .filter((s) => s.reps > 0);
        if (sets.length) exercises.push({ name: ex.dataset.name, sets });
      }
      if (v.type === "gym" && f.querySelector("[data-ex]") && !exercises.length) return "Enter the reps for at least one set.";
      const item = { id: id || LifeStore.uid(), date: v.date, type: v.type, minutes: v.minutes === "" ? "" : Math.max(0, Math.round(num(v.minutes))),
        notes: v.notes, exercises: v.type === "gym" ? exercises : [], created: w.created || Date.now() };
      const err = LifeStore.commit((dd) => upsertIn(dd.workouts, item));
      if (!err) {
        const beaten = L.records(LifeStore.data.workouts).prs[item.id];
        if (beaten && beaten.length) {
          const best = L.records(LifeStore.data.workouts).best;
          setTimeout(() => toast(`🏆 New PR: ${beaten.map((n) => { const r = best.find((b) => b.name.toLowerCase() === n.toLowerCase()); return r ? `${n} ${kgText(r.kg)}` : n; }).join(", ")}`), 50);
        }
      }
      return err;
    }, {
      submitLabel: id ? "Save" : "Save workout",
      onDelete: id ? () => LifeStore.commit((dd) => removeFrom(dd.workouts, id)) : null,
      confirmText: "Delete this workout? This can't be undone.",
    });

    const list = form.querySelector("[data-exercises]");
    const addExercise = (name) => {
      name = name.trim();
      if (!name) return;
      const existing = [...list.querySelectorAll("[data-ex]")].find((x) => x.dataset.name.toLowerCase() === name.toLowerCase());
      if (existing) { existing.querySelector("[data-reps]").focus(); return; }
      list.insertAdjacentHTML("beforeend", exBlock({ name, sets: L.lastSets(d.workouts, name, id) || [{}] }));
      const block = list.lastElementChild;
      checkPr(block);
      const first = block.querySelector("[data-reps]");
      if (first) first.focus();
    };
    // "New PR" on an exercise when its sets beat the best from other workouts
    const checkPr = (block) => {
      const r = recordFor(block.dataset.name);
      const b = L.bestOf({ sets: [...block.querySelectorAll("[data-set]")].map((s) => ({ reps: num(s.querySelector("[data-reps]").value), kg: num(s.querySelector("[data-kg]").value) })) });
      const beat = r && (b.kg > r.kg + 1e-9 || b.e1 > r.e1 + 1e-9);
      block.classList.toggle("is-pr", !!beat);
      block.querySelector("[data-ex-pr]").textContent = beat ? (b.kg > r.kg ? `🏆 New PR ${kgText(b.kg)}` : "🏆 New best 1RM") : "";
    };
    const renumber = (block) => block.querySelectorAll(".lf-set-n").forEach((n, i) => { n.textContent = i + 1; });
    const sync = () => {
      const type = (form.querySelector("[name=type]:checked") || {}).value;
      form.querySelector("[data-gym]").hidden = type !== "gym";
    };
    list.querySelectorAll("[data-ex]").forEach(checkPr);
    sync();

    form.addEventListener("change", (e) => {
      if (e.target.name === "type") return sync();
      if (e.target.name === "pickExercise") {
        const v = e.target.value;
        if (!v) return;
        e.target.value = ""; // back to "Choose…"
        if (v === "__new") { form.querySelector("[data-new-ex]").hidden = false; form.newExercise.focus(); }
        else addExercise(v);
      }
    });
    form.addEventListener("input", (e) => { const block = e.target.closest("[data-ex]"); if (block) checkPr(block); });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.name === "newExercise") { e.preventDefault(); form.querySelector("[data-add-new]").click(); }
    });
    form.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-new]")) {
        addExercise(form.newExercise.value);
        form.newExercise.value = "";
        form.querySelector("[data-new-ex]").hidden = true;
        return;
      }
      if (e.target.closest("[data-copy-last]")) {
        lastGym.exercises.forEach((x) => addExercise(x.name));
        e.target.closest("[data-copy-last]").remove();
        return;
      }
      const block = e.target.closest("[data-ex]");
      if (!block) return;
      if (e.target.closest("[data-ex-remove]")) { block.remove(); return; }
      if (e.target.closest("[data-add-set]")) {
        // A new set copies the one above it
        const sets = block.querySelectorAll("[data-set]");
        const prev = sets[sets.length - 1];
        const s = prev ? { reps: prev.querySelector("[data-reps]").value, kg: prev.querySelector("[data-kg]").value } : {};
        block.querySelector("[data-sets]").insertAdjacentHTML("beforeend", setRow(s, sets.length));
        block.querySelector("[data-sets]").lastElementChild.querySelector("[data-reps]").focus();
        return checkPr(block);
      }
      const rm = e.target.closest("[data-set-remove]");
      if (rm) {
        if (block.querySelectorAll("[data-set]").length > 1) rm.closest("[data-set]").remove();
        else rm.closest("[data-set]").querySelectorAll("input").forEach((i) => { i.value = ""; });
        renumber(block);
        checkPr(block);
      }
    });
  }

  function recordsSheet() {
    const best = L.records(D().workouts).best.filter((r) => r.kg > 0 || r.e1 > 0);
    openModal("Personal records", best.length ? listCard(best.map((r) => rowEl({
      action: "", title: esc(r.name),
      meta: `Best 1RM ~${kgText(Math.round(r.e1 * 2) / 2)} · ${plural(r.sessions, "session")}`,
      trail: `${kgText(r.kg)}<div class="muted small">${fmtShort(r.kgDate)}</div>`,
    })), "lf-in-sheet") : `<p class="muted">Log a gym workout with weights to see your records.</p>`);
  }

  function bodyweightSheet() {
    const list = D().bodyweight.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = list[list.length - 1];
    const change = list.length > 1 ? latest.kg - list[0].kg : null;
    const form = openForm("Bodyweight", `
      ${latest ? `<div class="lf-goal-hero"><div class="lf-big">${fmtNum(latest.kg)}<span class="lf-unit">kg</span></div>
        <div class="lf-sub">${fmtDate(latest.date)}${change !== null ? ` · ${change > 0 ? "+" : ""}${fmtNum(Math.round(change * 10) / 10)} kg since ${fmtShort(list[0].date)}` : ""}</div></div>
        <div class="lf-chart-box" data-bw-chart></div>` : ""}
      <div class="form-row lf-pair">${field("Weight (kg)", numInput("kg", "", 'min="0" step="0.1" required placeholder="e.g. 72.5"'))}${field("Date", dateInput("date", L.today(), "required"))}</div>
      ${list.length ? `<div class="lf-list lf-in-sheet">${list.slice().reverse().slice(0, 30).map((b) => rowEl({ action: "", id: b.id, cls: "lf-bw",
        title: kgText(b.kg), trail: `<span class="muted">${fmtDate(b.date)}</span>` })).join("")}</div><p class="field-hint">Tap an entry to remove it.</p>` : ""}`,
    (v) => {
      if (!(num(v.kg) > 0)) return "Enter your weight in kg.";
      return LifeStore.commit((dd) => {
        dd.bodyweight = dd.bodyweight.filter((b) => b.date !== v.date); // one entry per day
        dd.bodyweight.push({ id: LifeStore.uid(), date: v.date, kg: num(v.kg) });
      });
    }, { submitLabel: "Add", after: bodyweightSheet });
    const box = form.querySelector("[data-bw-chart]");
    if (box && list.length > 1) box.innerHTML = lineChart({ width: box.clientWidth || 480, points: list.map((b) => ({ date: b.date, value: b.kg })), unit: "kg" });
    form.addEventListener("click", (e) => {
      const r = e.target.closest(".lf-bw");
      if (r && confirm("Remove this entry?")) { LifeStore.commit((dd) => removeFrom(dd.bodyweight, r.dataset.id)); bodyweightSheet(); }
    });
  }

  Object.assign(ACTIONS, {
    "add-workout": () => workoutForm(),
    "edit-workout": (id) => workoutForm(id),
    "repeat-workout": () => { const last = L.sortWorkouts(D().workouts).pop(); if (last) workoutForm(null, last); },
    records: recordsSheet,
    bodyweight: bodyweightSheet,
  });

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
  // Charts are sized to their card, so they are drawn once the page is in place (CHARTS is defined with PAGES)
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
