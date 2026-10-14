// Settings panel plumbing — no CDN, no build step (same pattern as Curtain Deck).
// Any <input>/<select> with a name is bound to that setting. <select data-list="limits|apps|sites">
// is filled from TimeLock's data, sent over by the plugin. Problems show with their
// error code, hover text pointing at the public error list, and Copy Error Details.
let socket, uuid, actionUUID, settings = {};
let lastLists = "";
const ERROR_HOVER = "Look this code up on the TimeLock error list: https://github.com/jonpikereally/TimeLock/blob/main/ERRORS.md";

window.connectElgatoStreamDeckSocket = (port, inUUID, registerEvent, info, actionInfo) => {
  uuid = inUUID;
  try { const a = JSON.parse(actionInfo); settings = a.payload.settings || {}; actionUUID = a.action; } catch { settings = {}; }
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => { socket.send(JSON.stringify({ event: registerEvent, uuid })); hydrate(); };
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === "didReceiveSettings") { settings = msg.payload.settings || {}; hydrate(); }
    if (msg.event === "sendToPropertyInspector") update(msg.payload);
  };
};

const save = () => socket?.send(JSON.stringify({ event: "setSettings", context: uuid, payload: settings }));
const toPlugin = (payload) => socket?.send(JSON.stringify({ event: "sendToPlugin", context: uuid, action: actionUUID, payload }));

function hydrate() {
  for (const el of document.querySelectorAll("[name]")) {
    const v = settings[el.name];
    if (v !== undefined && v !== null) el.value = v;
    else if (el.dataset.default !== undefined) { el.value = el.dataset.default; settings[el.name] = el.value; }
  }
  reveal();
}

function reveal() {
  for (const row of document.querySelectorAll("[data-show-when]")) {
    const [k, v] = row.dataset.showWhen.split("=");
    row.style.display = String(settings[k]) === v ? "" : "none";
  }
}

function update(p) {
  // Lists: rebuilt only when they change, so an open menu isn't yanked.
  const sig = JSON.stringify([p.limits, p.apps, p.sites]);
  if (sig !== lastLists) {
    lastLists = sig;
    for (const sel of document.querySelectorAll("select[data-list]")) {
      const items = p[sel.dataset.list] || [];
      const cur = settings[sel.name] || "";
      sel.innerHTML = "";
      const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); };
      add("", sel.dataset.list === "limits" ? "First limit" : "Choose…");
      if (sel.dataset.cycle) add("*", sel.dataset.cycle);
      for (const i of items) add(i, i);
      if (cur && cur !== "*" && !items.includes(cur)) add(cur, `${cur} (no time today)`);
      sel.value = cur;
    }
  }
  const st = document.getElementById("status");
  if (st) st.textContent = `TimeLock for Mac: ${p.macRunning ? "running" : "not running"} · Browser extension: ${p.browserConnected ? "connected" : "no data today"}`;
  const box = document.getElementById("problem");
  if (!box) return;
  if (!p.problem) { box.style.display = "none"; return; }
  const e = p.problem;
  box.style.display = "";
  box.title = ERROR_HOVER;
  box.innerHTML = `<b title="${ERROR_HOVER}">Error code: ${e.code}</b><span title="${ERROR_HOVER}">${e.summary} ${e.hint}</span>
    <div><a href="#" id="errlist" title="${ERROR_HOVER}">Error list</a> · <button id="copy">Copy Error Details</button>
    ${e.code === "TL-901" ? '<button id="open">Open TimeLock</button>' : ""}</div>`;
  document.getElementById("errlist").onclick = (ev) => { ev.preventDefault(); socket.send(JSON.stringify({ event: "openUrl", payload: { url: e.list } })); };
  document.getElementById("copy").onclick = () => copy([
    `TimeLock Deck error ${e.code}: ${e.summary}`, `What to try: ${e.hint}`, e.details ? `Details: ${e.details}` : "",
    `Stream Deck plugin com.jonpike.timelockdeck`, `Error list: ${e.list}`, `Error list (plain text for AI assistants): ${e.raw}`,
  ].filter(Boolean).join("\n"));
  const open = document.getElementById("open");
  if (open) open.onclick = () => toPlugin({ openMacApp: true });
}

function copy(text) {
  const t = document.createElement("textarea");
  t.value = text;
  document.body.appendChild(t);
  t.select();
  document.execCommand("copy");
  t.remove();
  document.getElementById("copy").textContent = "Copied ✓";
}

document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.name) return;
  settings[el.name] = el.value;
  // A name picked for apps means nothing for websites, and the reverse.
  if (el.name === "kind") { settings.name = ""; for (const x of document.querySelectorAll('[name="name"]')) x.value = ""; }
  else if (el.name === "name") for (const x of document.querySelectorAll('[name="name"]')) x.value = el.value;
  reveal();
  save();
});
