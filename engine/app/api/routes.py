# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Engine routes under `/engine/v1`: models, downloads, engines and packs, Hugging Face search, status, event stream."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import audio_packs
from ..catalog import describe_models
from ..downloads import downloads
from ..audio_packs import installer as pack_installer
from ..engine_install import installer
from .. import hf_search
from ..engines import MODELS, custom, get_spec
from ..events import bus
from ..jobs import jobs, load_settings
from ..llamacpp import installer as llamacpp_installer
from ..llm import llm
from ..system import get_system

# Mounted by main.py under `/engine/v1` with the `X-Engine-Token` check (NestJS is the only caller).
router = APIRouter()


# Models and engines

@router.get("/models")
def list_models() -> dict[str, Any]:
    return describe_models()


@router.get("/system")
def system_info(refresh: bool = False) -> dict[str, Any]:
    info = get_system(refresh=refresh)
    engines = {k: dict(v) for k, v in info["engines"].items()}
    engines["sdcpp"]["install"] = installer.public()  # live state, outside the detection cache
    engines["llamacpp"]["install"] = llamacpp_installer.public()
    packs = {
        p.id: {"name": p.name, "size_mb": p.size_mb, "installed": audio_packs.is_installed(p.id),
               **{k: v for k, v in audio_packs.engine_info(p.id).items() if k in ("installable", "reason")}}
        for p in audio_packs.PACKS.values()
    }
    return {**info, "engines": engines, "packs": packs, "pack_install": pack_installer.public()}


@router.post("/engines/pack/{pack_id}/install")
async def install_pack(pack_id: str) -> dict[str, Any]:
    try:
        return await pack_installer.start(pack_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


@router.delete("/engines/pack/install")
async def cancel_pack_install() -> dict[str, Any]:
    if not pack_installer.cancel():
        raise HTTPException(409, "Aucune installation en cours.")
    return {"ok": True}


@router.delete("/engines/pack/{pack_id}")
async def uninstall_pack(pack_id: str) -> dict[str, Any]:
    if pack_id not in audio_packs.PACKS:
        raise HTTPException(404, "Pack inconnu.")
    if jobs.worker and jobs.worker.alive:
        spec = get_spec(jobs.worker.model_id)
        if spec.options.get("pack") == pack_id:
            raise HTTPException(409, "Ce moteur est en cours d'utilisation : déchargez le modèle d'abord.")
    try:
        await asyncio.to_thread(pack_installer.uninstall, pack_id)  # only reply once everything is deleted
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None
    bus.publish("models.changed", {})
    return {"ok": True}


@router.post("/engines/sdcpp/install")
async def install_engine() -> dict[str, Any]:
    try:
        return await installer.start()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


@router.delete("/engines/sdcpp/install")
async def cancel_engine_install() -> dict[str, Any]:
    if not installer.cancel():
        raise HTTPException(409, "Aucune installation en cours.")
    return {"ok": True}


@router.post("/models/{model_id}/download")
async def download_model(model_id: str) -> dict[str, Any]:
    try:
        job = await downloads.start(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from None
    return job.public()


@router.delete("/models/{model_id}/download")
async def cancel_download(model_id: str) -> dict[str, Any]:
    if not await downloads.cancel(model_id):
        raise HTTPException(409, "Aucun téléchargement en cours pour ce modèle.")
    return {"ok": True}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str) -> dict[str, Any]:
    if jobs.worker and jobs.worker.model_id == model_id:
        raise HTTPException(409, "Ce modèle est chargé en mémoire : déchargez-le d'abord.")
    try:
        # Delete files off the event loop so the server stays responsive; reply only once the space is freed.
        result = await asyncio.to_thread(downloads.delete, model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from None
    bus.publish("models.changed", {})
    return result


# User-added Hugging Face models

@router.get("/hf/search")
async def hf_search_models(kind: str = "image", q: str = "") -> dict[str, Any]:
    try:
        return {"results": await asyncio.to_thread(hf_search.search, kind, q)}
    except hf_search.HubError as exc:
        raise HTTPException(502, str(exc)) from None


@router.get("/hf/inspect")
async def hf_inspect(repo: str) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(hf_search.inspect, repo)
    except hf_search.HubError as exc:
        raise HTTPException(422, str(exc)) from None


class CustomModelBody(BaseModel):
    repo: str
    option: str = "default"


@router.post("/models/custom")
async def add_custom_model(body: CustomModelBody) -> dict[str, Any]:
    try:
        recipe = await asyncio.to_thread(hf_search.make_recipe, body.repo.strip(), body.option)
    except hf_search.HubError as exc:
        raise HTTPException(422, str(exc)) from None
    spec = custom.add(MODELS, recipe)
    downloads.invalidate()
    bus.publish("models.changed", {})
    return {"model_id": spec.id}


@router.delete("/models/{model_id}/custom")
async def remove_custom_model(model_id: str) -> dict[str, Any]:
    spec = MODELS.get(model_id)
    if spec is None or not spec.custom:
        raise HTTPException(404, "Ce n'est pas un modèle ajouté depuis Hugging Face.")
    if jobs.worker and jobs.worker.model_id == model_id:
        raise HTTPException(409, "Ce modèle est chargé en mémoire : déchargez-le d'abord.")
    freed = 0.0
    try:
        if downloads.status(spec)["size_gb"] > 0:
            freed = (await asyncio.to_thread(downloads.delete, model_id))["freed_gb"]
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from None
    custom.remove(MODELS, model_id)
    downloads.invalidate()
    bus.publish("models.changed", {})
    return {"freed_gb": freed}


@router.get("/status")
def engine_status() -> dict[str, Any]:
    return jobs.status()


@router.post("/engine/unload")
async def unload_engine() -> dict[str, Any]:
    if jobs.current:
        raise HTTPException(409, "Une génération est en cours.")
    await jobs.unload()
    return jobs.status()


class SettingsPatch(BaseModel):
    keep_alive_minutes: int | None = None
    previews: bool | None = None
    low_memory: bool | None = None
    hf_token: str | None = None
    quantize: dict[str, int | None] | None = None
    variant: dict[str, str] | None = None


def public_settings() -> dict[str, Any]:
    st = load_settings()
    token = st.pop("hf_token", None)
    st["has_hf_token"] = bool(token)
    return st


def check_variant(variant: dict[str, str]) -> None:
    for model_id, key in variant.items():
        spec = MODELS.get(model_id)
        if spec is None or key not in {v.key for v in spec.variants}:
            raise HTTPException(422, f"Quantification inconnue pour {model_id} : {key}.")


def check_quantize(quantize: dict[str, int | None]) -> None:
    for model_id, bits in quantize.items():
        if model_id in MODELS and bits is not None and bits not in MODELS[model_id].quantize_options:
            raise HTTPException(422, f"Quantification {bits} non prise en charge par {model_id}.")


async def unload_if_variant_changed(previous: dict[str, str], variant: dict[str, str]) -> None:
    """The loaded model uses the old quantization: unload it (409 while a generation runs)."""
    changed = [i for i, k in variant.items() if previous.get(i, MODELS[i].default_variant) != k]
    if jobs.worker and jobs.worker.model_id in changed:
        if jobs.current:
            raise HTTPException(409, "Une génération est en cours : attendez sa fin pour changer de quantification.")
        await jobs.unload()
    downloads.invalidate()


# Real-time events

@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    q = bus.subscribe()

    async def stream():
        try:
            yield "retry: 2000\n\n"
            yield f"event: engine.status\ndata: {json.dumps(jobs.status())}\n\n"
            for prog in jobs.snapshot():
                yield f"event: job.progress\ndata: {json.dumps(prog)}\n\n"
            for dl in downloads.active():
                yield f"event: download.progress\ndata: {json.dumps(dl)}\n\n"
            yield f"event: engine.install\ndata: {json.dumps(installer.public())}\n\n"
            yield f"event: pack.install\ndata: {json.dumps(pack_installer.public())}\n\n"
            yield f"event: llamacpp.install\ndata: {json.dumps(llamacpp_installer.public())}\n\n"
            yield f"event: llm.status\ndata: {json.dumps(llm.status())}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
