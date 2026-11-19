#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Screenshots and rendered-HTML snapshots of the /l2 pages from a running
# preview (scripts/l2-explorer-preview.mjs). Usage:
#   scripts/l2-explorer-snapshot.sh http://127.0.0.1:19160 OUTDIR /l2 /l2/block/214 ...
set -euo pipefail
base=$1; out=$2; shift 2
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
mkdir -p "$out"
for path in "$@"; do
  name=$(printf '%s' "$path" | tr '/' '_' | sed 's/^_//' | cut -c1-60)
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1400,2400 \
    --virtual-time-budget=20000 --screenshot="$out/$name.png" "$base$path" >/dev/null 2>&1
  "$chrome" --headless=new --disable-gpu --virtual-time-budget=20000 --dump-dom "$base$path" 2>/dev/null > "$out/$name.html"
  echo "$path -> $out/$name.png, $out/$name.html"
done
