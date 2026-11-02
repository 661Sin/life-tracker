// ---------- Section switching ----------
// Shows the section matching the URL "hash" (the part after #, e.g. #life).
// Changing the hash never reloads the page; it also means a refresh keeps
// you on the same tab and the browser's back button moves between tabs.

const TABS = ["pnl", "life", "other"];

function showTab() {
  let current = location.hash.replace("#", "");
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
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
let lastFocused = null; // so focus returns to the button that opened the modal

function openModal(sectionName) {
  lastFocused = document.activeElement;
  modalTitle.textContent = "Add to " + sectionName;
  modal.hidden = false;
  modal.querySelector(".modal-close").focus();
}

function closeModal() {
  modal.hidden = true;
  if (lastFocused) lastFocused.focus();
}

// "Add" buttons open it
document.querySelectorAll("[data-open-modal]").forEach((btn) => {
  btn.addEventListener("click", () => openModal(btn.dataset.openModal));
});

// X button and backdrop close it
document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeModal);
});

// Escape closes it
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});
