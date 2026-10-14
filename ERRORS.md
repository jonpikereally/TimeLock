# TimeLock error codes

Every problem TimeLock can show you has a code like `TL-301`. Find yours below.

**Getting help from an AI assistant:** click **Copy Error Details** on the error, then paste it into ChatGPT, Claude or similar along with a link to this page. For a plain-text copy that's easy for AI assistants to read, use https://raw.githubusercontent.com/jonpikereally/TimeLock/main/ERRORS.md

Codes are grouped: `1xx` updates, `2xx` time tracking, `3xx` blocking, `4xx` password, `5xx` limits and settings, `999` anything else. Codes are never reused or renumbered.

| Code | What happened | What to try |
|---|---|---|
| `TL-101` | TimeLock couldn't reach the update feed. | Check your internet connection. If you set a custom Update source in Settings, make sure the URL is right, or clear it. |
| `TL-102` | The update feed answered, but not with a valid `latest.json`. | Clear the Update source in Settings to go back to the built-in GitHub feed. If you're already on it, open an issue. |
| `TL-201` | Saving the time you spent on a site failed, usually because the disk is full. | Free some disk space. If it keeps happening, copy the details and open an issue. |
| `TL-202` | TimeLock couldn't read its saved time or settings. | Restart Chrome. If it persists, copy the details and open an issue. |
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
| `TL-999` | Something unexpected went wrong. | Copy the details and paste them into an AI assistant with a link to this page, or open an issue. |

Forgot your password? It can't be recovered (only a hash is stored). Remove TimeLock in `chrome://extensions` and add it again; your time history and limits are lost.
