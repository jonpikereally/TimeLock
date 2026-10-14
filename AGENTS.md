# Brief for anyone (human or AI) working on TimeLock

TimeLock is a Manifest V3 extension (Chrome/Brave/Edge 120+). Plain JS, no build step, no dependencies.

- **Tracking** is in `src/background.js`. `chrome.storage.session.cur` holds `{host, since}`; every tab/focus/idle event and a 30 s alarm call `flush()`, which adds the elapsed seconds to `usage:<YYYY-MM-DD>` and re-reads the front tab. Gaps over 90 s are dropped (the computer slept). Everything runs through the `serial()` queue so events can't double-count.
- **Blocking** uses `declarativeNetRequest` dynamic rules (one per locked limit) that redirect main-frame loads to `app/blocked.html#<original URL>`, plus `tabs.update` for tabs already open. Locked state is always derived from usage + `unlocks` + settings in `core.ruleStatus`; nothing stores "locked".
- **Countdown clock:** `src/content.js` (plain script, Shadow DOM) asks the background for `pageStatus` every 15 s and on focus/visibility changes, and ticks locally in between only while the tab is visible and focused.
- **Pure logic** (days, matching, status, tighten-vs-loosen, validation) is in `src/shared/core.js`, covered by `node tests/core.test.mjs`. Run it after any change there.
- **Password:** salted PBKDF2 hash in `storage.local.pw`; `verify()` enforces the cooldown in `core.cooldownMs`. Never store or log the password.
- **Errors:** every user-facing error has a `TL-###` code from `src/shared/errors.js`, documented in `ERRORS.md`. `scripts/check-errors.sh` enforces this. Never reuse or renumber a code.
- **UI preview** without installing: serve the repo root (`python3 -m http.server 8792`) and open `/tests/ui-harness.html`, which fakes `chrome.*` and the background.
- **Releases:** bump `manifest.json` version + `RELEASE_NOTES.txt`, push to `main`. The GitHub Action builds `updates/`; never edit `updates/` by hand.
