import * as core from "./shared/core.js";
import { REPO, coded, logError } from "./shared/errors.js";
import { hashPassword, checkPassword } from "./shared/password.js";

const VERSION = chrome.runtime.getManifest().version;
const FEED = `https://raw.githubusercontent.com/${REPO}/main/updates/latest.json`;
const BLOCKED = chrome.runtime.getURL("app/blocked.html");
const MAX_GAP = 90; // seconds; a longer gap between ticks means the computer slept
const KEEP_DAYS = 35;
const DEFAULTS = { rules: [], resetHour: 0, warnings: true, updateSource: "", clockSites: [], goals: [] };

// Every state change goes through one queue, so two events firing together
// can't count the same seconds twice.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

async function load(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch (e) {
    throw coded("TL-202", e.message);
  }
}

async function getSettings() {
  const { settings } = await load("settings");
  const s = { ...DEFAULTS, ...settings };
  // v1.2.0 kept the clock as a per-limit flag; fold those into clockSites.
  for (const r of s.rules) if (r.clock) for (const d of r.domains) s.clockSites = core.setClock(s.clockSites, d, true);
  return s;
}

// ---------- time tracking ----------
// We remember which site is in front and since when. Every event (tab switch,
// navigation, focus change, idle change) and a 30-second alarm "flush" the
// seconds since then onto that site, then look again at what's in front now.

async function frontHost() {
  const win = await chrome.windows.getLastFocused({}).catch(() => null);
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) return null;
  // On macOS the window can stay "focused" after you switch to another app,
  // so ask the page too: document.hasFocus() is false whenever the browser
  // isn't the frontmost app. Pages without our script (new tab, extension
  // pages) fall back to the window check above.
  const pageFocused = await chrome.tabs.sendMessage(tab.id, { type: "hasFocus" }).catch(() => null);
  if (pageFocused === false) return null;
  const { idle, [`media:${tab.id}`]: video } = await chrome.storage.session.get(["idle", `media:${tab.id}`]);
  // After a minute with no mouse or keyboard input, time stops counting
  // unless the tab is playing sound or a video (muted videos included).
  if (idle && idle !== "active" && !tab.audible && !video) return null;
  return core.hostOf(tab.url);
}

async function flush() {
  const now = Date.now();
  const s = await getSettings();
  const { cur } = await chrome.storage.session.get("cur");
  if (cur && cur.host) {
    const secs = (now - cur.since) / 1000;
    if (secs > 0 && secs <= MAX_GAP) {
      const key = "usage:" + core.dayKey(cur.since, s.resetHour);
      const { [key]: usage = {} } = await load(key);
      usage[cur.host] = (usage[cur.host] || 0) + secs;
      try {
        await chrome.storage.local.set({ [key]: usage });
      } catch (e) {
        throw coded("TL-201", e.message);
      }
    }
  }
  const host = await frontHost();
  await chrome.storage.session.set({ cur: { host, since: now } });
  await enforce(s, host, now);
}

const tick = (why) =>
  serial(flush)
    .then(() => macSync())
    .catch((e) => logError(e.code || "TL-999", `${why}: ${e.stack || e}`));

// ---------- the TimeLock Mac app ----------
// Chrome runs the Mac app in "connector" mode through native messaging
// (host com.jonpike.timelock, registered by the app at launch). Each sync
// hands it today's site time and limits and gets today's app time back, so
// app time counts toward limits and the menu bar shows site time.

const MAC_HOST = "com.jonpike.timelock";
const MAC_EVERY = 25000;
let lastMacSync = 0;

async function macSync(force = false) {
  const now = Date.now();
  if (!force && now - lastMacSync < MAC_EVERY) return;
  lastMacSync = now;
  const s = await getSettings();
  const { day, usage, apps, unlocks } = await today(s, now);
  const limits = s.rules.map((r) => {
    const st = core.ruleStatus(r, usage, unlocks, now, s.resetHour, apps);
    return { name: r.name, domains: r.domains, apps: r.apps || [], limit: st.limit, used: st.used, locked: st.locked, unlockedUntil: st.unlockedUntil };
  });
  const { mac: prev } = await load("mac");
  let mac;
  try {
    const res = await chrome.runtime.sendNativeMessage(MAC_HOST, {
      type: "sync", day, resetHour: s.resetHour, sites: usage, limits, goals: s.goals, version: VERSION, at: now,
    });
    if (!res || !res.ok) throw new Error((res && res.error) || "empty reply");
    await chrome.storage.local.set({ [`apps:${day}`]: res.apps || {} });
    mac = { installed: true, connected: true, at: now, version: res.version, running: !!res.running, known: res.known || [] };
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/not found|forbidden/i.test(msg)) {
      // Not installed (or installed for another extension ID): not an error.
      mac = { installed: false, connected: false, at: now, known: (prev && prev.known) || [] };
    } else {
      mac = { installed: true, connected: false, at: now, error: { code: "TL-601", details: msg }, known: (prev && prev.known) || [] };
      if (!prev || !prev.error) await logError("TL-601", msg);
    }
  }
  await chrome.storage.local.set({ mac });
  if (mac.connected) await serial(flush); // app time may have just locked something
}

// ---------- enforcing limits ----------

// Today's site time, Mac app time and temporary unlocks.
async function today(s, now) {
  const day = core.dayKey(now, s.resetHour);
  const got = await load([`usage:${day}`, `apps:${day}`, "unlocks", "warned"]);
  return { day, usage: got[`usage:${day}`] || {}, apps: got[`apps:${day}`] || {}, unlocks: got.unlocks || {}, warned: got.warned || {} };
}

async function enforce(s, host, now) {
  const { day, usage, apps, unlocks, warned } = await today(s, now);
  const statuses = s.rules.map((r) => [r, core.ruleStatus(r, usage, unlocks, now, s.resetHour, apps)]);
  const locked = statuses.filter(([, st]) => st.locked).map(([r]) => r);

  await applyBlockRules(locked);
  await redirectOpenTabs(locked);

  // Badge: time left on the strictest limit covering the site in front.
  const mine = statuses.filter(([r]) => r.domains.some((d) => core.hostMatches(host, d)));
  const tight = mine.sort((a, b) => a[1].left - b[1].left)[0];
  if (tight && !tight[1].unlocked) {
    const m = Math.ceil(tight[1].left / 60);
    await chrome.action.setBadgeText({ text: m >= 100 ? `${Math.round(m / 60)}h` : `${m}m` });
    await chrome.action.setBadgeBackgroundColor({ color: m <= 5 ? "#c62828" : "#455a64" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }

  // Lock right on time instead of waiting for the next 30-second tick.
  if (tight && !tight[1].locked && !tight[1].unlocked && tight[1].left < 35) {
    setTimeout(() => tick("limit reached"), tight[1].left * 1000 + 300);
  }

  // Heads-up notifications at 5 and 1 minutes left, once each per day.
  if (s.warnings && tight && !tight[1].unlocked) {
    const done = warned.day === day ? warned.keys : [];
    const due = [5, 1].filter((m) => tight[1].limit >= m * 60 * 2 && tight[1].left <= m * 60 && tight[1].left > 0);
    const fresh = due.filter((m) => !done.includes(`${tight[0].id}:${m}`));
    if (fresh.length) {
      const mark = Math.min(...due);
      due.forEach((m) => done.push(`${tight[0].id}:${m}`));
      chrome.notifications.create(`warn-${tight[0].id}-${mark}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `${mark} minute${mark > 1 ? "s" : ""} left on ${tight[0].name}`,
        message: `TimeLock will lock ${tight[0].domains.join(", ")} for the rest of the day.`,
      });
    }
    await chrome.storage.local.set({ warned: { day, keys: done } });
  }

  // Wake up exactly when a temporary unlock runs out.
  const nextExpiry = Math.min(...Object.values(unlocks).filter((t) => t > now), Infinity);
  if (nextExpiry !== Infinity) chrome.alarms.create("relock", { when: nextExpiry + 500 });
}

// declarativeNetRequest sends any page load on a locked domain to the lock
// screen before it even starts, with the original URL after the #.
async function applyBlockRules(locked) {
  // A limit made only of Mac apps has no sites to block.
  const want = locked.filter((r) => r.domains.length).map((r, i) => ({
    id: i + 1,
    priority: 1,
    condition: { requestDomains: r.domains, resourceTypes: ["main_frame"], regexFilter: "^(https?://.*)$" },
    action: { type: "redirect", redirect: { regexSubstitution: `${BLOCKED}#\\1` } },
  }));
  try {
    const have = await chrome.declarativeNetRequest.getDynamicRules();
    const same = have.length === want.length && want.every((w, i) => JSON.stringify(w.condition.requestDomains) === JSON.stringify(have[i].condition.requestDomains));
    if (same) return;
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: have.map((r) => r.id), addRules: want });
  } catch (e) {
    throw coded("TL-301", e.message);
  }
}

async function redirectOpenTabs(locked) {
  if (!locked.length) return;
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    const host = core.hostOf(tab.url);
    if (locked.some((r) => r.domains.some((d) => core.hostMatches(host, d)))) {
      await chrome.tabs.update(tab.id, { url: `${BLOCKED}#${tab.url}` }).catch((e) => logError("TL-302", e.message));
    }
  }
}

async function pruneOldDays() {
  const all = await chrome.storage.local.get(null);
  const cutoff = core.dayKey(Date.now() - KEEP_DAYS * 864e5);
  const old = Object.keys(all).filter((k) => /^(usage|apps):/.test(k) && k.split(":")[1] < cutoff);
  if (old.length) await chrome.storage.local.remove(old);
}

// ---------- password ----------

async function verify(password) {
  const { pw, pwFail = { count: 0, last: 0 } } = await load(["pw", "pwFail"]);
  const wait = pwFail.last + core.cooldownMs(pwFail.count) - Date.now();
  if (wait > 0) throw Object.assign(coded("TL-402", `Wait ${Math.ceil(wait / 1000)}s`), { wait });
  let ok;
  try {
    ok = await checkPassword(password, pw);
  } catch (e) {
    throw coded("TL-404", e.message);
  }
  if (!ok) {
    const next = { count: pwFail.count + 1, last: Date.now() };
    await chrome.storage.local.set({ pwFail: next });
    throw Object.assign(coded("TL-401"), { wait: core.cooldownMs(next.count) });
  }
  await chrome.storage.local.set({ pwFail: { count: 0, last: 0 } });
}

// ---------- messages from the popup and lock screen ----------

const handlers = {
  async state({ host }) {
    await serial(flush);
    await macSync().catch(() => {});
    const s = await getSettings();
    const now = Date.now();
    const { day, usage, apps, unlocks } = await today(s, now);
    const { pw, update, errors = [], errorsSeenAt = 0, mac = null } = await load(["pw", "update", "errors", "errorsSeenAt", "mac"]);
    return {
      version: VERSION,
      now,
      day,
      settings: s,
      hasPassword: !!pw,
      usage,
      apps,
      mac,
      statuses: s.rules.map((r) => core.ruleStatus(r, usage, unlocks, now, s.resetHour, apps)),
      host: host || (await frontHost()),
      update,
      errors: errors.filter((e) => e.t > errorsSeenAt),
    };
  },

  // For the ticking clock on limited sites (src/content.js). The host comes
  // from the tab itself, not from the message.
  async pageStatus(msg, sender) {
    const host = core.hostOf(sender.tab && sender.tab.url);
    await serial(flush);
    const s = await getSettings();
    if (!host || !core.clockOn(s.clockSites, host)) return null;
    const now = Date.now();
    const { usage, apps, unlocks } = await today(s, now);
    const mine = core.ruleFor(s.rules, host)
      .map((r) => [r, core.ruleStatus(r, usage, unlocks, now, s.resetHour, apps)])
      .sort((a, b) => a[1].left - b[1].left);
    // No limit on this site: the clock counts up the time spent today instead.
    if (!mine.length) {
      const domain = s.clockSites.find((d) => core.hostMatches(host, d));
      const used = core.ruleSeconds({ domains: [domain] }, usage);
      const goal = core.goalFor(s.goals, "site", host);
      // The goal may cover a wider domain than the clock (e.g. google.com vs
      // mail.google.com); goalOffset lets the page add the difference.
      const goalUsed = goal ? core.ruleSeconds({ domains: [goal.name] }, usage) : 0;
      return { mode: "up", name: domain, used, goal: goal && { min: goal.min, max: goal.max, text: core.goalText(goal) }, goalOffset: goalUsed - used };
    }
    const [r, st] = mine[0];
    return { name: r.name, domains: r.domains, left: st.left, used: st.used, limit: st.limit, unlockedUntil: st.unlockedUntil };
  },

  // Show/hide the clock on one site. Never needs the password.
  async setClock({ host, on }) {
    const domain = core.cleanDomain(host);
    if (!domain) throw coded("TL-501", String(host));
    const s = await getSettings();
    const clockSites = core.setClock(s.clockSites, domain, !!on);
    try {
      await chrome.storage.local.set({ settings: { ...s, clockSites, rules: s.rules.map(({ clock, ...r }) => r) } });
    } catch (e) {
      throw coded("TL-503", e.message);
    }
    return clockSites;
  },

  // A page reports that a video/audio element started or stopped playing.
  async media({ playing }, sender) {
    if (!sender.tab) return;
    await chrome.storage.session.set({ [`media:${sender.tab.id}`]: !!playing });
    tick("media");
  },

  async macRefresh() {
    await macSync(true);
    const { mac = null } = await load("mac");
    return mac;
  },

  async logError({ code, details }) {
    await logError(["TL-203", "TL-204"].includes(code) ? code : "TL-999", details);
  },

  async unlock({ password, ruleId, minutes }) {
    await verify(password);
    const s = await getSettings();
    const now = Date.now();
    const until = minutes === "day" ? core.nextReset(now, s.resetHour) : now + Number(minutes) * 60000;
    const { unlocks = {} } = await load("unlocks");
    unlocks[ruleId] = until;
    await chrome.storage.local.set({ unlocks });
    await serial(flush);
    return { until };
  },

  async relockNow({ ruleId }) {
    const { unlocks = {} } = await load("unlocks");
    delete unlocks[ruleId];
    await chrome.storage.local.set({ unlocks });
    await serial(flush);
  },

  async setPassword({ old, password }) {
    const { pw } = await load("pw");
    if (pw) await verify(old);
    if (typeof password !== "string" || password.length < 4) throw coded("TL-403", "Shorter than 4 characters");
    await chrome.storage.local.set({ pw: await hashPassword(password) });
  },

  async checkPassword({ password }) {
    await verify(password);
  },

  // Making limits stricter never needs the password; loosening them does.
  async saveSettings({ settings, password }) {
    const old = await getSettings();
    const { pw } = await load("pw");
    const rules = [];
    for (const r of settings.rules || []) {
      const v = core.validateRule(r);
      if (v.error) throw coded(v.error, JSON.stringify(r.domains));
      rules.push({ ...v.rule, id: r.id || crypto.randomUUID() });
    }
    const next = {
      ...old,
      rules,
      resetHour: Math.min(23, Math.max(0, Number(settings.resetHour) || 0)),
      warnings: settings.warnings !== false,
      updateSource: String(settings.updateSource || "").trim(),
      clockSites: [...new Set((settings.clockSites || []).map(core.cleanDomain).filter(Boolean))],
      goals: [],
    };
    // Goals are soft targets: never locked, so changing them never needs the password.
    for (const g of settings.goals || []) {
      const v = core.validateGoal(g);
      if (v.error) throw coded(v.error, JSON.stringify(g));
      if (!next.goals.some((x) => x.kind === v.goal.kind && x.name === v.goal.name)) next.goals.push(v.goal);
    }
    if (rules.length && !pw) throw coded("TL-405");
    if (!core.isTightening(old, next)) await verify(password);
    try {
      await chrome.storage.local.set({ settings: next });
    } catch (e) {
      throw coded("TL-503", e.message);
    }
    await serial(flush);
  },

  async dismissErrors() {
    await chrome.storage.local.set({ errorsSeenAt: Date.now() });
  },

  async checkUpdates() {
    return checkForUpdates(true);
  },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg && msg.type];
  if (!h) {
    // Content scripts and pages from a newer copy may ask for things this one doesn't know.
    reply({ ok: false, error: { code: "TL-103", details: `Unknown request "${msg && msg.type}"` } });
    return false;
  }
  h(msg, sender)
    .then((result) => reply({ ok: true, result }))
    .catch((e) => {
      const code = e.code || "TL-999";
      if (!["TL-401", "TL-402", "TL-403", "TL-405", "TL-501", "TL-502"].includes(code)) logError(code, e.stack || e.message);
      reply({ ok: false, error: { code, details: e.message, wait: e.wait || 0 } });
    });
  return true;
});

// ---------- updates ----------
// Unpacked extensions can't replace their own files, so this only tells you
// a newer version exists; the popup shows how to install it.

async function checkForUpdates(manual = false) {
  const { updateSource } = await getSettings();
  const feed = updateSource || FEED;
  let state;
  try {
    let res;
    try {
      res = await fetch(feed, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      throw coded("TL-101", `${feed}: ${e.message}`);
    }
    let latest;
    try {
      latest = await res.json();
      if (!latest.version) throw new Error("no version field");
    } catch (e) {
      throw coded("TL-102", `${feed}: ${e.message}`);
    }
    state = {
      checkedAt: Date.now(),
      current: VERSION,
      latest: latest.version,
      available: core.newer(latest.version, VERSION),
      notes: latest.notes || "",
      url: latest.url ? new URL(latest.url, feed).toString() : null,
    };
  } catch (e) {
    state = { checkedAt: Date.now(), current: VERSION, available: false, error: { code: e.code || "TL-999", details: e.message } };
    if (manual) await logError(state.error.code, state.error.details);
  }
  await chrome.storage.local.set({ update: state });
  await chrome.action.setTitle({ title: state.available ? `TimeLock: update to v${state.latest} available` : "TimeLock" });
  return state;
}

// ---------- one-time restore ----------
// A restore.json in the extension folder (never in the repo) is merged into
// storage once: used when data has to be carried over from an older copy of
// the extension, e.g. the one before the ID was pinned in v2.0.0.

async function restoreFromFile() {
  let file;
  try {
    const res = await fetch(chrome.runtime.getURL("restore.json"), { cache: "no-store" });
    if (!res.ok) return;
    file = await res.json();
  } catch {
    return; // no file: the normal case
  }
  try {
    if (file.app !== "TimeLock" || file.kind !== "restore" || !file.data) throw new Error("not a TimeLock restore file");
    const { restoredFrom } = await chrome.storage.local.get("restoredFrom");
    if (restoredFrom === file.createdAt) return;
    const cur = await chrome.storage.local.get(null);
    const out = {};
    const d = file.data;
    if (d.pw && !cur.pw) out.pw = d.pw;
    if (d.settings) {
      const s = { ...DEFAULTS, ...cur.settings };
      const old = { ...DEFAULTS, ...d.settings };
      out.settings = {
        ...old,
        ...cur.settings,
        rules: s.rules.length ? s.rules : old.rules,
        clockSites: [...new Set([...(old.clockSites || []), ...(s.clockSites || [])])],
      };
    }
    for (const [k, v] of Object.entries(d)) {
      if (!/^(usage|apps):\d{4}-\d\d-\d\d$/.test(k)) continue;
      // The two copies counted different stretches of time, so add them up.
      const merged = { ...(cur[k] || {}) };
      for (const [host, secs] of Object.entries(v)) merged[host] = (merged[host] || 0) + secs;
      out[k] = merged;
    }
    out.restoredFrom = file.createdAt;
    await chrome.storage.local.set(out);
    console.info("[TimeLock] restored", Object.keys(out));
  } catch (e) {
    await logError("TL-205", `restore.json: ${e.message}`);
  }
}

// ---------- wiring ----------

chrome.alarms.create("tick", { periodInMinutes: 0.5 });
chrome.alarms.create("updates", { periodInMinutes: 6 * 60 });
chrome.alarms.create("prune", { periodInMinutes: 24 * 60 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "tick" || a.name === "relock") tick(a.name);
  else if (a.name === "updates") checkForUpdates();
  else if (a.name === "prune") pruneOldDays().catch((e) => logError("TL-201", e.message));
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (state) => {
  await chrome.storage.session.set({ idle: state });
  tick("idle");
});

chrome.tabs.onActivated.addListener(() => tick("tab switch"));
chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove(`media:${id}`));
chrome.tabs.onUpdated.addListener((id, info) => (info.url || info.audible !== undefined) && tick("navigation"));
chrome.windows.onFocusChanged.addListener(() => tick("focus"));
chrome.storage.onChanged.addListener((changes, area) => area === "local" && changes.settings && tick("settings"));

chrome.runtime.onStartup.addListener(() => setTimeout(checkForUpdates, 5000));
// After an install or reload, forget the old check result straight away.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove("update");
  setTimeout(checkForUpdates, 5000);
});
restoreFromFile().finally(() => tick("startup"));
