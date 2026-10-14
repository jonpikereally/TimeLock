// node streamdeck/tools/test.js            unit tests + a fake Stream Deck run against sample data
// node streamdeck/tools/test.js --live     the fake Stream Deck against your real TimeLock data
// Writes every key image it drew to $TMPDIR/timelockdeck-keys.html so you can look at them.

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const PLUGIN = path.join(__dirname, "..", "com.jonpike.timelockdeck.sdPlugin");
const WebSocket = require(path.join(PLUGIN, "bin", "node_modules", "ws"));
const data = require(path.join(PLUGIN, "bin", "data.js"));

const live = process.argv.includes("--live");
const now = Date.now();
const day = data.localDay(now);

// --- sample data folder -----------------------------------------------------------
const tmpHome = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tldeck-"));
const dir = path.join(tmpHome, "Library", "Application Support", "TimeLock");
fs.mkdirSync(path.join(dir, "apps"), { recursive: true });
fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({
  at: now - 1000, day, state: "counting", app: "Visual Studio Code", background: ["Spotify"],
  today: { "Visual Studio Code": 5400, "Brave Browser": 2100, Discord: 600, Spotify: 1800 },
}));
fs.writeFileSync(path.join(dir, "browser.json"), JSON.stringify({
  at: now - 5000, day, resetHour: 0, version: "2.0.1",
  sites: { "x.com": 900, "old.reddit.com": 300, "reddit.com": 200, "youtube.com": 3300, "github.com": 1200 },
  limits: [
    { name: "Social", domains: ["x.com", "reddit.com"], apps: ["Discord"], limit: 1800, used: 0, locked: false, unlockedUntil: 0 },
    { name: "YouTube", domains: ["youtube.com"], apps: [], limit: 3600, used: 0, locked: false, unlockedUntil: 0 },
    { name: "News", domains: ["cnn.com"], apps: [], limit: 600, used: 0, locked: false, unlockedUntil: now + 9 * 60000 },
    { name: "Games", domains: ["chess.com"], apps: ["Steam"], limit: 0, used: 0, locked: true, unlockedUntil: 0 },
  ],
}));

// --- unit tests ----------------------------------------------------------------------
{
  const s = data.snapshot(now, dir);
  assert.equal(s.macRunning, true);
  assert.equal(s.front, "Visual Studio Code");
  assert.deepEqual(s.background, ["Spotify"]);
  const social = s.limits.find((l) => l.name === "Social");
  assert.equal(social.used, 900 + 300 + 200 + 600, "sites incl. subdomains + Discord app time");
  assert.ok(social.locked && social.over);
  const yt = s.limits.find((l) => l.name === "YouTube");
  assert.equal(yt.left, 300);
  assert.ok(!yt.locked);
  const news = s.limits.find((l) => l.name === "News");
  assert.ok(news.unlocked && !news.locked);
  assert.equal(data.timeFor(s, "site", "reddit.com"), 500);
  assert.equal(data.timeFor(s, "app", "Discord"), 600);
  assert.equal(data.duration(3725), "1h 02m");
  assert.equal(data.clock(754), "12:34");
  assert.equal(data.clock(3725), "1h 02");
  // Time format setting
  assert.equal(data.format(3725, "hm"), "1h 02m");
  assert.equal(data.format(754, "hm"), "12m");
  assert.equal(data.format(3725, "hms"), "1:02:05");
  assert.equal(data.format(754, "hms"), "12:34");
  assert.equal(data.format(3725, "min"), "62 min");
  assert.equal(data.format(3960, "dec"), "1.1 h");
  assert.equal(data.format(754, "auto", "clock"), "12:34");
  assert.equal(data.format(754, undefined), "12m");

  // Mac app quit: status older than 30 s → not running, totals from the day file.
  const stale = data.snapshot(now + 60000, dir);
  assert.equal(stale.macRunning, false);
  assert.equal(stale.state, "off");

  // Damaged file → TL-903, never a crash.
  const bad = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tldeck-bad-"));
  fs.writeFileSync(path.join(bad, "status.json"), "{nope");
  assert.equal(data.snapshot(now, bad).errors[0].code, "TL-903");

  // Nothing installed.
  const empty = data.snapshot(now, fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tldeck-empty-")));
  assert.equal(empty.installed, false);
  // Old Mac app (no status.json) still running → "update", not "off".
  const old = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tldeck-old-"));
  fs.writeFileSync(path.join(old, "browser.json"), JSON.stringify({ at: now, day, resetHour: 0, sites: {}, limits: [] }));
  assert.equal(data.snapshot(now, old, true).macOutdated, true);
  assert.equal(data.snapshot(now, old, false).macOutdated, false);
  assert.equal(data.snapshot(now, old).limits.length, 0);
  console.log("PASS data.js unit tests");
}

// --- fake Stream Deck ------------------------------------------------------------------
const server = new WebSocket.Server({ port: 0 });
const port = server.address().port;
const images = [];
const keys = [
  ["limit", { limit: "YouTube" }], ["limit", { limit: "Social" }], ["limit", { limit: "News" }],
  ["limit", { limit: "Games" }], ["limit", { limit: "Gone" }], ["dial", { limit: "YouTube" }],
  ["time", { kind: "app", name: "Visual Studio Code" }], ["time", { kind: "site", name: "reddit.com" }],
  ["today", { show: "mac" }], ["today", { show: "web" }], ["now", {}],
  ["time", { kind: "app", name: "Visual Studio Code", format: "hms" }], ["limit", { limit: "YouTube", format: "min" }],
  ["dial", { limit: "YouTube", format: "dec" }],
];

server.on("connection", (sock) => {
  sock.once("message", () => {
    keys.forEach(([a, settings], i) =>
      sock.send(JSON.stringify({ event: "willAppear", action: `com.jonpike.timelockdeck.${a}`, context: `ctx${i}`, payload: { settings } })));
    // Press the first key (left → used) and turn the dial.
    setTimeout(() => sock.send(JSON.stringify({ event: "keyDown", action: "com.jonpike.timelockdeck.limit", context: "ctx0", payload: {} })), 300);
    setTimeout(() => sock.send(JSON.stringify({ event: "dialRotate", action: "com.jonpike.timelockdeck.dial", context: "ctx5", payload: { ticks: 1 } })), 400);
  });
  sock.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.event === "setImage") images.push([m.context, m.payload.image]);
    if (m.event === "setFeedback") images.push([m.context, m.payload]);
    if (m.event === "setSettings") images.push([m.context, { settings: m.payload }]);
    if (m.event === "logMessage") console.log("  plugin log:", m.payload.message);
  });
});

const env = { ...process.env };
if (!live) env.HOME = tmpHome;
const child = spawn(process.execPath, [path.join(PLUGIN, "bin", "plugin.js"), "-port", String(port), "-pluginUUID", "test", "-registerEvent", "registerPlugin", "-info", "{}"], { env, stdio: "inherit" });

setTimeout(() => {
  child.kill();
  server.close();
  const byCtx = (c) => images.filter(([x]) => x === c).map(([, v]) => v);
  if (!live) {
    const first = byCtx("ctx0").filter((v) => typeof v === "string");
    assert.ok(first.length >= 2, "limit key redrawn after the press");
    assert.ok(decodeURIComponent(first.at(-1)).includes(">used<"), "press switched the key to time used");
    assert.ok(decodeURIComponent(byCtx("ctx4")[0]).includes("TL-904"), "missing limit shows TL-904");
    assert.ok(decodeURIComponent(byCtx("ctx3")[0]).includes("<rect x=\"-10\""), "locked limit shows the lock");
    const dialSettings = byCtx("ctx5").find((v) => v.settings);
    assert.equal(dialSettings.settings.limit, "News", "dial turned from YouTube to the next limit");
    const fb = byCtx("ctx5").filter((v) => v.title).at(-1);
    assert.ok(fb.title.startsWith("News") && fb.indicator.bar_fill_c, "dial feedback has title + coloured bar");
    assert.ok(decodeURIComponent(byCtx("ctx11")[0]).includes(">1:30:00<"), "Time Today in 1:05:23 format");
    assert.ok(decodeURIComponent(byCtx("ctx12")[0]).includes(">5 min<"), "Limit ring in minutes format");
    assert.equal(byCtx("ctx13").filter((v) => v.title).at(-1).value, "0.1 h left", "dial in decimal hours");
    console.log("PASS fake Stream Deck run");
  }
  const html = `<!doctype html><meta charset="utf-8"><title>TimeLock Deck keys</title><body style="background:#000;color:#ccc;font:13px sans-serif">
${keys.map(([a, s], i) => {
    const imgs = byCtx(`ctx${i}`);
    const img = imgs.filter((v) => typeof v === "string").at(-1);
    const fb = imgs.filter((v) => v && v.title).at(-1);
    return `<div style="display:inline-block;margin:8px;text-align:center;vertical-align:top">${img ? `<img src="${img}" width="144">` : ""}
${fb ? `<div style="width:200px;height:100px;background:#111;border-radius:8px;padding:6px;text-align:left"><img src="${fb.icon}" width="40" style="float:left"><b>${fb.title}</b><br>${fb.value}<div style="clear:both;height:8px;background:#333;border-radius:4px"><div style="width:${fb.indicator.value}%;height:8px;background:${fb.indicator.bar_fill_c};border-radius:4px"></div></div></div>` : ""}
<div>${a} ${JSON.stringify(s)}</div></div>`;
  }).join("")}`;
  const out = path.join(process.env.TMPDIR || os.tmpdir(), "timelockdeck-keys.html");
  fs.writeFileSync(out, html);
  console.log("Key images:", out);
}, 1500);
