// ---------- Section switching ----------
// Shows the section matching the URL "hash" (the part after #, e.g. #life).
// Changing the hash never reloads the page; it also means a refresh keeps
// you on the same tab and the browser's back button moves between tabs.
// A hash can also name a sub-page after a slash, e.g. #pnl/sales.

const TABS = ["pnl", "life", "other"];

// ---------- Liquid Glass motion ----------
// Timings and easing are read from the CSS variables at the top of style.css.
// Only transform and opacity are animated (cheap for phones). With "reduce
// motion" turned on, everything switches instantly.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const cssNum = (name, fallback) => { const n = parseFloat(cssVar(name)); return isNaN(n) ? fallback : n; };
const canAnimate = () => !reduceMotion.matches && !!Element.prototype.animate;

// Adds the sliding "bubble" and the mouse-following highlight to a tab bar (once).
function glassBar(bar) {
  if (bar._glass) return bar._glass;
  const glow = document.createElement("span");
  glow.className = "glass-glow";
  const bubble = document.createElement("span");
  bubble.className = "glass-bubble";
  glow.setAttribute("aria-hidden", "true");
  bubble.setAttribute("aria-hidden", "true");
  bar.prepend(glow, bubble);
  bar.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = bar.getBoundingClientRect();
    glow.style.transform = `translate(${e.clientX - r.left + bar.scrollLeft}px, ${e.clientY - r.top + bar.scrollTop}px)`;
    bar.classList.add("glowing");
  });
  bar.addEventListener("pointerleave", () => bar.classList.remove("glowing"));
  bar._glass = { bubble, last: null };
  return bar._glass;
}

// Moves a bar's bubble behind its .active item. When animated it slides with a
// spring and stretches along the way. It jumps straight to the new size, then
// animates from the old shape ("FLIP"), so only transform changes.
function moveBubble(bar, animate = true) {
  const g = glassBar(bar);
  const active = bar.querySelector(":scope > .active");
  if (!active || !bar.offsetWidth) { g.bubble.style.opacity = 0; g.last = null; return; } // hidden bar
  const to = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
  const b = g.bubble;
  b.style.width = to.w + "px";
  b.style.height = to.h + "px";
  b.style.transform = `translate(${to.x}px, ${to.y}px)`;
  b.style.opacity = 1;
  const from = g.last;
  g.last = to;
  if (!animate || !from || !canAnimate()) return;
  if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return;

  // Halfway: centred between the two tabs, stretched along the direction of travel
  const sideways = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const stretch = cssNum("--bubble-stretch", 1.18), squash = 2 - stretch;
  const midW = ((from.w + to.w) / 2) * (sideways ? stretch : squash);
  const midH = ((from.h + to.h) / 2) * (sideways ? squash : stretch);
  const midX = (from.x + from.w / 2 + to.x + to.w / 2) / 2 - midW / 2;
  const midY = (from.y + from.h / 2 + to.y + to.h / 2) / 2 - midH / 2;
  b.animate([
    { transform: `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w}, ${from.h / to.h})` },
    { transform: `translate(${midX}px, ${midY}px) scale(${midW / to.w}, ${midH / to.h})`, offset: 0.4 },
    { transform: `translate(${to.x}px, ${to.y}px)` },
  ], { duration: cssNum("--t-bubble", 350), easing: cssVar("--ease-spring") || "ease" });
}

// Scrolls a sideways-scrolling bar so its active item is centred (phone sub-tabs)
function scrollActiveIntoView(bar) {
  const active = bar.querySelector(":scope > .active");
  if (!active || bar.scrollWidth <= bar.clientWidth) return;
  bar.scrollTo({ left: active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2,
                 behavior: canAnimate() ? "smooth" : "auto" });
}

// Page change: newEl slides in from the side of the tab picked (dir = 1 from
// the right, -1 from the left) and fades in while oldEl fades out on top.
// done() runs once oldEl's exit is over (straight away when not animating).
function slidePage(oldEl, newEl, dir, done) {
  if (newEl._endLeave) newEl._endLeave();   // came straight back: cancel its exit
  if (!oldEl) return;
  if (!dir || !canAnimate()) { done(); return; }
  if (oldEl._endLeave) oldEl._endLeave();
  const shift = cssNum("--page-shift", 40) * dir;
  const opts = { duration: cssNum("--t-page", 300), easing: cssVar("--ease-out") || "ease-out" };

  // Keep the old page visible exactly where the new one now sits, out of the flow
  Object.assign(oldEl.style, { top: newEl.offsetTop + "px", left: newEl.offsetLeft + "px", width: newEl.offsetWidth + "px" });
  oldEl.classList.add("leaving");
  oldEl.inert = true;
  oldEl.setAttribute("aria-hidden", "true");

  newEl.animate([{ opacity: 0, transform: `translateX(${shift}px)` }, { opacity: 1, transform: "none" }], opts);
  const out = oldEl.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-shift}px)` }],
    { ...opts, fill: "forwards" });
  // Safety net: tidy up even if the browser never reports the animation finished
  const safety = setTimeout(() => oldEl._endLeave && oldEl._endLeave(), opts.duration + 150);
  oldEl._endLeave = () => {
    clearTimeout(safety);
    oldEl._endLeave = null;
    out.onfinish = null;
    out.cancel();
    oldEl.classList.remove("leaving");
    Object.assign(oldEl.style, { top: "", left: "", width: "" });
    oldEl.inert = false;
    oldEl.removeAttribute("aria-hidden");
    done();
  };
  out.onfinish = oldEl._endLeave;
}

const sideTabs = document.querySelector(".side-tabs");
let currentTab = null;

function showTab() {
  let current = location.hash.replace("#", "").split("/")[0];
  if (!TABS.includes(current)) current = TABS[0]; // default to PnL
  const oldPage = currentTab && currentTab !== current ? document.getElementById("page-" + currentTab) : null;
  const dir = oldPage ? Math.sign(TABS.indexOf(current) - TABS.indexOf(currentTab)) : 0;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === current);
  });
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === "page-" + current);
  });

  const newPage = document.getElementById("page-" + current);
  slidePage(oldPage, newPage, dir, () => {});
  currentTab = current;
  moveBubble(sideTabs);
  newPage.querySelectorAll(".subnav").forEach((bar) => moveBubble(bar, false)); // it was hidden until now
}

window.addEventListener("hashchange", showTab);
showTab();

// Re-place bubbles when sizes change (window resize, PC ↔ phone layout, web font loaded)
function placeAllBubbles() {
  document.querySelectorAll(".side-tabs, .subnav").forEach((bar) => moveBubble(bar, false));
}
window.addEventListener("resize", placeAllBubbles);
if (document.fonts) document.fonts.ready.then(placeAllBubbles);

// ---------- Modal ----------
// One shared pop-up. openModal(title, html) fills it and returns the body
// element so the caller (e.g. a PnL form) can hook up its own events.
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
let lastFocused = null; // so focus returns to the button that opened the modal

function openModal(title, html) {
  if (modal.hidden) lastFocused = document.activeElement;
  modalTitle.textContent = title;
  modal.querySelector(".modal-box").className = "modal-box"; // drop any special sheet style (e.g. the full check-in sheet)
  modalBody.innerHTML = html;
  if (typeof Pickers !== "undefined") Pickers.enhance(modalBody); // native selects / dates / times → glass pickers
  modal.hidden = false;
  const first = modalBody.querySelector("input:not([type=hidden]):not(.gp-value):not([type=checkbox]):not([type=radio]), textarea");
  (first || modal.querySelector(".modal-close")).focus();
  return modalBody;
}

function closeModal() {
  if (typeof Pickers !== "undefined") Pickers.close(false, true);
  modal.hidden = true;
  modalBody.innerHTML = "";
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
}

// Placeholder "Add" buttons (Life / Other) open it
document.querySelectorAll("[data-open-modal]").forEach((btn) => {
  btn.addEventListener("click", () =>
    openModal("Add to " + btn.dataset.openModal, '<p class="modal-muted">Nothing here yet.</p>'));
});

// X button, Cancel buttons and the backdrop close it
modal.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-modal]")) closeModal();
});

// Escape closes it
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});
