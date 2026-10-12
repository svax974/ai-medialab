"""Catalogue des modèles tel que vu par l'interface : disponibilité, compatibilité mémoire, installation."""

from __future__ import annotations

import re
from typing import Any

from . import audio_packs
from .downloads import downloads
from .engines import MODELS
from .jobs import load_settings
from .system import get_system, memory_plan


# Modèles conseillés pour démarrer, par ordre de préférence (légers d'abord, sous licences permissives d'abord).
STARTER_ORDER = ["z-image-turbo-gguf", "qwen-image-2.1-gguf", "qwen-image-2.1", "sdxl-base", "z-image-turbo"]
# Audio : Pocket TTS (clonage, français, temps réel sur CPU) puis Kokoro (le plus léger).
AUDIO_STARTER_ORDER = ["pocket-tts", "kokoro-82m", "qwen3-tts-custom-small"]


def _pack_plan(spec, system: dict[str, Any]) -> dict[str, Any]:
    """Les modèles audio tournent sur CPU ou GPU : seule la mémoire compte pour la faisabilité."""
    ram = system["ram_gb"]
    need = (spec.weights_gb or 0) * 1.6 + 1.5
    if ram < need:
        return {"fits": False, "strategy": "none", "note": f"Il faut ≈ {need:.0f} Go de mémoire ({ram:.0f} Go ici)."}
    gpu_tagged = "GPU" in spec.tags
    if gpu_tagged and not system["accelerators"]:
        return {"fits": True, "strategy": "full", "note": "Aucun GPU détecté : ce modèle sera très lent sur processeur."}
    return {"fits": True, "strategy": "full", "note": ""}


_QUANT = re.compile(r"(?<![A-Za-z0-9])((?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32)(?![A-Za-z0-9])", re.I)


def quant_from_name(name: str) -> str:
    """« z_image_turbo-Q4_K.gguf » -> « Q4_K »."""
    m = _QUANT.search(name.rsplit("/", 1)[-1])
    return m.group(1).upper() if m else ""


def precision_of(spec, quantize: int | None) -> str:
    """Précision des poids telle qu'elle sera utilisée (pour l'affichage)."""
    if spec.backend == "mlx":
        return f"{quantize} bits" if quantize else "bf16"
    if spec.precision:
        return spec.precision
    if spec.backend == "sdcpp":
        diffusion = spec.options.get("files", {}).get("diffusion-model") or spec.options.get("files", {}).get("model")
        return quant_from_name(diffusion[1]) if diffusion else ""
    return ""


_SDCPP_DEVICE = {"metal": "Metal", "cuda": "CUDA", "rocm": "ROCm", "vulkan": "Vulkan", "cpu": "processeur"}


def _engine_name(spec, engine: dict[str, Any]) -> str:
    if spec.backend == "pack":
        return engine.get("pack_engine") or engine.get("pack_name") or ""
    return {"sdcpp": "GGUF (stable-diffusion.cpp)", "torch": "PyTorch + diffusers", "mlx": "MLX (Apple Silicon)"}.get(spec.backend, "")


def _engine_detail(spec, engine: dict[str, Any]) -> str:
    """Ce que l'installation apporte, en clair."""
    if spec.backend == "pack":
        return f"environnement Python isolé avec {engine.get('pack_contents') or ''}".rstrip()
    if spec.backend == "sdcpp":
        dev = _SDCPP_DEVICE.get(engine.get("install_variant") or engine.get("variant") or "", "")
        return ("Petit programme autonome qui exécute les modèles GGUF, sans Python"
                + (f" ({dev})" if dev else "") + ". Il est téléchargé une seule fois et sert à tous les modèles GGUF.")
    return ""


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
        elif spec.backend == "pack":
            engine = audio_packs.engine_info(spec.options["pack"])
        else:
            engine = system["engines"].get(spec.backend, {"available": False, "reason": "Moteur inconnu."})
        # Un moteur que l'application sait installer n'est pas un obstacle : on proposera de l'installer.
        usable_engine = bool(engine["available"] or engine.get("installable"))
        if not usable_engine:
            plan = {"fits": False, "strategy": "none", "note": engine.get("reason", "")}
        elif spec.backend == "pack":
            plan = _pack_plan(spec, system)
        else:
            plan = memory_plan(spec.weights_gb, spec.largest_component_gb, system, spec.backend)
        status = downloads.status(spec)
        job = downloads.job(spec.id)
        compatible = bool(usable_engine and plan["fits"])
        quantize = settings["quantize"].get(spec.id, spec.default_quantize)
        m.update(
            quantize=quantize,
            precision=precision_of(spec, quantize),
            engine_available=engine["available"],
            engine_reason=engine.get("reason") if not engine.get("installable") else None,
            needs_engine_install=bool(engine.get("installable") and not engine["available"]),
            engine_install_size_mb=engine.get("install_size_mb"),
            engine_pack=spec.options.get("pack") if spec.backend == "pack" else None,
            engine_name=_engine_name(spec, engine),
            engine_detail=_engine_detail(spec, engine),
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

    def pick(kind: str, order: list[str]) -> dict[str, Any]:
        mine = [m for m in models if m["kind"] == kind and not (m.get("audio") or {}).get("task") == "stt"]
        ready = [m for m in mine if m["ready"]]
        usable = [m for m in mine if m["compatible"]]
        by_id = {m["id"]: m for m in usable}
        starter = next((by_id[i] for i in order if i in by_id), usable[0] if usable else None)
        # Par défaut : un modèle prêt, sinon un modèle déjà téléchargé, sinon celui qu'on recommande d'installer.
        default = ready[0] if ready else (next((m for m in usable if m["install"] == "installed"), None)
                                          or starter or (mine[0] if mine else None))
        return {"default_model_id": default["id"] if default else None,
                "recommended_model_id": starter["id"] if starter else None, "ready": bool(ready)}

    image = pick("image", STARTER_ORDER)
    audio = pick("audio", AUDIO_STARTER_ORDER)
    return {"models": models, **image, "audio": audio}
