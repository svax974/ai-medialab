#!/bin/sh
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

# Prepare hook of the desktop build, called by `scripts/app.sh` and `scripts/bundle.sh` (template, see
# desktop/README.md): builds desktop/build/engine-bundle (embedded Python engine, copied by packaging.extraResources)
# for the target given as $1. Profile per target below, DESKTOP_PROFILE overrides it (e.g. win-rocm, linux-rocm).
# When the bundle already holds the same profile with the same dependencies, only the engine code is refreshed
# (`--refresh-app`, seconds instead of minutes); DESKTOP_CLEAN=1 forces a full rebuild.
set -eu

TARGET="${1:?usage: desktop-prepare.sh <target>}"
case "${TARGET}" in
  darwin-arm64) DEFAULT=mac-arm64 ;;
  win-x64) DEFAULT=win-cuda ;;
  linux-x64) DEFAULT=linux-cuda ;;
  *) echo "desktop-prepare: no engine profile for ${TARGET} (desktop/runtime/profiles.json)" >&2; exit 1 ;;
esac
PROFILE="${DESKTOP_PROFILE:-${DEFAULT}}"

cd "$(dirname "$0")/.."
OUT=desktop/build/engine-bundle
STAMP="${OUT}/.prepared"
# Same profile and same dependency files = the Python runtime can be kept.
KEY="${PROFILE} $(cat engine/pyproject.toml engine/uv.lock desktop/runtime/profiles.json | shasum -a 256 | cut -d' ' -f1)"

if [ "${DESKTOP_CLEAN:-0}" != 1 ] && [ -f "${STAMP}" ] && [ "$(cat "${STAMP}")" = "${KEY}" ]; then
  python3 scripts-local/build_runtime.py --profile "${PROFILE}" --refresh-app
else
  rm -f "${STAMP}"
  python3 scripts-local/build_runtime.py --profile "${PROFILE}"
fi
echo "${KEY}" > "${STAMP}"
