"""Catalogue des modèles tel que vu par l'interface : disponibilité, compatibilité mémoire, installation."""

from __future__ import annotations

from typing import Any

from .downloads import downloads
from .engines import MODELS
from .jobs import load_settings
from .system import get_system, memory_plan


# Modèles conseillés pour démarrer, par ordre de préférence (légers d'abord, sous licences permissives d'abord).
STARTER_ORDER = ["z-image-turbo-gguf", "qwen-image-2.1-gguf", "qwen-image-2.1", "sdxl-base", "z-image-turbo"]


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
        # Un moteur que l'application sait installer n'est pas un obstacle : on proposera de l'installer.
        usable_engine = bool(engine["available"] or engine.get("installable"))
        plan = memory_plan(spec.weights_gb, spec.largest_component_gb, system, spec.backend) if usable_engine else {
            "fits": False, "strategy": "none", "note": engine.get("reason", "")}
        status = downloads.status(spec)
        job = downloads.job(spec.id)
        compatible = bool(usable_engine and plan["fits"])
        m.update(
            quantize=settings["quantize"].get(spec.id, spec.default_quantize),
            engine_available=engine["available"],
            engine_reason=engine.get("reason") if not engine.get("installable") else None,
            needs_engine_install=bool(engine.get("installable") and not engine["available"]),
            engine_install_size_mb=engine.get("install_size_mb"),
            compatible=compatible,
            plan=plan,
            install=status["state"],
            installed_gb=status["size_gb"],
            download=job.public() if job and job.state in ("running", "error") else None,
            ready=bool(compatible and engine["available"] and status["state"] == "installed"),
            # Rétro-compatibilité de l'interface : « téléchargé » = prêt à l'emploi.
            downloaded=status["state"] == "installed",
        )
        models.append(m)

    ready = [m for m in models if m["ready"]]
    usable = [m for m in models if m["compatible"]]
    by_id = {m["id"]: m for m in usable}
    starter = next((by_id[i] for i in STARTER_ORDER if i in by_id), usable[0] if usable else None)
    # Par défaut : un modèle prêt, sinon un modèle déjà téléchargé, sinon celui qu'on recommande d'installer.
    default = ready[0] if ready else (next((m for m in usable if m["install"] == "installed"), None)
                                      or starter or (models[0] if models else None))
    return {
        "models": models,
        "default_model_id": default["id"] if default else None,
        "recommended_model_id": starter["id"] if starter else None,
        "ready": bool(ready),
    }
