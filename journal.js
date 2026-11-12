// ---------- Journal screens ----------
// (Feed and song of the week are built on top of this.)
(function () {
  const root = document.getElementById("journal-root");
  if (!root) return;
  JournalStore.load();
  root.innerHTML = `<div class="card empty">Nothing saved yet.</div>`;
})();
