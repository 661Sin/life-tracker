// ---------- Journal screens ----------
// A personal space for things I like or want: song of the week at the top,
// then the saved feed (links and photos in a masonry grid). Text comes from
// JournalStore, photos / audio from Media (both in journal-store.js); link
// parsing, filters and totals from JournalCalc (journal-calc.js).
//
// Design rules: one primary (blue) action, "+ Save"; everything else in ⋯;
// tap a card to open it (Edit / Delete inside). Pictures load only when they
// scroll near the screen; video players load only when an item is opened.

(function () {
  const root = document.getElementById("journal-root");
  if (!root) return;

  const J = JournalCalc;
  const D = () => JournalStore.data;

  // ================= Helpers =================
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const NZD = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
  const money = (n) => NZD.format(Math.round((Number(n) || 0) * 100) / 100);
  const F_DATE = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const F_SHORT = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
  const fmtDate = (s) => F_DATE.format(J.toUTC(s));
  const fmtShort = (s) => F_SHORT.format(J.toUTC(s));
  const dateOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const firstLine = (s) => String(s || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  const cleanTag = (s) => String(s || "").trim().toLowerCase().replace(/^#/, "").replace(/[,]/g, "").slice(0, 24);

  const btn = (label, action, id = "", cls = "") =>
    `<button type="button" class="btn ${cls}" data-action="${action}"${id !== "" ? ` data-id="${esc(id)}"` : ""}>${label}</button>`;
  const moreMenu = (items) => !items.length ? "" : `
    <div class="menu-wrap">
      <button type="button" class="btn btn-ghost btn-icon" data-action="menu" aria-label="More options" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu card" hidden>${items.map(([label, action, id]) =>
        `<button type="button" class="menu-item" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${label}</button>`).join("")}</div>
    </div>`;
  const field = (label, control) => `<label class="field"><span class="field-label">${label}</span>${control}</label>`;
  const fieldDiv = (label, control) => `<div class="field"><span class="field-label">${label}</span>${control}</div>`;
  const row2 = (...f) => `<div class="form-row">${f.join("")}</div>`;
  const textInput = (name, value, extra = "") => `<input name="${name}" type="text" value="${esc(value)}" ${extra}>`;
  const switchRow = (name, label, on, extra = "") =>
    `<label class="jr-switch-row"><span>${label}</span><input type="checkbox" class="jr-switch" name="${name}"${on ? " checked" : ""} ${extra}></label>`;
  const ICON = {
    link: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>`,
    photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="3.6"/><path d="M8.5 5l1.3-2h4.4l1.3 2"/></svg>`,
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
    out: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
    music: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  };
  const letter = (site) => esc((String(site || "?").replace(/^www\./, "")[0] || "?").toUpperCase());

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
  // returns an error message, or nothing on success (sheet closes, page redraws).
  function openForm(title, fieldsHtml, onSubmit, opts = {}) {
    const body = openModal(title, `
      <form class="form" novalidate>
        ${fieldsHtml}
        <div class="form-error" hidden></div>
        <div class="form-actions">
          ${opts.onDelete ? `<button type="button" class="btn btn-ghost danger form-delete" data-form-delete>Delete</button>` : ""}
          <button type="button" class="btn" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary">${opts.submitLabel || "Save"}</button>
        </div>
      </form>`);
    const form = body.querySelector("form");
    const errorBox = form.querySelector(".form-error");
    const submit = form.querySelector("[type=submit]");
    const fail = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };
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
      closeModal();
      render();
      if (opts.after) opts.after();
    });
    const del = form.querySelector("[data-form-delete]");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(opts.confirmText || "Delete this? This can't be undone.")) return;
      const error = await opts.onDelete();
      if (error) return fail(error);
      closeModal();
      render();
    });
    return form;
  }

  // ================= State =================
  const filter = { type: "all", tag: "", q: "" };
  const FILTERS = [["all", "All"], ["videos", "Videos"], ["photos", "Photos"], ["wishlist", "Wishlist"]];
  const PAGE = 40;                       // cards drawn at a time (more as you scroll)
  const grid = { list: [], shown: 0, heights: [], n: 0, colW: 0 };

  // ================= Page =================
  // The page is built once; each part redraws on its own so typing in the
  // search box (or a playing song) is never interrupted.
  root.innerHTML = `
    <div data-slot="song"></div>
    <div data-slot="head"></div>
    <div class="jr-bar">
      <div class="jr-filters" data-slot="filters"></div>
      <label class="jr-search">${ICON.search}<input type="search" name="jrSearch" placeholder="Search" aria-label="Search saved" autocomplete="off" data-native></label>
    </div>
    <div class="jr-grid" data-slot="grid"></div>
    <div class="jr-sentinel" aria-hidden="true"></div>`;
  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
  const gridEl = slot("grid");
  const searchEl = root.querySelector("[name=jrSearch]");

  function renderHead() {
    const d = D();
    const wish = filter.type === "wishlist";
    const shown = J.filterItems(d.items, filter);
    let label, big, sub = "";
    if (wish) {
      const w = J.wishlistTotal(shown);
      label = "Still want";
      big = money(w.total);
      sub = `${plural(w.count, "thing")}${w.count - w.priced ? ` · ${w.count - w.priced} without a price` : ""}`;
    } else {
      label = filter.type === "videos" ? "Videos" : filter.type === "photos" ? "Photos" : "Saved";
      big = String(shown.length);
      if (filter.tag || filter.q) sub = `of ${d.items.length}`;
    }
    const menu = [];
    if (J.allTags(d).length) menu.push(["Tags…", "tags"]);
    menu.push(["Storage used…", "storage"], ["Export backup", "export"], ["Import backup", "import"]);
    slot("head").innerHTML = `
      <div class="lf-head jr-head">
        <div class="lf-hero">
          <div class="stat-label">${label}</div>
          <div class="lf-big">${big}</div>
          ${sub ? `<div class="lf-sub">${sub}</div>` : ""}
        </div>
        <div class="lf-actions">${moreMenu(menu)}${btn("+ Save", "save", "", "btn-primary")}</div>
      </div>`;
  }

  function renderFilters() {
    const tags = J.allTags(D());
    if (filter.tag && !tags.includes(filter.tag)) filter.tag = "";
    slot("filters").innerHTML = `
      <div class="chips jr-chips">${FILTERS.map(([k, t]) =>
        `<button type="button" class="chip${filter.type === k ? " active" : ""}" data-action="filter" data-id="${k}" aria-pressed="${filter.type === k}">${t}</button>`).join("")}</div>
      ${tags.length ? `<div class="jr-tag-filter${filter.tag ? " on" : ""}"><select name="jrTag" aria-label="Filter by tag">
        <option value="">All tags</option>${tags.map((t) => `<option value="${esc(t)}"${t === filter.tag ? " selected" : ""}>#${esc(t)}</option>`).join("")}
      </select></div>` : ""}`;
  }

  // ---------- Masonry grid ----------
  // Cards go into the shortest column, using the picture's known shape, so
  // nothing jumps when pictures arrive.
  const GAP = 12;
  function colCount() {
    const w = gridEl.clientWidth;
    if (!w) return 0;
    return w < 560 ? 2 : Math.max(2, Math.floor((w + GAP) / (230 + GAP)));
  }
  function aspectOf(it) {
    if (it.kind === "photo" && it.photo && it.photo.w) return it.photo.w / it.photo.h;
    if (it.kind === "link") {
      if (it.thumb || (it.link && it.link.thumb)) return it.thumbAspect || (it.link && it.link.aspect) || 16 / 9;
      return null; // site card
    }
    return 1;
  }
  const estHeight = (it, w) => { const a = aspectOf(it); return (a ? w / Math.max(0.4, a) : 70) + 64 + (it.want ? 30 : 0); };

  function cardHtml(it) {
    const a = aspectOf(it);
    const video = J.isVideo(it);
    let media;
    if (it.kind === "photo") {
      media = `<div class="jr-media" style="aspect-ratio:${a}"><img data-media="${esc(it.photo && it.photo.thumb)}" alt="" decoding="async"></div>`;
    } else if (a) {
      media = `<div class="jr-media" style="aspect-ratio:${Math.max(0.4, a)}"><img data-src="${esc(it.thumb || it.link.thumb)}" alt="" decoding="async" referrerpolicy="no-referrer" data-thumb-of="${esc(it.id)}">
        ${video ? `<span class="jr-play">${ICON.play}</span>` : ""}</div>`;
    } else {
      const site = (it.link && it.link.site) || "Link";
      media = `<div class="jr-site"><span class="jr-site-letter">${letter(site)}</span><span class="jr-site-name">${esc(site)}</span>${video ? `<span class="jr-play jr-play-sm">${ICON.play}</span>` : ""}</div>`;
    }
    const line = firstLine(it.thoughts);
    const badge = it.want ? (it.got ? `<span class="jr-badge got">Got it ✓</span>`
      : `<span class="jr-badge want">Want${Number(it.price) > 0 ? ` · ${money(it.price)}` : ""}</span>`) : "";
    return `<article class="jr-card${it.got ? " got" : ""}" data-action="open" data-id="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.title || "Saved item")}">
      ${media}
      <div class="jr-card-body">
        ${it.title ? `<div class="jr-card-title">${esc(it.title)}</div>` : ""}
        ${line ? `<div class="jr-card-line">${esc(line)}</div>` : ""}
        ${badge}
      </div>
    </article>`;
  }

  function renderGrid() {
    grid.list = J.filterItems(D().items, filter);
    grid.n = colCount() || grid.n || 2;
    grid.shown = 0;
    grid.heights = Array(grid.n).fill(0);
    if (!grid.list.length) {
      gridEl.innerHTML = `<div class="card empty">${D().items.length ? "Nothing matches." : "Nothing saved yet."}</div>`;
      return;
    }
    gridEl.innerHTML = Array.from({ length: grid.n }, () => `<div class="jr-col"></div>`).join("");
    appendCards();
  }
  function appendCards() {
    const cols = gridEl.querySelectorAll(".jr-col");
    if (!cols.length) return;
    const w = cols[0].clientWidth || 200;
    const next = grid.list.slice(grid.shown, grid.shown + PAGE);
    for (const it of next) {
      let c = 0;
      for (let i = 1; i < grid.n; i++) if (grid.heights[i] < grid.heights[c] - 1) c = i;
      cols[c].insertAdjacentHTML("beforeend", cardHtml(it));
      grid.heights[c] += estHeight(it, w) + GAP;
    }
    grid.shown += next.length;
    lazy(gridEl);
  }

  // ---------- Lazy pictures ----------
  // Pictures get their address only when they come within ~600px of the screen.
  function loadImg(img) {
    if (img.dataset.media) {
      Media.url(img.dataset.media).then((u) => { if (u) img.src = u; else img.parentElement.classList.add("missing"); });
    } else if (img.dataset.src) img.src = img.dataset.src;
  }
  const imgObs = "IntersectionObserver" in window
    ? new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { imgObs.unobserve(e.target); loadImg(e.target); } }), { rootMargin: "600px 0px" })
    : null;
  function lazy(box) {
    box.querySelectorAll("img[data-src]:not([src]), img[data-media]:not([src])").forEach((img) => (imgObs ? imgObs.observe(img) : loadImg(img)));
  }
  // More cards once the bottom comes near
  const sentinel = root.querySelector(".jr-sentinel");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((ents) => {
      if (ents[0].isIntersecting && onJournal && grid.shown < grid.list.length) appendCards();
    }, { rootMargin: "800px 0px" }).observe(sentinel);
  }
  // Fade pictures in once loaded; a dead link thumbnail (TikTok's expire) is asked for again once
  root.addEventListener("load", (e) => { if (e.target.tagName === "IMG") e.target.classList.add("loaded"); }, true);
  root.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    const id = img.dataset.thumbOf;
    const it = id && JournalStore.get("items", id);
    if (!it || img.dataset.retried || !it.link) { if (img.parentElement) img.parentElement.classList.add("missing"); return; }
    img.dataset.retried = "1";
    LinkInfo.fetch(it.link).then((info) => {
      if (info && info.thumb && info.thumb !== img.src) {
        JournalStore.commit((d) => { d.items.find((x) => x.id === id).thumb = info.thumb; });
        img.src = info.thumb;
      } else img.parentElement.classList.add("missing");
    });
  }, true);

  // ================= Save sheet: Link or Photo =================
  function saveSheet() {
    const body = openModal("Save", `
      <div class="jr-choices">
        <button type="button" class="jr-choice" data-pick="link">${ICON.link}<b>Link</b></button>
        <label class="jr-choice">${ICON.photo}<b>Photo</b><input type="file" accept="image/*" class="jr-file" data-pick-photo></label>
      </div>`);
    body.querySelector("[data-pick=link]").addEventListener("click", () => itemForm(null, { kind: "link" }));
    body.querySelector("[data-pick-photo]").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) itemForm(null, { kind: "photo", file });
    });
  }

  // Tag chips to toggle + a box to make a new tag
  function tagPicker(selected) {
    const tags = J.allTags(D());
    return `<div class="jr-tags" data-tags>
      ${tags.map((t) => `<button type="button" class="chip${selected.has(t) ? " active" : ""}" data-tag="${esc(t)}" aria-pressed="${selected.has(t)}">#${esc(t)}</button>`).join("")}
      <span class="jr-newtag"><input type="text" data-new-tag placeholder="New tag" maxlength="24" aria-label="New tag" autocomplete="off"><button type="button" class="chip" data-add-tag aria-label="Add tag">+</button></span>
    </div>`;
  }
  function hookTagPicker(form, selected) {
    const box = form.querySelector("[data-tags]");
    const input = box.querySelector("[data-new-tag]");
    const add = () => {
      const t = cleanTag(input.value);
      input.value = "";
      if (!t) return;
      selected.add(t);
      let chip = [...box.querySelectorAll("[data-tag]")].find((c) => c.dataset.tag === t);
      if (!chip) {
        box.querySelector(".jr-newtag").insertAdjacentHTML("beforebegin", `<button type="button" class="chip active" data-tag="${esc(t)}" aria-pressed="true">#${esc(t)}</button>`);
      } else { chip.classList.add("active"); chip.setAttribute("aria-pressed", "true"); }
    };
    box.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-tag]");
      if (chip) {
        const t = chip.dataset.tag;
        if (selected.has(t)) selected.delete(t); else selected.add(t);
        chip.classList.toggle("active", selected.has(t));
        chip.setAttribute("aria-pressed", String(selected.has(t)));
      }
      if (e.target.closest("[data-add-tag]")) add();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } });
    return add; // also called on save, so a typed tag isn't lost
  }

  // ================= Item form (new / edit) =================
  function previewHtml(link, info) {
    if (!link) return "";
    const thumb = (info && info.thumb) || link.thumb;
    return `<div class="jr-prev">
      ${thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer" style="aspect-ratio:${link.aspect && link.aspect > 1 ? link.aspect : 1}">` : `<span class="jr-site-letter">${letter(link.site)}</span>`}
      <span class="jr-prev-text"><b>${esc((info && info.title) || link.site)}</b><span>${esc(link.site)}${info && info.author ? ` · ${esc(info.author)}` : ""}</span></span>
    </div>`;
  }

  function itemForm(id, opts = {}) {
    const it = id ? JournalStore.get("items", id) : null;
    const kind = it ? it.kind : opts.kind;
    const selected = new Set(it ? it.tags : filter.tag ? [filter.tag] : []);
    let newFile = opts.file || null;
    let link = it && it.link ? it.link : null;
    let info = null;
    let autoTitle = ""; // a title we filled in from the link (replaced if the link changes)

    const top = kind === "link"
      ? field("Link", `<input name="url" type="url" inputmode="url" autocomplete="off" placeholder="Paste a link" value="${esc(it ? it.url : "")}">`) +
        `<div class="jr-preview" data-preview>${previewHtml(link, null)}</div>`
      : `<div class="jr-photo-pick"><img data-photo-preview alt="" ${it ? `data-media="${esc(it.photo && it.photo.thumb)}"` : ""}>
          <label class="btn btn-sm jr-change">${it ? "Change photo" : "Choose another"}<input type="file" accept="image/*" class="jr-file" data-photo-file></label></div>`;
    const html = `${top}
      ${field("Title", textInput("title", it ? it.title : "", 'maxlength="140" autocomplete="off"'))}
      ${field("Thoughts", `<textarea name="thoughts" rows="4">${esc(it ? it.thoughts : "")}</textarea>`)}
      ${fieldDiv("Tags", tagPicker(selected))}
      ${switchRow("want", "Want it", it && it.want)}
      <div class="jr-want" data-want${it && it.want ? "" : " hidden"}>
        ${row2(field("Price", `<input name="price" type="number" inputmode="decimal" step="any" min="0" value="${it && it.price != null ? esc(it.price) : ""}" placeholder="Optional">`),
               field("Link to buy", textInput("buyUrl", it ? it.buyUrl : "", 'inputmode="url" placeholder="Optional" autocomplete="off"')))}
        ${switchRow("got", "Got it", it && it.got)}
      </div>`;

    let addTyped = () => {};
    const form = openForm(it ? "Edit" : kind === "link" ? "Save a link" : "Save a photo", html, async (v) => {
      addTyped();
      const base = {
        title: v.title, thoughts: v.thoughts, tags: [...selected], want: v.want === "on",
        price: v.want === "on" && v.price !== "" && Number(v.price) >= 0 ? Number(v.price) : null,
        buyUrl: v.want === "on" ? v.buyUrl : "",
        got: v.want === "on" && v.got === "on" ? (it && it.got) || J.today() : null,
      };
      if (base.price !== null && isNaN(base.price)) return "Price should be a number.";
      if (base.buyUrl && !J.url(base.buyUrl)) return "The buy link doesn't look like a web address.";
      if (base.buyUrl) base.buyUrl = J.url(base.buyUrl).href;
      let entry, oldMedia = [];

      if (kind === "link") {
        link = J.parseLink(v.url);
        if (!link) return "Paste a full link, e.g. https://youtube.com/…";
        if (!info || info.url !== link.url) info = await LinkInfo.fetch(link).then((x) => x && { ...x, url: link.url });
        const thumb = (link.provider !== "youtube" && info && info.thumb) || link.thumb || "";
        const aspect = link.aspect || (info && info.thumbW && info.thumbH ? info.thumbW / info.thumbH : null);
        entry = { ...base, kind, url: link.url, link, thumb, thumbAspect: thumb ? aspect || 16 / 9 : null,
                  title: base.title || (info && info.title) || link.site };
      } else {
        if (!it && !newFile) return "Choose a photo.";
        entry = { ...base, kind, title: base.title };
        if (newFile) {
          const full = await Media.resizeImage(newFile, 1600, 0.8);
          const small = await Media.resizeImage(full.blob, 600, 0.75);
          const fullId = await Media.put(full.blob);
          const thumbId = await Media.put(small.blob);
          entry.photo = { full: fullId, thumb: thumbId, w: full.w, h: full.h };
          if (it) oldMedia = JournalStore.mediaOf(it);
        }
      }
      const error = JournalStore.commit((d) => {
        if (it) {
          const i = d.items.findIndex((x) => x.id === it.id);
          d.items[i] = { ...d.items[i], ...entry, updated: Date.now() };
        } else d.items.push({ id: JournalStore.uid(), created: Date.now(), ...entry });
        for (const t of entry.tags) if (!d.tags.includes(t)) d.tags.push(t);
      });
      if (error) return error;
      Media.del(oldMedia).catch(() => {});
      if (!it) toast("Saved");
    }, {
      onDelete: it ? () => deleteItem(it.id) : null,
      after: it ? () => openItem(it.id) : null,
    });
    addTyped = hookTagPicker(form, selected);

    // Want it → price / buy link / got it
    const wantBox = form.querySelector("[data-want]");
    form.want.addEventListener("change", () => { wantBox.hidden = !form.want.checked; });

    if (kind === "link") {
      // Preview (and title) follow the link as it's pasted / typed
      const prev = form.querySelector("[data-preview]");
      let timer = null, seq = 0;
      const update = () => {
        const l = J.parseLink(form.url.value);
        link = l;
        prev.innerHTML = previewHtml(l, null);
        if (!l) return;
        const mine = ++seq;
        LinkInfo.fetch(l).then((x) => {
          if (mine !== seq || !x) return;
          info = { ...x, url: l.url };
          prev.innerHTML = previewHtml(l, info);
          if (x.title && (!form.title.value || form.title.value === autoTitle)) { form.title.value = autoTitle = x.title; }
        });
      };
      form.url.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 350); });
      form.url.addEventListener("paste", () => setTimeout(update, 0));
      if (!it) form.url.focus();
    } else {
      const img = form.querySelector("[data-photo-preview]");
      const show = (file) => { const u = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(u); img.src = u; };
      if (newFile) show(newFile); else if (it) loadImg(img);
      form.querySelector("[data-photo-file]").addEventListener("change", (e) => {
        if (e.target.files[0]) { newFile = e.target.files[0]; show(newFile); }
      });
      form.title.focus();
    }
  }

  async function deleteItem(id) {
    const it = JournalStore.get("items", id);
    const error = JournalStore.commit((d) => { d.items = d.items.filter((x) => x.id !== id); });
    if (!error && it) Media.del(JournalStore.mediaOf(it)).catch(() => {});
    return error;
  }

  // ================= Open an item (full size) =================
  // The video player is created only here, and removed when the sheet closes.
  function embedHtml(l, title) {
    const a = l.aspect || 16 / 9;
    const size = l.height ? `height:${l.height}px` : `aspect-ratio:${a};width:min(100%, calc(70vh * ${a}))`;
    return `<div class="jr-embed" style="${size}"><iframe src="${esc(l.embed)}" title="${esc(title || l.site)}"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }
  function openItem(id) {
    const it = JournalStore.get("items", id);
    if (!it) return;
    const l = it.link;
    let media = "";
    if (it.kind === "photo") {
      media = `<button type="button" class="jr-view-photo" data-full aria-label="Show full screen"><img data-media="${esc(it.photo && it.photo.full)}" alt="${esc(it.title)}" style="aspect-ratio:${aspectOf(it)}"></button>`;
    } else if (l && l.embed) {
      media = embedHtml(l, it.title);
    } else if (it.thumb || (l && l.thumb)) {
      media = `<a class="jr-view-thumb" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(it.thumb || l.thumb)}" alt="" referrerpolicy="no-referrer"></a>`;
    } else {
      media = `<a class="jr-site jr-site-big" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"><span class="jr-site-letter">${letter(l && l.site)}</span><span class="jr-site-name">${esc((l && l.site) || it.url)}</span></a>`;
    }
    const meta = [it.kind === "link" && l ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" class="jr-out">${esc(l.site)} ${ICON.out}</a>` : "",
                  `<span>${fmtDate(dateOf(it.created || Date.now()))}</span>`].filter(Boolean).join(`<span aria-hidden="true">·</span>`);
    const wish = it.want ? `
      <div class="jr-wish${it.got ? " got" : ""}">
        <div><div class="stat-label">${it.got ? `Got it · ${fmtShort(it.got)}` : "Want it"}</div><div class="jr-wish-price">${Number(it.price) > 0 ? money(it.price) : "—"}</div></div>
        <div class="jr-wish-actions">
          ${it.buyUrl ? `<a class="btn btn-sm" href="${esc(it.buyUrl)}" target="_blank" rel="noopener noreferrer">Buy ${ICON.out}</a>` : ""}
          <label class="jr-switch-row jr-got"><span>Got it</span><input type="checkbox" class="jr-switch" data-got${it.got ? " checked" : ""}></label>
        </div>
      </div>` : "";
    const body = openModal(it.title || (l ? l.site : "Photo"), `
      <div class="jr-view">
        ${media}
        <div class="jr-view-meta">${meta}</div>
        ${it.tags.length ? `<div class="jr-view-tags">${it.tags.map((t) => `<button type="button" class="chip" data-tag-go="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
        ${it.thoughts ? `<div class="jr-thoughts">${esc(it.thoughts)}</div>` : ""}
        ${wish}
        <div class="form-actions">
          <button type="button" class="btn btn-ghost danger form-delete" data-del>Delete</button>
          <button type="button" class="btn" data-edit>Edit</button>
        </div>
      </div>`);
    body.parentElement.classList.add("jr-view-box");
    lazy(body);
    body.querySelectorAll("img[data-media]").forEach(loadImg);
    body.addEventListener("click", async (e) => {
      if (e.target.closest("[data-edit]")) return itemForm(id);
      if (e.target.closest("[data-del]")) {
        if (!confirm("Delete this? This can't be undone.")) return;
        await deleteItem(id);
        closeModal();
        return render();
      }
      if (e.target.closest("[data-full]")) return fullScreen(it);
      const tg = e.target.closest("[data-tag-go]");
      if (tg) { filter.tag = tg.dataset.tagGo; closeModal(); return render(); }
    });
    const got = body.querySelector("[data-got]");
    if (got) got.addEventListener("change", () => {
      JournalStore.commit((d) => { d.items.find((x) => x.id === id).got = got.checked ? J.today() : null; });
      render();
      openItem(id);
      if (got.checked) toast("Got it ✓");
    });
  }

  // Photo full screen: tap anywhere or Escape to close
  function fullScreen(it) {
    const box = document.createElement("div");
    box.className = "jr-full";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", it.title || "Photo");
    box.tabIndex = -1;
    box.innerHTML = `<img alt="${esc(it.title)}"><button type="button" class="jr-full-close" aria-label="Close">${ICON.close}</button>`;
    Media.url(it.photo.full).then((u) => { if (u) box.querySelector("img").src = u; });
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    box.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(box);
    box.focus();
  }

  // ================= ⋯ menu sheets =================
  function tagsSheet() {
    const d = D();
    const tags = J.allTags(d);
    const body = openModal("Tags", `
      <div class="card lf-list lf-in-sheet jr-taglist">${tags.map((t) => `
        <div class="lf-row" data-tag-row="${esc(t)}" role="button" tabindex="0">
          <span class="lf-main"><span class="lf-title">#${esc(t)}</span></span><span class="lf-trail"><span class="muted">${J.tagCount(d, t)}</span></span>
        </div>`).join("")}</div>`);
    const open = (t) => {
      const form = openForm(`#${t}`, field("Name", textInput("name", t, 'maxlength="24" autocomplete="off"')), (v) => {
        const name = cleanTag(v.name);
        if (!name) return "Give the tag a name.";
        const error = JournalStore.commit((dd) => {
          dd.tags = [...new Set(dd.tags.map((x) => (x === t ? name : x)).concat(name))];
          for (const it of dd.items) it.tags = [...new Set(it.tags.map((x) => (x === t ? name : x)))];
        });
        if (!error && filter.tag === t) filter.tag = name;
        return error;
      }, {
        onDelete: () => JournalStore.commit((dd) => {
          dd.tags = dd.tags.filter((x) => x !== t);
          for (const it of dd.items) it.tags = it.tags.filter((x) => x !== t);
        }),
        confirmText: `Delete #${t}? It's removed from every item (the items stay).`,
        after: tagsSheet,
      });
      form.name.select();
    };
    body.addEventListener("click", (e) => { const r = e.target.closest("[data-tag-row]"); if (r) open(r.dataset.tagRow); });
    body.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.tagRow) open(e.target.dataset.tagRow); });
  }

  async function storageSheet() {
    const body = openModal("Storage used", `<div class="jr-storage"><div class="muted">Measuring…</div></div>`);
    const text = JournalStore.textBytes();
    const m = await Media.sizes().catch(() => ({ photos: 0, audio: 0, count: 0 }));
    let quota = null, persisted = null;
    try { if (navigator.storage && navigator.storage.estimate) quota = await navigator.storage.estimate(); } catch (e) { quota = null; }
    try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (e) { persisted = null; }
    const total = text + m.photos + m.audio;
    const line = (label, v) => `<div class="jr-st-row"><span>${label}</span><b>${v}</b></div>`;
    const box = body.querySelector(".jr-storage");
    if (!box) return;
    box.innerHTML = `
      <div class="lf-big">${J.bytes(total)}</div>
      <div class="jr-st-list">
        ${line("Text", J.bytes(text))}
        ${line("Photos", J.bytes(m.photos))}
        ${line("Audio", J.bytes(m.audio))}
        ${quota && quota.quota ? line("Space this browser allows", J.bytes(quota.quota)) : ""}
      </div>
      ${persisted === false ? `<div class="field-hint">The browser may clear photos if space runs low. Export a backup with photos to be safe.</div>` : ""}`;
  }

  // ================= Song of the week =================
  // A "now playing" card. A link plays in that site's own player (loaded only
  // when Play is pressed); an uploaded file plays in our glass player through
  // ONE shared <audio> element that lives outside the page, so it keeps
  // playing on other tabs (see the mini-player below).
  const songUi = { current: null, embedFor: null };   // song shown in the card; song whose embed is open
  const audio = new Audio();
  audio.preload = "metadata";
  const player = { songId: null, closed: false };     // song loaded into the <audio>; mini-player dismissed

  const thisWeek = () => J.weekStart(J.today());
  const weekLabel = (w) => {
    const end = J.addDays(w, 6);
    return w.slice(0, 7) === end.slice(0, 7) ? `${Number(w.slice(8))}–${fmtShort(end)}` : `${fmtShort(w)} – ${fmtShort(end)}`;
  };
  const shownSong = () => {
    const d = D();
    if (songUi.current && !JournalStore.get("songs", songUi.current)) songUi.current = null;
    return songUi.current ? JournalStore.get("songs", songUi.current) : J.songForWeek(d.songs, thisWeek());
  };
  const isPlaying = (s) => !!s && (s.source === "file" ? player.songId === s.id && !audio.paused : songUi.embedFor === s.id);
  const coverHtml = (s, cls = "jr-cover") => s && (s.coverMedia || s.cover)
    ? `<span class="${cls}"><img ${s.coverMedia ? `data-media="${esc(s.coverMedia)}"` : `data-src="${esc(s.cover)}" referrerpolicy="no-referrer"`} alt=""></span>`
    : `<span class="${cls} jr-cover-empty">${ICON.music}</span>`;

  function renderSong() {
    const box = slot("song");
    const keep = box.querySelector(".jr-song-embed iframe");   // an open embed survives redraws
    const s = shownSong();
    const week = thisWeek();
    const others = J.songsByWeek(D().songs).filter((x) => !s || x.id !== s.id);
    let card;
    if (!s) {
      card = `<div class="card jr-song jr-song-empty">
        <div class="jr-song-top">
          ${coverHtml(null)}
          <div class="jr-song-info"><div class="stat-label">Song of the week · ${weekLabel(week)}</div><div class="jr-song-title muted-title">Nothing yet</div></div>
          ${btn("Add song", "song-add")}
        </div></div>`;
    } else {
      const playing = isPlaying(s);
      const current = s.week === week;
      card = `<div class="card jr-song" data-song="${esc(s.id)}">
        <div class="jr-song-top">
          ${coverHtml(s)}
          <div class="jr-song-info" data-action="song-edit" data-id="${esc(s.id)}" role="button" tabindex="0" aria-label="Edit song">
            <div class="stat-label">${current ? "Song of the week" : "Week of"} · ${weekLabel(s.week)}</div>
            <div class="jr-song-title">${esc(s.title || "Untitled")}</div>
            ${s.artist ? `<div class="jr-song-artist">${esc(s.artist)}</div>` : ""}
          </div>
          <button type="button" class="jr-song-play${playing ? " on" : ""}" data-action="song-play" data-id="${esc(s.id)}" aria-label="${playing ? "Pause" : "Play"}">${playing ? ICON.pause : ICON.play}</button>
        </div>
        ${s.source === "file" ? `<div class="jr-seekrow">
            <span class="jr-time" data-t-now>${J.clock(player.songId === s.id ? audio.currentTime : 0)}</span>
            <input type="range" class="jr-seek" min="0" max="1000" step="1" value="${player.songId === s.id && audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0}" aria-label="Seek" data-seek>
            <span class="jr-time" data-t-len>${player.songId === s.id && audio.duration ? J.clock(audio.duration) : "–:––"}</span>
          </div>` : ""}
        <div class="jr-song-embed" data-embed></div>
        ${s.note ? `<div class="jr-song-note">${esc(s.note)}</div>` : ""}
        ${!current ? `<button type="button" class="link jr-song-back" data-action="song-week">Back to this week</button>` : ""}
      </div>`;
    }
    const list = others.length ? collapsedList(others) : "";
    box.innerHTML = card + list;
    if (s && songUi.embedFor === s.id && s.link && s.link.embed) {
      const holder = box.querySelector("[data-embed]");
      if (keep) holder.appendChild(keep); else holder.innerHTML = songEmbed(s);
    } else songUi.embedFor = null;
    lazy(box);
    box.querySelectorAll("img[data-media]").forEach(loadImg);
  }
  function collapsedList(songs) {
    const open = slot("song").querySelector(".jr-prev-weeks[open]") ? " open" : "";
    return `<details class="history lf-collapse jr-prev-weeks"${open}><summary>Previous weeks</summary>
      <div class="card lf-list">${songs.map((x) => `
        <div class="lf-row jr-song-row" data-action="song-pick" data-id="${esc(x.id)}" role="button" tabindex="0">
          <span class="lf-lead">${coverHtml(x, "jr-cover jr-cover-sm")}</span>
          <span class="lf-main"><span class="lf-title">${esc(x.title || "Untitled")}</span><span class="lf-meta">${esc(x.artist || (x.link ? x.link.site : "Uploaded"))}</span></span>
          <span class="lf-trail"><span class="muted">${fmtShort(x.week)}</span></span>
        </div>`).join("")}</div></details>`;
  }
  function songEmbed(s) {
    const l = s.link;
    const h = l.height || (l.provider === "youtube" ? null : 152);
    return `<iframe src="${esc(l.embed)}" title="${esc(s.title || l.site)}" style="${h ? `height:${h}px` : "aspect-ratio:16/9"}"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  // ---- Playing ----
  async function playSong(id) {
    const s = JournalStore.get("songs", id);
    if (!s) return;
    if (s.source === "link") {
      songUi.embedFor = songUi.embedFor === id ? null : id;   // Play opens the site's player; again closes it
      if (songUi.embedFor) audio.pause();
      return renderSong();
    }
    songUi.embedFor = null;
    if (player.songId !== id) {
      const url = await Media.url(s.audio);
      if (!url) return toast("This song's file is missing (restore a backup with audio).");
      player.songId = id;
      audio.src = url;
    }
    player.closed = false;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    setMediaSession(s);
  }
  // Lock-screen / headphone controls on phones
  function setMediaSession(s) {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    const meta = { title: s.title || "Song of the week", artist: s.artist || "", artwork: [] };
    const set = (src) => { if (src) meta.artwork = [{ src, sizes: "512x512" }]; navigator.mediaSession.metadata = new MediaMetadata(meta); };
    if (s.coverMedia) Media.url(s.coverMedia).then(set); else set(s.cover);
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  }
  // Keep the card's button, seek bar and times in step with the audio
  function syncPlayer() {
    const card = slot("song").querySelector(`.jr-song[data-song="${player.songId}"]`);
    if (card) {
      const b = card.querySelector(".jr-song-play");
      b.classList.toggle("on", !audio.paused);
      b.innerHTML = audio.paused ? ICON.play : ICON.pause;
      b.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
      const seek = card.querySelector("[data-seek]");
      if (seek && !seek.matches(":active")) seek.value = audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
      card.querySelector("[data-t-now]").textContent = J.clock(audio.currentTime);
      if (audio.duration) card.querySelector("[data-t-len]").textContent = J.clock(audio.duration);
    }
    if (PARTS.mini) PARTS.mini();
  }
  ["play", "pause", "timeupdate", "loadedmetadata", "ended", "emptied"].forEach((ev) => audio.addEventListener(ev, syncPlayer));
  root.addEventListener("input", (e) => {
    if (!e.target.matches("[data-seek]")) return;
    const card = e.target.closest(".jr-song");
    if (card.dataset.song !== player.songId || !audio.duration) return;
    audio.currentTime = (e.target.value / 1000) * audio.duration;
  });
  // Pressing the seek bar of a song that isn't loaded yet starts it
  root.addEventListener("pointerdown", (e) => {
    const seek = e.target.closest && e.target.closest("[data-seek]");
    if (seek && seek.closest(".jr-song").dataset.song !== player.songId) playSong(seek.closest(".jr-song").dataset.song);
  });

  // ---- Song form ----
  function songInfoFrom(link, info) {
    if (!info) return { title: link && link.provider === "apple" ? J.titleFromPath(link.id) : "", artist: "", cover: "" };
    if (link.provider === "youtube") return { ...J.splitSongTitle(info.title, info.author), cover: info.thumb };
    if (link.provider === "soundcloud") {
      const t = info.author ? info.title.replace(new RegExp(`\\s+by\\s+${info.author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "") : info.title;
      return { title: t, artist: info.author, cover: info.thumb };
    }
    return { title: info.title, artist: link.provider === "spotify" ? "" : info.author, cover: info.thumb };
  }

  function songForm(id) {
    const s = id ? JournalStore.get("songs", id) : null;
    let source = s ? s.source : "link";
    let audioFile = null, coverFile = null, link = s && s.link ? s.link : null, info = null;
    let auto = { title: "", artist: "" };
    const html = `
      <div class="seg" data-source>${[["link", "Link"], ["file", "Audio file"]].map(([v, t]) =>
        `<label><input type="radio" name="source" value="${v}"${v === source ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>
      <div data-src-link>
        ${field("Link", `<input name="url" type="url" inputmode="url" autocomplete="off" placeholder="YouTube, Spotify, SoundCloud or Apple Music" value="${esc(s && s.url ? s.url : "")}">`)}
        <div class="jr-preview" data-preview>${link ? previewHtml(link, null) : ""}</div>
      </div>
      <div data-src-file class="jr-filepick">
        <label class="jr-pickbtn">${ICON.music}<span data-audio-name>${esc(s && s.audioName ? s.audioName : "Choose audio (mp3, m4a)")}</span>
          <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav" class="jr-file" data-audio-file></label>
        <label class="jr-pickbtn jr-pickcover"><span class="jr-cover jr-cover-sm" data-cover-prev>${s && s.coverMedia ? `<img data-media="${esc(s.coverMedia)}" alt="">` : ICON.photo}</span><span>Cover (optional)</span>
          <input type="file" accept="image/*" class="jr-file" data-cover-file></label>
      </div>
      ${row2(field("Song", textInput("title", s ? s.title : "", 'maxlength="120" autocomplete="off"')), field("Artist", textInput("artist", s ? s.artist : "", 'maxlength="120" autocomplete="off"')))}
      ${field("Week of", `<input name="week" type="date" required value="${esc(s ? s.week : thisWeek())}">`)}
      ${field("Why I like it", `<textarea name="note" rows="3">${esc(s ? s.note : "")}</textarea>`)}`;

    const form = openForm(s ? "Edit song" : "Song of the week", html, async (v) => {
      if (!v.week) return "Pick the week.";
      const week = J.weekStart(v.week);
      const entry = { week, source, title: v.title, artist: v.artist, note: v.note };
      let dropMedia = [];
      if (source === "link") {
        link = J.parseLink(v.url);
        if (!link || !link.embed) return "Paste a YouTube, Spotify, SoundCloud or Apple Music link.";
        if (!info || info.url !== link.url) info = await LinkInfo.fetch(link).then((x) => x && { ...x, url: link.url });
        const got = songInfoFrom(link, info);
        Object.assign(entry, { url: link.url, link, cover: got.cover || "", audio: null, audioName: "", coverMedia: null,
          title: entry.title || got.title || link.site, artist: entry.artist || got.artist });
        if (s) dropMedia = JournalStore.mediaOf(s);
      } else {
        if (!audioFile && !(s && s.audio)) return "Choose an audio file.";
        if (audioFile && !/^audio\//.test(audioFile.type) && !/\.(mp3|m4a|aac|wav)$/i.test(audioFile.name)) return "That file isn't audio.";
        Object.assign(entry, { url: "", link: null, cover: "" });
        if (audioFile) {
          entry.audio = await Media.put(audioFile);
          entry.audioName = audioFile.name;
          if (s && s.audio) dropMedia.push(s.audio);
          if (!entry.title) entry.title = audioFile.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
        }
        if (coverFile) {
          const c = await Media.resizeImage(coverFile, 800, 0.8);
          entry.coverMedia = await Media.put(c.blob);
          if (s && s.coverMedia) dropMedia.push(s.coverMedia);
        }
      }
      const clash = D().songs.find((x) => x.week === week && (!s || x.id !== s.id));
      if (clash && !confirm(`Replace "${clash.title || "the song"}" as the song for the week of ${fmtShort(week)}?`)) {
        if (entry.audio && entry.audio !== (s && s.audio)) Media.del(entry.audio);
        return "Pick another week.";
      }
      let newId = s ? s.id : JournalStore.uid();
      const error = JournalStore.commit((d) => {
        if (clash) d.songs = d.songs.filter((x) => x.id !== clash.id);
        if (s) { const i = d.songs.findIndex((x) => x.id === s.id); d.songs[i] = { ...d.songs[i], ...entry }; }
        else d.songs.push({ id: newId, created: Date.now(), ...entry });
      });
      if (error) return error;
      if (clash) dropMedia.push(...JournalStore.mediaOf(clash));
      if (s && player.songId === s.id && (source === "link" || entry.audio !== s.audio)) stopAudio();
      Media.del(dropMedia).catch(() => {});
      songUi.current = week === thisWeek() ? null : newId;
    }, {
      onDelete: s ? () => {
        const error = JournalStore.commit((d) => { d.songs = d.songs.filter((x) => x.id !== s.id); });
        if (!error) {
          if (player.songId === s.id) stopAudio();
          if (songUi.current === s.id) songUi.current = null;
          Media.del(JournalStore.mediaOf(s)).catch(() => {});
        }
        return error;
      } : null,
    });

    // Link / file switch
    const showSource = () => {
      form.querySelector("[data-src-link]").hidden = source !== "link";
      form.querySelector("[data-src-file]").hidden = source !== "file";
    };
    form.addEventListener("change", (e) => {
      if (e.target.name === "source") { source = e.target.value; showSource(); }
      if (e.target.matches("[data-audio-file]") && e.target.files[0]) {
        audioFile = e.target.files[0];
        form.querySelector("[data-audio-name]").textContent = audioFile.name;
        if (!form.title.value) form.title.value = audioFile.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
      }
      if (e.target.matches("[data-cover-file]") && e.target.files[0]) {
        coverFile = e.target.files[0];
        const u = URL.createObjectURL(coverFile);
        form.querySelector("[data-cover-prev]").innerHTML = `<img src="${u}" alt="">`;
      }
    });
    showSource();
    form.querySelectorAll("img[data-media]").forEach(loadImg);

    // Link preview fills in song / artist (only fields still empty or filled by us)
    const prev = form.querySelector("[data-preview]");
    let timer = null, seq = 0;
    const update = () => {
      const l = J.parseLink(form.url.value);
      link = l;
      prev.innerHTML = l ? previewHtml(l, null) : "";
      if (!l) return;
      const mine = ++seq;
      LinkInfo.fetch(l).then((x) => {
        if (mine !== seq) return;
        info = x && { ...x, url: l.url };
        const got = songInfoFrom(l, info);
        if (info) prev.innerHTML = previewHtml(l, info);
        if (got.title && (!form.title.value || form.title.value === auto.title)) form.title.value = auto.title = got.title;
        if (got.artist && (!form.artist.value || form.artist.value === auto.artist)) form.artist.value = auto.artist = got.artist;
      });
    };
    form.url.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 350); });
    form.url.addEventListener("paste", () => setTimeout(update, 0));
    if (!s) form.url.focus();
  }

  function stopAudio() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    player.songId = null;
    if (PARTS.mini) PARTS.mini();
  }

  // ================= Mini-player =================
  // On other tabs, an uploaded song that's playing (or paused part-way) gets a
  // small glass player docked above the bottom bar (bottom right on PC).
  // Tap the song to go back to the Journal; × stops it.
  const mini = document.getElementById("jr-mini");
  function renderMini() {
    if (!mini) return;
    const s = player.songId && JournalStore.get("songs", player.songId);
    const show = !!s && !onJournal && !player.closed && (!audio.paused || audio.currentTime > 0);
    if (!show) {
      if (!mini.hidden) {
        mini.hidden = true;
        document.body.classList.remove("jr-mini-on");
      }
      return;
    }
    if (mini.dataset.song !== s.id) {
      mini.dataset.song = s.id;
      mini.innerHTML = `
        <button type="button" class="jr-mini-open" data-mini="open" aria-label="Open Journal">
          ${coverHtml(s, "jr-cover jr-cover-sm")}
          <span class="jr-mini-text"><b>${esc(s.title || "Song of the week")}</b>${s.artist ? `<span>${esc(s.artist)}</span>` : ""}</span>
        </button>
        <button type="button" class="jr-mini-btn" data-mini="toggle" aria-label="Pause"></button>
        <button type="button" class="jr-mini-btn jr-mini-x" data-mini="close" aria-label="Stop">${ICON.close}</button>
        <span class="jr-mini-bar" aria-hidden="true"><span></span></span>`;
      mini.querySelectorAll("img[data-media]").forEach(loadImg);
      mini.querySelectorAll("img[data-src]").forEach(loadImg);
    }
    const t = mini.querySelector("[data-mini=toggle]");
    const label = audio.paused ? "Play" : "Pause";
    if (t.getAttribute("aria-label") !== label || !t.innerHTML) { t.innerHTML = audio.paused ? ICON.play : ICON.pause; t.setAttribute("aria-label", label); }
    mini.querySelector(".jr-mini-bar span").style.transform = `scaleX(${audio.duration ? audio.currentTime / audio.duration : 0})`;
    if (mini.hidden) {
      mini.hidden = false;
      document.body.classList.add("jr-mini-on");
      if (canAnimate()) mini.animate([{ opacity: 0, transform: "translateY(16px) scale(0.96)" }, { opacity: 1, transform: "none" }],
        { duration: 320, easing: cssVar("--ease-spring") || "ease-out" });
    }
  }
  if (mini) mini.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mini]");
    if (!b) return;
    if (b.dataset.mini === "open") location.hash = "#journal";
    if (b.dataset.mini === "toggle") { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    if (b.dataset.mini === "close") { audio.pause(); player.closed = true; renderMini(); }
  });

  // ================= Actions =================
  const ACTIONS = {
    menu: (id, el) => {
      const menu = el.parentElement.querySelector(".menu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      el.setAttribute("aria-expanded", String(open));
      if (open) {
        const first = menu.querySelector(".menu-item");
        if (first) first.focus();
        // Show the size right in the menu
        const st = menu.querySelector("[data-action=storage]");
        if (st) Media.sizes().then((m) => { st.textContent = `Storage used · ${J.bytes(JournalStore.textBytes() + m.photos + m.audio)}`; }).catch(() => {});
      }
    },
    save: () => saveSheet(),
    open: (id) => openItem(id),
    filter: (k) => { filter.type = k; renderHead(); renderFilters(); renderGrid(); },
    tags: () => tagsSheet(),
    storage: () => storageSheet(),
    export: () => Backup.download(),
    import: () => Backup.chooseAndImport(),
    "song-add": () => songForm(null),
    "song-edit": (id) => songForm(id),
    "song-play": (id) => playSong(id),
    "song-pick": (id) => {           // replay a previous week's song in the card
      songUi.current = id;
      songUi.embedFor = null;
      renderSong();
      playSong(id);
      window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 20, behavior: canAnimate() ? "smooth" : "auto" });
    },
    "song-week": () => { songUi.current = null; songUi.embedFor = null; renderSong(); },
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
  // Tag picker and search
  root.addEventListener("change", (e) => {
    if (e.target.name === "jrTag") { filter.tag = e.target.value; renderHead(); renderFilters(); renderGrid(); }
  });
  let searchTimer = null;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.q = searchEl.value; renderHead(); renderGrid(); }, 150);
  });

  // ================= Drawing =================
  const PARTS = { song: renderSong, mini: renderMini };
  function render() {
    PARTS.song();
    renderHead();
    renderFilters();
    const y = window.scrollY;
    renderGrid();
    if (onJournal) window.scrollTo(0, y);
  }

  let onJournal = false;
  const readHash = () => { onJournal = location.hash.replace("#", "").split("/")[0] === "journal"; return onJournal; };
  // The grid can only measure itself while visible: redraw when shown or resized if the column count changed
  const refit = () => { if (onJournal && colCount() && colCount() !== grid.n) renderGrid(); };
  window.addEventListener("hashchange", () => {
    if (readHash()) requestAnimationFrame(refit);
    else if (songUi.embedFor) { songUi.embedFor = null; renderSong(); }   // a site's player stops when you leave
    if (PARTS.mini) PARTS.mini();
  });
  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refit, 150); });
  document.addEventListener("lifetracker:imported", () => { JournalStore.load(); render(); });

  JournalStore.load();
  readHash();
  render();
})();
