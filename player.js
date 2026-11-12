// ---------- Global music player ----------
// ONE player for the whole site, created once on page load and never rebuilt
// by any section. Journal's "Song of the week" card only sends it commands
// (Player.load / toggle / seek / setVolume) and listens for changes
// (Player.on). That's why music keeps playing when you switch tabs.
//
// Every source looks the same to the rest of the site, because only OUR glass
// controls are ever shown. Underneath, each source has an "engine":
//   file        → a permanent <audio> element (uploaded mp3 / m4a)
//   soundcloud  → SoundCloud's player in a hidden iframe, driven by its Widget API
//   youtube     → YouTube's player in a hidden iframe, driven by its IFrame Player API
//   spotify     → Spotify's embed in a hidden iframe, driven by its Embed IFrame API
//                 (no volume control; full songs only when logged in to Spotify in this browser)
// Hidden iframes sit in #player-host: off-screen, opacity 0, never display:none
// (some browsers pause or reload hidden iframes).
//
// track = { id, kind, home ("journal"), title, artist, cover, openUrl, openLabel,
//           src (file), url (soundcloud), videoId (youtube), uri (spotify), onMeta(meta)? }

const Player = (function () {
  const host = document.getElementById("player-host");
  const mini = document.getElementById("jr-mini");

  // The <audio> for uploaded files: made once, lives in #player-host forever
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  host.appendChild(audio);

  // iPhones ignore volume set from code (hardware buttons only): hide the slider there
  const volumeWorks = (() => { const a = document.createElement("audio"); a.volume = 0.5; return a.volume === 0.5; })();
  const VOL_KEY = "lifeTracker.player.volume";
  let savedVol = 1;
  try { const v = parseFloat(localStorage.getItem(VOL_KEY)); if (v >= 0 && v <= 1) savedVol = v; } catch (e) { /* per-browser nicety only */ }

  const blank = () => ({ id: null, kind: null, home: "", status: "idle", pos: 0, dur: 0, title: "", artist: "", cover: "", error: "", openUrl: "", openLabel: "" });
  const state = { ...blank(), vol: savedVol };
  const subs = new Set();
  let engine = null;   // { play, pause, seek, volume, destroy }
  let track = null;
  let seq = 0;         // so a slow-loading track can't overwrite a newer one
  let closed = false;  // mini-player dismissed with ×

  function emit() {
    subs.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
    drawMini();
    session();
  }
  const set = (patch, mine = seq) => { if (mine !== seq) return; Object.assign(state, patch); emit(); };

  // ---------- Loading the sites' APIs (once each) ----------
  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { scripts.delete(src); reject(new Error("Couldn't load the player. Are you offline?")); };
        document.head.appendChild(s);
      }));
    }
    return scripts.get(src);
  }
  let ytReady = null, spReady = null;
  const youtubeApi = () => ytReady || (ytReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    loadScript("https://www.youtube.com/iframe_api").catch((e) => { ytReady = null; reject(e); });
  }));
  const spotifyApi = () => spReady || (spReady = new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = (api) => resolve(api);
    loadScript("https://open.spotify.com/embed/iframe-api/v1").catch((e) => { spReady = null; reject(e); });
  }));
  const slotIn = () => { const d = document.createElement("div"); d.className = "player-slot"; host.appendChild(d); return d; };

  // ---------- Engines ----------
  const ENGINES = {
    file(t, autoplay, mine) {
      audio.src = t.src;
      audio.volume = state.vol;
      audio.dataset.seq = mine;
      if (autoplay) audio.play().catch(() => set({ status: "paused" }, mine));
      return {
        play: () => (audio.ended ? (audio.currentTime = 0) : 0, audio.play().catch(() => {})),
        pause: () => audio.pause(),
        seek: (s) => { audio.currentTime = s; },
        volume: (v) => { audio.volume = v; },
        destroy: () => { audio.pause(); delete audio.dataset.seq; audio.removeAttribute("src"); audio.load(); },
      };
    },

    async soundcloud(t, autoplay, mine) {
      await loadScript("https://w.soundcloud.com/player/api.js");
      const slot = slotIn();
      const frame = document.createElement("iframe");
      frame.title = "SoundCloud player";
      frame.allow = "autoplay; encrypted-media";
      frame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(t.url)}&auto_play=false&visual=false&show_comments=false&buying=false&sharing=false&download=false&show_user=true`;
      slot.appendChild(frame);
      const w = window.SC.Widget(frame), E = window.SC.Widget.Events;
      w.bind(E.READY, () => {
        w.setVolume(Math.round(state.vol * 100));
        w.getDuration((ms) => set({ dur: ms / 1000 }, mine));
        w.getCurrentSound((s) => {
          if (!s) return;
          const art = (s.artwork_url || (s.user && s.user.avatar_url) || "").replace("-large.", "-t500x500.");
          found({ title: s.title, artist: s.user && s.user.username, cover: art }, mine);
        });
        if (autoplay) w.play();
      });
      w.bind(E.PLAY, () => set({ status: "playing" }, mine));
      w.bind(E.PAUSE, () => set({ status: "paused" }, mine));
      w.bind(E.FINISH, () => set({ status: "ended", pos: state.dur }, mine));
      w.bind(E.PLAY_PROGRESS, (e) => set({ pos: e.currentPosition / 1000 }, mine));
      w.bind(E.ERROR, () => set({ status: "error", error: "SoundCloud couldn't play this track." }, mine));
      return {
        play: () => w.play(),
        pause: () => w.pause(),
        seek: (s) => { w.seekTo(s * 1000); set({ pos: s }, mine); },
        volume: (v) => w.setVolume(Math.round(v * 100)),
        destroy: () => { try { w.unbind(E.PLAY_PROGRESS); } catch (e) { /* already gone */ } slot.remove(); },
      };
    },

    async youtube(t, autoplay, mine) {
      const YT = await youtubeApi();
      const slot = slotIn();
      const el = document.createElement("div");
      slot.appendChild(el);
      let p = null, timer = null, ready = false;
      // Opened as a local file (file://), YouTube never answers: say so instead of loading forever
      const giveUp = setTimeout(() => {
        if (!ready) set({ status: "error", error: location.protocol === "file:"
          ? "YouTube won't play while the site is opened as a file. It will once the site is online."
          : "YouTube didn't respond." }, mine);
      }, 12000);
      const tick = () => { if (p && p.getCurrentTime) set({ pos: p.getCurrentTime() || 0, dur: p.getDuration() || state.dur }, mine); };
      const vars = { autoplay: autoplay ? 1 : 0, controls: 0, playsinline: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3 };
      if (location.origin && location.origin !== "null") vars.origin = location.origin;
      p = new YT.Player(el, {
        width: 200, height: 200, videoId: t.videoId, host: "https://www.youtube-nocookie.com", playerVars: vars,
        events: {
          onReady: () => {
            ready = true;
            clearTimeout(giveUp);
            p.setVolume(Math.round(state.vol * 100));
            const vd = p.getVideoData ? p.getVideoData() : null;
            if (vd && vd.title) found({ title: vd.title, artist: vd.author }, mine);
            set({ dur: p.getDuration() || 0 }, mine);
            if (autoplay) p.playVideo();
          },
          onStateChange: (e) => {
            const S = YT.PlayerState;
            if (e.data === S.PLAYING) { set({ status: "playing" }, mine); if (!timer) timer = setInterval(tick, 500); }
            else if (e.data === S.PAUSED) { set({ status: "paused" }, mine); tick(); }
            else if (e.data === S.BUFFERING) set({ status: "loading" }, mine);
            else if (e.data === S.ENDED) set({ status: "ended", pos: state.dur }, mine);
          },
          onError: (e) => set({ status: "error", error: [101, 150, 153].includes(e.data)
            ? "YouTube won't play this one inside the site here." : "YouTube couldn't play this video." }, mine),
        },
      });
      return {
        play: () => p.playVideo && p.playVideo(),
        pause: () => p.pauseVideo && p.pauseVideo(),
        seek: (s) => { if (p.seekTo) { p.seekTo(s, true); set({ pos: s }, mine); } },
        volume: (v) => p.setVolume && p.setVolume(Math.round(v * 100)),
        destroy: () => { clearInterval(timer); clearTimeout(giveUp); try { p.destroy(); } catch (e) { /* not ready yet */ } slot.remove(); },
      };
    },

    async spotify(t, autoplay, mine) {
      const api = await spotifyApi();
      const slot = slotIn();
      const el = document.createElement("div");
      slot.appendChild(el);
      let started = false;
      const ctrl = await new Promise((resolve) => api.createController(el, { uri: t.uri, width: 300, height: 152 }, resolve));
      ctrl.addListener("ready", () => { if (autoplay) ctrl.play(); });
      ctrl.addListener("playback_update", (e) => {
        const d = e.data || {};
        if (!d.isPaused) started = true;
        set({ pos: (d.position || 0) / 1000, dur: (d.duration || 0) / 1000 || state.dur,
              status: d.isBuffering ? "loading" : d.isPaused ? (started ? "paused" : state.status) : "playing" }, mine);
      });
      return {
        play: () => (started ? ctrl.resume() : ctrl.play()),
        pause: () => ctrl.pause(),
        seek: (s) => ctrl.seek(s),
        volume: null, // Spotify's API has no volume
        destroy: () => { try { ctrl.destroy(); } catch (e) { /* gone */ } slot.remove(); },
      };
    },
  };

  // Song details the source knows (SoundCloud / YouTube), offered back to the caller
  function found(meta, mine) {
    if (mine !== seq || !track) return;
    const patch = {};
    if (!state.title && meta.title) patch.title = meta.title;
    if (!state.artist && meta.artist) patch.artist = meta.artist;
    if (!state.cover && meta.cover) patch.cover = meta.cover;
    if (Object.keys(patch).length) set(patch, mine);
    if (track.onMeta) track.onMeta(meta);
  }

  // <audio> events (ignored when a different engine is in charge)
  const fromAudio = (fn) => () => { if (state.kind === "file" && audio.dataset.seq === String(seq)) fn(); };
  audio.addEventListener("play", fromAudio(() => set({ status: "playing" })));
  audio.addEventListener("playing", fromAudio(() => set({ status: "playing" })));
  audio.addEventListener("waiting", fromAudio(() => set({ status: "loading" })));
  audio.addEventListener("pause", fromAudio(() => { if (!audio.ended) set({ status: "paused" }); }));
  audio.addEventListener("ended", fromAudio(() => set({ status: "ended", pos: audio.duration || state.dur })));
  audio.addEventListener("timeupdate", fromAudio(() => set({ pos: audio.currentTime })));
  audio.addEventListener("loadedmetadata", fromAudio(() => set({ dur: audio.duration || 0 })));
  audio.addEventListener("error", fromAudio(() => set({ status: "error", error: "This audio file can't be played." })));

  // ---------- Commands ----------
  async function load(t, autoplay = true) {
    if (state.id === t.id && engine) { if (autoplay) play(); return; }  // same song: never rebuilt
    destroy();
    const mine = ++seq;
    track = t;
    closed = false;
    Object.assign(state, blank(), { id: t.id, kind: t.kind, home: t.home || "", status: "loading",
      title: t.title || "", artist: t.artist || "", cover: t.cover || "", openUrl: t.openUrl || "", openLabel: t.openLabel || "" });
    emit();
    try {
      const e = await ENGINES[t.kind](t, autoplay, mine);
      if (mine !== seq) { e.destroy(); return; }
      engine = e;
    } catch (err) {
      set({ status: "error", error: err.message || "Couldn't load the player." }, mine);
    }
  }
  function destroy() {
    if (engine) { try { engine.destroy(); } catch (e) { /* ignore */ } }
    engine = null;
    track = null;
  }
  function play() {
    if (!engine) return;
    closed = false;
    if (state.status === "ended") seek(0);
    engine.play();
  }
  function pause() { if (engine) engine.pause(); }
  function toggle() { if (state.status === "playing" || state.status === "loading") pause(); else play(); }
  function seek(sec) { if (engine && isFinite(sec)) { engine.seek(Math.max(0, Math.min(sec, state.dur || sec))); set({ pos: sec }); } }
  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    state.vol = v;
    try { localStorage.setItem(VOL_KEY, String(v)); } catch (e) { /* fine */ }
    if (engine && engine.volume) engine.volume(v);
    emit();
  }
  function stop() { seq++; destroy(); Object.assign(state, blank()); emit(); }
  // Details changed (e.g. song edited): update without touching playback
  function update(id, patch) { if (state.id === id) set(patch); }
  const canVolume = (kind) => volumeWorks && kind !== "spotify";

  // ---------- Mini-player ----------
  // Docked above the bottom bar (bottom right on PC) while a song is playing or
  // paused part-way and you're on another tab. Built once; only its text changes.
  const ICON = {
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    music: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>`,
  };
  let m = null;
  if (mini) {
    mini.innerHTML = `
      <button type="button" class="jr-mini-open" data-mini="open">
        <span class="jr-cover jr-cover-sm"><img alt="" hidden><span class="jr-mini-note">${ICON.music}</span></span>
        <span class="jr-mini-text"><b></b><span></span></span>
      </button>
      <button type="button" class="jr-mini-btn" data-mini="toggle" aria-label="Play">${ICON.play}</button>
      <button type="button" class="jr-mini-btn jr-mini-x" data-mini="close" aria-label="Stop">${ICON.close}</button>
      <span class="jr-mini-bar" aria-hidden="true"><span></span></span>`;
    m = {
      img: mini.querySelector("img"), note: mini.querySelector(".jr-mini-note"),
      title: mini.querySelector(".jr-mini-text b"), artist: mini.querySelector(".jr-mini-text span"),
      open: mini.querySelector("[data-mini=open]"), toggle: mini.querySelector("[data-mini=toggle]"),
      bar: mini.querySelector(".jr-mini-bar span"), playing: null,
    };
    mini.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mini]");
      if (!b) return;
      if (b.dataset.mini === "open" && state.home) location.hash = "#" + state.home;
      if (b.dataset.mini === "toggle") toggle();
      if (b.dataset.mini === "close") { pause(); closed = true; drawMini(); }
    });
    window.addEventListener("hashchange", () => drawMini());
  }
  const tabNow = () => location.hash.replace("#", "").split("/")[0];
  function drawMini() {
    if (!m) return;
    const live = ["playing", "paused", "loading"].includes(state.status);
    const show = !!state.id && live && !closed && tabNow() !== state.home;
    if (!show) {
      if (!mini.hidden) { mini.hidden = true; document.body.classList.remove("jr-mini-on"); }
      return;
    }
    if (m.title.textContent !== (state.title || "Song of the week")) m.title.textContent = state.title || "Song of the week";
    if (m.artist.textContent !== state.artist) m.artist.textContent = state.artist;
    m.open.setAttribute("aria-label", `${state.title || "Song"}: open ${state.home || "player"}`);
    if (state.cover) { if (m.img.getAttribute("src") !== state.cover) m.img.src = state.cover; m.img.hidden = false; m.note.hidden = true; }
    else { m.img.hidden = true; m.note.hidden = false; }
    const playing = state.status !== "paused";
    if (m.playing !== playing) {
      m.playing = playing;
      m.toggle.innerHTML = playing ? ICON.pause : ICON.play;
      m.toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    m.bar.style.transform = `scaleX(${state.dur ? Math.min(1, state.pos / state.dur) : 0})`;
    if (mini.hidden) {
      mini.hidden = false;
      document.body.classList.add("jr-mini-on");
      if (typeof canAnimate === "function" && canAnimate()) {
        mini.animate([{ opacity: 0, transform: "translateY(16px) scale(0.96)" }, { opacity: 1, transform: "none" }],
          { duration: 320, easing: (typeof cssVar === "function" && cssVar("--ease-spring")) || "ease-out" });
      }
    }
  }

  // ---------- Lock screen / headphone buttons ----------
  let sessionFor = null;
  function session() {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    const key = state.id && `${state.id}|${state.title}|${state.artist}|${state.cover}`;
    if (key === sessionFor) return;
    sessionFor = key;
    if (!state.id) { navigator.mediaSession.metadata = null; return; }
    navigator.mediaSession.metadata = new MediaMetadata({ title: state.title || "Song of the week", artist: state.artist || "",
      artwork: state.cover ? [{ src: state.cover, sizes: "512x512" }] : [] });
  }
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", play);
      navigator.mediaSession.setActionHandler("pause", pause);
      navigator.mediaSession.setActionHandler("seekto", (d) => seek(d.seekTime));
    } catch (e) { /* not supported */ }
  }

  return {
    state, load, play, pause, toggle, seek, setVolume, stop, update, canVolume,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();
