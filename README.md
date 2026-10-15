# TimeLock

A Chrome extension that tracks how long you spend on each website and, once you hit a daily limit, locks you out of the sites you chose for the rest of the day. Your password gets you back in early.

The optional **TimeLock for Mac** menu bar app tracks your time in Mac apps too. The two are connected: app time shows in the extension, a limit can mix sites and apps ("Social: x.com, reddit.com and the Discord app, 30 min shared"), and the menu bar shows your website time and limits. Apps are only tracked, never locked: when a shared limit runs out, its websites lock.

- **Tracks** the site in front of you, only while Chrome is focused. If you step away (no keyboard or mouse for 60 s) it stops counting, unless a video or audio is playing in that tab (muted videos included), so watching still counts. The on-page clock pauses at the same moment.
- **Limits** cover one or more sites that share one daily budget (e.g. "Social: reddit.com, x.com, instagram.com — 30 min"). Subdomains are included. 0 minutes blocks the sites all day.
- **Locking:** when you run out, every open tab on those sites switches to a lock screen, and new visits are blocked before the page loads. You get a heads-up notification at 5 and 1 minutes left, and on the sites you pick, a small ticking clock in the corner of the page counts down the time you have left, or counts up your time today on sites with no limit (click **Show timer** next to a site in the popup; drag it anywhere, each site remembers the spot, and double-click resets it). The toolbar badge shows the same.
- **Password:** unlock for 5, 15, 30, 60 minutes or the rest of the day. Wrong guesses trigger a growing cooldown. Making limits stricter never needs the password; loosening them (raising, removing, dropping a site, changing the reset hour) does.
- **Goals:** a daily minimum and/or maximum for any app or website (Settings → Goals), e.g. "at least 1h of Logic Pro" or "at most 30m of youtube.com". Times turn blue below the minimum, green once it's met, amber at 75% of the maximum and red past it, in the popup, the on-page clock, the Mac menu and on Stream Deck keys. Goals never lock anything and don't need the password.
- **The day resets** at midnight, or a later hour you choose (night owls can set 4 AM).
- **Private:** everything stays in Chrome's local storage. The only network request is the update check against this repo.

## Install

**Quickest:** `curl -fsSL https://raw.githubusercontent.com/jonpikereally/TimeLock/main/install.sh | bash` sets up the Mac app (built from source), the Stream Deck plugin and the folder for the extension. To set it up with Claude's help, see [BUILD-WITH-CLAUDE.md](BUILD-WITH-CLAUDE.md).

By hand:

1. Download this repo (green **Code** button → Download ZIP) and unzip it somewhere permanent, or `git clone` it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and choose the `TimeLock` folder.
3. Pin TimeLock to the toolbar, open it, and set a password. Then add limits.
4. **Close the loopholes:** in `chrome://extensions` → TimeLock → Details, turn on **Allow in Incognito**, otherwise an incognito window gets around every limit.

Works in Chrome, Brave and Edge (version 120 or newer).

## TimeLock for Mac

1. Download [TimeLock-Mac.zip](https://github.com/jonpikereally/TimeLock/raw/main/updates/mac/TimeLock-Mac.zip), unzip it, and double-click **Install TimeLock.command** (if macOS blocks it: right-click → Open → Open).
2. Look for the hourglass in the menu bar. It needs no permissions and turns on Open at Login (switch that off in its menu).
3. Reload the extension in `chrome://extensions` once. Its Settings → **Mac app** card should say *Connected*.

Click the hourglass for today's apps, sites and limits; its **Open TimeLock in the Browser** item opens the extension's popup (the browser comes forward, launching if needed).

It counts the app in front, pauses after a minute with no mouse or keyboard input unless that app is playing media, and stops while the screen is locked. Media players (VLC, Spotify, QuickTime, Music, Podcasts, TV, IINA and more) also count while they play in the background, marked ♪ in the menu. Playback is detected from the player's own macOS power assertions (keep the display awake for video, keep the Mac awake for sound), which players hold only while actually playing, so no permission is needed. Audio software that keeps sound running all day (DAWs, audio-interface apps) only counts when it's in front and you're using it. Data stays in `~/Library/Application Support/TimeLock`. It updates itself from this repo ("Check for Updates…" in its menu).

**How they talk:** the app registers itself with Chrome, Brave, Edge, Chromium and Vivaldi as a [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) host. Every 30 seconds the browser runs it briefly to swap today's numbers. Nothing listens on the network.

## Stream Deck

**TimeLock Deck** (in [`streamdeck/`](streamdeck/)) puts your limits, screen time and what's counting right now on Stream Deck keys, with a limits dial for the Stream Deck +. Install with `streamdeck/install.sh`. It reads TimeLock for Mac's data, so it needs the Mac app (1.2 or newer).

## What it can't stop

It's a speed bump for your own habits, not parental control. Anyone can turn it off in `chrome://extensions` or use another browser. Forgetting the password means removing and re-adding the extension, which wipes your history and limits.

## Updates

TimeLock checks this repo every 6 hours and shows a banner when a new version is out. Download it again (or `git pull`), then click ↻ on TimeLock in `chrome://extensions`. Your limits and history are kept.

## Errors

Every error has a code like `TL-301` and a **Copy Error Details** button. See [ERRORS.md](ERRORS.md).
