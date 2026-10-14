// Reads TimeLock's shared data folder and works out what the keys show.
// No Stream Deck code here, so tools/test.js can run it on its own.
//
// ~/Library/Application Support/TimeLock/
//   status.json   written every 2 s by the Mac app: what's counting now + today's app totals
//   browser.json  written every ~30 s by the browser extension (via the Mac app): sites + limits
//   apps/<day>.json  saved app totals (fallback when status.json is missing)

const fs = require("fs");
const path = require("path");
const os = require("os");

const DIR = path.join(os.homedir(), "Library", "Application Support", "TimeLock");
const STATUS_FRESH = 30 * 1000;
const BROWSER_FRESH = 3 * 60 * 1000;

const REPO = "jonpikereally/TimeLock";
const ERROR_LIST_URL = `https://github.com/${REPO}/blob/main/ERRORS.md`;
const ERROR_LIST_RAW = `https://raw.githubusercontent.com/${REPO}/main/ERRORS.md`;

// Stream Deck plugin codes are TL-9xx. Never reuse or renumber.
const ERRORS = {
  "TL-901": ["TimeLock for Mac isn't running.", "Press the key to open it, or install it from the TimeLock GitHub page."],
  "TL-902": ["No data from the TimeLock browser extension yet.", "Open your browser with the TimeLock extension installed; it syncs every 30 seconds."],
  "TL-903": ["Couldn't read TimeLock's data files.", "Quit and reopen TimeLock for Mac. If it persists, copy the details."],
  "TL-904": ["The limit picked for this key doesn't exist any more.", "Pick another limit in this key's settings."],
  "TL-908": ["TimeLock for Mac is running but is too old for the Stream Deck plugin.", "Click the hourglass in the menu bar → Check for Updates… (the plugin needs v1.2.0 or newer)."],
};
const describe = (code) => {
  const [summary, hint] = ERRORS[code] || ["Something unexpected went wrong.", "Copy the details and ask for help."];
  return { code, summary, hint, list: ERROR_LIST_URL, raw: ERROR_LIST_RAW };
};

function readJSON(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { missing: true };
  }
  try {
    return { data: JSON.parse(text) };
  } catch (e) {
    return { error: { code: "TL-903", details: `${path.basename(file)}: ${e.message}` } };
  }
}

const pad = (n) => String(n).padStart(2, "0");
function localDay(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const hostMatches = (host, domain) => !!host && (host === domain || host.endsWith("." + domain));

/// Recomputed here (not taken from browser.json) so app time is up to the
/// second instead of up to 30 seconds old.
function limitStatus(limit, sites, apps, now) {
  let used = 0;
  for (const [host, secs] of Object.entries(sites || {})) {
    if ((limit.domains || []).some((d) => hostMatches(host, d))) used += secs;
  }
  for (const name of limit.apps || []) used += (apps && apps[name]) || 0;
  const unlocked = (limit.unlockedUntil || 0) > now;
  return {
    name: limit.name,
    used,
    limit: limit.limit,
    left: Math.max(0, limit.limit - used),
    pct: limit.limit > 0 ? Math.min(1, used / limit.limit) : 1,
    over: used >= limit.limit,
    unlocked,
    unlockedUntil: unlocked ? limit.unlockedUntil : 0,
    locked: used >= limit.limit && !unlocked,
  };
}

/// Everything the keys need, read fresh from disk.
/// `processRunning` (from pgrep, when known) tells an old Mac app that writes
/// no status.json apart from one that isn't running at all.
function snapshot(now = Date.now(), dir = DIR, processRunning) {
  const errors = [];
  const st = readJSON(path.join(dir, "status.json"));
  const br = readJSON(path.join(dir, "browser.json"));
  if (st.error) errors.push(st.error);
  if (br.error) errors.push(br.error);

  const status = st.data || null;
  const macRunning = !!status && now - status.at < STATUS_FRESH;
  const day = (status && status.day) || (br.data && br.data.day) || localDay(now);

  // App totals: the live status if it's today's, else the saved day file.
  let apps = {};
  if (status && status.day === day) apps = status.today || {};
  else {
    const f = readJSON(path.join(dir, "apps", `${day}.json`));
    if (f.error) errors.push(f.error);
    apps = f.data || {};
  }

  const browser = br.data && br.data.day === day ? br.data : null;
  const sites = (browser && browser.sites) || {};
  const limits = ((browser && browser.limits) || []).map((l) => limitStatus(l, sites, apps, now));

  return {
    now,
    day,
    installed: !st.missing || !br.missing,
    macRunning,
    macOutdated: !macRunning && processRunning === true && (!status || now - status.at > STATUS_FRESH),
    state: macRunning ? status.state : "off",
    front: macRunning ? status.app || null : null,
    background: macRunning ? status.background || [] : [],
    apps,
    sites,
    browserConnected: !!browser,
    browserFresh: !!browser && now - browser.at < BROWSER_FRESH,
    limits,
    errors,
  };
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

/// "1h 05m", "12m", "45s"
function duration(secs) {
  secs = Math.max(0, Math.floor(secs));
  const m = Math.floor(secs / 60);
  if (m < 1) return `${secs}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/// For the big number on a key: "12:34" under an hour, "1h 05" above.
function clock(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}h ${pad(m)}` : `${m}:${pad(s)}`;
}

/// Time for one app or site today (sites include their subdomains).
function timeFor(snap, kind, name) {
  if (!name) return 0;
  if (kind === "site") {
    return Object.entries(snap.sites).reduce((t, [h, s]) => (hostMatches(h, name) ? t + s : t), 0);
  }
  return snap.apps[name] || 0;
}

module.exports = { DIR, ERRORS, ERROR_LIST_URL, ERROR_LIST_RAW, describe, snapshot, limitStatus, hostMatches, duration, clock, sum, timeFor, localDay };
