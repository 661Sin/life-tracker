// ---------- Service worker: offline app + updates ----------
// A service worker is a small script the browser keeps running for this site.
// It saves every app file in a cache, so the app opens with no internet, and
// serves them from there (fast). Your data is NOT here: it stays in the
// browser's localStorage / IndexedDB.
//
// Updates: VERSION is changed on every commit (Claude updates the line below
// to the date and time before committing). A new VERSION = a "new" service worker: the browser installs
// it in the background, the page shows "Update available, tap to refresh",
// and only after that tap does it take over (so nothing changes mid-use).

const VERSION = "2026-11-12.222110";
const CACHE = `life-tracker-${VERSION}`;
const FONTS = "life-tracker-fonts";

const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "pickers.js",
  "pnl-calc.js",
  "pnl-store.js",
  "pnl.js",
  "life-calc.js",
  "life-store.js",
  "life.js",
  "player.js",
  "journal-calc.js",
  "journal-store.js",
  "journal.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

// Install: download every app file fresh (skipping the browser's normal cache)
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: "reload" })))));
});

// The page says "go" when the user taps the update toast
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Activate: delete caches from older versions
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("life-tracker-") && n !== CACHE && n !== FONTS).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The app's own files: from the cache (any page address opens index.html)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === "navigate") return (await cache.match("index.html")) || fetch(req);
      return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
    })());
    return;
  }

  // Google Fonts: keep a copy so the font works offline too
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    })());
  }
  // Everything else (YouTube, SoundCloud, Spotify, link previews) goes straight to the internet
});
