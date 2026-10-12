"""Registre des modèles disponibles."""

from __future__ import annotations

import importlib

from ..config import DEMO_MODE
from . import audio_specs, custom, demo, gguf_models, qwen21, qwen_edit, torch_models
from .base import Engine, ModelSpec, with_variant

_SPECS: list[ModelSpec] = [qwen21.SPEC, *gguf_models.SPECS, *torch_models.SPECS, qwen_edit.SPEC, *audio_specs.SPECS]
if DEMO_MODE:
    _SPECS.append(demo.SPEC)

MODELS: dict[str, ModelSpec] = {s.id: s for s in _SPECS}
custom.register_all(MODELS)  # modèles ajoutés depuis Hugging Face
DEFAULT_MODEL_ID = qwen21.SPEC.id


def selected_variants() -> dict[str, str]:
    """Quantification choisie par modèle (réglages)."""
    from .. import db

    try:
        return dict(db.get_settings().get("variant", {}))
    except Exception:  # base absente : variantes par défaut
        return {}


def resolve(spec: ModelSpec, chosen: dict[str, str] | None = None) -> ModelSpec:
    """La spec avec la quantification choisie (ou celle par défaut)."""
    chosen = selected_variants() if chosen is None else chosen
    return with_variant(spec, chosen.get(spec.id))


def get_spec(model_id: str) -> ModelSpec:
    """Un modèle prêt à l'emploi : sources, options et précision de la quantification sélectionnée."""
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
