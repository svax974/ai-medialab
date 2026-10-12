#!/bin/sh
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

# Dev mode: backend with auto-reload (port 8000) + Vite with HMR (port 5173).
set -eu
cd "$(dirname "$0")"
EXTRAS="--extra torch"
[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] && EXTRAS="--extra mlx --extra torch"
(cd backend && uv sync --quiet $EXTRAS)
(cd frontend && { [ -d node_modules ] || npm install --silent; })
trap 'kill 0' INT TERM EXIT
(cd backend && uv run uvicorn app.main:app --port 8000 --reload --reload-dir app --timeout-graceful-shutdown 3) &
(cd frontend && npm run dev) &
wait
