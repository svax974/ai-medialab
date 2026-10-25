# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Routes of the installable components and of the "set a model up" run (`/engine/v1/components`, `/models/{id}/setup-plan`,
`/setup`). Logic: `components.py` (what exists, removal) and `setup_runner.py` (plan, run, cancel); live state through the
`setup.progress` event."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import components
from ..setup_runner import plan_for_model, setup_runner

setup_router = APIRouter(tags=["setup"])


class ModelRef(BaseModel):
    id: str
    name: str
    kind: str


class ComponentInfo(BaseModel):
    id: str
    kind: Literal["base", "engine"]
    name: str
    contents: str
    installed: bool
    removable: bool
    size_mb: int
    blocked: str | None = None
    disk_mb: int = 0
    dependants: list[ModelRef] = []


class ComponentList(BaseModel):
    components: list[ComponentInfo]


class SetupStepPlan(BaseModel):
    id: str
    kind: Literal["base", "engine", "model"]
    name: str
    installed: bool
    size_mb: int
    blocked: str | None = None
    purpose: Literal["transcription"] | None = None


class SetupPlan(BaseModel):
    model_id: str
    steps: list[SetupStepPlan]
    ready: bool
    total_mb: int
    blocked: str | None = None


class SetupStep(BaseModel):
    id: str
    kind: Literal["base", "engine", "model"]
    name: str
    size_mb: int
    state: Literal["pending", "running", "done", "error", "cancelled"]
    purpose: Literal["transcription"] | None = None


class SetupState(BaseModel):
    state: Literal["idle", "running", "done", "error", "cancelled"]
    model_id: str | None = None
    model_name: str | None = None
    steps: list[SetupStep] = []
    current: int = -1
    total_mb: int = 0
    message: str = ""
    detail: str = ""
    done: int = 0
    total: int = 0
    rate: int = 0
    eta: int | None = None
    error: str | None = None
    started_at: float | None = None


class UninstallResult(BaseModel):
    ok: bool
    removed_models: list[ModelRef]


@setup_router.get("/components", response_model=ComponentList)
async def list_components(disk: bool = False) -> dict[str, Any]:
    """Every component with its state and the installed models that need it. `disk`: also measure the space it takes."""
    return {"components": await asyncio.to_thread(components.describe, None, disk)}


@setup_router.delete("/components/{component_id}", response_model=UninstallResult)
async def uninstall_component(component_id: str) -> dict[str, Any]:
    """Removes a component and the installed models that need it (409 while it is in use or installing)."""
    try:
        return await components.uninstall(component_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc.args[0])) from None
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


@setup_router.get("/models/{model_id}/setup-plan", response_model=SetupPlan)
async def setup_plan(model_id: str) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(plan_for_model, model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc.args[0])) from None


@setup_router.get("/setup", response_model=SetupState)
async def setup_state() -> dict[str, Any]:
    return setup_runner.public()


@setup_router.post("/setup/{model_id}", response_model=SetupState)
async def start_setup(model_id: str) -> dict[str, Any]:
    """Installs what the model lacks (base data, engine, model files); progress through the `setup.progress` event."""
    try:
        return await setup_runner.start(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc.args[0])) from None
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


@setup_router.delete("/setup")
async def cancel_setup() -> dict[str, Any]:
    """Stops the current step (its partial files are removed); steps already finished stay installed."""
    if not await setup_runner.cancel():
        raise HTTPException(409, "Aucune installation en cours.")
    return {"ok": True}
