#!/bin/sh
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

# Builds the macOS .dmg with hdiutil (no AppleScript/Finder, so it works in CI and over SSH).
# Usage: scripts/make_dmg_macos.sh [chemin/vers/AI\ MediaLab.app] [sortie.dmg]
set -eu
cd "$(dirname "$0")/.."
BUNDLE_DIR="desktop/src-tauri/target/release/bundle"
APP="${1:-$BUNDLE_DIR/macos/AI MediaLab.app}"
ARCH="$(uname -m | sed 's/arm64/aarch64/')"
OUT="${2:-$BUNDLE_DIR/dmg/AI MediaLab_0.1.0_${ARCH}.dmg}"
[ -d "$APP" ] || { echo "Application introuvable : $APP (lancez d'abord tauri build)" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cn-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/$(basename "$APP")"      # ditto keeps signature, links and attributes
ln -s /Applications "$STAGE/Applications"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
hdiutil create -volname "AI MediaLab" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=6 -ov "$OUT" >/dev/null
echo "DMG : $OUT ($(du -h "$OUT" | cut -f1))"
