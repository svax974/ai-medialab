# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Routes only the NestJS server calls (mounted under `/engine/v1` with the token):
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
from ..job_checks import MAX_COUNT, check_generation
from ..job_plans import JobRequest
from ..jobs import jobs
from ..llm import llm
from ..media import VIDEO_EXTENSIONS, FfmpegMissing, is_video_upload, make_thumb, probe_video, save_upload, video_thumb
from ..private_session import inside, session_dir, subfolder

jobs_router = APIRouter(tags=["jobs"])


class JobCheckBody(BaseModel):
    model_id: str
    reference_media: list[Literal["image", "audio", "video"]] = Field(
        default_factory=list, description="Media of each attached asset, in order.")


class JobCheck(BaseModel):
    kind: Literal["image", "audio", "video"]
    name: str
    max_count: int = Field(description="Most results one generation may ask for.")
    default_params: dict[str, Any] = Field(description="Defaults of the model's parameters, to merge under the user's.")


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
    private_dir: str | None = Field(
        default=None, description="Private generation: the session folder (`<data>/private/<id>`) the job keeps all "
        "of its files in; `output_dir` must be inside it. The engine keeps nothing of such a job once it ended.")


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


def _private_session(raw: str | None, out_dir: Path) -> Path | None:
    """The session folder of a private job (422 when malformed or when the output folder is not inside it), else None."""
    if raw is None:
        return None
    try:
        session = session_dir(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if not inside(out_dir, session):
        raise HTTPException(422, "output_dir : en dehors de la session privée.")
    return session


@jobs_router.post("/jobs/check", response_model=JobCheck)
def check_job(body: JobCheckBody) -> dict[str, Any]:
    """Refuses (422, with the message to show) a generation the model cannot do, before anything is stored."""
    try:
        return check_generation(body.model_id, list(body.reference_media))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@jobs_router.post("/jobs", status_code=202, response_model=JobState)
def submit_job(body: JobSubmit) -> dict[str, Any]:
    """Queues a generation. Validation of the content (empty prompt, missing reference...) is reported by `job.failed`."""
    try:
        spec = get_spec(body.model_id)
    except KeyError as exc:
        raise HTTPException(422, str(exc)) from None
    if spec.kind != body.kind:
        raise HTTPException(422, f"{spec.name} est un modèle {spec.kind}, pas {body.kind}.")
    if llm.generating:
        raise HTTPException(409, "Une réponse de chat est en cours : attendez sa fin avant de lancer une génération.")
    if len(body.params.get("seeds") or []) > MAX_COUNT:
        raise HTTPException(422, f"{MAX_COUNT} résultats au plus par job.")
    out_dir = _inside_data_dir(body.output_dir, "output_dir")
    private = _private_session(body.private_dir, out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    inputs = [str(_inside_data_dir(p, "inputs")) for p in body.inputs]
    voices = {k: v.model_dump() for k, v in body.voices.items()} if body.voices is not None else None
    for voice in (voices or {}).values():
        voice["path"] = str(_inside_data_dir(voice["path"], "voices"))
    job = JobRequest(job_id=body.job_id, model_id=body.model_id, prompt=body.prompt, params=dict(body.params),
                     inputs=inputs, output_dir=str(out_dir), voices=voices,
                     private_dir=str(private) if private else None)
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
    private_dir: str | None = Field(
        default=None, description="Private generation: store the reference and its thumbnail in this session folder "
        "(`inputs/`, `thumbs/`) instead of `uploads/` and `thumbs/`.")


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
    folders = _ingest_folders(body.private_dir)
    try:
        if is_video_upload(body.original_name, body.content_type):
            return await asyncio.to_thread(_ingest_video, source, body.asset_id, name, *folders)
        return await asyncio.to_thread(_ingest_image, source, body.asset_id, name, *folders)
    finally:
        source.unlink(missing_ok=True)


def _ingest_folders(private_dir: str | None) -> tuple[Path | None, Path | None]:
    """(folder of the reference, folder of its thumbnail): the session's for a private upload, else the usual ones (None)."""
    if private_dir is None:
        return None, None
    try:
        session = session_dir(private_dir)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return subfolder(session, "inputs"), subfolder(session, "thumbs")


def _ingest_image(source: Path, asset_id: str, name: str, uploads: Path | None = None,
                  thumbs: Path | None = None) -> dict[str, Any]:
    try:
        filename, width, height = save_upload(asset_id, source.read_bytes(), uploads)
    except Exception:
        raise HTTPException(422, f"Image illisible : {name}") from None
    thumb = make_thumb((uploads or config.UPLOADS_DIR) / filename, asset_id, thumbs)
    return {"media": "image", "filename": filename, "thumb": thumb, "width": width, "height": height, "meta": {}}


def _ingest_video(source: Path, asset_id: str, name: str, uploads: Path | None = None,
                  thumbs: Path | None = None) -> dict[str, Any]:
    ext = Path(name).suffix.lower()
    ext = ext if ext in VIDEO_EXTENSIONS else ".mp4"
    filename = f"{asset_id}{ext}"
    target = (uploads or config.UPLOADS_DIR) / filename
    shutil.copyfile(source, target)
    try:
        info = probe_video(target)
        thumb = video_thumb(target, asset_id, thumbs)
    except FfmpegMissing as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(409, str(exc)) from None
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
