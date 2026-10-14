#!/usr/bin/env bash
# Fails if any TL-### code used in src/ or app/ is missing from ERRORS.md.
set -euo pipefail
cd "$(dirname "$0")/.."
missing=0
for code in $(grep -rhoE 'TL-[0-9]{3}' src app mac/Sources mac/release.sh streamdeck/com.jonpike.timelockdeck.sdPlugin/bin/plugin.js streamdeck/com.jonpike.timelockdeck.sdPlugin/bin/data.js streamdeck/install.sh install.sh | sort -u); do
  if ! grep -q "^| \`$code\`" ERRORS.md; then
    echo "error: $code is used in the code but missing from ERRORS.md" >&2
    missing=1
  fi
done
[ "$missing" = 0 ] && echo "All error codes are documented in ERRORS.md."
exit "$missing"
