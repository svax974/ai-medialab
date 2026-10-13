# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Entry point: `uv run uvicorn app.main:app` from engine/ (see ../start.sh)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .api.auth import require_engine_token
from .api.jobs import jobs_router
from .api.routes import router
from .api.runtime import runtime_router
from .api.voice_media import voice_media_router
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
# `/engine/v1` is the contract with the NestJS server (token-protected, in the OpenAPI schema; `runtime_router` and
# `jobs_router` and `voice_media_router` exist only there); `/api` is the same
# router for the legacy UI (no token, kept until it is removed) and stays out of the schema (duplicate operation ids).
app.include_router(router, prefix="/engine/v1", dependencies=[Depends(require_engine_token)])
app.include_router(runtime_router, prefix="/engine/v1", dependencies=[Depends(require_engine_token)])
app.include_router(jobs_router, prefix="/engine/v1", dependencies=[Depends(require_engine_token)])
app.include_router(voice_media_router, prefix="/engine/v1", dependencies=[Depends(require_engine_token)])
app.include_router(router, prefix="/api", include_in_schema=False)

ensure_dirs()
for name, directory in MEDIA_DIRS.items():
    app.mount(f"/media/{name}", StaticFiles(directory=directory), name=f"media-{name}")

if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    """Serve the built frontend; unknown paths fall back to index.html (SPA routing)."""
    if path.startswith(("api/", "engine/", "media/")):
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
