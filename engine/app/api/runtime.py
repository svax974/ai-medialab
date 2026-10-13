# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Routes only the NestJS server calls (mounted under `/engine/v1` with the token)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import runtime_settings
from ..jobs import load_settings
from .routes import check_quantize, check_variant, public_settings, unload_if_variant_changed

runtime_router = APIRouter(prefix="/runtime", tags=["runtime"])


class RuntimeSettings(BaseModel):
    """The complete studio settings (Nest sends all of them every time; maps are replaced, not merged)."""

    keep_alive_minutes: int = 10
    previews: bool = True
    low_memory: bool = True
    hf_token: str = ""
    quantize: dict[str, int | None] = Field(default_factory=dict)
    variant: dict[str, str] = Field(default_factory=dict)


@runtime_router.put("/settings")
async def push_settings(settings: RuntimeSettings) -> dict[str, Any]:
    """Keeps the studio settings in memory (never written to disk).

    Checks: unknown model or quantization is a 422, a variant change while a
    generation runs is a 409 (nothing is applied then); the loaded model is unloaded when its variant changed.
    """
    values = settings.model_dump()
    values["hf_token"] = values["hf_token"].strip()
    check_variant(values["variant"])
    check_quantize(values["quantize"])
    await unload_if_variant_changed(load_settings()["variant"], values["variant"])
    runtime_settings.apply(values)
    return public_settings()
