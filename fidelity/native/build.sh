#!/usr/bin/env bash
# Builds GlassformReference.app (macOS 26+, Command Line Tools are enough) into
# ~/Library/Caches/glassform-fidelity, on the Mac disk: macOS asks apps for
# separate permission to touch removable drives, and a fixed path keeps the
# Screen Recording grant. Rebuilding changes the ad-hoc signature, so macOS may
# ask again; the build is skipped when sources are unchanged.
set -euo pipefail
cd "$(dirname "$0")"
STAGE="${GLASSFORM_STAGE:-$HOME/Library/Caches/glassform-fidelity}"
APP="$STAGE/GlassformReference.app"
SUM=$(shasum Sources/*.swift Info.plist | shasum | cut -c1-12)
if [[ -f "$APP/Contents/.srchash" && "$(cat "$APP/Contents/.srchash")" == "$SUM" ]]; then
  echo "up to date: $APP"; exit 0
fi
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O -o "$APP/Contents/MacOS/GlassformReference" Sources/main.swift
codesign --force --sign - "$APP"
echo "$SUM" > "$APP/Contents/.srchash"
echo "built: $APP"
