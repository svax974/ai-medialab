# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Registry of available models."""

from __future__ import annotations

import importlib

from ..config import DEMO_MODE
from . import (audio_specs, audiocpp_specs, custom, demo, gguf_models, llm_models, qwen21, qwen_edit, torch_models, video_gguf,
               video_specs)
from .base import Engine, ModelSpec, with_variant

_SPECS: list[ModelSpec] = [qwen21.SPEC, *gguf_models.SPECS, *torch_models.SPECS, qwen_edit.SPEC, *audio_specs.SPECS, *audiocpp_specs.SPECS,
                     *video_gguf.SPECS, *video_specs.SPECS, *video_specs.PACK_SPECS, *llm_models.SPECS]
if DEMO_MODE:
    _SPECS.append(demo.SPEC)

MODELS: dict[str, ModelSpec] = {s.id: s for s in _SPECS}
custom.register_all(MODELS)  # user-added Hugging Face models
DEFAULT_MODEL_ID = qwen21.SPEC.id


def selected_variants() -> dict[str, str]:
    """Quantization picked per model (from the settings Nest pushed; default variants until then)."""
    from .. import runtime_settings

    return dict(runtime_settings.get_settings().get("variant", {}))


def resolve(spec: ModelSpec, chosen: dict[str, str] | None = None) -> ModelSpec:
    """Spec with the chosen quantization applied (default if none)."""
    chosen = selected_variants() if chosen is None else chosen
    return with_variant(spec, chosen.get(spec.id))


def get_spec(model_id: str) -> ModelSpec:
    """Spec ready to use, with the selected quantization applied."""
    try:
        return resolve(MODELS[model_id])
    except KeyError:
        raise KeyError(f"Modèle inconnu : {model_id}") from None


def all_specs() -> list[ModelSpec]:
    chosen = selected_variants()
    return [resolve(s, chosen) for s in MODELS.values()]


def create_engine(spec: ModelSpec, quantize: int | None, options: dict | None = None) -> Engine:
    module_name, class_name = spec.engine.split(":")
    cls = getattr(importlib.import_module(module_name), class_name)
    return cls(spec, quantize, options)
