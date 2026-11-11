// ---------- Section switching ----------
// Shows the section matching the URL "hash" (the part after #, e.g. #life).
// Changing the hash never reloads the page; it also means a refresh keeps
// you on the same tab and the browser's back button moves between tabs.
// A hash can also name a sub-page after a slash, e.g. #pnl/sales.

const TABS = ["pnl", "life", "other"];

function showTab() {
  let current = location.hash.replace("#", "").split("/")[0];
  if (!TABS.includes(current)) current = TABS[0]; // default to PnL

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === current);
  });
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === "page-" + current);
  });
}

window.addEventListener("hashchange", showTab);
showTab();

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
  modalBody.innerHTML = html;
  modal.hidden = false;
  const first = modalBody.querySelector("input:not([type=hidden]), select, textarea");
  (first || modal.querySelector(".modal-close")).focus();
  return modalBody;
}

function closeModal() {
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
