// ---------- Journal calculations ----------
// Everything the Journal works out: what a pasted link is (YouTube, TikTok,
// Spotify...), its embed / thumbnail address, weeks for "song of the week",
// feed filters and the wishlist total. No page code, no storage here.

const JournalCalc = {
  // ---- Dates (local time, "YYYY-MM-DD") ----
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  toUTC(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  fromUTC(dt) { return dt.toISOString().slice(0, 10); },
  addDays(s, n) { const d = this.toUTC(s); d.setUTCDate(d.getUTCDate() + n); return this.fromUTC(d); },
  // Monday of the week a date is in (weeks run Monday → Sunday)
  weekStart(s) { const d = this.toUTC(s); return this.addDays(s, -((d.getUTCDay() + 6) % 7)); },

  // ---- Links ----
  // Adds https:// if missing; returns a URL object or null
  url(text) {
    let t = String(text || "").trim();
    if (!t) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = "https://" + t;
    try { const u = new URL(t); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u : null; } catch (e) { return null; }
  },
  // "www.youtube.com" → "youtube.com"
  host(u) { return u.hostname.replace(/^(www|m|mobile)\./, ""); },

  // What a link is. Returns { url, provider, id, site, video, music, embed, thumb, aspect, height }
  //   provider: youtube | tiktok | instagram | vimeo | spotify | soundcloud | apple | web
  //   embed: player address for an <iframe> (null = no player, show a link card)
  //   aspect: width ÷ height of the thumbnail / player (null = no picture)
  parseLink(text) {
    const u = this.url(text);
    if (!u) return null;
    const host = this.host(u);
    const path = u.pathname;
    const out = { url: u.href, provider: "web", id: null, site: host, video: false, music: false, embed: null, thumb: null, aspect: null, height: null };
    let m;

    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|youtube-nocookie\.com$/.test(host)) {
      let id = null, shorts = false;
      if (host.endsWith("youtu.be")) id = path.slice(1).split("/")[0];
      else if ((m = path.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/))) { id = m[2]; shorts = m[1] === "shorts"; }
      else id = u.searchParams.get("v");
      if (id && /^[\w-]{6,}$/.test(id)) {
        const music = host.startsWith("music.");
        return { ...out, provider: "youtube", id, site: music ? "YouTube Music" : "YouTube", video: true, music,
          embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`,
          thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, aspect: shorts ? 9 / 16 : 16 / 9 };
      }
      return { ...out, site: "YouTube" };
    }
    if (/(^|\.)tiktok\.com$/.test(host)) {
      m = path.match(/\/video\/(\d+)/);
      return m ? { ...out, provider: "tiktok", id: m[1], site: "TikTok", video: true,
        embed: `https://www.tiktok.com/embed/v2/${m[1]}`, aspect: 9 / 16, height: 740 }
        : { ...out, provider: "tiktok", site: "TikTok", video: true }; // short vm.tiktok.com links: no id to embed
    }
    if (/(^|\.)instagram\.com$/.test(host)) {
      m = path.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
      return m ? { ...out, provider: "instagram", id: m[2], site: "Instagram", video: m[1] !== "p",
        embed: `https://www.instagram.com/p/${m[2]}/embed/`, height: 720 }
        : { ...out, provider: "instagram", site: "Instagram" };
    }
    if (/(^|\.)vimeo\.com$/.test(host)) {
      m = path.match(/\/(\d{5,})/);
      if (m) return { ...out, provider: "vimeo", id: m[1], site: "Vimeo", video: true,
        embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, aspect: 16 / 9 };
    }
    if (host === "open.spotify.com" || host === "spotify.link") {
      m = path.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|artist)\/(\w+)/);
      if (m) return { ...out, provider: "spotify", id: `${m[1]}/${m[2]}`, site: "Spotify", music: true,
        embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator`, height: m[1] === "track" ? 152 : 352 };
      return { ...out, provider: "spotify", site: "Spotify", music: true };
    }
    if (/(^|\.)soundcloud\.com$/.test(host) || host === "on.soundcloud.com") {
      return { ...out, provider: "soundcloud", id: path, site: "SoundCloud", music: true,
        embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.origin + u.pathname)}&auto_play=true&visual=false&show_comments=false`, height: 166 };
    }
    if (host === "music.apple.com" || host === "embed.music.apple.com") {
      return { ...out, provider: "apple", id: path, site: "Apple Music", music: true,
        embed: `https://embed.music.apple.com${path}${u.search}`, height: u.searchParams.get("i") || /\/song\//.test(path) ? 175 : 450 };
    }
    // Any other site: a clean card with the site name
    return out;
  },

  // Best-guess song name from an Apple Music address: /nz/album/blinding-lights/123?i=456 → "Blinding Lights"
  titleFromPath(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    const slug = parts.find((p, i) => i > 0 && !/^\d+$/.test(p) && !/^(album|song|playlist|artist|music-video|[a-z]{2})$/.test(p)) || "";
    return decodeURIComponent(slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  },

  // Tidies a YouTube title into song + artist: "Artist - Song (Official Video)" → { title: "Song", artist: "Artist" }
  splitSongTitle(title, author = "") {
    let t = String(title || "").replace(/\s*[([](official|lyric|lyrics|audio|music video|visualizer|video|hd|hq|4k)[^)\]]*[)\]]/gi, "").trim();
    let artist = String(author || "").replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
    const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) { artist = m[1].trim(); t = m[2].trim(); }
    return { title: t, artist };
  },

  // ---- Feed ----
  isVideo(item) { return item.kind === "link" && !!(item.link && item.link.video); },
  // filter: { type: all|videos|photos|wishlist, tag, q }. Newest first.
  // Wishlist shows things still wanted first, then the ones already got.
  filterItems(items, filter = {}) {
    const q = String(filter.q || "").trim().toLowerCase();
    let list = items.filter((it) => {
      if (filter.type === "videos" && !this.isVideo(it)) return false;
      if (filter.type === "photos" && it.kind !== "photo") return false;
      if (filter.type === "wishlist" && !it.want) return false;
      if (filter.tag && !(it.tags || []).includes(filter.tag)) return false;
      if (q) {
        const hay = [it.title, it.thoughts, (it.tags || []).join(" "), it.link && it.link.site].join(" ").toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    list = list.sort((a, b) => (b.created || 0) - (a.created || 0));
    if (filter.type === "wishlist") list.sort((a, b) => (a.got ? 1 : 0) - (b.got ? 1 : 0));
    return list;
  },
  // Total price of wanted items not yet got
  wishlistTotal(items) {
    const still = items.filter((it) => it.want && !it.got);
    return { count: still.length, total: still.reduce((s, it) => s + (Number(it.price) || 0), 0), priced: still.filter((it) => Number(it.price) > 0).length };
  },
  // Every tag in use plus the saved tag list, sorted
  allTags(data) {
    const set = new Set(data.tags || []);
    for (const it of data.items) for (const t of it.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  },
  tagCount(data, tag) { return data.items.filter((it) => (it.tags || []).includes(tag)).length; },

  // Spreads cards over n columns, each into the currently shortest one.
  // heights = estimated card heights (from the picture's aspect ratio).
  masonry(heights, n) {
    const cols = Array.from({ length: Math.max(1, n) }, () => ({ h: 0, idx: [] }));
    heights.forEach((h, i) => { const c = cols.reduce((a, b) => (b.h < a.h ? b : a)); c.idx.push(i); c.h += h; });
    return cols.map((c) => c.idx);
  },

  // ---- Songs ----
  // Songs newest week first
  songsByWeek(songs) { return [...songs].sort((a, b) => (b.week || "").localeCompare(a.week || "") || (b.created || 0) - (a.created || 0)); },
  songForWeek(songs, week) { return songs.find((s) => s.week === week) || null; },

  // ---- Sizes ----
  bytes(n) {
    if (!n) return "0 KB";
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  },
  // "3:07"
  clock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  },
};
