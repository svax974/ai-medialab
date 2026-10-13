# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Routes only the NestJS server calls (mounted under `/engine/v1` with the token, never under the legacy `/api`):
the audio side of the voice library. The caller owns the library rows (name, transcript, language); the engine only
prepares reference clips and transcribes them, because both need audio decoding and models.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import audio_packs, transcription, voices
from ..downloads import downloads as dl
from ..engines import MODELS
from .jobs import _inside_data_dir

voice_media_router = APIRouter(tags=["voices"])


class VoiceReferenceBody(BaseModel):
    source_path: str = Field(description="Audio file (WAV, MP3, FLAC, OGG) inside the data folder; left in place.")
    voice_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class VoiceReference(BaseModel):
    filename: str = Field(description="`voice_<id>.wav` in the uploads folder (mono, 24 kHz, edges trimmed).")
    duration: float
    peaks: list[float] = Field(description="120 waveform values in [0, 1].")


@voice_media_router.post("/media/voice-reference", response_model=VoiceReference)
async def prepare_voice_reference(body: VoiceReferenceBody) -> dict[str, Any]:
    """Turns an audio file into a cloning reference clip and writes it to the uploads folder. 422 when the clip is
    unreadable, shorter than one second or the source is outside the data folder. The source is not removed."""
    source = _inside_data_dir(body.source_path, "source_path")
    if not source.is_file():
        raise HTTPException(422, "Fichier introuvable.")
    try:
        audio, duration = await asyncio.to_thread(lambda: voices.prepare_reference(source.read_bytes()))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception:
        raise HTTPException(422, "Fichier audio illisible (formats : WAV, MP3, FLAC, OGG).") from None
    filename = await asyncio.to_thread(voices.store_reference, body.voice_id, audio)
    return {"filename": filename, "duration": round(duration, 2), "peaks": voices.peaks_of(audio)}


class TranscribeBody(BaseModel):
    path: str = Field(description="Audio file inside the data folder.")
    language: str | None = None
    model_id: str | None = Field(default=None, description="A transcription model; by default the first one installed.")


class Transcription(BaseModel):
    text: str
    language: str | None = None
    duration: float | None = None
    model: str


@voice_media_router.post("/media/transcribe", response_model=Transcription)
async def transcribe_clip(body: TranscribeBody) -> dict[str, Any]:
    """Suggests a transcript for a clip (the user can always correct it). 409 with the reason to show when no
    transcription model or engine is installed; 500 when the model fails."""
    source = _inside_data_dir(body.path, "path")
    if not source.is_file():
        raise HTTPException(422, "Fichier introuvable.")
    spec, why = transcription.choose(
        transcription.ordered(MODELS, body.model_id),
        downloaded=lambda m: dl.status(m)["state"] == "installed",
        engine_ready=lambda m: audio_packs.is_installed(m.options["pack"]))
    if spec is None:
        raise HTTPException(409, why)
    try:
        return await asyncio.to_thread(transcription.transcribe, spec, str(source), body.language)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from None
