# TimeLock

A Chrome extension that tracks how long you spend on each website and, once you hit a daily limit, locks you out of the sites you chose for the rest of the day. Your password gets you back in early.

- **Tracks** the site in front of you, only while Chrome is focused. If you step away (no keyboard or mouse for 60 s) it stops counting, unless the tab is playing sound, so videos still count.
- **Limits** cover one or more sites that share one daily budget (e.g. "Social: reddit.com, x.com, instagram.com — 30 min"). Subdomains are included. 0 minutes blocks the sites all day.
- **Locking:** when you run out, every open tab on those sites switches to a lock screen, and new visits are blocked before the page loads. You get a heads-up notification at 5 and 1 minutes left, and a small ticking clock in the top-right corner of every limited site counts down the time you have left (it fades when your mouse comes near; turn it off in Settings). The toolbar badge shows the same.
- **Password:** unlock for 5, 15, 30, 60 minutes or the rest of the day. Wrong guesses trigger a growing cooldown. Making limits stricter never needs the password; loosening them (raising, removing, dropping a site, changing the reset hour) does.
- **The day resets** at midnight, or a later hour you choose (night owls can set 4 AM).
- **Private:** everything stays in Chrome's local storage. The only network request is the update check against this repo.

## Install

1. Download this repo (green **Code** button → Download ZIP) and unzip it somewhere permanent, or `git clone` it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and choose the `TimeLock` folder.
3. Pin TimeLock to the toolbar, open it, and set a password. Then add limits.
4. **Close the loopholes:** in `chrome://extensions` → TimeLock → Details, turn on **Allow in Incognito**, otherwise an incognito window gets around every limit.

Works in Chrome, Brave and Edge (version 120 or newer).

## What it can't stop

It's a speed bump for your own habits, not parental control. Anyone can turn it off in `chrome://extensions` or use another browser. Forgetting the password means removing and re-adding the extension, which wipes your history and limits.

## Updates

TimeLock checks this repo every 6 hours and shows a banner when a new version is out. Download it again (or `git pull`), then click ↻ on TimeLock in `chrome://extensions`. Your limits and history are kept.

## Errors

Every error has a code like `TL-301` and a **Copy Error Details** button. See [ERRORS.md](ERRORS.md).
