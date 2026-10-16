import { $, esc, send, errorBox, fmtTime, VERSION } from "./ui.js";
import { fmtDuration, hostMatches, isTightening, cleanDomain, hostOf, clockOn, setClock, newer, goalFor, goalState, goalText } from "../src/shared/core.js";
import { REPO, ERROR_LIST_URL } from "../src/shared/errors.js";

const MAC_DOWNLOAD = `https://github.com/${REPO}/raw/main/updates/mac/TimeLock-Mac.zip`;

let state;
let draft; // settings being edited in the Settings view
let goalsDraft = []; // goals being edited (saved on their own, never need the password)

// A time cell coloured by its goal (see core.goalState), with the goal on hover.
// A website goal counts all its subdomains together (reddit.com + old.reddit.com).
function timeCell(kind, name, secs) {
  const goal = goalFor(state.settings.goals, kind, name);
  const goalSecs = goal && kind === "site"
    ? Object.entries(state.usage || {}).reduce((t, [h, x]) => (hostMatches(h, goal.name) ? t + x : t), 0)
    : secs;
  const st = goalState(goalSecs, goal);
  return `<span class="t ${st === "none" ? "" : "g-" + st}" title="${esc(goal ? goalText(goal) : "")}">${fmtDuration(secs)}</span>`;
}

async function refresh() {
  try {
    // Ask about this window's own tab: while the popup is open, the window
    // may not count as "focused" (Brave), so the background can't tell.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    state = await send("state", { host: tab ? hostOf(tab.url) : null });
  } catch (e) {
    $("#banners").replaceChildren(errorBox(e));
    return;
  }
  renderBanners();
  renderHome();
}

// ---------- home ----------

function renderBanners() {
  const box = $("#banners");
  box.replaceChildren();
  const u = state.update;
  // The saved check may predate an update you've already installed, so
  // compare against the version actually running.
  if (u && u.available && newer(u.latest, VERSION)) {
    const el = document.createElement("div");
    el.className = "banner";
    el.innerHTML = `<b>TimeLock v${esc(u.latest)} is available</b> (you have v${esc(VERSION)}).
      ${u.notes ? `<div class="small">${esc(u.notes)}</div>` : ""}
      <div class="small muted">Download it${u.url ? ` from <a href="${esc(u.url)}" target="_blank">here</a>` : ""} or run <code>git pull</code>, replace the folder, then click ↻ on TimeLock in chrome://extensions. Your limits and history are kept.</div>`;
    box.append(el);
  }
  if (state.errors.length) {
    const last = state.errors.at(-1);
    box.append(errorBox(last, { onDismiss: () => send("dismissErrors") }));
  }
}

function statusLine(r, st) {
  if (st.unlocked) return [`Unlocked until ${fmtTime(st.unlockedUntil)}`, "ok"];
  if (st.locked) return [`Locked until ${fmtTime(st.resetsAt)}`, "bad"];
  if (r.limit === 0) return ["Blocked all day", "bad"];
  return [`${fmtDuration(st.left)} left`, st.left <= 300 ? "warn" : ""];
}

const whatItCovers = (r) => [...r.domains, ...(r.apps || []).map((a) => `${a} (app)`)].join(", ");

function ruleCard(r, st) {
  const pct = st.limit ? Math.min(100, (st.used / st.limit) * 100) : 100;
  const [text, cls] = statusLine(r, st);
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <div class="row"><b class="grow ellipsis">${esc(r.name)}</b><span class="pill ${cls}">${esc(text)}</span></div>
    <div class="bar ${st.over ? "bad" : st.left <= 300 ? "warn" : ""}"><i style="width:${pct}%"></i></div>
    <div class="row small muted"><span class="grow ellipsis" title="${esc(whatItCovers(r))}">${esc(whatItCovers(r))}</span>
      <span>${fmtDuration(st.used)} of ${fmtDuration(st.limit)}</span>
      ${st.unlocked ? '<button class="btn small relock">Lock again</button>' : ""}</div>`;
  const relock = $(".relock", el);
  if (relock) relock.onclick = () => send("relockNow", { ruleId: r.id }).then(refresh);
  return el;
}

// The "Show timer" toggle on each site. Takes effect right away, no Save needed.
function clockButton(host) {
  const b = document.createElement("button");
  const draw = () => {
    const on = clockOn(state.settings.clockSites, host);
    b.className = `btn small clock-btn ${on ? "on" : ""}`;
    b.textContent = on ? "⏱ Timer on" : "Show timer";
    b.title = on ? `Hide the ticking clock on ${host}` : `Show a ticking clock in the corner of ${host}`;
  };
  b.onclick = async () => {
    const on = !clockOn(state.settings.clockSites, host);
    try {
      state.settings.clockSites = await send("setClock", { host, on });
      // Redraw them all: turning on reddit.com also covers old.reddit.com.
      document.querySelectorAll(".clock-btn").forEach((x) => x.redraw());
    } catch (e) {
      $("#banners").prepend(errorBox(e, { onDismiss: () => {} }));
    }
  };
  b.dataset.clockHost = host;
  b.redraw = draw;
  draw();
  return b;
}

function renderHome() {
  const { settings, statuses, usage, host } = state;
  const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));

  // The site you're on right now, with a one-click way to limit it.
  const now = $("#now");
  now.replaceChildren();
  if (host) {
    const covered = settings.rules.filter((r) => r.domains.some((d) => hostMatches(host, d)));
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<div class="row"><span class="grow ellipsis"><b>${esc(host)}</b></span><span class="muted">${fmtDuration(usage[host] || 0)} today</span></div>`;
    $(".row", el).append(clockButton(host));
    if (!covered.length) {
      const add = document.createElement("div");
      add.className = "row";
      add.style.marginTop = "8px";
      add.innerHTML = `<span class="grow small">Limit this site to</span><input class="min" type="number" min="0" max="1440" placeholder="30"><span class="small">min/day</span><button class="btn small" disabled>Add</button>`;
      // Grey until a number of minutes is typed, then blue.
      const minutes = $("input", add), addBtn = $("button", add);
      minutes.oninput = () => {
        const ok = minutes.value !== "" && Number(minutes.value) >= 0;
        addBtn.disabled = !ok;
        addBtn.classList.toggle("primary", ok);
      };
      const err = document.createElement("div");
      $("button", add).onclick = async () => {
        err.replaceChildren();
        if (minutes.value === "") return;
        const rule = { name: host, domains: [host], limit: Number(minutes.value) };
        try {
          await send("saveSettings", { settings: { ...settings, rules: [...settings.rules, rule] } });
          refresh();
        } catch (e) {
          err.append(errorBox(e, { compact: true }));
          if (e.code === "TL-405") openSettings();
        }
      };
      el.append(add, err);
    }
    now.append(el);
  }

  const limits = $("#limits");
  limits.replaceChildren();
  if (!settings.rules.length) limits.innerHTML = `<div class="card empty">No limits yet. Add one above or in ⚙︎ Settings.</div>`;
  for (const r of settings.rules) limits.append(ruleCard(r, byId[r.id]));

  // Mac app time, when the TimeLock Mac app is connected.
  const appRows = Object.entries(state.apps || {}).sort((a, b) => b[1] - a[1]);
  $("#apps-section").classList.toggle("hidden", !appRows.length);
  $("#apps-total").textContent = fmtDuration(appRows.reduce((t, [, s]) => t + s, 0));
  $("#apps").innerHTML = appRows.slice(0, 15)
    .map(([a, s]) => `<li><span class="grow ellipsis">${esc(a)}</span>${timeCell("app", a, s)}</li>`).join("");

  const rows = Object.entries(usage).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((t, [, s]) => t + s, 0);
  $("#total").textContent = fmtDuration(total);
  const list = $("#sites");
  list.replaceChildren();
  if (!rows.length) list.innerHTML = `<li class="empty">Nothing tracked yet today.</li>`;
  for (const [h, s] of rows.slice(0, 15)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow ellipsis">${esc(h)}</span>${timeCell("site", h, s)}`;
    li.append(clockButton(h));
    list.append(li);
  }
}

// ---------- settings ----------

function openSettings() {
  $("#home").classList.add("hidden");
  $("#settings").classList.remove("hidden");
  $("#toggle").textContent = "✕";
  $("#toggle").title = "Back";
  draft = structuredClone(state.settings);
  renderPassword();
  goalsDraft = structuredClone(state.settings.goals || []);
  renderGoals();
  renderMac();
  renderRuleEditor();
  $("#reset-hour").value = draft.resetHour;
  $("#warnings").checked = draft.warnings;
  $("#update-source").value = draft.updateSource;
  $("#version").textContent = `v${VERSION}`;
  updateSaveState();
}

function closeSettings() {
  $("#settings").classList.add("hidden");
  $("#home").classList.remove("hidden");
  $("#toggle").textContent = "⚙︎";
  $("#toggle").title = "Settings";
  refresh();
}

function renderPassword() {
  const card = $("#pw-card");
  const has = state.hasPassword;
  card.innerHTML = `
    <p class="small ${has ? "muted" : ""}" style="margin-top:0">${has
      ? "Your password unlocks a locked site early and is needed to loosen limits."
      : "<b>Set a password first.</b> You'll need it to get into a locked site early or to loosen your limits. Pick one that's annoying to type, or have someone else set it. There's no way to recover it: forgetting it means removing TimeLock and losing your history."}</p>
    ${has ? '<label class="field">Current password</label><input type="password" id="pw-old" autocomplete="current-password" style="width:100%">' : ""}
    <label class="field">${has ? "New password" : "Password"}</label><input type="password" id="pw-new" autocomplete="new-password" style="width:100%">
    <label class="field">Type it again</label><input type="password" id="pw-new2" autocomplete="new-password" style="width:100%">
    <div id="pw-err"></div>
    <div class="row" style="margin-top:8px"><span class="grow small muted" id="pw-msg"></span><button class="btn primary small" id="pw-save">${has ? "Change password" : "Set password"}</button></div>`;
  $("#pw-save").onclick = async () => {
    const err = $("#pw-err");
    err.replaceChildren();
    const password = $("#pw-new").value;
    if (password.length < 4 || password !== $("#pw-new2").value) {
      err.append(errorBox({ code: "TL-403", details: password.length < 4 ? "Shorter than 4 characters" : "The two boxes don't match" }, { compact: true }));
      return;
    }
    try {
      await send("setPassword", { old: has ? $("#pw-old").value : undefined, password });
      state.hasPassword = true;
      renderPassword();
      $("#pw-msg").textContent = "Password saved ✓";
    } catch (e) {
      err.append(errorBox(e, { compact: true }));
    }
  };
}

function renderGoals() {
  const box = $("#goals-edit");
  box.replaceChildren();
  const sites = new Set([...Object.keys(state.usage || {}), ...(state.settings.clockSites || []), ...state.settings.rules.flatMap((r) => r.domains)]);
  $("#known-sites").innerHTML = [...sites].sort().map((d) => `<option value="${esc(d)}">`).join("");
  goalsDraft.forEach((g, i) => {
    const el = document.createElement("div");
    el.className = "card goal-edit";
    el.innerHTML = `
      <select class="kind"><option value="site">Website</option><option value="app">Mac app</option></select>
      <input class="name" placeholder="${g.kind === "app" ? "App name, e.g. Logic Pro" : "youtube.com"}" list="${g.kind === "app" ? "known-apps" : "known-sites"}" value="${esc(g.name)}">
      <button class="btn icon del" title="Remove this goal">🗑</button>
      <div class="mins"><span title="Turns green once you reach this">Min</span><input class="min" type="number" min="0" max="1440" placeholder="–" value="${g.min ?? ""}"><span title="Turns amber at 75% and red past this">Max</span><input class="max" type="number" min="0" max="1440" placeholder="–" value="${g.max ?? ""}"><span>minutes a day</span></div>`;
    $(".kind", el).value = g.kind;
    $(".kind", el).onchange = (e) => { g.kind = e.target.value; renderGoals(); };
    $(".name", el).oninput = (e) => { g.name = e.target.value.trim(); };
    $(".min", el).oninput = (e) => { g.min = e.target.value === "" ? null : Number(e.target.value); };
    $(".max", el).oninput = (e) => { g.max = e.target.value === "" ? null : Number(e.target.value); };
    $(".del", el).onclick = () => { goalsDraft.splice(i, 1); renderGoals(); };
    box.append(el);
  });
  if (!goalsDraft.length) box.innerHTML = `<p class="small muted">No goals yet.</p>`;
}

async function saveGoals() {
  $("#goal-err").replaceChildren();
  $("#goal-msg").textContent = "";
  try {
    await send("saveSettings", { settings: { ...state.settings, goals: goalsDraft } });
    state = await send("state");
    goalsDraft = structuredClone(state.settings.goals || []);
    renderGoals();
    $("#goal-msg").textContent = "Goals saved ✓";
  } catch (e) {
    $("#goal-err").append(errorBox(e, { compact: true }));
  }
}

function renderMac() {
  const m = state.mac;
  const card = $("#mac-card");
  let status;
  if (m && m.connected) {
    status = `<b>✓ Connected</b> to TimeLock for Mac v${esc(m.version)}${m.running ? "" : " — <b>but the app isn't running</b>, so app time isn't being tracked. Open TimeLock from your Applications folder."}`;
  } else if (m && m.installed && m.error) {
    status = "";
  } else {
    status = `Not installed. The TimeLock Mac app tracks time in your Mac apps, shows it here, and lets a limit include apps (e.g. "Social: x.com + the Discord app"). Apps are tracked, never locked. <a href="${MAC_DOWNLOAD}" target="_blank">Download TimeLock for Mac</a>, unzip it and run <b>Install TimeLock.command</b>.`;
  }
  card.innerHTML = `<p class="small" style="margin-top:0">${status}</p><div id="mac-err"></div>
    <div class="row"><span class="grow small muted">${m && m.at ? `Last checked ${fmtTime(m.at)}` : ""}</span><button class="btn small" id="mac-check">Check connection</button></div>`;
  if (m && m.error) $("#mac-err").append(errorBox(m.error, { compact: true }));
  $("#mac-check").onclick = async (e) => {
    e.target.textContent = "Checking…";
    try {
      state.mac = await send("macRefresh");
    } catch (err) {
      state.mac = { installed: true, error: err };
    }
    renderMac();
  };
  const known = new Set([...(m && m.known) || [], ...Object.keys(state.apps || {})]);
  $("#known-apps").innerHTML = [...known].sort().map((a) => `<option value="${esc(a)}">`).join("");
}

function renderRuleEditor() {
  const box = $("#rules-edit");
  box.replaceChildren();
  draft.rules.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "card rule-edit";
    el.innerHTML = `
      <input class="name" placeholder="Name (e.g. Social media)" value="${esc(r.name)}">
      <input class="min limit" type="number" min="0" max="1440" value="${esc(r.limit)}" title="Minutes per day">
      <button class="btn icon del" title="Remove this limit">🗑</button>
      <input class="domains" placeholder="youtube.com, reddit.com" value="${esc(r.domains.join(", "))}">
      <span class="small muted">min/day</span>
      <input class="apps" list="known-apps" placeholder="Mac apps (optional), e.g. Discord, Messages" value="${esc((r.apps || []).join(", "))}" title="App time counts toward this limit (needs the TimeLock Mac app). Apps are never locked; when the limit runs out, the sites lock.">
      <label class="row small clock-opt"><input type="checkbox" class="clock" ${r.domains.length && r.domains.every((d) => clockOn(draft.clockSites, d)) ? "checked" : ""}> Show ticking clock on these sites</label>`;
    $(".name", el).oninput = (e) => { r.name = e.target.value; };
    $(".limit", el).oninput = (e) => { r.limit = e.target.value === "" ? NaN : Number(e.target.value); updateSaveState(); };
    $(".domains", el).oninput = (e) => { r.domains = e.target.value.split(/[,\s]+/).filter(Boolean); updateSaveState(); };
    $(".apps", el).oninput = (e) => { r.apps = e.target.value.split(",").map((a) => a.trim()).filter(Boolean); updateSaveState(); };
    $(".clock", el).onchange = (e) => {
      for (const d of r.domains.map(cleanDomain).filter(Boolean)) draft.clockSites = setClock(draft.clockSites, d, e.target.checked);
    };
    $(".del", el).onclick = () => { draft.rules.splice(i, 1); renderRuleEditor(); updateSaveState(); };
    box.append(el);
  });
}

function normalized() {
  return { ...draft, rules: draft.rules.map((r) => ({ ...r, domains: r.domains.map((d) => cleanDomain(d) || d), apps: r.apps || [] })) };
}

function updateSaveState() {
  draft.resetHour = Number($("#reset-hour").value);
  draft.warnings = $("#warnings").checked;
  draft.updateSource = $("#update-source").value;
  const loosening = state.hasPassword && !isTightening(state.settings, normalized());
  $("#save-pw").classList.toggle("hidden", !loosening);
}

async function save() {
  const err = $("#save-err");
  err.replaceChildren();
  $("#save-msg").textContent = "";
  try {
    await send("saveSettings", { settings: normalized(), password: $("#save-password").value });
    state = await send("state");
    $("#save-password").value = "";
    openSettings();
    $("#save-msg").textContent = "Saved ✓";
  } catch (e) {
    err.append(errorBox(e, { compact: true }));
    if (e.wait) $("#save-msg").textContent = `Try again in ${Math.ceil(e.wait / 1000)}s`;
  }
}

async function checkUpdates() {
  const out = $("#update-result");
  const btn = $("#check-updates");
  btn.textContent = "Checking for Updates…";
  btn.disabled = true;
  out.replaceChildren();
  try {
    const u = await send("checkUpdates");
    if (u.error) out.append(errorBox({ ...u.error, t: u.checkedAt }, { compact: true }));
    else if (u.available) out.innerHTML = `<p class="small"><b>v${esc(u.latest)} is available.</b> ${esc(u.notes)}${u.url ? ` <a href="${esc(u.url)}" target="_blank">Download</a>` : ""}</p>`;
    else out.innerHTML = `<p class="small muted">TimeLock is up to date (v${esc(VERSION)}).</p>`;
  } catch (e) {
    out.append(errorBox(e, { compact: true }));
  }
  btn.textContent = "Check for Updates…";
  btn.disabled = false;
}

// ---------- wiring ----------

// Opened as a tab (the Mac app's fallback): centre it instead of popup width.
if (new URLSearchParams(location.search).has("full")) document.body.classList.replace("popup", "full");

for (let h = 0; h < 24; h++) {
  const o = document.createElement("option");
  o.value = h;
  o.textContent = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#reset-hour").append(o);
}
$("#toggle").onclick = () => ($("#settings").classList.contains("hidden") ? openSettings() : closeSettings());
$("#add-rule").onclick = () => { draft.rules.push({ name: "", domains: [], apps: [], limit: 30 }); renderRuleEditor(); updateSaveState(); };
$("#reset-hour").onchange = updateSaveState;
$("#warnings").onchange = updateSaveState;
$("#update-source").oninput = updateSaveState;
$("#save").onclick = save;
$("#stats").onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL("app/stats.html") }); window.close(); };
$("#add-goal").onclick = () => { goalsDraft.push({ kind: "site", name: "", min: null, max: null }); renderGoals(); };
$("#save-goals").onclick = saveGoals;
$("#check-updates").onclick = checkUpdates;
$("#gh").href = `https://github.com/${REPO}`;
$("#errlist").href = ERROR_LIST_URL;

await refresh();
if (state && !state.hasPassword) openSettings();
setInterval(() => $("#settings").classList.contains("hidden") && refresh(), 15000);
