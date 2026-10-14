# TimeLock Deck

Stream Deck plugin for TimeLock. Adds a **TimeLock** category:

| Action | Shows |
|---|---|
| **Limit** (key) | A ring for one daily limit: time left in the middle, orange in the last 5 minutes, red with a lock when locked, green with a countdown while unlocked. Press to switch between time left and time used. |
| **Limits Dial** (Stream Deck +) | The same on the touch strip with a coloured bar. Turn to step through your limits, press or tap to switch left / used. |
| **Time Today** | Today's time in one Mac app or on one website. Green while that app is the one being counted. |
| **Screen Time Today** | Total time on your Mac or in the browser today. Press to switch. |
| **Now Counting** | What TimeLock for Mac is counting right now, media playing in the background (♪), or Away / Screen locked. |

Every key and the dial have a **Time format** setting: Automatic, `1h 05m`, `1:05:23`, `65 min` or `1.1 h`.

It's read-only: it never changes limits or time.

## How it works

No server. `bin/data.js` reads TimeLock's shared folder, `~/Library/Application Support/TimeLock`, once a second: `status.json` (written every 2 s by TimeLock for Mac 1.2+), `browser.json` (the extension's sites and limits, synced through the Mac app every ~30 s) and `apps/<day>.json`. Limit totals are recomputed from those, so app time is live. `bin/render.js` draws each key as an SVG. `ws` is vendored in `bin/node_modules`; no build step.

Problems show on the key with their code (`TL-901` Mac app not running, `TL-902` no browser data, `TL-903` unreadable data, `TL-904` limit gone), and in the key's settings with Copy Error Details. See [ERRORS.md](../ERRORS.md).

## Install

```bash
./install.sh
```

## Test

```bash
node tools/test.js          # unit tests + a fake Stream Deck against sample data
node tools/test.js --live   # the fake Stream Deck against your real TimeLock data
```

Both write the key images they drew to `$TMPDIR/timelockdeck-keys.html`.
