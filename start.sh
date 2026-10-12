#!/bin/sh
# AI MediaLab — installe les dépendances si besoin, compile l'interface et démarre le serveur.
#   ./start.sh              → http://127.0.0.1:8000
#   PORT=9000 ./start.sh
#   IMAGEGEN_DEMO=1 ./start.sh   (ajoute un modèle « Démo » sans GPU, pour tester l'interface)
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

command -v uv >/dev/null 2>&1 || { echo "uv est requis : https://docs.astral.sh/uv/" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Node.js/npm est requis." >&2; exit 1; }

echo "› Dépendances Python…"
EXTRAS="--extra torch"
[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] && EXTRAS="--extra mlx --extra torch"
(cd backend && uv sync --quiet $EXTRAS)

echo "› Interface…"
(cd frontend && { [ -d node_modules ] || npm install --silent; } && npm run build --silent >/dev/null)

echo "› AI MediaLab sur http://$HOST:$PORT"
cd backend
exec uv run uvicorn app.main:app --host "$HOST" --port "$PORT" --log-level warning --timeout-graceful-shutdown 3
