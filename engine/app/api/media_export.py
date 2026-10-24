# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Route only the NestJS server calls (mounted under `/engine/v1` with the token): a lighter copy of a produced video,
made to be sent by mail or message. The caller owns the assets; the engine only converts a file of the data folder."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config, media
from .jobs import _inside_data_dir

media_export_router = APIRouter(tags=["media"])

EXPORT_KEEP_SECONDS = 7 * 24 * 3600  # exports are recreated on demand: the old ones are removed on the next export


class VideoExportBody(BaseModel):
    source_path: str = Field(description="Video file inside the data folder; left in place.")
    short_side: int = Field(ge=120, le=1080, description="Shorter side of the copy, in pixels (never above the source's).")
    max_fps: int = Field(ge=4, le=30, description="Images per second at most.")


class VideoExport(BaseModel):
    filename: str = Field(description="File of the `exports` media folder (`/media/exports/<filename>`).")
    width: int
    height: int
    fps: int
    bytes: int


def _prune(keep: str) -> None:
    now = time.time()
    for entry in config.EXPORTS_DIR.glob("*.mp4"):
        if entry.name != keep and now - entry.stat().st_mtime > EXPORT_KEEP_SECONDS:
            entry.unlink(missing_ok=True)


def _export(body: VideoExportBody) -> dict[str, Any]:
    source = _inside_data_dir(body.source_path, "source_path")
    if not source.is_file():
        raise HTTPException(422, "Fichier introuvable.")
    config.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{source.stem}-{body.short_side}p{body.max_fps}.mp4"
    target = config.EXPORTS_DIR / name
    try:
        if not (target.is_file() and target.stat().st_mtime >= source.stat().st_mtime):
            result = media.export_video(source, target, body.short_side, body.max_fps)
        else:
            info = media.probe_video(target)
            result = {"width": info["width"], "height": info["height"], "fps": round(info["fps"]), "bytes": target.stat().st_size}
    except media.FfmpegMissing as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception:
        raise HTTPException(422, "Vidéo illisible : impossible d'en faire une copie allégée.") from None
    _prune(name)
    return {"filename": name, **result}


@media_export_router.post("/media/video-export", response_model=VideoExport)
async def export_video(body: VideoExportBody) -> dict[str, Any]:
    """A light MP4 of a video (smaller, fewer images per second, low bit rate), kept in the `exports` folder and reused while
    the source is unchanged. 422 when the file is missing, unreadable, outside the data folder, or FFmpeg is not installed."""
    return await asyncio.to_thread(_export, body)
