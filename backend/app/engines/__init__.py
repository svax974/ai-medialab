"""Registre des modèles disponibles."""

from __future__ import annotations

import importlib

from ..config import DEMO_MODE
from . import audio_specs, custom, demo, gguf_models, qwen21, qwen_edit, torch_models
from .base import Engine, ModelSpec

_SPECS: list[ModelSpec] = [qwen21.SPEC, *gguf_models.SPECS, *torch_models.SPECS, qwen_edit.SPEC, *audio_specs.SPECS]
if DEMO_MODE:
    _SPECS.append(demo.SPEC)

MODELS: dict[str, ModelSpec] = {s.id: s for s in _SPECS}
custom.register_all(MODELS)  # modèles ajoutés depuis Hugging Face
DEFAULT_MODEL_ID = qwen21.SPEC.id


def get_spec(model_id: str) -> ModelSpec:
    try:
        return MODELS[model_id]
    except KeyError:
        raise KeyError(f"Modèle inconnu : {model_id}") from None


def create_engine(spec: ModelSpec, quantize: int | None, options: dict | None = None) -> Engine:
    module_name, class_name = spec.engine.split(":")
    cls = getattr(importlib.import_module(module_name), class_name)
    return cls(spec, quantize, options)
