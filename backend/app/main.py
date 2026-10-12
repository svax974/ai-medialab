"""Point d'entrée : `uv run uvicorn app.main:app` depuis backend/ (voir ../start.sh)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .api.routes import router
from .config import FRONTEND_DIST, MEDIA_DIRS, ensure_dirs
from .downloads import downloads
from .jobs import jobs
from .system import warm_up


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    db.init_db()
    warm_up()
    await jobs.start()
    yield
    await downloads.shutdown()
    await jobs.shutdown()


app = FastAPI(title="AI MediaLab", lifespan=lifespan)
app.include_router(router)

ensure_dirs()
for name, directory in MEDIA_DIRS.items():
    app.mount(f"/media/{name}", StaticFiles(directory=directory), name=f"media-{name}")

if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    """Sert l'interface compilée (frontend/dist) ; toute route inconnue renvoie index.html."""
    if path.startswith(("api/", "media/")):
        return JSONResponse({"detail": "Introuvable"}, status_code=404)
    candidate = (FRONTEND_DIST / path).resolve()
    if path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = FRONTEND_DIST / "index.html"
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse(
        {"detail": "Interface non compilée : lancez ./start.sh (ou `npm run build` dans frontend/)."},
        status_code=503,
    )
