// The small ticking clock in the top-right corner of sites that have a limit.
// The background is the source of truth; this ticks locally between syncs
// and re-syncs every 15 s and whenever the tab comes back into view.
// Plain script (content scripts can't be modules), so no imports.
(() => {
  if (window.top !== window || window.__timelockClock) return;
  window.__timelockClock = true;

  const SYNC_MS = 15000;
  let st = null; // { left, used, limit, unlockedUntil, name, domains }
  let syncedAt = 0;
  let host, box, label;

  const pad = (n) => String(n).padStart(2, "0");
  function clock(secs) {
    secs = Math.max(0, Math.ceil(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Time only runs down while you're actually looking at this tab,
  // matching how the background counts.
  const counting = () => document.visibilityState === "visible" && document.hasFocus();

  function build() {
    host = document.createElement("timelock-clock");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; top: 12px; right: 12px; z-index: 2147483647; pointer-events: none; }
      .c { display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 8px; border-radius: 999px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
        color: #fff; background: rgba(29, 35, 48, .82); box-shadow: 0 2px 10px rgba(0,0,0,.25);
        backdrop-filter: blur(6px); transition: opacity .15s, background .3s; }
      .c.warn { background: rgba(230, 81, 0, .92); }
      .c.bad { background: rgba(198, 40, 40, .95); }
      .c.ok { background: rgba(46, 125, 50, .9); }
      .c.near { opacity: .12; }
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

    // Fade out when the mouse comes near, so it never hides what's underneath.
    document.addEventListener("mousemove", (e) => {
      const r = box.getBoundingClientRect();
      const near = e.clientX > r.left - 24 && e.clientX < r.right + 24 && e.clientY > r.top - 24 && e.clientY < r.bottom + 24;
      box.classList.toggle("near", near);
    }, { passive: true });
  }

  function render() {
    if (!st) {
      if (host) host.remove(), (host = null);
      return;
    }
    if (!host || !host.isConnected) build();
    const now = Date.now();
    const elapsed = counting() ? (now - syncedAt) / 1000 : 0;
    let secs, cls, tip;
    if (st.unlockedUntil > now) {
      secs = (st.unlockedUntil - now) / 1000;
      cls = "ok";
      tip = `TimeLock: unlocked for ${clock(secs)} more, then ${st.name} locks again.`;
    } else {
      secs = st.left - elapsed;
      cls = secs <= 60 ? "bad" : secs <= 300 ? "warn" : "";
      tip = `TimeLock: ${clock(secs)} left today on ${st.name} (${st.domains.join(", ")}).`;
    }
    label.textContent = clock(secs);
    box.className = `c ${cls} ${counting() ? "" : "paused"} ${box.classList.contains("near") ? "near" : ""}`;
    box.title = tip;
    box.querySelector(".hand").style.transform = `rotate(${(Math.floor(now / 1000) % 60) * 6}deg)`;
    // Out of time: ask the background now, which locks the site straight away.
    if (secs <= 0 && now - syncedAt > 1500) sync();
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

  sync();
  timer = setInterval(render, 1000);
  poll = setInterval(() => document.visibilityState === "visible" && sync(), SYNC_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", () => { sync(); });
})();
