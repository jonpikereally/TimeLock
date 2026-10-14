import { $, send, errorBox, fmtTime } from "./ui.js";
import { hostOf, hostMatches, fmtDuration } from "../src/shared/core.js";

const target = location.hash.slice(1);
const host = hostOf(target);
let rule, status;

async function load() {
  let state;
  try {
    state = await send("state", { host });
  } catch (e) {
    $("#err").replaceChildren(errorBox(e));
    return;
  }
  rule = state.settings.rules.find((r) => r.domains.some((d) => hostMatches(host, d)));
  status = rule && state.statuses.find((s) => s.id === rule.id);

  // Limit loosened, deleted, or a new day started: nothing to block any more.
  if (!status || !status.locked) {
    if (target) location.replace(target);
    return;
  }

  document.title = `${host} is locked · TimeLock`;
  $("#title").textContent = `${host} is locked`;
  $("#sub").textContent = `It unlocks at ${fmtTime(status.resetsAt)}.`;
  $("#detail").textContent = rule.limit === 0
    ? `"${rule.name}" is blocked all day.`
    : `You've used ${fmtDuration(status.used)} of your ${fmtDuration(status.limit)} daily limit for "${rule.name}" (${rule.domains.join(", ")}).`;
  $("#url").textContent = target;
  if (!state.hasPassword) $("#unlock-box").classList.add("hidden");
}

async function unlock() {
  $("#err").replaceChildren();
  $("#wait").textContent = "";
  const btn = $("#unlock");
  btn.disabled = true;
  try {
    await send("unlock", { password: $("#password").value, ruleId: rule.id, minutes: $("#minutes").value });
    location.replace(target);
  } catch (e) {
    $("#err").append(errorBox(e, { compact: true }));
    $("#password").select();
    if (e.wait) countdown(Date.now() + e.wait);
    else btn.disabled = false;
  }
}

function countdown(until) {
  const btn = $("#unlock");
  const step = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      $("#wait").textContent = "";
      btn.disabled = false;
      return;
    }
    $("#wait").textContent = `Try again in ${left}s`;
    setTimeout(step, 500);
  };
  btn.disabled = true;
  step();
}

$("#unlock").onclick = unlock;
$("#password").onkeydown = (e) => e.key === "Enter" && unlock();
load();
