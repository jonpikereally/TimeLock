#!/usr/bin/env bash
# Sets one version for all three parts of TimeLock, which always ship in step:
#   VERSION (the source of truth), manifest.json (extension),
#   mac/VERSION (Mac app), streamdeck/…/manifest.json (Stream Deck, as X.Y.Z.0).
# Usage: scripts/set-version.sh 2.3.0
set -euo pipefail
cd "$(dirname "$0")/.."
v="${1:-}"
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 X.Y.Z" >&2; exit 1; }
echo "$v" > VERSION
echo "$v" > mac/VERSION
python3 - "$v" <<'PY'
import json, re, sys
v = sys.argv[1]
for path, value in [("manifest.json", v), ("streamdeck/com.jonpike.timelockdeck.sdPlugin/manifest.json", v + ".0")]:
    s = open(path).read()
    key = '"version"' if path == "manifest.json" else '"Version"'
    s, n = re.subn(key + r'\s*:\s*"[^"]*"', f'{key}: "{value}"', s, count=1)
    assert n == 1, path
    json.loads(s)
    open(path, "w").write(s)
PY
scripts/check-versions.sh
