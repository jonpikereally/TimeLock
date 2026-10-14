#!/usr/bin/env bash
# Fails unless the extension, Mac app and Stream Deck plugin all carry the
# version in VERSION. Run by both release builds; fix with scripts/set-version.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(tr -d '[:space:]' < VERSION)
ext=$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')
mac=$(tr -d '[:space:]' < mac/VERSION)
deck=$(python3 -c 'import json;print(json.load(open("streamdeck/com.jonpike.timelockdeck.sdPlugin/manifest.json"))["Version"])')
bad=0
[ "$ext" = "$v" ] || { echo "error: extension manifest.json is $ext, VERSION is $v" >&2; bad=1; }
[ "$mac" = "$v" ] || { echo "error: mac/VERSION is $mac, VERSION is $v" >&2; bad=1; }
[ "$deck" = "$v.0" ] || { echo "error: Stream Deck manifest is $deck, expected $v.0" >&2; bad=1; }
[ "$bad" = 0 ] && echo "All three parts are at version $v."
exit "$bad"
