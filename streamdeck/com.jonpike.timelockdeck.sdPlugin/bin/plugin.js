// TimeLock Deck — Stream Deck plugin for TimeLock (browser extension + Mac app).
// Reads TimeLock's data folder once a second (see data.js) and draws the keys
// (see render.js). Read-only: it never changes limits or tracked time.

const WebSocket = require("ws");
const { execFile } = require("child_process");
const data = require("./data");
const draw = require("./render");

const MAC_BUNDLE_ID = "com.jonpike.timelock";
const POLL_MS = 1000;

// --- Stream Deck registration -------------------------------------------------

const argv = {};
for (let i = 2; i < process.argv.length; i += 2) {
  argv[process.argv[i].replace(/^-+/, "")] = process.argv[i + 1];
}
const ws = new WebSocket(`ws://127.0.0.1:${argv.port}`);
const send = (obj) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));
ws.on("open", () => send({ event: argv.registerEvent, uuid: argv.pluginUUID }));
const log = (msg) => send({ event: "logMessage", payload: { message: `[timelockdeck] ${msg}` } });

// --- State ---------------------------------------------------------------------

const contexts = new Map();   // context -> { action, settings, problem, lastImage, lastFeedback }
const inspectors = new Map(); // context -> action, while its settings panel is open
// Whether the TimeLock process exists, for telling "not running" from "too old".
let processRunning;
const checkProcess = () => execFile("/usr/bin/pgrep", ["-x", "TimeLock"], (err) => { processRunning = !err; });
checkProcess();
setInterval(checkProcess, 5000);
let snap = data.snapshot();
let loggedProblems = new Set();

setInterval(() => {
  if (!contexts.size) return;
  snap = data.snapshot(Date.now(), data.DIR, processRunning);
  for (const e of snap.errors) {
    if (!loggedProblems.has(e.code + e.details)) { loggedProblems.add(e.code + e.details); log(`${e.code} ${e.details}`); }
  }
  renderAll();
  pushToInspectors();
}, POLL_MS);

const short = (action) => action.split(".").pop();

// --- Rendering -------------------------------------------------------------------

function renderAll() {
  for (const [context, entry] of contexts) render(context, entry);
}

function setImage(context, entry, image) {
  if (entry.lastImage === image) return;
  entry.lastImage = image;
  send({ event: "setImage", context, payload: { image, target: 0 } });
  send({ event: "setTitle", context, payload: { title: "" } });
}

/// Shows a problem on the key, always with its code.
function showProblem(context, entry, code, top, line) {
  entry.problem = { ...data.describe(code), details: snap.errors.find((e) => e.code === code)?.details };
  if (entry.action.endsWith(".dial")) {
    setFeedback(context, entry, { title: top, value: code, indicator: { value: 0 }, icon: draw.dialIcon(draw.COLORS.warn) });
  } else {
    setImage(context, entry, draw.problem({ top, line, code }));
  }
}

/// The first problem that stops this key showing real numbers, if any.
function blocker(needs) {
  if (snap.errors.length) return ["TL-903", "TimeLock", "data error"];
  if (needs.mac && snap.macOutdated) return ["TL-908", "TimeLock", "update Mac app"];
  if (needs.mac && !snap.macRunning) return ["TL-901", "TimeLock", snap.installed ? "Mac app off" : "not installed"];
  if (needs.browser && !snap.browserConnected) return ["TL-902", "TimeLock", "no browser data"];
  return null;
}

function render(context, entry) {
  const { action, settings } = entry;
  entry.problem = null;
  switch (short(action)) {
    case "limit": return renderLimitKey(context, entry, settings);
    case "dial": return renderDial(context, entry, settings);
    case "time": return renderTime(context, entry, settings);
    case "today": return renderToday(context, entry, settings);
    case "now": return renderNow(context, entry);
  }
}

function pickLimit(settings) {
  if (!snap.limits.length) return { missing: "no limits" };
  if (!settings.limit) return { st: snap.limits[0] };
  const st = snap.limits.find((l) => l.name === settings.limit);
  return st ? { st } : { missing: settings.limit };
}

// No limits yet is a normal state, not a problem: say so without an error code.
function noLimits(context, entry) {
  if (entry.action.endsWith(".dial")) {
    return setFeedback(context, entry, { title: "TimeLock", value: "No limits yet", indicator: { value: 0 }, icon: draw.dialIcon(draw.COLORS.muted) });
  }
  setImage(context, entry, draw.text({ top: "TimeLock", big: "No limits", sub: "add one in the", bottom: "browser popup", color: draw.COLORS.muted }));
}

function renderLimitKey(context, entry, settings) {
  const b = blocker({ browser: true });
  if (b) return showProblem(context, entry, ...b);
  if (!snap.limits.length) return noLimits(context, entry);
  const { st, missing } = pickLimit(settings);
  if (!st) return showProblem(context, entry, "TL-904", missing, "limit gone");
  const color = draw.limitColor(st);
  const used = settings.show === "used";
  if (st.unlocked) {
    return setImage(context, entry, draw.ring({ pct: st.pct, color, top: "unlocked", big: data.clock((st.unlockedUntil - snap.now) / 1000), bottom: st.name }));
  }
  if (st.locked) {
    return setImage(context, entry, draw.ring({ pct: 1, color, lock: true, big: st.limit === 0 ? "all day" : data.duration(st.used), bottom: st.name }));
  }
  setImage(context, entry, draw.ring({
    pct: st.pct, color,
    top: used ? "used" : "left",
    big: data.clock(used ? st.used : st.left),
    bottom: st.name,
  }));
}

function setFeedback(context, entry, payload) {
  const json = JSON.stringify(payload);
  if (entry.lastFeedback === json) return;
  entry.lastFeedback = json;
  send({ event: "setFeedback", context, payload });
}

function renderDial(context, entry, settings) {
  const b = blocker({ browser: true });
  if (b) return showProblem(context, entry, ...b);
  if (!snap.limits.length) return noLimits(context, entry);
  const { st, missing } = pickLimit(settings);
  if (!st) return showProblem(context, entry, "TL-904", missing, "limit gone");
  const color = draw.limitColor(st);
  let value;
  if (st.unlocked) value = `unlocked ${data.clock((st.unlockedUntil - snap.now) / 1000)}`;
  else if (st.locked) value = "🔒 locked";
  else value = settings.show === "used" ? `${data.duration(st.used)} used` : `${data.duration(st.left)} left`;
  const n = snap.limits.length;
  const i = snap.limits.indexOf(st) + 1;
  setFeedback(context, entry, {
    title: n > 1 ? `${st.name}  ${i}/${n}` : st.name,
    value,
    indicator: { value: Math.round(st.pct * 100), bar_fill_c: color },
    icon: draw.dialIcon(color, st.locked),
  });
}

function renderTime(context, entry, settings) {
  const kind = settings.kind === "site" ? "site" : "app";
  const b = blocker(kind === "site" ? { browser: true } : { mac: true });
  if (b) return showProblem(context, entry, ...b);
  if (!settings.name) return setImage(context, entry, draw.text({ top: kind === "site" ? "Website" : "App", big: "—", bottom: "pick one" }));
  const live = kind === "app" && snap.front === settings.name;
  setImage(context, entry, draw.text({
    top: settings.name,
    big: data.duration(data.timeFor(snap, kind, settings.name)),
    bottom: live ? "● now" : "today",
    color: live ? draw.COLORS.ok : draw.COLORS.text,
  }));
}

function renderToday(context, entry, settings) {
  const web = settings.show === "web";
  const b = blocker(web ? { browser: true } : { mac: true });
  if (b) return showProblem(context, entry, ...b);
  const mac = data.sum(snap.apps), site = data.sum(snap.sites);
  setImage(context, entry, draw.text({
    top: web ? "In the browser" : "On your Mac",
    big: data.duration(web ? site : mac),
    sub: web ? (snap.macRunning ? `Mac ${data.duration(mac)}` : "") : (snap.browserConnected ? `web ${data.duration(site)}` : ""),
    bottom: "today",
  }));
}

function renderNow(context, entry) {
  const b = blocker({ mac: true });
  if (b) return showProblem(context, entry, ...b);
  const bg = snap.background;
  const playing = bg.length ? `♪ ${bg.join(", ")}` : "";
  if (snap.state === "counting" && snap.front) {
    return setImage(context, entry, draw.text({ top: snap.front, big: data.duration(snap.apps[snap.front] || 0), sub: playing, bottom: "● counting", color: draw.COLORS.ok }));
  }
  const label = { away: "Away", screenLocked: "Screen locked", idle: "Paused" }[snap.state] || "Paused";
  setImage(context, entry, draw.text({ top: "TimeLock", big: label, sub: playing, bottom: playing ? "counting media" : "not counting", color: draw.COLORS.muted }));
}

// --- Settings panels -------------------------------------------------------------

function pushToInspectors() {
  for (const [context, action] of inspectors) {
    const entry = contexts.get(context);
    send({
      event: "sendToPropertyInspector",
      context,
      action,
      payload: {
        limits: snap.limits.map((l) => l.name),
        apps: Object.entries(snap.apps).sort((a, b) => b[1] - a[1]).map(([n]) => n),
        sites: Object.entries(snap.sites).sort((a, b) => b[1] - a[1]).map(([n]) => n),
        macRunning: snap.macRunning,
        browserConnected: snap.browserConnected,
        problem: entry ? entry.problem : null,
      },
    });
  }
}

function saveSettings(context, entry, changes) {
  entry.settings = { ...entry.settings, ...changes };
  send({ event: "setSettings", context, payload: entry.settings });
  render(context, entry);
}

function launchMacApp() {
  execFile("open", ["-b", MAC_BUNDLE_ID], (err) => err && log(`couldn't open TimeLock: ${err.message}`));
}

// --- Input ------------------------------------------------------------------------

function press(context, entry) {
  if (entry.problem && entry.problem.code === "TL-901") return launchMacApp();
  if (entry.problem) return send({ event: "showAlert", context });
  switch (short(entry.action)) {
    case "limit":
    case "dial":
      return saveSettings(context, entry, { show: entry.settings.show === "used" ? "left" : "used" });
    case "today":
      return saveSettings(context, entry, { show: entry.settings.show === "web" ? "mac" : "web" });
    default:
      send({ event: "showOk", context });
  }
}

function rotate(context, entry, ticks) {
  const names = snap.limits.map((l) => l.name);
  if (!names.length) return send({ event: "showAlert", context });
  const cur = Math.max(0, names.indexOf(entry.settings.limit));
  const next = (((cur + ticks) % names.length) + names.length) % names.length;
  saveSettings(context, entry, { limit: names[next] });
}

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { event, context, action, payload = {} } = msg;
  const entry = contexts.get(context);

  switch (event) {
    case "willAppear":
      contexts.set(context, { action, settings: payload.settings || {} });
      snap = data.snapshot(Date.now(), data.DIR, processRunning);
      render(context, contexts.get(context));
      break;
    case "willDisappear":
      contexts.delete(context);
      inspectors.delete(context);
      break;
    case "didReceiveSettings":
      if (entry) { entry.settings = payload.settings || {}; entry.lastImage = entry.lastFeedback = null; render(context, entry); }
      break;
    case "propertyInspectorDidAppear":
      inspectors.set(context, action);
      pushToInspectors();
      break;
    case "propertyInspectorDidDisappear":
      inspectors.delete(context);
      break;
    case "sendToPlugin":
      if (payload.openMacApp) launchMacApp();
      break;
    case "keyDown":
      if (entry) press(context, entry);
      break;
    case "dialDown":
    case "touchTap":
      if (entry) press(context, entry);
      break;
    case "dialRotate":
      if (entry) rotate(context, entry, payload.ticks || 0);
      break;
  }
});

ws.on("error", (e) => log(`socket error: ${e.message}`));

module.exports = { render, press, rotate }; // for tools/test.js
