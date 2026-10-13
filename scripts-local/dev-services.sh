#!/bin/sh
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

# Extra dev service of ai-medialab, started by `scripts/run.sh dev` (hook of the template, see front/.libs/apptemplate/README.md):
# the Python engine (engine/, FastAPI) that Nest talks to. Runs with back/.env.dev already loaded:
#   ENGINE_TOKEN   shared secret (required; generate with `openssl rand -hex 32`, same value for Nest)
#   ENGINE_PORT    port on 127.0.0.1 (default 8000)
#   APP_DATA_DIR   data folder shared with Nest (default <repo>/data); the engine reads it as IMAGEGEN_DATA_DIR
#   ENGINE_RELOAD  0 disables auto-reload (default 1)
#   IMAGEGEN_DEMO  1 adds a GPU-less "Démo" model (synthetic images) to try the interface; put it in back/.env.dev
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ENGINE_TOKEN:?ENGINE_TOKEN is not set: add it to back/.env.dev (openssl rand -hex 32)}"
ENGINE_PORT="${ENGINE_PORT:-8000}"
export ENGINE_TOKEN
export IMAGEGEN_DATA_DIR="${APP_DATA_DIR:-$ROOT/data}"

command -v uv >/dev/null 2>&1 || { echo "uv est requis : https://docs.astral.sh/uv/" >&2; exit 1; }
EXTRAS="--extra torch"
[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] && EXTRAS="--extra mlx --extra torch"
(cd "$ROOT/engine" && uv sync --quiet $EXTRAS)

RELOAD=""
[ "${ENGINE_RELOAD:-1}" = "1" ] && RELOAD="--reload --reload-dir app"
echo "› engine on http://127.0.0.1:${ENGINE_PORT} (data: ${IMAGEGEN_DATA_DIR})"
cd "$ROOT/engine"
# shellcheck disable=SC2086
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$ENGINE_PORT" $RELOAD --timeout-graceful-shutdown 3
