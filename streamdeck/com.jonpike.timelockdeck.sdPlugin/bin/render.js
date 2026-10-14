// Draws key images as SVG data URLs (144×144, Stream Deck scales them).

const COLORS = {
  bg: "#15181e",
  track: "#2e333d",
  text: "#ffffff",
  muted: "#9aa3b2",
  accent: "#6d8dff",
  warn: "#ff9800",
  bad: "#ef5350",
  ok: "#66bb6a",
  goal: "#6d9bff",
};

/// Colour for a goal state; `fallback` when there's no goal.
const GOAL_COLORS = { under: COLORS.goal, met: COLORS.ok, near: COLORS.warn, over: COLORS.bad };
const goalColor = (state, fallback = COLORS.text) => GOAL_COLORS[state] || fallback;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const url = (svg) => "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
const FONT = `font-family="-apple-system, Helvetica Neue, Helvetica, Arial, sans-serif"`;

/// Shrinks long text so it fits the key's width.
function fit(text, max, size) {
  const n = String(text).length;
  return n * size * 0.58 > max ? Math.max(11, Math.floor(max / (n * 0.58))) : size;
}

function frame(inner) {
  return url(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" rx="18" fill="${COLORS.bg}"/>${inner}</svg>`);
}

const lockIcon = (x, y, color) => `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round">
<path d="M-7 -1 v-5 a7 7 0 0 1 14 0 v5"/><rect x="-10" y="-1" width="20" height="15" rx="3" fill="${color}" stroke="none"/></g>`;

/// A progress ring with a big number in the middle.
function ring({ pct = 0, color = COLORS.accent, top = "", big = "", bottom = "", lock = false }) {
  const r = 56, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const bigSize = fit(big, 92, 30);
  return frame(`
<circle cx="72" cy="72" r="${r}" fill="none" stroke="${COLORS.track}" stroke-width="10"/>
<circle cx="72" cy="72" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
  stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 72 72)"/>
${lock ? lockIcon(72, 44, color) : `<text x="72" y="54" text-anchor="middle" ${FONT} font-size="14" fill="${COLORS.muted}">${esc(top)}</text>`}
<text x="72" y="${lock ? 88 : 84}" text-anchor="middle" ${FONT} font-size="${bigSize}" font-weight="700" fill="${COLORS.text}">${esc(big)}</text>
<text x="72" y="106" text-anchor="middle" ${FONT} font-size="${fit(bottom, 80, 14)}" fill="${COLORS.muted}">${esc(bottom)}</text>`);
}

/// Plain text: a label on top, a big value, a line underneath.
function text({ top = "", big = "", bottom = "", color = COLORS.text, sub = "" }) {
  const bigSize = fit(big, 128, 34);
  return frame(`
<text x="72" y="34" text-anchor="middle" ${FONT} font-size="${fit(top, 128, 16)}" fill="${COLORS.muted}">${esc(top)}</text>
<text x="72" y="${sub ? 80 : 86}" text-anchor="middle" ${FONT} font-size="${bigSize}" font-weight="700" fill="${color}">${esc(big)}</text>
${sub ? `<text x="72" y="104" text-anchor="middle" ${FONT} font-size="${fit(sub, 128, 15)}" fill="${COLORS.muted}">${esc(sub)}</text>` : ""}
<text x="72" y="128" text-anchor="middle" ${FONT} font-size="${fit(bottom, 128, 15)}" fill="${COLORS.muted}">${esc(bottom)}</text>`);
}

/// A problem key: the error code is always shown (see ERRORS.md).
function problem({ top = "", line = "", code = "" }) {
  return frame(`
<text x="72" y="34" text-anchor="middle" ${FONT} font-size="${fit(top, 128, 16)}" fill="${COLORS.muted}">${esc(top)}</text>
<text x="72" y="78" text-anchor="middle" ${FONT} font-size="${fit(line, 128, 20)}" font-weight="600" fill="${COLORS.text}">${esc(line)}</text>
<text x="72" y="120" text-anchor="middle" ${FONT} font-size="15" font-weight="600" fill="${COLORS.warn}">${esc(code)}</text>`);
}

/// Small square icon for the Stream Deck + touch strip.
function dialIcon(color, lock) {
  return url(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
<circle cx="36" cy="36" r="26" fill="none" stroke="${color}" stroke-width="6"/>
${lock ? lockIcon(36, 34, color) : `<path d="M36 22 v14 l9 6" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`}</svg>`);
}

/// Ring colour for a limit: green while unlocked, red when locked, orange near the end.
function limitColor(st) {
  if (st.unlocked) return COLORS.ok;
  if (st.locked) return COLORS.bad;
  if (st.left <= 300) return COLORS.warn;
  return COLORS.accent;
}

module.exports = { goalColor, COLORS, ring, text, problem, dialIcon, limitColor };
