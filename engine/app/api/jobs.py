# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Routes only the NestJS server calls (mounted under `/engine/v1` with the token, never under the legacy `/api`):
generation jobs and the engine-side handling of media files.

A job is submitted with everything the engine needs (model, prompt, parameters, input file paths, output folder) and
reports through the event stream (`job.started`, `job.progress`, `job.preview`, `job.output`, `job.done`,
`job.failed`, `job.cancelled`, all carrying `job_id`). The engine keeps no conversation or message: the caller owns
those and registers the files a `job.output` describes.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..engines import get_spec
from ..job_plans import JobRequest
from ..jobs import jobs
from ..media import VIDEO_EXTENSIONS, is_video_upload, make_thumb, probe_video, save_upload, video_thumb

jobs_router = APIRouter(tags=["jobs"])

MAX_COUNT_PER_JOB = 4


class LibraryVoice(BaseModel):
    """A voice of the caller's library: its reference clip and transcript."""

    path: str
    transcript: str = ""
    name: str = ""


class JobSubmit(BaseModel):
    job_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["image", "audio", "video"]
    model_id: str
    prompt: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    inputs: list[str] = Field(default_factory=list, description="Absolute paths (inside the data folder).")
    output_dir: str = Field(description="Absolute folder (inside the data folder) the files are written to.")
    voices: dict[str, LibraryVoice] | None = Field(default=None, description="Library voices by id (audio).")


class JobOutput(BaseModel):
    """A produced file, with what the caller needs to register it as an asset."""

    index: int
    media: Literal["image", "audio", "video"]
    asset_id: str
    path: str
    filename: str
    thumb: str | None = None
    width: int | None = None
    height: int | None = None
    seed: int | None = None
    duration: float | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class JobState(BaseModel):
    job_id: str
    state: Literal["queued", "loading", "running", "done", "failed", "cancelled"]
    error: str | None = None
    outputs: list[JobOutput] = Field(default_factory=list)
    queue_position: int | None = None
    progress: dict[str, Any] | None = None


class JobList(BaseModel):
    jobs: list[JobState]


def _inside_data_dir(raw: str, what: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise HTTPException(422, f"{what} : chemin absolu attendu.")
    resolved = path.resolve()
    root = config.DATA_DIR.resolve()
    if resolved != root and root not in resolved.parents:
        raise HTTPException(422, f"{what} : en dehors du dossier de données.")
    return resolved


@jobs_router.post("/jobs", status_code=202, response_model=JobState)
def submit_job(body: JobSubmit) -> dict[str, Any]:
    """Queues a generation. Validation of the content (empty prompt, missing reference...) is reported by `job.failed`."""
    try:
        spec = get_spec(body.model_id)
    except KeyError as exc:
        raise HTTPException(422, str(exc)) from None
    if spec.kind != body.kind:
        raise HTTPException(422, f"{spec.name} est un modèle {spec.kind}, pas {body.kind}.")
    if len(body.params.get("seeds") or []) > MAX_COUNT_PER_JOB:
        raise HTTPException(422, f"{MAX_COUNT_PER_JOB} résultats au plus par job.")
    out_dir = _inside_data_dir(body.output_dir, "output_dir")
    out_dir.mkdir(parents=True, exist_ok=True)
    inputs = [str(_inside_data_dir(p, "inputs")) for p in body.inputs]
    voices = {k: v.model_dump() for k, v in body.voices.items()} if body.voices is not None else None
    for voice in (voices or {}).values():
        voice["path"] = str(_inside_data_dir(voice["path"], "voices"))
    job = JobRequest(job_id=body.job_id, model_id=body.model_id, prompt=body.prompt, params=dict(body.params),
                     inputs=inputs, output_dir=str(out_dir), voices=voices)
    try:
        jobs.submit(job)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return jobs.describe(body.job_id)  # type: ignore[return-value]


@jobs_router.get("/jobs", response_model=JobList)
def list_jobs() -> dict[str, Any]:
    """Jobs that are queued or running."""
    return {"jobs": jobs.active()}


@jobs_router.get("/jobs/{job_id}", response_model=JobState)
def get_job(job_id: str) -> dict[str, Any]:
    """State of a job, including how one of the last 100 finished jobs ended (its outputs too); 404 otherwise."""
    state = jobs.describe(job_id)
    if state is None:
        raise HTTPException(404, "Job inconnu.")
    return state


@jobs_router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict[str, Any]:
    """Stops a queued job at once; a running one stops after its current step (the worker is killed while loading)."""
    if jobs.describe(job_id) is None:
        raise HTTPException(404, "Job inconnu.")
    if not await jobs.cancel(job_id):
        raise HTTPException(409, "Ce job n'est plus en cours.")
    return {"ok": True}


# Media files (the engine decodes, probes and makes thumbnails; the caller stores the rows)

class IngestBody(BaseModel):
    source_path: str = Field(description="Raw uploaded file, inside the data folder; consumed.")
    asset_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    original_name: str | None = None
    content_type: str | None = None


class IngestResult(BaseModel):
    media: Literal["image", "video"]
    filename: str
    thumb: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


@jobs_router.post("/media/ingest", response_model=IngestResult)
async def ingest_upload(body: IngestBody) -> dict[str, Any]:
    """Turns a raw upload into a stored reference: images are re-encoded as PNG (EXIF orientation, transparency
    flattened, 4096 px at most), videos are kept and probed; both get a thumbnail. 422 on an unreadable file."""
    source = _inside_data_dir(body.source_path, "source_path")
    if not source.is_file():
        raise HTTPException(422, "Fichier introuvable.")
    name = body.original_name or source.name
    try:
        if is_video_upload(body.original_name, body.content_type):
            return await asyncio.to_thread(_ingest_video, source, body.asset_id, name)
        return await asyncio.to_thread(_ingest_image, source, body.asset_id, name)
    finally:
        source.unlink(missing_ok=True)


def _ingest_image(source: Path, asset_id: str, name: str) -> dict[str, Any]:
    try:
        filename, width, height = save_upload(asset_id, source.read_bytes())
    except Exception:
        raise HTTPException(422, f"Image illisible : {name}") from None
    thumb = make_thumb(config.UPLOADS_DIR / filename, asset_id)
    return {"media": "image", "filename": filename, "thumb": thumb, "width": width, "height": height, "meta": {}}


def _ingest_video(source: Path, asset_id: str, name: str) -> dict[str, Any]:
    ext = Path(name).suffix.lower()
    ext = ext if ext in VIDEO_EXTENSIONS else ".mp4"
    filename = f"{asset_id}{ext}"
    target = config.UPLOADS_DIR / filename
    shutil.copyfile(source, target)
    try:
        info = probe_video(target)
        thumb = video_thumb(target, asset_id)
    except Exception:
        target.unlink(missing_ok=True)
        raise HTTPException(422, f"Vidéo illisible : {name}") from None
    return {"media": "video", "filename": filename, "thumb": thumb, "width": info["width"], "height": info["height"],
            "duration": info["duration"], "meta": {"fps": info["fps"], "has_audio": info["has_audio"]}}


class PurgeFile(BaseModel):
    folder: Literal["uploads", "outputs"]
    filename: str = Field(min_length=1)
    thumb: str | None = None


class PurgeBody(BaseModel):
    files: list[PurgeFile]


@jobs_router.post("/media/purge")
def purge_files(body: PurgeBody) -> dict[str, int]:
    """Deletes media files and their thumbnails (names only: no path separators); missing files are not an error."""
    deleted = 0
    for item in body.files:
        folder = config.UPLOADS_DIR if item.folder == "uploads" else config.OUTPUTS_DIR
        for base, name in ((folder, item.filename), (config.THUMBS_DIR, item.thumb)):
            if not name:
                continue
            if Path(name).name != name or name in (".", ".."):
                raise HTTPException(422, f"Nom de fichier invalide : {name}")
            target = base / name
            if target.is_file():
                target.unlink()
                deleted += 1
    return {"deleted": deleted}
