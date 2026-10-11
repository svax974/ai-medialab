"""Catalogue des modèles tel que vu par l'interface : disponibilité, compatibilité mémoire, installation."""

from __future__ import annotations

from typing import Any

from .downloads import downloads
from .engines import MODELS
from .jobs import load_settings
from .system import get_system, memory_plan


def describe_models() -> dict[str, Any]:
    system = get_system()
    settings = load_settings()
    apple = system["os"] == "Darwin" and system["arch"] == "arm64"
    models: list[dict[str, Any]] = []
    for spec in MODELS.values():
        if spec.backend == "mlx" and not apple:
            continue  # MLX n'existe que sur Mac Apple Silicon : inutile de l'afficher ailleurs
        m = spec.to_public()
        if spec.backend == "demo":
            engine = {"available": True}
        else:
            engine = system["engines"].get(spec.backend, {"available": False, "reason": "Moteur inconnu."})
        plan = memory_plan(spec.weights_gb, spec.largest_component_gb, system, spec.backend) if engine["available"] else {
            "fits": False, "strategy": "none", "note": engine.get("reason", "")}
        status = downloads.status(spec)
        job = downloads.job(spec.id)
        m.update(
            quantize=settings["quantize"].get(spec.id, spec.default_quantize),
            engine_available=engine["available"],
            engine_reason=engine.get("reason"),
            compatible=bool(engine["available"] and plan["fits"]),
            plan=plan,
            install=status["state"],
            installed_gb=status["size_gb"],
            download=job.public() if job and job.state in ("running", "error") else None,
            # Rétro-compatibilité de l'interface : « téléchargé » = prêt à l'emploi.
            downloaded=status["state"] == "installed",
        )
        models.append(m)

    usable = [m for m in models if m["compatible"]]
    default = next((m for m in usable if m["install"] == "installed"), None) or (usable[0] if usable else None) or (
        models[0] if models else None)
    return {"models": models, "default_model_id": default["id"] if default else None}
