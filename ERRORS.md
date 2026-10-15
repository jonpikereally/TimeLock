# TimeLock error codes

Every problem TimeLock can show you has a code like `TL-301`. Find yours below.

**Getting help from an AI assistant:** click **Copy Error Details** on the error, then paste it into ChatGPT, Claude or similar along with a link to this page. For a plain-text copy that's easy for AI assistants to read, use https://raw.githubusercontent.com/jonpikereally/TimeLock/main/ERRORS.md

Codes are grouped: `1xx` extension updates, `2xx` time tracking, `3xx` blocking, `4xx` password, `5xx` limits and settings, `6xx` the Mac app and its connection to the extension, `7xx` Mac app updates, `8xx` the Mac installer, `9xx` the Stream Deck plugin, `999` anything else. Codes are never reused or renumbered.

| Code | What happened | What to try |
|---|---|---|
| `TL-101` | TimeLock couldn't reach the update feed. | Check your internet connection. If you set a custom Update source in Settings, make sure the URL is right, or clear it. |
| `TL-102` | The update feed answered, but not with a valid `latest.json`. | Clear the Update source in Settings to go back to the built-in GitHub feed. If you're already on it, open an issue. |
| `TL-103` | TimeLock's files were updated, but the part running in the background is still the old version, so it didn't understand a request from the new popup or page. | Open `chrome://extensions` (`brave://extensions` in Brave) and click ↻ on TimeLock. Then refresh open tabs and reopen the popup. |
| `TL-201` | Saving the time you spent on a site failed, usually because the disk is full. | Free some disk space. If it keeps happening, copy the details and open an issue. |
| `TL-202` | TimeLock couldn't read its saved time or settings. | Restart Chrome. If it persists, copy the details and open an issue. |
| `TL-203` | The countdown clock in the corner of a limited site couldn't get its time from TimeLock. Tracking and locking are unaffected. | Reload the page. If it keeps happening, copy the details and open an issue. |
| `TL-204` | Saving the spot you dragged the countdown clock to failed, so it will go back to its old place next time. | Drag it again. If it keeps forgetting, copy the details and open an issue. |
| `TL-205` | A `restore.json` file was found in the extension folder but couldn't be merged in. Your current data wasn't changed. | Copy the details and ask for help. Deleting `restore.json` stops the message. |
| `TL-301` | Chrome refused the rule that blocks a locked site. Locked sites may still open until this is fixed. | Restart Chrome. If it persists, copy the details and open an issue. |
| `TL-302` | A tab that was already open on a locked site couldn't be switched to the lock screen. | Close that tab yourself. New visits to the site are still blocked. |
| `TL-401` | The password typed on the lock screen or in Settings was wrong. | Try again. After 3 wrong tries you have to wait before trying again. |
| `TL-402` | Too many wrong passwords in a row, so TimeLock is making you wait (30 s, doubling each time, up to 10 min). | Wait for the countdown, then try again. |
| `TL-403` | The new password was shorter than 4 characters, or the two boxes didn't match. | Type a password of at least 4 characters the same way in both boxes. |
| `TL-404` | Checking the password failed inside Chrome's crypto library. | Restart Chrome and try again. If it persists, copy the details and open an issue. |
| `TL-405` | You tried to add a limit before setting a password. | Open ⚙︎ Settings in the popup and set a password first. |
| `TL-501` | A limit has a site that isn't a valid domain, or no sites at all. | Type plain domains like `youtube.com, reddit.com`. Subdomains are covered automatically. |
| `TL-502` | A limit's minutes aren't a whole number between 0 and 1440. | Fix the number. 0 means the sites are blocked all day. |
| `TL-503` | Saving settings failed. | Try again. If it repeats, copy the details and open an issue. |
| `TL-504` | A goal's app or website isn't valid (a website must be a domain like `youtube.com`; an app must have a name). | Fix the name in Settings → Goals. App names must match exactly how TimeLock lists them. |
| `TL-505` | A goal's minutes aren't valid: not whole minutes between 0 and 1440, neither a minimum nor a maximum set, or a minimum bigger than the maximum. | Fix the minutes in Settings → Goals. |
| `TL-601` | The extension found the TimeLock Mac app but the connection failed, so app time isn't counted right now. | Open TimeLock from ~/Applications once (it re-registers its connection with your browsers on every launch), then click **Check connection** in the extension's Settings. If you moved the app, open it from its new place. |
| `TL-602` | **Mac app:** couldn't register itself with your browsers, so the extension can't reach it. | Check that `~/Library/Application Support` is writable, then quit and reopen TimeLock from the menu bar. In the extension, click **Check connection** in Settings. |
| `TL-603` | **Mac app:** couldn't create its data folder (`~/Library/Application Support/TimeLock`), so app time can't be saved. | Check that your disk isn't full and that folder is writable, then reopen TimeLock. |
| `TL-604` | **Mac app:** saving tracked time (or the extension's latest data) failed. | Check that your disk isn't full and that `~/Library/Application Support/TimeLock` is writable. |
| `TL-605` | **Mac app:** today's saved app time couldn't be read, so it started from zero. The unreadable file was kept with "damaged" in its name. | Nothing to do; tracking continues. If it keeps happening, copy the details and open an issue. |
| `TL-606` | **Mac app:** turning Open at Login on or off failed. | Add or remove TimeLock yourself in System Settings → General → Login Items. |
| `TL-607` | **Mac app:** the extension sent the Mac app something it couldn't handle, usually because one of them is out of date. | Update both to the latest version, then reload the extension. |
| `TL-608` | **Mac app:** **Open TimeLock in the Browser** couldn't open the TimeLock popup: the browser extension didn't answer within 15 seconds. | Make sure the browser is open and the TimeLock extension is enabled and on 2.3.0 or newer (reload it in the extensions page), then try again. |
| `TL-701` | **Mac app update:** no update source is set. | Use **Update Source…** in the menu, or leave it empty for the built-in source. |
| `TL-702` | **Mac app update:** the update source isn't a web link or a file path. | Fix it in **Update Source…**, or clear it. |
| `TL-703` | **Mac app update:** couldn't reach the update source. | Check your internet connection and try again. |
| `TL-704` | **Mac app update:** the update server returned an error. | Try again in a few minutes, or download the latest version from GitHub. |
| `TL-705` | **Mac app update:** the update information is damaged or in the wrong format. | Download the latest version from GitHub instead. |
| `TL-706` | **Mac app update:** downloading the update failed. | Try again in a few minutes, or download it from GitHub. |
| `TL-707` | **Mac app update:** unpacking the downloaded update failed. | Download the latest version from GitHub instead. |
| `TL-708` | **Mac app update:** the download doesn't contain TimeLock. | Download the latest version from GitHub instead. |
| `TL-709` | **Mac app update:** the download is a different app. | Download the latest version from GitHub instead. |
| `TL-710` | **Mac app update:** the downloaded app is damaged. | Download the latest version from GitHub instead. |
| `TL-711` | **Mac app update:** couldn't start installing the update. | Make sure TimeLock is in `~/Applications` and the folder isn't locked, then try again. |
| `TL-712` | **Mac app update:** installing failed, so the previous version was put back. | Make sure TimeLock is in `~/Applications` and the folder isn't locked, then try again. |
| `TL-801` | **Mac installer:** couldn't copy TimeLock into `~/Applications`. | Check that `~/Applications` exists and is writable, then run **Install TimeLock.command** again. |
| `TL-802` | **Mac installer:** couldn't sign TimeLock for this Mac. | Run the installer again. If it repeats, copy the Terminal output and open an issue. |
| `TL-803` | **Mac installer:** TimeLock was installed but didn't open. | Open it yourself from `~/Applications`. |
| `TL-811` | **Installer (`install.sh`):** this isn't a Mac, or macOS is older than 13. | TimeLock for Mac needs macOS 13 Ventura or newer. The browser extension alone works anywhere: download the repo and load it unpacked. |
| `TL-812` | **Installer:** couldn't download or update the TimeLock source. | Check your internet connection. If `~/TimeLock` has your own changes, move them aside and run the installer again. |
| `TL-813` | **Installer:** building TimeLock for Mac from source failed. | Run `cd ~/TimeLock/mac && ./build.sh` to see the compiler's error. Updating Apple's Command Line Tools (`xcode-select --install`) usually fixes it; or run the installer with `TIMELOCK_PREBUILT=1` to use the prebuilt app. |
| `TL-814` | **Installer:** couldn't download the prebuilt TimeLock for Mac, or it was damaged. | Check your internet connection and run the installer again. |
| `TL-815` | **Installer:** couldn't copy, sign or open TimeLock in `~/Applications`. | Check that `~/Applications` exists and is writable, quit TimeLock if it's running, and run the installer again. |
| `TL-816` | **Installer:** the Stream Deck plugin step failed (its own message is printed above). | Look up the TL-90x code it printed, or run `~/TimeLock/streamdeck/install.sh` on its own. |
| `TL-901` | **Stream Deck:** TimeLock for Mac isn't running (or isn't installed, or is older than v1.2.0, which is when it started sharing live status), so app time can't be shown. | Press the key to open TimeLock. If it's already running, use its **Check for Updates…**. Not installed? See the README. |
| `TL-902` | **Stream Deck:** there's no data from the TimeLock browser extension for today, so limits and website time can't be shown. | Open your browser with the TimeLock extension installed and the Mac app running; they sync every 30 seconds. |
| `TL-903` | **Stream Deck:** one of TimeLock's data files in `~/Library/Application Support/TimeLock` couldn't be read. | Quit and reopen TimeLock for Mac. If it keeps happening, copy the details and open an issue. |
| `TL-904` | **Stream Deck:** the limit chosen for this key was renamed or deleted in the extension. | Pick a limit again in the key's settings. |
| `TL-905` | **Stream Deck installer:** the Stream Deck app isn't installed. | Install the Stream Deck app from Elgato, open it once, then run `streamdeck/install.sh` again. |
| `TL-906` | **Stream Deck installer:** copying the plugin into Stream Deck's Plugins folder failed. | Quit the Stream Deck app and run `streamdeck/install.sh` again. |
| `TL-907` | **Stream Deck installer:** the plugin was installed but the Stream Deck app didn't reopen. | Open the Stream Deck app yourself. |
| `TL-908` | **Stream Deck:** TimeLock for Mac is running, but it's older than v1.2.0 and doesn't share live status yet. | Click the hourglass in the menu bar → **Check for Updates…** → Install and Relaunch. |
| `TL-999` | Something unexpected went wrong. | Copy the details and paste them into an AI assistant with a link to this page, or open an issue. |

Forgot your password? It can't be recovered (only a hash is stored). Remove TimeLock in `chrome://extensions` and add it again; your time history and limits are lost.
