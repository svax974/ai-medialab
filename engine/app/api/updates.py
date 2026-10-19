# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Routes of the update check (`updates.py`): what is out of date, and starting one update at a time.

An update reuses the installers: a model is downloaded again (only the files that changed come over), an engine is
installed again. Their progress travels through the events they already publish (`download.progress`, `engine.install`,
`pack.install`); only one of each runs at a time, so the caller queues "update all".

`POST /updates/advice` is the adviser (`update_advisor.py`): a local language model lists, from public sources, the problems
reported about an update. It is informative and never blocks an update."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import audio_packs, update_advisor, updates
from ..audio_packs import installer as pack_installer
from ..downloads import downloads
from ..engine_install import installer as sdcpp_installer
from ..engines import MODELS, get_spec
from ..jobs import jobs

updates_router = APIRouter(prefix="/updates", tags=["updates"])


class AdviceBody(BaseModel):
    kind: Literal["engine", "model"]
    id: str = Field(min_length=1, max_length=160)
    target: Literal["pinned", "latest"] = Field(
        default="pinned", description="Engines: the tested release (`pinned`) or the newest upstream one (`latest`, untested).")


class AdviceFinding(BaseModel):
    severity: Literal["info", "warning", "critical"]
    title: str
    quote: str = Field(description="Excerpt of the source, copied word for word (checked), or the documented regression.")
    url: str = Field(description="The page the excerpt comes from; empty for a regression the repository documents.")
    source_kind: str = Field(description="release | issue | commit | discussion | card | known")


class AdviceSource(BaseModel):
    title: str
    url: str


class Advice(BaseModel):
    """What the adviser concluded about one update. Informative: nothing is blocked by it."""

    kind: Literal["engine", "model"]
    id: str
    target: Literal["pinned", "latest"]
    from_version: str | None = Field(description="Installed release (engines) or short revision of the cache (models).")
    to_version: str | None = Field(description="Target release (engines) or fingerprint of what changed on the Hub (models).")
    verdict: Literal["none", "caution", "discouraged"] = Field(description="Computed by the code from the kept findings, never by the model.")
    summary: str
    findings: list[AdviceFinding]
    sources: list[AdviceSource]
    notes: list[str] = Field(description="What could not be read (rate limit, network).")
    truncated: int = Field(description="Sources that did not fit the model's context.")
    rejected: int = Field(description="Findings dropped because their excerpt is not in the source.")
    llm_model_id: str
    generated_at: float


@updates_router.get("/check")
async def check_updates() -> dict[str, Any]:
    """Engines and installed models, each `current`, `update` or (models) `error`. Reads the Hub and GitHub: can take seconds."""
    return await asyncio.to_thread(updates.check_all)


@updates_router.post("/models/{model_id}")
async def update_model(model_id: str) -> dict[str, Any]:
    if model_id not in MODELS:
        raise HTTPException(404, "Modèle inconnu.")
    if jobs.worker and jobs.worker.model_id == model_id:
        raise HTTPException(409, "Ce modèle est chargé en mémoire : déchargez-le d'abord.")
    rows = await asyncio.to_thread(updates.check_models, only=model_id)
    if not rows:
        raise HTTPException(409, "Ce modèle n'est pas installé.")
    row = rows[0]
    if row["state"] == "error":
        raise HTTPException(409, row["error"])
    if row["state"] != "update":
        raise HTTPException(409, "Ce modèle est déjà à jour.")
    try:
        job = await downloads.start(get_spec(model_id).id, refresh=True, need_gb=row["size_gb"])
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from None
    return job.public()


@updates_router.post("/engines/{engine_id}")
async def update_engine(engine_id: str, target: Literal["pinned", "latest"] = "pinned") -> dict[str, Any]:
    """`target=pinned`: the release the application was tested with (the update `check` recommends; also the way back from a newer build). `latest`: the newest
    upstream release, untested (`latest` of the check row; stable-diffusion.cpp and audio.cpp only). The caller asks the
    user to confirm that one."""
    if jobs.current:
        raise HTTPException(409, "Une génération est en cours : attendez sa fin.")
    rows = {r["id"]: r for r in await asyncio.to_thread(updates.check_engines)}
    row = rows.get(engine_id)
    if row is None:
        raise HTTPException(404, "Ce moteur n'est pas installé.")
    if target == "latest":
        if row["latest"] is None:
            raise HTTPException(409, "Aucune version plus récente n'est connue pour ce moteur.")
        tag = row["latest"]["tag"]
    elif row["state"] != "update" and not row["rollback"]:
        raise HTTPException(409, "Ce moteur est déjà à jour.")
    else:
        tag = None
    if jobs.worker and jobs.worker.alive and audio_packs.pack_of(get_spec(jobs.worker.model_id)) == engine_id:
        raise HTTPException(409, "Ce moteur est en cours d'utilisation : déchargez le modèle d'abord.")
    try:
        if engine_id == "sdcpp":
            return await sdcpp_installer.start(row["variant"], tag=tag)
        return await pack_installer.start(engine_id, tag=tag)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


_advising = asyncio.Lock()


@updates_router.post("/advice", response_model=Advice)
async def advise_update(body: AdviceBody) -> dict[str, Any]:
    """Reads public sources about one update (GitHub for an engine, Hugging Face for a model) with the local chat model and
    lists the problems they report. One analysis at a time, about a minute. A 409 carries `{code, message}` (`busy`,
    `no_engine`, `no_model`, `nothing_to_analyse`, `unsupported`), a 502 `no_sources`, `llm` or `llm_output`."""
    if jobs.current or jobs.pending or _advising.locked():
        raise HTTPException(409, detail={"code": "busy", "message": "Une génération ou une autre analyse est en cours : attendez sa fin."})
    async with _advising:
        try:
            return await update_advisor.advise(body.kind, body.id, body.target)
        except update_advisor.AdvisorError as exc:
            raise HTTPException(exc.status, detail={"code": exc.code, "message": str(exc)}) from None
