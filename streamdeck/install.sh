#!/bin/bash
# Installs (or updates) the TimeLock Deck plugin and restarts the Stream Deck app.
cd "$(dirname "$0")"
DEST="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.jonpike.timelockdeck.sdPlugin"
fail() {
  echo "Error $1: $2"
  echo "Look up this code on the TimeLock error list: https://github.com/jonpikereally/TimeLock/blob/main/ERRORS.md"
  exit 1
}
[ -d "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins" ] || fail TL-905 "The Stream Deck app isn't installed (no Plugins folder)."
osascript -e 'quit app id "com.elgato.StreamDeck"' 2>/dev/null
sleep 2
rm -rf "$DEST"
cp -R com.jonpike.timelockdeck.sdPlugin "$DEST" || fail TL-906 "Couldn't copy the plugin into Stream Deck's Plugins folder."
open -b com.elgato.StreamDeck || fail TL-907 "The plugin was installed but the Stream Deck app didn't reopen. Open it yourself."
echo "TimeLock Deck installed. Find it in the Stream Deck app under the TimeLock category."
