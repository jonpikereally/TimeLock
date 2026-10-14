// Every error a user can see has a stable code. Never reuse or renumber.
// The public list lives in ERRORS.md; scripts/check-errors.sh fails the
// build if a code used in src/ or app/ is missing from it.
//   1xx updates   2xx time tracking   3xx blocking   4xx password
//   5xx limits/settings   999 unexpected

export const REPO = "jonpikereally/TimeLock";
export const ERROR_LIST_URL = `https://github.com/${REPO}/blob/main/ERRORS.md`;
export const ERROR_LIST_RAW = `https://raw.githubusercontent.com/${REPO}/main/ERRORS.md`;
export const ERROR_HOVER = `Look this code up on the TimeLock error list: ${ERROR_LIST_URL}`;

export const ERRORS = {
  "TL-101": ["Couldn't reach the update feed.", "Check your internet connection, or the Update source in Settings."],
  "TL-102": ["The update feed returned something unreadable.", "Clear the Update source in Settings to go back to the built-in feed."],
  "TL-201": ["Couldn't save the time you spent on a site.", "Your disk may be full. Free some space; if it keeps happening, copy the details."],
  "TL-202": ["Couldn't read your saved time or settings.", "Restart Chrome. If it persists, copy the details."],
  "TL-301": ["Couldn't turn on blocking for a locked site.", "Restart Chrome. Until this is fixed, locked sites may still open."],
  "TL-302": ["Couldn't send an open tab to the lock screen.", "Close the tab yourself; new visits are still blocked."],
  "TL-401": ["That password isn't right.", "Try again. After 3 wrong tries you'll have to wait before the next one."],
  "TL-402": ["Too many wrong passwords.", "Wait for the countdown to finish, then try again."],
  "TL-403": ["The new password wasn't accepted.", "Use at least 4 characters and type it the same way in both boxes."],
  "TL-404": ["Couldn't check the password.", "Restart Chrome and try again. If it persists, copy the details."],
  "TL-405": ["Set a password before adding limits.", "Open Settings in the TimeLock popup and set a password first."],
  "TL-501": ["That isn't a website address TimeLock understands.", "Type plain domains like youtube.com, separated by commas."],
  "TL-502": ["That daily limit isn't valid.", "Use a whole number of minutes between 0 and 1440. 0 blocks the site all day."],
  "TL-503": ["Couldn't save your settings.", "Try again. If it repeats, copy the details."],
  "TL-999": ["Something unexpected went wrong.", "Copy the details and paste them into an AI assistant along with the error list link."],
};

export function describe(code) {
  const [summary, hint] = ERRORS[code] || ERRORS["TL-999"];
  return { code: ERRORS[code] ? code : "TL-999", summary, hint };
}

export function coded(code, message) {
  return Object.assign(new Error(message || describe(code).summary), { code });
}

export function detailsText(err, version) {
  const d = describe(err.code);
  return [
    `TimeLock error ${d.code}: ${d.summary}`,
    `What to try: ${d.hint}`,
    err.details ? `Details: ${err.details}` : null,
    `When: ${new Date(err.t || Date.now()).toISOString()}`,
    `TimeLock version: ${version}`,
    `Browser: ${navigator.userAgent}`,
    `Error list: ${ERROR_LIST_URL}`,
    `Error list (plain text for AI assistants): ${ERROR_LIST_RAW}`,
  ].filter(Boolean).join("\n");
}

// Background errors land here so the popup can show them. Never logs
// passwords or page contents, only codes and technical details.
export async function logError(code, details) {
  try {
    const { errors = [] } = await chrome.storage.local.get("errors");
    errors.push({ code, details: String(details || "").slice(0, 2000), t: Date.now() });
    await chrome.storage.local.set({ errors: errors.slice(-30) });
    console.warn(`[TimeLock] ${code}`, details);
  } catch (e) {
    console.error("[TimeLock] couldn't log error", code, details, e);
  }
}
