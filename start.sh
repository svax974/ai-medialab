#!/bin/sh
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

# AI MediaLab: installs dependencies if needed, builds the UI and starts the server.
#   ./start.sh              → http://127.0.0.1:8000
#   PORT=9000 ./start.sh
#   IMAGEGEN_DEMO=1 ./start.sh   (adds a GPU-less "Démo" model to try out the UI)
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

command -v uv >/dev/null 2>&1 || { echo "uv est requis : https://docs.astral.sh/uv/" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Node.js/npm est requis." >&2; exit 1; }

echo "› Dépendances Python…"
EXTRAS="--extra torch"
[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] && EXTRAS="--extra mlx --extra torch"
(cd engine && uv sync --quiet $EXTRAS)

echo "› Interface…"
(cd frontend && { [ -d node_modules ] || npm install --silent; } && npm run build --silent >/dev/null)

echo "› AI MediaLab sur http://$HOST:$PORT"
cd engine
exec uv run uvicorn app.main:app --host "$HOST" --port "$PORT" --log-level warning --timeout-graceful-shutdown 3
