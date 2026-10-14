# TimeLock: set it up on your Mac (with Claude)

TimeLock tracks how long you spend on websites and in Mac apps, and helps you stay in charge of it:

- **Daily limits** for websites (and app time counts toward them). When a limit runs out, those sites lock for the rest of the day unless you type your password.
- **Goals:** a daily minimum and/or maximum for any app or site. Timers turn blue below your minimum, green once it's met, amber near your maximum and red past it.
- **A ticking clock** in the corner of any site you choose, a menu bar hourglass that shows your day, and an optional **Stream Deck** plugin.

It's free, has no accounts, and everything stays on your Mac. The only thing it fetches from the internet is a small file to check for updates.

It has three parts that share one version number:

| Part | What it is | Where it lives |
|---|---|---|
| Browser extension | Tracks websites, limits, lock screen, popup | A folder you keep, e.g. `~/TimeLock` (Chrome, Brave, Edge, Vivaldi) |
| TimeLock for Mac | Menu bar hourglass: tracks apps, talks to the extension | `~/Applications/TimeLock.app` |
| TimeLock Deck | Stream Deck plugin (optional) | Stream Deck's plugins folder |

**You need:** macOS 13 or newer and a Chromium browser (Chrome, Brave, Edge, Vivaldi). A Stream Deck is optional.

---

## Option A: one command (about 2 minutes)

Paste this into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/jonpikereally/TimeLock/main/install.sh | bash
```

It downloads TimeLock to `~/TimeLock` and builds the Mac app from source. If Apple's free Command Line Tools aren't installed, it uses the ready-made app instead. Then it installs and opens the app and offers the Stream Deck plugin if you have one.

The last step is yours, because browsers don't let scripts add extensions:

1. Open `chrome://extensions` (`brave://extensions` in Brave).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `~/TimeLock` folder.
4. Pin TimeLock to the toolbar, open it and **set a password**. Pick one that's annoying to type, or have someone else set it.
5. In the extension's **Details**, turn on **Allow in Incognito**. Otherwise incognito windows get around your limits.
6. In the popup, go to ⚙︎ Settings → **Mac app**. It should say *Connected*. Click the hourglass in your menu bar: it opens the popup.

## Option B: have Claude build it with you

If you'd rather Claude do it (and explain each step), open **Claude Code** in a terminal (`claude`) and paste this prompt:

> Set up TimeLock on this Mac from source: https://github.com/jonpikereally/TimeLock
>
> 1. Read `README.md`, `AGENTS.md` and `ERRORS.md` in the repo first.
> 2. Clone it to `~/TimeLock` (or `git pull` if it's already there). This folder must stay put: the browser extension runs from it.
> 3. Check Apple's Command Line Tools with `xcode-select -p`. If they're missing, ask me to run `xcode-select --install` and wait for me.
> 4. Run the tests: `node tests/core.test.mjs` and `node streamdeck/tools/test.js` (needs Node 18+; skip the second if there's no Node).
> 5. Build the Mac app with `cd mac && ./build.sh`, copy `mac/TimeLock.app` to `~/Applications` (replace any old copy, after quitting it), run `codesign --force --sign - ~/Applications/TimeLock.app`, and open it. Check `~/Library/Application Support/<my browser>/NativeMessagingHosts/com.jonpike.timelock.json` now exists and points at the app.
> 6. If I have the Stream Deck app, offer to run `streamdeck/install.sh`.
> 7. Then walk me through loading the extension unpacked (Developer mode → Load unpacked → `~/TimeLock`), setting a password, turning on Allow in Incognito, and checking that Settings → Mac app says Connected.
>
> Don't change `"key"` in `manifest.json` or `BrowserLink.extensionID` in the Mac app: they fix the extension's ID, which is how the Mac app recognises it. If anything fails, look up its TL-### code in `ERRORS.md`.

(The prompt above does the same as Option A, step by step, with Claude reading the code as it goes.)

## Using it

- **Limits:** popup → ⚙︎ Settings → Limits. A limit can mix websites and Mac apps, e.g. "Social: x.com, reddit.com and Discord, 30 min". 0 minutes blocks the sites all day. Apps are only counted, never locked.
- **Making limits stricter** never needs the password. **Loosening** them (raising, removing, or dropping a site) does.
- **Goals:** ⚙︎ Settings → Goals. Give any app or site a minimum, a maximum, or both. Goals never lock anything.
- **The on-page clock:** click **Show timer** next to a site in the popup. Drag the clock anywhere; double-click it to reset its position.
- **Menu bar hourglass:** click it to open the popup; right-click it for today's apps, sites and limits.
- **It pauses** after a minute without mouse or keyboard input, unless a video or music player is playing. It also stops when the browser isn't the app in front, and when the screen is locked.

## Updating

- **Extension:** `cd ~/TimeLock && git pull`, then click ↻ on TimeLock in the extensions page. The popup shows a banner when an update is out.
- **Mac app:** right-click the hourglass → **Check for Updates…**. It updates itself.
- **Stream Deck plugin:** after `git pull`, run `~/TimeLock/streamdeck/install.sh`.
- Running the one-command installer again also updates everything.

## If something goes wrong

Every error shows a code like `TL-601` and a **Copy Error Details** button. Paste the details, plus a link to the error list, into Claude:
https://github.com/jonpikereally/TimeLock/blob/main/ERRORS.md
(a plain-text version for AI assistants: https://raw.githubusercontent.com/jonpikereally/TimeLock/main/ERRORS.md)

Common ones:

| Code | Meaning |
|---|---|
| `TL-601` | The extension can't reach the Mac app. Open TimeLock from `~/Applications` once (it re-registers with your browsers), then click **Check connection** in Settings. |
| `TL-608` | Clicking the hourglass couldn't open the popup. Make sure the browser is open and the extension is loaded. |
| `TL-901` | The Stream Deck keys can't find the Mac app. Open TimeLock. |
| `TL-81x` | Installer problems; each one says what to try. |

**Forgot your password?** It can't be recovered, because only a scrambled version is stored. Remove the extension and load it again; your limits and history start fresh.

**What it can't stop:** anyone can switch it off in the extensions page or use another browser. It's a speed bump for your own habits, not parental controls.

**To remove it:**
- Remove the extension in the extensions page.
- Quit TimeLock and delete `~/Applications/TimeLock.app` and `~/Library/Application Support/TimeLock`.
- Delete `~/TimeLock`.
