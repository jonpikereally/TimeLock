// Stats page: totals and per-day / per-week history for websites and Mac apps.
// One `history` request loads this year plus the last 30 days; every filter
// after that is computed here, so switching is instant.
import { $, esc, send, errorBox } from "./ui.js";
import { fmtDuration, daysBetween, rangeStart, bucket, addDays, goalFor, goalState, goalText } from "../src/shared/core.js";

const PREFS_KEY = "timelock-stats";
let H = null; // history from the background
const ui = { range: "week", view: "day", source: "all", item: "", period: null, table: false };
try { Object.assign(ui, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"), { period: null }); } catch {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...ui, period: null })); } catch {} };

// ---------- data ----------

const itemKey = (kind, name) => `${kind}:${name}`;
const splitKey = (k) => { const i = k.indexOf(":"); return { kind: k.slice(0, i), name: k.slice(i + 1) }; };
const labelOf = (k) => { const { kind, name } = splitKey(k); return `${name}${kind === "app" ? " (app)" : ""}`; };

/// Seconds per item on one day, for the chosen source.
function dayItems(d) {
  const out = {};
  if (ui.source !== "app") for (const [h, s] of Object.entries(H.sites[d] || {})) out[itemKey("site", h)] = s;
  if (ui.source !== "site") for (const [a, s] of Object.entries(H.apps[d] || {})) out[itemKey("app", a)] = s;
  return out;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const dayTotal = (d) => (ui.item ? dayItems(d)[ui.item] || 0 : sum(dayItems(d)));

/// The range's days, starting at the first day with any tracked time, so
/// averages and charts don't count days from before TimeLock was installed.
function rangeDays() {
  const from = [rangeStart(ui.range, H.today), H.from].sort().at(-1);
  const all = daysBetween(from, H.today);
  const first = all.findIndex((d) => sum(dayItems(d)) > 0);
  return first > 0 ? all.slice(first) : all;
}

/// The days a chart bar covers (a day, or the days of a week inside the range).
function periodDays(key, days) {
  if (ui.view !== "week") return [key];
  const end = addDays(key, 6);
  return days.filter((d) => d >= key && d <= end);
}

function totalsOver(days) {
  const out = {};
  for (const d of days) for (const [k, s] of Object.entries(dayItems(d))) out[k] = (out[k] || 0) + s;
  return Object.entries(out).filter(([, s]) => s >= 1).sort((a, b) => b[1] - a[1]);
}

const itemGoal = (k) => { if (!k) return null; const { kind, name } = splitKey(k); return goalFor(H.goals, kind, name); };

// ---------- formatting ----------

const keyDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const dayLabel = (k, opts = { weekday: "short", month: "short", day: "numeric" }) => keyDate(k).toLocaleDateString([], opts);
const periodLabel = (k) => (ui.view === "week" ? `Week of ${dayLabel(k, { month: "short", day: "numeric" })}` : dayLabel(k));
const RANGE_NAMES = { today: "Today", week: "This week", month: "This month", year: "This year", "7d": "Last 7 days", "30d": "Last 30 days" };

// ---------- render ----------

function render() {
  for (const seg of ["range", "view"]) {
    for (const b of document.querySelectorAll(`#${seg} button`)) b.setAttribute("aria-pressed", String(b.dataset.v === ui[seg]));
  }
  $("#source").value = ui.source;
  const days = rangeDays();
  renderItemPicker(days);
  renderTiles(days);
  renderChart(days);
  renderRank(days);
  $("#as-of").textContent = `Today is ${dayLabel(H.today)}`;
}

function renderItemPicker(days) {
  const items = totalsOver(days).map(([k]) => k);
  if (ui.item && !items.includes(ui.item)) items.unshift(ui.item);
  $("#item").innerHTML = `<option value="">Everything</option>` + items.map((k) => `<option value="${esc(k)}">${esc(labelOf(k))}</option>`).join("");
  $("#item").value = ui.item;
}

function renderTiles(days) {
  const totals = days.map(dayTotal);
  const total = totals.reduce((a, b) => a + b, 0);
  const busiest = days.reduce((best, d, i) => (totals[i] > (best ? best[1] : -1) ? [d, totals[i]] : best), null);
  const tiles = [
    ["Total", fmtDuration(total), `${RANGE_NAMES[ui.range]}${ui.item ? ` · ${labelOf(ui.item)}` : ""}`],
    ["Daily average", fmtDuration(total / Math.max(1, days.length)), `over ${days.length} day${days.length > 1 ? "s" : ""}${days[0] > rangeStart(ui.range, H.today) ? ` (since ${dayLabel(days[0], { month: "short", day: "numeric" })})` : ""}`],
  ];
  if (days.length > 1 && busiest) tiles.push(["Busiest day", fmtDuration(busiest[1]), dayLabel(busiest[0])]);
  const goal = itemGoal(ui.item);
  if (goal && days.length > 1) {
    const states = totals.map((s) => goalState(s, goal));
    const met = states.filter((x) => x === "met" || (goal.min == null && x !== "over")).length;
    tiles.push(["Goal", `${met} of ${days.length} days`, goalText(goal)]);
  } else if (!ui.item) {
    const top = totalsOver(days)[0];
    if (top) tiles.push(["Most time", fmtDuration(top[1]), labelOf(top[0])]);
  }
  $("#tiles").innerHTML = tiles.map(([k, v, s]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s" title="${esc(s)}">${esc(s)}</div></div>`).join("");
}

/// A round axis maximum (in seconds) and its tick step.
function niceScale(max) {
  const steps = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200];
  const step = steps.find((s) => max / s <= 4) || 43200;
  return { top: Math.max(step, Math.ceil(max / step) * step), step };
}

function renderChart(days) {
  const card = $("#chart-card");
  card.classList.toggle("hidden", ui.view === "totals");
  if (ui.view === "totals") return;
  const totals = Object.fromEntries(days.map((d) => [d, dayTotal(d)]));
  const periods = bucket(days, totals, ui.view === "week" ? "week" : "day");
  const goal = itemGoal(ui.item);
  $("#chart-title").textContent = `${ui.view === "week" ? "Per week" : "Per day"}: ${ui.item ? labelOf(ui.item) : ui.source === "site" ? "all websites" : ui.source === "app" ? "all Mac apps" : "everything"}`;

  // Goal colouring for one item: each bar by its (average) day against the goal.
  const stateOf = (p) => {
    if (!goal) return null;
    const n = periodDays(p.key, days).length || 1;
    return goalState(p.secs / n, goal);
  };
  $("#legend").innerHTML = goal ? [["under", "below min"], ["met", "goal met"], ["near", "near max"], ["over", "over max"]]
    .filter(([s]) => (s === "under" || s === "met" ? goal.min != null : goal.max != null))
    .map(([s, t]) => `<span><i class="sw g-${s}"></i>${t}</span>`).join("") + (ui.view === "week" ? `<span>(weekly bars use the daily average)</span>` : "") : "";
  for (const sw of document.querySelectorAll("#legend .sw")) sw.style.background = getComputedStyle(document.body).getPropertyValue(`--${{ "g-under": "goal", "g-met": "ok", "g-near": "warn", "g-over": "bad" }[sw.classList[1]]}`);

  // Table view (also the accessible version of the chart).
  $("#as-table").setAttribute("aria-pressed", String(ui.table));
  $("#as-table").textContent = ui.table ? "Show as chart" : "Show as table";
  $("#chart").classList.toggle("hidden", ui.table);
  $("#chart-table").classList.toggle("hidden", !ui.table);
  $("#chart-table").innerHTML = `<table class="periods"><tr><th>${ui.view === "week" ? "Week" : "Day"}</th><th>Time</th></tr>${
    periods.map((p) => `<tr><td>${esc(periodLabel(p.key))}</td><td>${fmtDuration(p.secs)}</td></tr>`).join("")}</table>`;
  if (ui.table) return;

  const W = Math.max(320, $("#chart").clientWidth), Hh = 240, L = 52, R = 8, T = 10, B = 24;
  const lines = goal && ui.view === "day" ? [goal.min, goal.max].filter((x) => x != null).map((m) => m * 60) : [];
  const { top, step } = niceScale(Math.max(1, ...periods.map((p) => p.secs), ...lines));
  const y = (s) => T + (Hh - T - B) * (1 - s / top);
  const band = (W - L - R) / periods.length;
  const gap = band > 8 ? 2 : 0;
  const bw = Math.max(1, Math.min(48, band - gap));
  let svg = "";
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v ? fmtDuration(v) : "0"}</text>`;
  }
  for (const m of lines) svg += `<line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/>`;
  const every = Math.ceil(periods.length / Math.max(1, Math.floor((W - L) / 70)));
  periods.forEach((p, i) => {
    const x = L + i * band + (band - bw) / 2;
    const h = Math.max(0, y(0) - y(p.secs));
    const st = stateOf(p);
    const dim = ui.period && ui.period !== p.key ? " dim" : "";
    const r = Math.min(4, bw / 2, h);
    // Rounded at the data end only, square on the baseline.
    svg += h > 0 ? `<path class="bar${st && st !== "none" ? " g-" + st : ""}${dim}" d="M${x},${y(0)} V${y(p.secs) + r} Q${x},${y(p.secs)} ${x + r},${y(p.secs)} H${x + bw - r} Q${x + bw},${y(p.secs)} ${x + bw},${y(p.secs) + r} V${y(0)} Z"/>` : "";
    if (i % every === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${Hh - 6}" text-anchor="middle">${esc(ui.view === "week" ? dayLabel(p.key, { month: "short", day: "numeric" }) : dayLabel(p.key, periods.length > 8 ? { month: "short", day: "numeric" } : undefined))}</text>`;
    svg += `<rect class="hit" tabindex="0" data-i="${i}" x="${L + i * band}" y="${T}" width="${band}" height="${Hh - T - B}"><title>${esc(periodLabel(p.key))}: ${fmtDuration(p.secs)}</title></rect>`;
  });
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc($("#chart-title").textContent)}">${svg}</svg>`;

  // Hover / focus tooltip; click or Enter shows that period's breakdown below.
  const tip = $("#tip");
  const show = (el) => {
    const p = periods[+el.dataset.i];
    const pd = periodDays(p.key, days);
    let rows = "";
    if (!ui.item) rows = totalsOver(pd).slice(0, 4).map(([k, s]) => `<div class="r"><span>${esc(labelOf(k))}</span><span>${fmtDuration(s)}</span></div>`).join("");
    else if (goal) rows = `<div class="r"><span>${esc(goalText(goal))}</span><span>${esc({ under: "below min", met: "met", near: "near max", over: "over max", none: "fine" }[stateOf(p)])}</span></div>`;
    tip.innerHTML = `<b>${esc(periodLabel(p.key))} · ${fmtDuration(p.secs)}</b>${rows}<div class="r"><span>Click for details</span><span></span></div>`;
    tip.classList.remove("hidden");
    const box = el.getBoundingClientRect(), host = $("#chart-card").getBoundingClientRect();
    const left = Math.min(box.left - host.left + box.width / 2 + 10, host.width - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${box.top - host.top + 4}px`;
  };
  const pick = (el) => { const k = periods[+el.dataset.i].key; ui.period = ui.period === k ? null : k; render(); };
  for (const el of document.querySelectorAll("#chart .hit")) {
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("focus", () => show(el));
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    el.addEventListener("blur", () => tip.classList.add("hidden"));
    el.addEventListener("click", () => pick(el));
    el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(el)));
  }
}

function renderRank(allDays) {
  const days = ui.period ? periodDays(ui.period, allDays) : allDays;
  $("#list-title").textContent = ui.period ? `${periodLabel(ui.period)}: what you spent it on` : `${RANGE_NAMES[ui.range]}: what you spent it on`;
  $("#clear-period").classList.toggle("hidden", !ui.period);
  const rows = totalsOver(days);
  const max = rows.length ? rows[0][1] : 1;
  const n = Math.max(1, days.length);
  $("#rank").innerHTML = rows.length ? rows.slice(0, 50).map(([k, s]) => {
    const { kind, name } = splitKey(k);
    const goal = goalFor(H.goals, kind, name);
    const avg = s / n;
    const st = goalState(avg, goal);
    return `<li data-k="${esc(k)}" title="Show only ${esc(name)}">
      <span class="name">${esc(name)}<span class="kind">${kind === "app" ? "app" : "site"}</span></span>
      <span class="track"><i style="width:${(100 * s / max).toFixed(1)}%"></i></span>
      <span class="tot">${fmtDuration(s)}</span>
      <span class="avg ${st === "none" ? "" : "g-" + st}" title="${esc(goal ? `${goalText(goal)} (daily average)` : "Daily average")}">${n > 1 ? `${fmtDuration(avg)}/day` : ""}</span></li>`;
  }).join("") : `<li class="empty" style="display:block">Nothing tracked ${ui.period ? "then" : "in this range"} yet.</li>`;
  for (const li of document.querySelectorAll("#rank li[data-k]")) li.onclick = () => { ui.item = ui.item === li.dataset.k ? "" : li.dataset.k; ui.period = null; savePrefs(); render(); };
}

// ---------- wiring ----------

for (const seg of ["range", "view"]) {
  $(`#${seg}`).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    ui[seg] = b.dataset.v;
    ui.period = null;
    savePrefs();
    render();
  });
}
$("#source").onchange = (e) => { ui.source = e.target.value; ui.item = ""; ui.period = null; savePrefs(); render(); };
$("#item").onchange = (e) => { ui.item = e.target.value; ui.period = null; savePrefs(); render(); };
$("#as-table").onclick = () => { ui.table = !ui.table; savePrefs(); render(); };
$("#clear-period").onclick = (e) => { e.preventDefault(); ui.period = null; render(); };
let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => H && render(), 150); });

try {
  H = await send("history", {});
  if (H.mac === "error") $("#banners").append(errorBox({ code: "TL-601", details: "Stats: couldn't load Mac app history" }, { onDismiss: () => {} }));
  render();
} catch (e) {
  $("#banners").append(errorBox(e));
}
