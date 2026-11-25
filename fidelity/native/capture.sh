#!/usr/bin/env bash
# Renders fidelity/scenes.json natively and copies the captures and filter dump
# to fidelity/native-captures/. Usage: capture.sh [scene-id]
# The app runs through `open` so macOS asks Screen Recording permission for
# GlassformReference itself, and it works in a stage folder on the Mac disk.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
STAGE="${GLASSFORM_STAGE:-$HOME/Library/Caches/glassform-fidelity}"
native/build.sh
APP="$STAGE/GlassformReference.app"
mkdir -p "$STAGE/out" backgrounds native-captures
rm -rf "$STAGE/out"/* "$STAGE/backgrounds"
"$APP/Contents/MacOS/GlassformReference" --backgrounds "$ROOT/backgrounds" > /dev/null
cp -R backgrounds "$STAGE/backgrounds"
cp scenes.json "$STAGE/scenes.json"
LOG="$STAGE/out/capture-log.txt"
EXTRA=()
if [[ $# -gt 0 ]]; then EXTRA=(--scene "$1"); fi
open -n "$APP" --args --capture --scenes "$STAGE/scenes.json" --backgrounds "$STAGE/backgrounds" --out "$STAGE/out" --log "$LOG" ${EXTRA[@]+"${EXTRA[@]}"}
for _ in $(seq 1 600); do
  if [[ -f "$LOG" ]] && grep -qE '^(done|error:|NEEDS_PERMISSION)' "$LOG"; then break; fi
  sleep 0.5
done
cat "$LOG"
grep -q '^done$' "$LOG"
cp "$STAGE/out"/*.png "$STAGE/out/native-filters.json" "$LOG" native-captures/
echo "copied $(ls "$STAGE/out"/*.png | wc -l | tr -d ' ') captures to native-captures/"
