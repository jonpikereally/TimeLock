// Shared by the popup and the lock screen.
import { describe, detailsText, ERROR_HOVER, ERROR_LIST_URL } from "../src/shared/errors.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const VERSION = chrome.runtime.getManifest().version;

// Every background call comes back as {ok, result} or {ok:false, error:{code, details, wait}}.
export async function send(type, data = {}) {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type, ...data });
  } catch (e) {
    throw Object.assign(new Error(e.message), { code: "TL-999" });
  }
  // No reply means the background is an older copy that doesn't know this
  // request: the files were updated but the extension wasn't reloaded.
  if (!res) throw Object.assign(new Error(`The background doesn't handle "${type}" (no reply)`), { code: "TL-103" });
  if (!res.ok) throw Object.assign(new Error(res.error.details || res.error.code), res.error);
  return res.result;
}

export const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Every error shows its code, hover text pointing at the public error list,
// a "?" link for touch screens, and a Copy Error Details button.
export function errorBox(err, { onDismiss, compact } = {}) {
  const d = describe(err.code);
  const el = document.createElement("div");
  el.className = "banner error";
  el.title = ERROR_HOVER;
  el.innerHTML = `
    <div class="err-head"><span class="err-code" title="${esc(ERROR_HOVER)}">Error code: ${esc(d.code)}</span>
      <a class="err-help" href="${ERROR_LIST_URL}" target="_blank" title="${esc(ERROR_HOVER)}">?</a></div>
    <div class="err-msg" title="${esc(ERROR_HOVER)}">${esc(d.summary)}${compact ? "" : ` <span class="muted">${esc(d.hint)}</span>`}</div>
    <div class="err-actions"><button class="btn small copy">Copy Error Details</button>${onDismiss ? '<button class="btn small dismiss">Dismiss</button>' : ""}</div>`;
  $(".copy", el).onclick = async (e) => {
    await navigator.clipboard.writeText(detailsText(err, VERSION));
    e.target.textContent = "Copied ✓";
  };
  if (onDismiss) $(".dismiss", el).onclick = () => { el.remove(); onDismiss(); };
  return el;
}
