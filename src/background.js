import * as core from "./shared/core.js";
import { REPO, coded, logError } from "./shared/errors.js";
import { hashPassword, checkPassword } from "./shared/password.js";

const VERSION = chrome.runtime.getManifest().version;
const FEED = `https://raw.githubusercontent.com/${REPO}/main/updates/latest.json`;
const BLOCKED = chrome.runtime.getURL("app/blocked.html");
const MAX_GAP = 90; // seconds; a longer gap between ticks means the computer slept
const KEEP_DAYS = 35;
const DEFAULTS = { rules: [], resetHour: 0, warnings: true, updateSource: "" };

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
  return { ...DEFAULTS, ...settings };
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
  const { idle } = await chrome.storage.session.get("idle");
  // Away from the keyboard counts only while the tab is playing sound (videos).
  if (idle && idle !== "active" && !tab.audible) return null;
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
  serial(flush).catch((e) => logError(e.code || "TL-999", `${why}: ${e.stack || e}`));

// ---------- enforcing limits ----------

async function enforce(s, host, now) {
  const day = core.dayKey(now, s.resetHour);
  const { [`usage:${day}`]: usage = {}, unlocks = {}, warned = {} } = await load([`usage:${day}`, "unlocks", "warned"]);
  const statuses = s.rules.map((r) => [r, core.ruleStatus(r, usage, unlocks, now, s.resetHour)]);
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
  const want = locked.map((r, i) => ({
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
  const old = Object.keys(all).filter((k) => k.startsWith("usage:") && k.slice(6) < cutoff);
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
    const s = await getSettings();
    const now = Date.now();
    const day = core.dayKey(now, s.resetHour);
    const { [`usage:${day}`]: usage = {}, unlocks = {}, pw, update, errors = [], errorsSeenAt = 0 } =
      await load([`usage:${day}`, "unlocks", "pw", "update", "errors", "errorsSeenAt"]);
    return {
      version: VERSION,
      now,
      day,
      settings: s,
      hasPassword: !!pw,
      usage,
      statuses: s.rules.map((r) => core.ruleStatus(r, usage, unlocks, now, s.resetHour)),
      host: host || (await frontHost()),
      update,
      errors: errors.filter((e) => e.t > errorsSeenAt),
    };
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
    };
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
  if (!h) return false;
  h(msg)
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
chrome.tabs.onUpdated.addListener((id, info) => (info.url || info.audible !== undefined) && tick("navigation"));
chrome.windows.onFocusChanged.addListener(() => tick("focus"));
chrome.storage.onChanged.addListener((changes, area) => area === "local" && changes.settings && tick("settings"));

chrome.runtime.onStartup.addListener(() => setTimeout(checkForUpdates, 5000));
chrome.runtime.onInstalled.addListener(() => setTimeout(checkForUpdates, 5000));
tick("startup");
