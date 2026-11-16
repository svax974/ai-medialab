# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Internal long-media transcription stream. Nest owns sources, history and edited text."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import audio_packs, transcript_job, transcription
from ..downloads import downloads
from ..engines import MODELS
from ..jobs import jobs
from ..llm import llm, ocr_llm
from ..transcript_media import youtube_url
from .jobs import _inside_data_dir
from .llm import sse

transcripts_router = APIRouter(prefix="/transcripts", tags=["transcription"])


@transcripts_router.post("/stop")
async def stop() -> dict[str, bool]:
    """Acknowledge that the subprocess tree has stopped before Nest releases the engine gate."""
    await transcript_job.stop()
    return {"ok": True}


class TranscriptBody(BaseModel):
    model_id: str
    folder: str = Field(description="Existing job folder inside the application data folder.")
    path: str | None = None
    url: str | None = Field(default=None, max_length=2048)
    language: str | None = Field(default=None, pattern=r"^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$")


@transcripts_router.post("/read")
async def read(body: TranscriptBody) -> StreamingResponse:
    """SSE: progress, prepared, segment, done/error; disconnect kills the subprocess tree."""
    folder = _inside_data_dir(body.folder, "folder")
    if not folder.is_dir() or bool(body.path) == bool(body.url):
        raise HTTPException(422, "Choisissez un fichier ou un lien YouTube.")
    if jobs.busy() or llm.generating or ocr_llm.generating:
        raise HTTPException(409, "Le moteur est occupé.")
    request = body.model_dump()
    request["folder"] = str(folder)
    if body.path:
        source = _inside_data_dir(body.path, "path")
        if not source.is_file():
            raise HTTPException(422, "Fichier introuvable.")
        request["path"] = str(source)
    if body.url:
        try:
            request["url"] = youtube_url(body.url)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    spec, why = transcription.choose(transcription.ordered(MODELS, body.model_id),
                                      lambda model: downloads.status(model)["state"] == "installed",
                                      lambda model: audio_packs.is_installed(model.options["pack"]))
    if not spec or not audio_packs.is_installed("ffmpeg"):
        raise HTTPException(409, why or "Installez le composant FFmpeg dans Réglages → Moteurs pour lire ce média.")
    request["model_id"] = spec.id
    return StreamingResponse(_stream(spec, request), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def _stream(spec, request):
    async for event in transcript_job.read(spec, request):
        yield sse(event)
