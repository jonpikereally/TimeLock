// The small ticking clock in the top-right corner of sites that have a limit.
// The background is the source of truth; this ticks locally between syncs
// and re-syncs every 15 s and whenever the tab comes back into view.
// Plain script (content scripts can't be modules), so no imports.
(() => {
  if (window.top !== window || window.__timelockClock) return;
  window.__timelockClock = true;

  const SYNC_MS = 15000;
  let st = null; // { left, used, limit, unlockedUntil, name, domains } or { mode: "up", used, name }
  let syncedAt = 0;
  let localSecs = 0; // counted here since the last sync
  let lastRender = Date.now();
  let host, box, label;

  const pad = (n) => String(n).padStart(2, "0");
  function clock(secs) {
    secs = Math.max(0, Math.ceil(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // ---------- away-from-keyboard and video detection ----------
  // Matches how the background counts: time runs only while this tab is in
  // front, and stops after a minute with no mouse or keyboard input, unless
  // a video (or audio) is playing, muted or not.
  const AWAY_MS = 60000;
  let lastInput = Date.now();
  for (const ev of ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"]) {
    addEventListener(ev, () => (lastInput = Date.now()), { capture: true, passive: true });
  }
  const mediaPlaying = () =>
    [...document.querySelectorAll("video, audio")].some((m) => !m.paused && !m.ended && m.readyState > 2);
  const away = () => Date.now() - lastInput > AWAY_MS && !mediaPlaying();
  const inFront = () => document.visibilityState === "visible" && document.hasFocus();
  const counting = () => inFront() && !away();

  // Tell the background when playback starts or stops, so a muted video
  // still counts while you're not touching anything (tab.audible misses it).
  let reported = null;
  function reportMedia() {
    const playing = mediaPlaying();
    if (playing === reported) return;
    reported = playing;
    chrome.runtime.sendMessage({ type: "media", playing }).catch(() => {});
  }
  for (const ev of ["play", "playing", "pause", "ended", "emptied"]) {
    document.addEventListener(ev, () => setTimeout(reportMedia, 50), true);
  }
  setInterval(reportMedia, 10000);

  function build() {
    host = document.createElement("timelock-clock");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; top: 12px; right: 12px; z-index: 2147483647; }
      .c { display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 8px; border-radius: 999px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
        color: #fff; background: rgba(29, 35, 48, .82); box-shadow: 0 2px 10px rgba(0,0,0,.25);
        backdrop-filter: blur(6px); transition: opacity .15s, background .3s;
        cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
      .c.dragging { cursor: grabbing; opacity: 1 !important; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
      .c.warn { background: rgba(230, 81, 0, .92); }
      .c.bad { background: rgba(198, 40, 40, .95); }
      .c.ok { background: rgba(46, 125, 50, .9); }
      .c.near { opacity: .4; }
      .c.paused .t { opacity: .7; }
      svg { width: 14px; height: 14px; flex: none; }
      .hand { transform-origin: 7px 7px; transition: transform .25s; }
    </style>
    <div class="c" title="">
      <svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <line class="hand" x1="7" y1="7" x2="7" y2="2.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <span class="t"></span>
    </div>`;
    box = root.querySelector(".c");
    label = root.querySelector(".t");
    document.documentElement.append(host);

    place(savedPos);
    enableDrag();

    // Fade when the mouse comes near, so you can see what's underneath
    // (it stays solid enough to grab and drag).
    document.addEventListener("mousemove", (e) => {
      const r = box.getBoundingClientRect();
      const near = e.clientX > r.left - 24 && e.clientX < r.right + 24 && e.clientY > r.top - 24 && e.clientY < r.bottom + 24;
      box.classList.toggle("near", near);
    }, { passive: true });
  }

  // ---------- dragging ----------
  // The position is remembered per site, as a distance from the nearest
  // horizontal and vertical edge, so it stays in its corner when the window
  // is resized. Double-click puts it back in the top-right corner.
  const MARGIN = 4;
  let savedPos = null; // { h: "left"|"right", x, v: "top"|"bottom", y }
  const site = location.hostname;

  async function loadPos() {
    try {
      const { clockPos = {} } = await chrome.storage.local.get("clockPos");
      savedPos = clockPos[site] || null;
    } catch (e) {
      savedPos = null;
    }
  }

  async function savePos(pos) {
    try {
      const { clockPos = {} } = await chrome.storage.local.get("clockPos");
      if (pos) clockPos[site] = pos;
      else delete clockPos[site];
      await chrome.storage.local.set({ clockPos });
    } catch (e) {
      if (String(e).includes("context invalidated")) return;
      chrome.runtime.sendMessage({ type: "logError", code: "TL-204", details: `${site}: ${e && e.message}` }).catch(() => {});
    }
  }

  function place(pos) {
    const s = host.style;
    s.left = s.right = s.top = s.bottom = "";
    if (!pos) return; // default: the top/right in the stylesheet
    const r = box.getBoundingClientRect();
    const maxX = Math.max(MARGIN, innerWidth - r.width - MARGIN);
    const maxY = Math.max(MARGIN, innerHeight - r.height - MARGIN);
    s[pos.h] = `${Math.min(Math.max(pos.x, MARGIN), maxX)}px`;
    s[pos.v] = `${Math.min(Math.max(pos.y, MARGIN), maxY)}px`;
    s[pos.h === "left" ? "right" : "left"] = "auto";
    s[pos.v === "top" ? "bottom" : "top"] = "auto";
  }

  function enableDrag() {
    let start = null;
    box.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = box.getBoundingClientRect();
      start = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    box.addEventListener("pointermove", (e) => {
      if (!start) return;
      start.moved = true;
      box.classList.add("dragging");
      const r = box.getBoundingClientRect();
      const left = Math.min(Math.max(e.clientX - start.dx, MARGIN), innerWidth - r.width - MARGIN);
      const top = Math.min(Math.max(e.clientY - start.dy, MARGIN), innerHeight - r.height - MARGIN);
      place({ h: "left", x: left, v: "top", y: top });
    });
    const end = () => {
      if (!start) return;
      box.classList.remove("dragging");
      if (start.moved) {
        const r = box.getBoundingClientRect();
        const right = innerWidth - r.right, bottom = innerHeight - r.bottom;
        savedPos = {
          h: r.left + r.width / 2 > innerWidth / 2 ? "right" : "left",
          x: Math.round(r.left + r.width / 2 > innerWidth / 2 ? right : r.left),
          v: r.top + r.height / 2 > innerHeight / 2 ? "bottom" : "top",
          y: Math.round(r.top + r.height / 2 > innerHeight / 2 ? bottom : r.top),
        };
        place(savedPos);
        savePos(savedPos);
      }
      start = null;
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    box.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      savedPos = null;
      place(null);
      savePos(null);
    });
    // Keep it on screen when the window shrinks.
    addEventListener("resize", () => savedPos && place(savedPos), { passive: true });
  }

  function render() {
    if (!st) {
      if (host) host.remove(), (host = null);
      return;
    }
    if (!host || !host.isConnected) build();
    const now = Date.now();
    const isCounting = counting();
    if (isCounting) localSecs += Math.min(5, (now - lastRender) / 1000);
    lastRender = now;
    const elapsed = localSecs;
    let secs, cls, tip;
    if (st.mode === "up") {
      secs = st.used + elapsed;
      cls = "";
      tip = `TimeLock: ${clock(secs)} spent on ${st.name} today.\nDrag to move · double-click to reset.`;
    } else if (st.unlockedUntil > now) {
      secs = (st.unlockedUntil - now) / 1000;
      cls = "ok";
      tip = `TimeLock: unlocked for ${clock(secs)} more, then ${st.name} locks again.\nDrag to move · double-click to reset.`;
    } else {
      secs = st.left - elapsed;
      cls = secs <= 60 ? "bad" : secs <= 300 ? "warn" : "";
      tip = `TimeLock: ${clock(secs)} left today on ${st.name} (${st.domains.join(", ")}).\nDrag to move · double-click to reset.`;
    }
    label.textContent = clock(secs);
    for (const c of ["warn", "bad", "ok"]) box.classList.toggle(c, c === cls);
    box.classList.toggle("paused", !isCounting);
    if (inFront() && away()) tip = `Paused: no mouse or keyboard for a minute.\n${tip}`;
    box.title = tip;
    box.querySelector(".hand").style.transform = `rotate(${(Math.floor(now / 1000) % 60) * 6}deg)`;
    // Out of time: ask the background now, which locks the site straight away.
    if (st.mode !== "up" && secs <= 0 && now - syncedAt > 1500) sync();
  }

  let syncing = false;
  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "pageStatus" });
      if (res && res.ok) {
        st = res.result;
        syncedAt = Date.now();
        localSecs = 0;
      }
    } catch (e) {
      // "Extension context invalidated" after TimeLock is reloaded: stop quietly.
      if (String(e).includes("context invalidated")) return stop();
      chrome.runtime.sendMessage({ type: "logError", code: "TL-203", details: `${location.hostname}: ${e && e.message}` }).catch(() => {});
    } finally {
      syncing = false;
    }
    render();
  }

  let timer, poll;
  function stop() {
    clearInterval(timer);
    clearInterval(poll);
    st = null;
    render();
  }

  loadPos().then(sync);
  timer = setInterval(render, 1000);
  poll = setInterval(() => document.visibilityState === "visible" && sync(), SYNC_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", () => { sync(); });
})();
