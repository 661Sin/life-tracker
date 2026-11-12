// ---------- Glass pickers (site-wide) ----------
// Replaces every native <select>, <input type="date"> and <input type="time">
// with a glass picker. Forms keep building plain <select>/<input> HTML; this
// file swaps them out as soon as they appear on the page (a MutationObserver
// watches for new ones, and openModal calls Pickers.enhance straight away).
//
// Each picker keeps a real (invisible) <input name="…"> holding the value, so
// FormData, form.someName.value and "input"/"change" listeners work exactly as
// they did with the native fields. Values keep the same format: dates are
// "YYYY-MM-DD", times "HH:MM".
//
// PC: a popover anchored to the field that springs up from it.
// Phone (≤700px): a bottom sheet that slides up.
// Closes on an outside tap or Escape. Keyboard: arrows, Enter, Escape, Tab.

const Pickers = (function () {
  const PHONE = window.matchMedia("(max-width: 700px)");
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
  const animOK = () => !REDUCE.matches && !!Element.prototype.animate;
  const pad = (n) => String(n).padStart(2, "0");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const todayStr = () => ymd(new Date());
  const LONG = new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const MONTH = new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric" });
  const ARIA_DAY = new Intl.DateTimeFormat("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const ICON = {
    select: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>`,
    date: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>`,
    time: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>`,
    check: `<svg class="gp-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  };
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  let uid = 0;

  // ================= Turning native fields into pickers =================
  function enhance(root) {
    if (!root || !root.querySelectorAll) return;
    const list = root.matches && root.matches("select, input[type=date], input[type=time]") ? [root]
      : root.querySelectorAll("select, input[type=date], input[type=time]");
    list.forEach((el) => { if (!el.closest(".gp-pop") && !el.hasAttribute("data-native")) upgrade(el); });
  }

  function upgrade(el) {
    const kind = el.tagName === "SELECT" ? "select" : el.type; // "select" | "date" | "time"
    const gp = { kind, id: "gp" + ++uid };
    const wrap = document.createElement("span");
    wrap.className = "gp gp-k-" + kind;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gp-field";
    btn.id = gp.id;
    btn.setAttribute("aria-haspopup", kind === "select" ? "listbox" : "dialog");
    btn.setAttribute("aria-expanded", "false");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "gp-value";
    input.tabIndex = -1;
    input.autocomplete = "off";
    input.setAttribute("aria-hidden", "true");
    for (const a of el.attributes) {
      if (!["type", "class", "style", "min", "max", "step", "id"].includes(a.name)) input.setAttribute(a.name, a.value);
    }
    gp.min = el.getAttribute("min") || "";
    gp.max = el.getAttribute("max") || "";
    gp.step = Math.max(1, Math.round((Number(el.getAttribute("step")) || 60) / 60)); // time: minutes per step
    gp.required = el.required;
    gp.placeholder = el.getAttribute("placeholder") || (kind === "date" ? "No date" : kind === "time" ? "--:--" : "Choose…");
    if (kind === "select") gp.options = [...el.options].map((o) => ({ value: o.value, label: o.textContent }));
    gp.wrap = wrap; gp.btn = btn; gp.input = input;
    wrap._gp = btn._gp = gp;

    const start = el.value;
    wrap.append(btn, input);
    el.replaceWith(wrap);
    if (el.id) btn.id = el.id; // a <label for="…"> keeps working
    valueDesc.set.call(input, start);
    // Setting .value from code (e.g. form.x.value = …) also updates what the field shows
    Object.defineProperty(input, "value", {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); refresh(gp); },
    });
    input.addEventListener("invalid", () => btn.classList.add("gp-invalid"));
    btn.addEventListener("click", () => toggle(gp));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || (e.key === "Enter" && kind !== "select")) { e.preventDefault(); open(gp); }
    });
    refresh(gp);
  }

  function labelFor(gp) {
    const v = gp.input.value;
    if (gp.kind === "select") {
      const o = gp.options.find((x) => x.value === v);
      return o ? { text: o.label, empty: o.value === "" } : { text: gp.placeholder, empty: true };
    }
    if (gp.kind === "date") {
      const d = parseYmd(v);
      if (!d) return { text: gp.placeholder, empty: true };
      const diff = Math.round((d - parseYmd(todayStr())) / 86400000);
      const word = { "-1": "Yesterday", 0: "Today", 1: "Tomorrow" }[diff];
      return { text: word ? `${word}, ${d.getDate()} ${d.toLocaleString("en-NZ", { month: "short" })}` : LONG.format(d) };
    }
    return v ? { text: v } : { text: gp.placeholder, empty: true };
  }

  function refresh(gp) {
    const l = labelFor(gp);
    gp.btn.innerHTML = `<span class="gp-text${l.empty ? " gp-placeholder" : ""}">${esc(l.text)}</span>${ICON[gp.kind]}`;
    gp.btn.classList.remove("gp-invalid");
  }

  // Sets the value and tells the form, like a native field would
  function setValue(gp, v) {
    if (gp.input.value === v) return;
    gp.input.value = v;
    gp.input.dispatchEvent(new Event("input", { bubbles: true }));
    gp.input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ================= Popover / bottom sheet =================
  let cur = null; // { gp, pop, scrim }

  function toggle(gp) { if (cur && cur.gp === gp) close(); else open(gp); }

  function open(gp) {
    close(false, true);
    const phone = PHONE.matches;
    const scrim = document.createElement("div");
    scrim.className = "gp-scrim" + (phone ? " gp-dim" : "");
    const pop = document.createElement("div");
    pop.className = `gp-pop gp-pop-${gp.kind}${phone ? " gp-sheet" : ""}`;
    pop.setAttribute("role", "dialog");
    const labelEl = gp.wrap.closest(".field") && gp.wrap.closest(".field").querySelector(".field-label");
    const title = labelEl ? labelEl.textContent : "";
    if (title) pop.setAttribute("aria-label", title);
    pop.innerHTML = (phone ? `<div class="gp-grab" aria-hidden="true"></div>${title ? `<div class="gp-title">${esc(title)}</div>` : ""}` : "") + `<div class="gp-body"></div>`;
    document.body.append(scrim, pop);
    cur = { gp, pop, scrim, phone };
    gp.btn.setAttribute("aria-expanded", "true");
    gp.wrap.classList.add("gp-open");

    const body = pop.querySelector(".gp-body");
    const focusTarget = BUILD[gp.kind](gp, body, pop);
    place();
    // Animate in: spring up from the field (PC) or slide up from the bottom (phone)
    if (animOK()) {
      if (phone) {
        pop.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 340, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" });
        scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
      } else {
        pop.animate([{ opacity: 0, transform: "scale(0.82)" }, { opacity: 1, transform: "none" }],
          { duration: 360, easing: getComputedStyle(document.documentElement).getPropertyValue("--ease-spring").trim() || "ease-out" });
      }
    }
    if (focusTarget) focusTarget.focus({ preventScroll: true });

    scrim.addEventListener("click", () => close());
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === "Tab") trapTab(e, pop);
    });
  }

  function trapTab(e, pop) {
    const items = [...pop.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // PC: below the field (or above if there's no room), kept inside the window.
  // The scale-up starts from the field's middle.
  function place() {
    if (!cur || cur.phone) return;
    const { gp, pop } = cur;
    const r = gp.btn.getBoundingClientRect();
    const minW = gp.kind === "select" ? Math.max(r.width, 220) : gp.kind === "date" ? 312 : 240;
    pop.style.width = Math.min(minW, window.innerWidth - 16) + "px";
    const ph = pop.offsetHeight, pw = pop.offsetWidth;
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const up = ph + 6 > below && above > below;
    const top = up ? Math.max(8, r.top - 6 - ph) : Math.min(r.bottom + 6, window.innerHeight - ph - 8);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    pop.style.top = Math.max(8, top) + "px";
    pop.style.left = left + "px";
    pop.style.transformOrigin = `${Math.min(pw, Math.max(0, r.left + r.width / 2 - left))}px ${up ? ph : 0}px`;
  }

  function close(refocus = true, instant = false) {
    if (!cur) return;
    const { gp, pop, scrim, phone } = cur;
    cur = null;
    gp.btn.setAttribute("aria-expanded", "false");
    gp.wrap.classList.remove("gp-open");
    if (gp.onClose) { gp.onClose(); gp.onClose = null; }
    if (refocus && document.contains(gp.btn)) gp.btn.focus({ preventScroll: true });
    const done = () => { pop.remove(); scrim.remove(); };
    if (instant || !animOK()) return done();
    pop.style.pointerEvents = "none";
    scrim.style.pointerEvents = "none";
    const a = pop.animate(phone ? [{ transform: "none" }, { transform: "translateY(100%)" }]
      : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.9)" }], { duration: phone ? 220 : 140, easing: "ease-in", fill: "forwards" });
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
    a.onfinish = done;
    setTimeout(done, 400); // safety net
  }

  // Follow the field when the page or a form scrolls; close when the window resizes
  window.addEventListener("scroll", (e) => { if (cur && !cur.pop.contains(e.target)) place(); }, true);
  // (Phones fire "resize" when the on-screen keyboard opens, e.g. for the search box,
  // so only close if the layout switched between PC popover and phone sheet.)
  window.addEventListener("resize", () => {
    if (!cur) return;
    if (cur.phone !== PHONE.matches) close(false, true); else place();
  });

  // ================= Contents =================
  const BUILD = {};

  // ---------- Select: rows with a checkmark; searchable when long ----------
  BUILD.select = (gp, body) => {
    const searchable = gp.options.length > 8;
    body.innerHTML = `${searchable ? `<div class="gp-search"><input type="search" placeholder="Search…" aria-label="Search" autocomplete="off" data-native></div>` : ""}
      <div class="gp-list" role="listbox" tabindex="0"${searchable ? "" : ` aria-labelledby="${gp.btn.id}"`}></div>`;
    const list = body.querySelector(".gp-list");
    const search = body.querySelector(".gp-search input");
    let shown = gp.options;
    let active = Math.max(0, shown.findIndex((o) => o.value === gp.input.value));

    function draw() {
      const sel = gp.input.value;
      list.innerHTML = shown.length ? shown.map((o, i) =>
        `<div class="gp-opt${i === active ? " active" : ""}${o.value === sel ? " sel" : ""}" role="option" id="${gp.id}-o${i}" data-i="${i}" aria-selected="${o.value === sel}">
          <span>${esc(o.label)}</span>${o.value === sel ? ICON.check : ""}</div>`).join("")
        : `<div class="gp-none">No matches</div>`;
      if (shown.length) list.setAttribute("aria-activedescendant", `${gp.id}-o${active}`);
      const a = list.querySelector(".gp-opt.active");
      if (a) a.scrollIntoView({ block: "nearest" });
    }
    function move(i) {
      if (!shown.length) return;
      active = Math.max(0, Math.min(shown.length - 1, i));
      list.querySelectorAll(".gp-opt").forEach((x) => x.classList.toggle("active", +x.dataset.i === active));
      list.setAttribute("aria-activedescendant", `${gp.id}-o${active}`);
      const a = list.querySelector(".gp-opt.active");
      if (a) a.scrollIntoView({ block: "nearest" });
    }
    function choose(i) {
      const o = shown[i];
      if (!o) return;
      setValue(gp, o.value);
      close();
    }
    draw();
    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        shown = q ? gp.options.filter((o) => o.label.toLowerCase().includes(q)) : gp.options;
        active = 0;
        draw();
        place();
      });
    }
    body.addEventListener("keydown", (e) => {
      const page = Math.max(1, Math.floor(list.clientHeight / 44));
      const keys = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: shown.length - 1, PageDown: active + page, PageUp: active - page };
      if (e.key in keys && !(search && document.activeElement === search && (e.key === "Home" || e.key === "End"))) { e.preventDefault(); move(keys[e.key]); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (!search && e.key.length === 1 && /\S/.test(e.key)) {
        // Type a letter to jump to the next option starting with it
        const k = e.key.toLowerCase();
        const n = shown.length;
        for (let s = 1; s <= n; s++) { const i = (active + s) % n; if (shown[i].label.toLowerCase().startsWith(k)) { move(i); break; } }
      }
    });
    list.addEventListener("pointermove", (e) => {
      const o = e.target.closest(".gp-opt");
      if (o && e.pointerType === "mouse" && +o.dataset.i !== active) move(+o.dataset.i);
    });
    list.addEventListener("click", (e) => { const o = e.target.closest(".gp-opt"); if (o) choose(+o.dataset.i); });
    return search && !PHONE.matches ? search : list;
  };

  // ---------- Date: month calendar + quick chips ----------
  const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]; // weeks start on Monday (NZ)
  BUILD.date = (gp, body) => {
    const today = todayStr();
    let focus = parseYmd(gp.input.value) || parseYmd(today);
    let month = new Date(focus.getFullYear(), focus.getMonth(), 1);
    const allowed = (s) => (!gp.min || s >= gp.min) && (!gp.max || s <= gp.max);
    body.innerHTML = `
      <div class="gp-cal-head">
        <button type="button" class="gp-nav" data-nav="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg></button>
        <div class="gp-cal-title" aria-live="polite"></div>
        <button type="button" class="gp-nav" data-nav="1" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg></button>
      </div>
      <div class="gp-cal-week" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="gp-cal-clip"><div class="gp-cal-grid" role="grid"></div></div>
      <div class="gp-chips">
        <button type="button" class="chip" data-quick="-1">Yesterday</button>
        <button type="button" class="chip" data-quick="0">Today</button>
        <button type="button" class="chip" data-quick="1">Tomorrow</button>
        ${gp.required ? "" : `<button type="button" class="chip gp-clear" data-clear>Clear</button>`}
      </div>`;
    const grid = body.querySelector(".gp-cal-grid");
    const titleEl = body.querySelector(".gp-cal-title");

    function draw(dir = 0) {
      const sel = gp.input.value;
      titleEl.textContent = MONTH.format(month);
      const lead = (month.getDay() + 6) % 7; // days from Monday
      const first = addDays(month, -lead);
      const fs = ymd(focus);
      let html = "";
      for (let i = 0; i < 42; i++) {
        const d = addDays(first, i), s = ymd(d);
        const cls = ["gp-day", d.getMonth() !== month.getMonth() ? "out" : "", s === today ? "today" : "", s === sel ? "sel" : ""].filter(Boolean).join(" ");
        html += `${i % 7 === 0 ? `<div class="gp-cal-row" role="row">` : ""}<button type="button" role="gridcell" class="${cls}" data-date="${s}"
          tabindex="${s === fs ? 0 : -1}" aria-label="${ARIA_DAY.format(d)}"${s === sel ? ' aria-selected="true"' : ""}${allowed(s) ? "" : " disabled"}>${d.getDate()}</button>${i % 7 === 6 ? "</div>" : ""}`;
      }
      grid.innerHTML = html;
      if (dir && animOK()) grid.animate([{ opacity: 0, transform: `translateX(${dir * 36}px)` }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    function focusDay() { const b = grid.querySelector(`[data-date="${ymd(focus)}"]`); if (b) b.focus({ preventScroll: true }); }
    function goto(d, keepFocus = true) {
      const dir = d.getFullYear() * 12 + d.getMonth() - (month.getFullYear() * 12 + month.getMonth());
      focus = d;
      if (dir) { month = new Date(d.getFullYear(), d.getMonth(), 1); draw(Math.sign(dir)); } else draw();
      if (keepFocus) focusDay();
    }
    function pick(s) { if (!allowed(s)) return; setValue(gp, s); close(); }
    draw();

    body.addEventListener("click", (e) => {
      const day = e.target.closest(".gp-day");
      if (day) return pick(day.dataset.date);
      const nav = e.target.closest("[data-nav]");
      if (nav) {
        const n = +nav.dataset.nav;
        const target = new Date(month.getFullYear(), month.getMonth() + n, 1);
        const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        focus = new Date(target.getFullYear(), target.getMonth(), Math.min(focus.getDate(), last));
        month = target;
        draw(n);
        return;
      }
      const q = e.target.closest("[data-quick]");
      if (q) return pick(ymd(addDays(parseYmd(today), +q.dataset.quick)));
      if (e.target.closest("[data-clear]")) { setValue(gp, ""); close(); }
    });
    grid.addEventListener("keydown", (e) => {
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (e.key in steps) { e.preventDefault(); goto(addDays(focus, steps[e.key])); }
      else if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        const n = e.key === "PageUp" ? -1 : 1;
        const t = new Date(focus.getFullYear(), focus.getMonth() + n, 1);
        goto(new Date(t.getFullYear(), t.getMonth(), Math.min(focus.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate())));
      } else if (e.key === "Home") { e.preventDefault(); goto(addDays(focus, -((focus.getDay() + 6) % 7))); }
      else if (e.key === "End") { e.preventDefault(); goto(addDays(focus, 6 - ((focus.getDay() + 6) % 7))); }
    });
    // Swipe sideways to change month
    let sx = null, sy = 0;
    grid.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
    grid.addEventListener("pointerup", (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        const t = new Date(month.getFullYear(), month.getMonth() + (dx < 0 ? 1 : -1), 1);
        month = t;
        focus = new Date(t.getFullYear(), t.getMonth(), 1);
        draw(dx < 0 ? 1 : -1);
        // The tap that ended the swipe shouldn't also pick a day
        const block = (c) => { c.stopPropagation(); c.preventDefault(); };
        grid.addEventListener("click", block, { capture: true, once: true });
        setTimeout(() => grid.removeEventListener("click", block, { capture: true }), 350);
      }
    });
    grid.style.touchAction = "pan-y";
    return grid.querySelector('[tabindex="0"]');
  };

  // ---------- Time: iOS-style hour / minute wheels ----------
  const ROW = 40; // height of one wheel row, matches the CSS
  BUILD.time = (gp, body) => {
    const step = gp.step;
    const now = new Date();
    const [h0, m0] = /^\d{2}:\d{2}$/.test(gp.input.value) ? gp.input.value.split(":").map(Number)
      : (gp.input.dataset.default || `${pad(now.getHours())}:${pad(now.getMinutes())}`).split(":").map(Number);
    const hours = [...Array(24).keys()];
    const minutes = [...Array(Math.ceil(60 / step)).keys()].map((i) => i * step);
    const wheel = (key, items, label) => `<div class="gp-wheel" data-w="${key}" tabindex="0" role="listbox" aria-label="${label}">
        <div class="gp-wheel-pad"></div>${items.map((v, i) => `<div class="gp-wheel-item" role="option" data-i="${i}">${pad(v)}</div>`).join("")}<div class="gp-wheel-pad"></div></div>`;
    body.innerHTML = `
      <div class="gp-time">
        <div class="gp-band" aria-hidden="true"></div>
        ${wheel("h", hours, "Hours")}<span class="gp-colon" aria-hidden="true">:</span>${wheel("m", minutes, "Minutes")}
      </div>
      <div class="gp-time-actions">
        <button type="button" class="chip" data-now>Now</button>
        ${gp.required ? "" : `<button type="button" class="chip gp-clear" data-clear>Clear</button>`}
        <span class="gp-spacer"></span>
        <button type="button" class="btn btn-sm btn-primary" data-done>Done</button>
      </div>`;
    const wh = body.querySelector('[data-w="h"]'), wm = body.querySelector('[data-w="m"]');
    const W = [
      { el: wh, items: hours, idx: h0 },
      { el: wm, items: minutes, idx: Math.min(minutes.length - 1, Math.round(m0 / step) % minutes.length) },
    ];
    let touched = false;

    // Rows tilt and fade the further they are from the middle band (like a drum)
    function paint(w) {
      const center = w.el.scrollTop / ROW;
      w.el.querySelectorAll(".gp-wheel-item").forEach((it, i) => {
        const d = i - center;
        const a = Math.max(-1, Math.min(1, d / 3));
        it.style.opacity = String(Math.max(0.18, 1 - Math.abs(d) * 0.28));
        it.style.transform = REDUCE.matches ? "" : `rotateX(${-a * 55}deg) scale(${1 - Math.abs(a) * 0.12})`;
        it.classList.toggle("on", Math.round(center) === i);
        it.setAttribute("aria-selected", String(Math.round(center) === i));
      });
    }
    function commit() {
      const v = `${pad(hours[W[0].idx])}:${pad(minutes[W[1].idx])}`;
      setValue(gp, v);
    }
    function scrollTo(w, i, smooth) {
      w.idx = Math.max(0, Math.min(w.items.length - 1, i));
      w.el.scrollTo({ top: w.idx * ROW, behavior: smooth && animOK() ? "smooth" : "auto" });
      if (!smooth || !animOK()) paint(w);
    }
    W.forEach((w) => {
      let timer = null, frame = 0;
      w.el.addEventListener("scroll", () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => paint(w));
        clearTimeout(timer);
        timer = setTimeout(() => {
          const i = Math.max(0, Math.min(w.items.length - 1, Math.round(w.el.scrollTop / ROW)));
          if (i !== w.idx || touched) { w.idx = i; touched = true; commit(); }
        }, 110);
      });
      w.el.addEventListener("click", (e) => {
        const it = e.target.closest(".gp-wheel-item");
        if (it) { touched = true; scrollTo(w, +it.dataset.i, true); }
      });
      w.el.addEventListener("keydown", (e) => {
        const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
        if (e.key in steps) { e.preventDefault(); touched = true; scrollTo(w, w.idx + steps[e.key], true); }
        else if (e.key === "Home" || e.key === "End") { e.preventDefault(); touched = true; scrollTo(w, e.key === "Home" ? 0 : w.items.length - 1, true); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); (w.el === wh ? wm : wh).focus(); }
        else if (e.key === "Enter") { e.preventDefault(); commit(); close(); }
        else if (/^\d$/.test(e.key)) {
          // Typing digits jumps there, e.g. "2" "3" on hours → 23
          const typed = ((w._typed || "") + e.key).slice(-2);
          w._typed = typed;
          clearTimeout(w._typedTimer);
          w._typedTimer = setTimeout(() => { w._typed = ""; }, 900);
          const n = Number(typed);
          const i = w.items.findIndex((v) => v === n) >= 0 ? w.items.findIndex((v) => v === n) : w.items.findIndex((v) => v === Number(e.key));
          if (i >= 0) { touched = true; scrollTo(w, i, true); }
        }
      });
    });
    body.addEventListener("click", (e) => {
      if (e.target.closest("[data-done]")) { commit(); close(); }
      else if (e.target.closest("[data-clear]")) { setValue(gp, ""); close(); }
      else if (e.target.closest("[data-now]")) {
        const n = new Date();
        touched = true;
        scrollTo(W[0], n.getHours(), true);
        scrollTo(W[1], Math.round(n.getMinutes() / step) % minutes.length, true);
        setTimeout(commit, 0);
      }
    });
    // Position after the popover is on screen and sized
    requestAnimationFrame(() => W.forEach((w) => scrollTo(w, w.idx, false)));
    W.forEach((w) => scrollTo(w, w.idx, false));
    return wh;
  };

  // ================= Auto-upgrade =================
  // Any select / date / time added to the page later is swapped automatically.
  const observer = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) enhance(n);
  });
  function start() {
    enhance(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  return { enhance, close, setValue: (input, v) => { const gp = input.closest(".gp") && input.closest(".gp")._gp; if (gp) setValue(gp, v); else input.value = v; } };
})();
