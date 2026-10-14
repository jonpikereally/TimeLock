import { $, esc, send, errorBox, fmtTime, VERSION } from "./ui.js";
import { fmtDuration, hostMatches, isTightening, cleanDomain } from "../src/shared/core.js";
import { REPO, ERROR_LIST_URL } from "../src/shared/errors.js";

let state;
let draft; // settings being edited in the Settings view

async function refresh() {
  try {
    state = await send("state");
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
  if (u && u.available) {
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

function ruleCard(r, st) {
  const pct = st.limit ? Math.min(100, (st.used / st.limit) * 100) : 100;
  const [text, cls] = statusLine(r, st);
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <div class="row"><b class="grow ellipsis">${esc(r.name)}</b><span class="pill ${cls}">${esc(text)}</span></div>
    <div class="bar ${st.over ? "bad" : st.left <= 300 ? "warn" : ""}"><i style="width:${pct}%"></i></div>
    <div class="row small muted"><span class="grow ellipsis" title="${esc(r.domains.join(", "))}">${esc(r.domains.join(", "))}</span>
      <span>${fmtDuration(st.used)} of ${fmtDuration(st.limit)}</span>
      ${st.unlocked ? '<button class="btn small relock">Lock again</button>' : ""}</div>`;
  const relock = $(".relock", el);
  if (relock) relock.onclick = () => send("relockNow", { ruleId: r.id }).then(refresh);
  return el;
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
    if (!covered.length) {
      const add = document.createElement("div");
      add.className = "row";
      add.style.marginTop = "8px";
      add.innerHTML = `<span class="grow small">Limit this site to</span><input class="min" type="number" min="0" max="1440" value="30"><span class="small">min/day</span><button class="btn small primary">Add</button>`;
      const err = document.createElement("div");
      $("button", add).onclick = async () => {
        err.replaceChildren();
        const rule = { name: host, domains: [host], limit: Number($("input", add).value) };
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

  const rows = Object.entries(usage).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((t, [, s]) => t + s, 0);
  $("#total").textContent = fmtDuration(total);
  $("#sites").innerHTML = rows.length
    ? rows.slice(0, 15).map(([h, s]) => `<li><span class="grow ellipsis">${esc(h)}</span><span class="t">${fmtDuration(s)}</span></li>`).join("")
    : `<li class="empty">Nothing tracked yet today.</li>`;
}

// ---------- settings ----------

function openSettings() {
  $("#home").classList.add("hidden");
  $("#settings").classList.remove("hidden");
  $("#toggle").textContent = "✕";
  $("#toggle").title = "Back";
  draft = structuredClone(state.settings);
  renderPassword();
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
      <span class="small muted">min/day</span>`;
    $(".name", el).oninput = (e) => { r.name = e.target.value; };
    $(".limit", el).oninput = (e) => { r.limit = e.target.value === "" ? NaN : Number(e.target.value); updateSaveState(); };
    $(".domains", el).oninput = (e) => { r.domains = e.target.value.split(/[,\s]+/).filter(Boolean); updateSaveState(); };
    $(".del", el).onclick = () => { draft.rules.splice(i, 1); renderRuleEditor(); updateSaveState(); };
    box.append(el);
  });
}

function normalized() {
  return { ...draft, rules: draft.rules.map((r) => ({ ...r, domains: r.domains.map((d) => cleanDomain(d) || d) })) };
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

for (let h = 0; h < 24; h++) {
  const o = document.createElement("option");
  o.value = h;
  o.textContent = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#reset-hour").append(o);
}
$("#toggle").onclick = () => ($("#settings").classList.contains("hidden") ? openSettings() : closeSettings());
$("#add-rule").onclick = () => { draft.rules.push({ name: "", domains: [], limit: 30 }); renderRuleEditor(); updateSaveState(); };
$("#reset-hour").onchange = updateSaveState;
$("#warnings").onchange = updateSaveState;
$("#update-source").oninput = updateSaveState;
$("#save").onclick = save;
$("#check-updates").onclick = checkUpdates;
$("#gh").href = `https://github.com/${REPO}`;
$("#errlist").href = ERROR_LIST_URL;

await refresh();
if (state && !state.hasPassword) openSettings();
setInterval(() => $("#settings").classList.contains("hidden") && refresh(), 15000);
