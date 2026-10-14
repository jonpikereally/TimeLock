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

export function ruleSeconds(rule, usage) {
  let s = 0;
  for (const [host, secs] of Object.entries(usage || {})) {
    if (rule.domains.some((d) => hostMatches(host, d))) s += secs;
  }
  return s;
}

// Everything the UI and the blocker need to know about one rule right now.
export function ruleStatus(rule, usage, unlocks, now, resetHour) {
  const used = ruleSeconds(rule, usage);
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
  }
  return true;
}

export function validateRule(r) {
  const domains = [...new Set((r.domains || []).map(cleanDomain))];
  if (!domains.length || domains.includes(null)) return { error: "TL-501" };
  const limit = Number(r.limit);
  if (!Number.isFinite(limit) || limit < 0 || limit > 24 * 60 || Math.round(limit) !== limit) return { error: "TL-502" };
  return { rule: { id: r.id, name: String(r.name || "").trim() || domains[0], domains, limit, clock: r.clock === true } };
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
