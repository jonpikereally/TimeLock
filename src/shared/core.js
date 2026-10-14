// Pure logic with no chrome.* calls, so tests/core.test.mjs can run it in Node.

const pad = (n) => String(n).padStart(2, "0");

// The "day" starts at resetHour (0 = midnight). Usage at 1am with resetHour 4
// still counts toward the previous day.
export function dayKey(now, resetHour = 0) {
  const d = new Date(now);
  if (d.getHours() < resetHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// When today's limits reset (the next time the clock hits resetHour:00).
export function nextReset(now, resetHour = 0) {
  const d = new Date(now);
  d.setHours(resetHour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// "https://www.YouTube.com/watch" -> "youtube.com". Null for non-web pages.
export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Turns whatever the user typed ("https://www.reddit.com/r/x", "Reddit.com ")
// into a bare domain, or null if it isn't one.
export function cleanDomain(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = "https://" + s;
  const h = hostOf(s);
  if (!h || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null;
  return h;
}

// A rule's domain also covers its subdomains: "youtube.com" matches "m.youtube.com".
export function hostMatches(host, domain) {
  return !!host && (host === domain || host.endsWith("." + domain));
}

export function ruleFor(rules, host) {
  return rules.filter((r) => r.domains.some((d) => hostMatches(host, d)));
}

// Sites that show the ticking clock (Settings.clockSites), subdomains included.
export function clockOn(clockSites, host) {
  return (clockSites || []).some((d) => hostMatches(host, d));
}

export function setClock(clockSites, host, on) {
  const list = (clockSites || []).filter((d) => on || !hostMatches(host, d));
  if (on && !clockOn(list, host)) list.push(host);
  return list;
}

// Time on a limit's sites plus time in its Mac apps (reported by the
// TimeLock Mac app; app names match exactly).
export function ruleSeconds(rule, usage, apps) {
  let s = 0;
  for (const [host, secs] of Object.entries(usage || {})) {
    if (rule.domains.some((d) => hostMatches(host, d))) s += secs;
  }
  for (const name of rule.apps || []) s += (apps && apps[name]) || 0;
  return s;
}

// Everything the UI and the blocker need to know about one rule right now.
export function ruleStatus(rule, usage, unlocks, now, resetHour, apps) {
  const used = ruleSeconds(rule, usage, apps);
  const limit = rule.limit * 60;
  const unlockedUntil = (unlocks && unlocks[rule.id]) || 0;
  const over = used >= limit;
  const unlocked = unlockedUntil > now;
  return {
    id: rule.id,
    used,
    limit,
    left: Math.max(0, limit - used),
    over,
    unlocked,
    unlockedUntil: unlocked ? unlockedUntil : 0,
    locked: over && !unlocked,
    resetsAt: nextReset(now, resetHour),
  };
}

// True when the new settings can only make things stricter, so saving them
// doesn't need the password: no rule removed, no limit raised, no domain
// dropped, and the reset hour unchanged.
export function isTightening(oldS, newS) {
  if ((newS.resetHour || 0) !== (oldS.resetHour || 0)) return false;
  for (const o of oldS.rules || []) {
    const n = (newS.rules || []).find((r) => r.id === o.id);
    if (!n || n.limit > o.limit) return false;
    if (!o.domains.every((d) => n.domains.includes(d))) return false;
    if (!(o.apps || []).every((a) => (n.apps || []).includes(a))) return false;
  }
  return true;
}

export function validateRule(r) {
  const domains = [...new Set((r.domains || []).map(cleanDomain))];
  const apps = [...new Set((r.apps || []).map((a) => String(a).trim()).filter(Boolean))];
  if (domains.includes(null) || apps.some((a) => a.length > 80)) return { error: "TL-501" };
  if (!domains.length && !apps.length) return { error: "TL-501" };
  const limit = Number(r.limit);
  if (!Number.isFinite(limit) || limit < 0 || limit > 24 * 60 || Math.round(limit) !== limit) return { error: "TL-502" };
  return { rule: { id: r.id, name: String(r.name || "").trim() || domains[0] || apps[0], domains, apps, limit } };
}

// ---------- goals ----------
// Soft daily targets for one app or website: at least `min` and/or at most
// `max` minutes. Goals never lock anything; they only colour the timers.
//   "under" below the minimum (blue)    "met"  minimum reached (green)
//   "near"  75% of the maximum (amber)  "over" past the maximum (red)
//   "none"  no goal, or nothing to say yet
export const GOAL_NEAR = 0.75;

export function goalFor(goals, kind, name) {
  if (!name) return null;
  return (goals || []).find((g) => g.kind === kind && (kind === "site" ? hostMatches(name, g.name) : g.name === name)) || null;
}

export function goalState(secs, goal) {
  if (!goal) return "none";
  const min = goal.min != null ? goal.min * 60 : null;
  const max = goal.max != null ? goal.max * 60 : null;
  if (max != null && secs >= max) return "over";
  if (max != null && secs >= max * GOAL_NEAR && (min == null || secs >= min)) return "near";
  if (min != null) return secs >= min ? "met" : "under";
  return "none";
}

export function goalText(goal) {
  if (!goal) return "";
  const m = (x) => fmtDuration(x * 60);
  if (goal.min != null && goal.max != null) return `goal ${m(goal.min)}–${m(goal.max)}`;
  if (goal.min != null) return `goal at least ${m(goal.min)}`;
  return `goal at most ${m(goal.max)}`;
}

export function validateGoal(g) {
  const kind = g.kind === "app" ? "app" : "site";
  const name = kind === "site" ? cleanDomain(g.name) : String(g.name || "").trim();
  if (!name || name.length > 80) return { error: "TL-504" };
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const min = num(g.min), max = num(g.max);
  for (const v of [min, max]) {
    if (v != null && (!Number.isFinite(v) || v < 0 || v > 1440 || Math.round(v) !== v)) return { error: "TL-505" };
  }
  if (min == null && max == null) return { error: "TL-505" };
  if (min != null && max != null && min > max) return { error: "TL-505" };
  return { goal: { kind, name, min, max } };
}

export function fmtDuration(secs) {
  const m = Math.floor(secs / 60);
  if (m < 1) return `${Math.floor(secs)}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

export function newer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Wrong passwords: 3 free tries, then a cooldown that doubles each time (max 10 min).
export function cooldownMs(failures) {
  return failures < 3 ? 0 : Math.min(30000 * 2 ** (failures - 3), 10 * 60000);
}
