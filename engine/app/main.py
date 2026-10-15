# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Entry point: `uvicorn app.main:app` from engine/ (dev: `scripts-local/dev-services.sh`; desktop: the shell).

The engine is an internal service of the NestJS server: it listens on 127.0.0.1 only, and every route under
`/engine/v1` except `/status` requires the shared `X-Engine-Token`. The generated media are served read-only under
`/media/<folder>/` (no token: the NestJS server relays them to the browser)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles

from .api.auth import require_engine_token
from .api.jobs import jobs_router
from .api.llm import llamacpp_router, llm_router
from .api.routes import router
from .api.runtime import runtime_router
from .api.trending import trending_router
from .api.updates import updates_router
from .api.voice_media import voice_media_router
from .config import MEDIA_DIRS, PRIVATE_DIR, ensure_dirs
from .downloads import downloads
from .jobs import jobs
from .llm import llm
from .private_session import NoStoreStaticFiles
from .system import warm_up


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    warm_up()
    await jobs.start()
    await llm.start()
    yield
    await downloads.shutdown()
    await llm.shutdown()
    await jobs.shutdown()


app = FastAPI(title="AI MediaLab engine", lifespan=lifespan)
for engine_router in (router, runtime_router, jobs_router, voice_media_router, updates_router, llm_router, llamacpp_router,
               trending_router):
    app.include_router(engine_router, prefix="/engine/v1", dependencies=[Depends(require_engine_token)])

ensure_dirs()
for name, directory in MEDIA_DIRS.items():
    app.mount(f"/media/{name}", StaticFiles(directory=directory), name=f"media-{name}")
# Private sessions (private_session.py): same files-only mount, but never cacheable.
app.mount("/media/private", NoStoreStaticFiles(directory=PRIVATE_DIR), name="media-private")
