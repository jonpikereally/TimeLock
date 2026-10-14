#!/bin/bash
# TimeLock installer for macOS 13+.
#
#   curl -fsSL https://raw.githubusercontent.com/jonpikereally/TimeLock/main/install.sh | bash
#
# 1. Gets the source into ~/TimeLock (git clone, or a zip if git isn't set up).
# 2. Builds TimeLock for Mac from source (needs Apple's Command Line Tools;
#    falls back to the prebuilt app), installs it to ~/Applications and opens it.
#    On launch it registers itself with Chrome, Brave, Edge, Chromium and Vivaldi.
# 3. Offers to install the Stream Deck plugin if the Stream Deck app is installed.
# 4. Tells you how to load the browser extension (browsers don't let scripts do that).
#
# Safe to run again: it updates what's there. Every error has a TL-8xx code
# from https://github.com/jonpikereally/TimeLock/blob/main/ERRORS.md
#
# For testing: TIMELOCK_DIR, TIMELOCK_APPS_DIR, TIMELOCK_YES=1 (accept defaults),
# TIMELOCK_NO_OPEN=1 (don't launch anything), TIMELOCK_PREBUILT=1 (skip building).

set -u
REPO="jonpikereally/TimeLock"
REPO_URL="https://github.com/$REPO"
ERRLIST="$REPO_URL/blob/main/ERRORS.md"
DIR="${TIMELOCK_DIR:-$HOME/TimeLock}"
APPS="${TIMELOCK_APPS_DIR:-$HOME/Applications}"
STREAMDECK_PLUGINS="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
step() { echo; bold "▸ $1"; }
fail() {
  echo
  echo "Error $1: $2"
  echo "Look up this code on the TimeLock error list: $ERRLIST"
  echo "(Paste this output and that link into Claude and it can help you fix it.)"
  exit 1
}
# Questions read from the keyboard even when the script itself is piped in.
ask() {
  local question="$1" default="$2" answer=""
  if [ -n "${TIMELOCK_YES:-}" ] || [ ! -r /dev/tty ]; then REPLY="$default"; echo "$question [$default] $default"; return; fi
  read -r -p "$question [$default] " answer </dev/tty || answer=""
  REPLY="${answer:-$default}"
}
have_clt() { xcode-select -p >/dev/null 2>&1 && command -v swiftc >/dev/null 2>&1; }

bold "TimeLock installer"
echo "Tracks your time on websites and Mac apps, with daily limits and goals."

# ---------------------------------------------------------------- checks
[ "$(uname)" = "Darwin" ] || fail TL-811 "This installer only runs on macOS."
os=$(sw_vers -productVersion)
[ "${os%%.*}" -ge 13 ] || fail TL-811 "TimeLock needs macOS 13 or newer; this Mac has $os."

# ---------------------------------------------------------------- 1. source
step "1/4  Getting TimeLock into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only || fail TL-812 "Couldn't update $DIR with git pull. If you changed files there, move them aside and run this again."
elif [ -f "$DIR/manifest.json" ]; then
  echo "Using the copy already in $DIR (not a git checkout, so it isn't updated)."
elif have_clt; then
  git clone --depth 1 "$REPO_URL.git" "$DIR" || fail TL-812 "Couldn't download TimeLock from $REPO_URL. Check your internet connection."
else
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/timelock.XXXXXX")
  curl -fsSL "$REPO_URL/archive/refs/heads/main.zip" -o "$tmp/src.zip" \
    && ditto -x -k "$tmp/src.zip" "$tmp" && mkdir -p "$(dirname "$DIR")" && mv "$tmp/TimeLock-main" "$DIR" \
    || fail TL-812 "Couldn't download TimeLock from $REPO_URL. Check your internet connection."
fi
version=$(tr -d '[:space:]' < "$DIR/VERSION" 2>/dev/null || echo "?")
echo "TimeLock $version is in $DIR. Keep this folder: the browser extension runs from it."

# ---------------------------------------------------------------- 2. Mac app
step "2/4  TimeLock for Mac"
app_src=""
if [ -z "${TIMELOCK_PREBUILT:-}" ] && have_clt; then
  echo "Building it from source with Apple's Command Line Tools (takes a minute)…"
  if (cd "$DIR/mac" && ./build.sh 2>&1 | grep -v xcrun_db); then
    app_src="$DIR/mac/TimeLock.app"
  else
    fail TL-813 "Building TimeLock for Mac failed. Run 'cd \"$DIR/mac\" && ./build.sh' to see the full error."
  fi
else
  [ -z "${TIMELOCK_PREBUILT:-}" ] && echo "Apple's Command Line Tools aren't installed, so using the prebuilt app. (To build it yourself instead: run 'xcode-select --install', then this installer again.)"
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/timelock.XXXXXX")
  curl -fsSL "$REPO_URL/raw/main/updates/mac/TimeLock-Mac.zip" -o "$tmp/mac.zip" && ditto -x -k "$tmp/mac.zip" "$tmp" \
    || fail TL-814 "Couldn't download the prebuilt TimeLock for Mac."
  app_src="$tmp/TimeLock/TimeLock.app"
fi
[ -x "$app_src/Contents/MacOS/TimeLock" ] || fail TL-814 "The TimeLock app is missing or damaged at $app_src."

mkdir -p "$APPS" || fail TL-815 "Couldn't create $APPS."
[ -z "${TIMELOCK_NO_OPEN:-}" ] && osascript -e 'quit app id "com.jonpike.timelock"' >/dev/null 2>&1 && sleep 1
rm -rf "$APPS/TimeLock.app"
ditto --norsrc "$app_src" "$APPS/TimeLock.app" || fail TL-815 "Couldn't copy TimeLock into $APPS."
xattr -dr com.apple.quarantine "$APPS/TimeLock.app" 2>/dev/null
codesign --force --sign - "$APPS/TimeLock.app" >/dev/null 2>&1 || fail TL-815 "Couldn't sign TimeLock for this Mac."
echo "Installed $APPS/TimeLock.app"
if [ -z "${TIMELOCK_NO_OPEN:-}" ]; then
  open "$APPS/TimeLock.app" || fail TL-815 "TimeLock was installed but didn't open. Open it yourself from $APPS."
  echo "Opened it: look for the hourglass in your menu bar. It needs no permissions."
fi

# ---------------------------------------------------------------- 3. Stream Deck
step "3/4  Stream Deck plugin (optional)"
if [ -d "$STREAMDECK_PLUGINS" ]; then
  ask "Stream Deck found. Install the TimeLock Deck plugin? (y/n)" "y"
  case "$REPLY" in
    [yY]*)
      if [ -n "${TIMELOCK_NO_OPEN:-}" ]; then echo "(skipped: TIMELOCK_NO_OPEN is set)"
      else "$DIR/streamdeck/install.sh" || fail TL-816 "The Stream Deck plugin didn't install (see the message above)."; fi ;;
    *) echo "Skipped. Install it later with: \"$DIR/streamdeck/install.sh\"" ;;
  esac
else
  echo "No Stream Deck app found, skipping."
fi

# ---------------------------------------------------------------- 4. extension
step "4/4  The browser extension (you do this part)"
cat <<EOF
Browsers only let you add an unpacked extension by hand:

  1. Open chrome://extensions  (Brave: brave://extensions, Edge: edge://extensions)
  2. Turn on "Developer mode" (top right).
  3. Click "Load unpacked" and choose this folder:
       $DIR
  4. Pin TimeLock to the toolbar, open it and set a password.
  5. TimeLock → Details → turn on "Allow in Incognito", or incognito windows
     get around your limits.
  6. Back in the popup: Settings → "Mac app" should say Connected.
     Then click the hourglass in the menu bar: it opens this popup.

Updating later:  cd "$DIR" && git pull   (then click ↻ on TimeLock in the
extensions page). TimeLock for Mac updates itself: right-click the hourglass →
Check for Updates.
EOF
[ -z "${TIMELOCK_NO_OPEN:-}" ] && open "$DIR" 2>/dev/null
echo
bold "Done. TimeLock $version is set up."
