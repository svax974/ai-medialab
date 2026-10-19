# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Model catalog as the UI sees it: availability, memory fit, install state."""

from __future__ import annotations

import re
from typing import Any

from . import audio_packs
from .downloads import downloads
from .engines import MODELS, resolve, selected_variants
from .engines.base import with_variant
from .i18n import translate
from .jobs import load_settings
from .system import get_system, memory_plan


# Suggested first models, in order of preference (light and permissively licensed first).
STARTER_ORDER = ["z-image-turbo-gguf", "qwen-image-2.1-gguf", "qwen-image-2.1", "sdxl-base", "z-image-turbo"]
# Audio: Pocket TTS (cloning, French, real time on CPU), then Kokoro (lightest).
AUDIO_STARTER_ORDER = ["pocket-tts", "kokoro-82m", "qwen3-tts-custom-small"]
# Video: Wan 2.2 TI2V 5B in GGUF first (runs on every GPU), then its PyTorch version and the lightest CogVideoX.
# HunyuanVideo (restrictive licence) and the gated LTX-2.5 are never suggested.
VIDEO_STARTER_ORDER = ["wan-2.2-ti2v-5b-gguf", "wan-2.2-ti2v-5b", "cogvideox-2b"]
# Chat: Qwen3 4B Instruct (2.3 GB, Apache 2.0, good in French), then the small Gemma 4 (reads images), Qwen3 8B (thinks)
# and the lightest model.
LLM_STARTER_ORDER = ["llm-qwen3-4b-instruct-2507", "llm-gemma-4-e4b", "llm-qwen3-8b", "llm-lfm2.5-1.2b"]
# Diagrams: same preference as chat (these are the same GGUF files, see engines/diagram_models.py).
DIAGRAM_STARTER_ORDER = ["diagram-qwen3-4b-instruct-2507", "diagram-qwen3-8b", "diagram-gemma-4-12b", "diagram-gpt-oss-20b"]


def _pack_plan(spec, system: dict[str, Any]) -> dict[str, Any]:
    """Audio models run on CPU or GPU, so only memory decides feasibility; video packs also need enough video memory."""
    if spec.kind == "video":
        return _video_pack_plan(spec, system)
    ram = system["ram_gb"]
    need = (spec.weights_gb or 0) * 1.6 + 1.5
    if ram < need:
        return {"fits": False, "strategy": "none", "note": f"Il faut ≈ {need:.0f} Go de mémoire ({ram:.0f} Go ici)."}
    return {"fits": True, "strategy": "full", "note": "", **_degraded(spec, system)}


def _degraded(spec, system: dict[str, Any]) -> dict[str, Any]:
    """Marks a PyTorch model that would run on the CPU here because no GPU it can drive exists, and names the GGUF
    twin (audio.cpp, any GPU) when there is one. Models made for the CPU (tag "CPU") and native engines never are."""
    pack = audio_packs.PACKS.get(spec.options.get("pack", ""))
    if spec.backend != "pack" or not pack or pack.native or "CPU" in spec.tags:
        return {}
    if audio_packs.torch_acceleration(system):
        return {}
    twin = MODELS.get(spec.options.get("twin", ""))
    note = "Aucun GPU exploitable par PyTorch ici (CUDA, ROCm sous Linux ou Metal) : ce modèle tournera sur le processeur, très lentement."
    if twin:
        note += f" Alternative qui utilise votre GPU : « {twin.name} »."
    return {"degraded": True, "alternative": {"id": twin.id, "name": twin.name} if twin else None, "note": note}


def _video_pack_plan(spec, system: dict[str, Any]) -> dict[str, Any]:
    """Video packs load their weights unquantized: compare with the video memory and RAM the spec asks for."""
    need_ram, need_vram = spec.options.get("min_ram_gb"), spec.options.get("min_vram_gb")
    if need_ram and system["ram_gb"] < need_ram:
        return {"fits": False, "strategy": "none",
                "note": f"Il faut ≈ {need_ram:.0f} Go de mémoire vive ({system['ram_gb']:.0f} Go ici)."}
    vram = max((a.get("memory_gb") or 0 for a in system["accelerators"] if a["backend"] in ("cuda", "rocm")), default=0)
    if need_vram and vram and vram < need_vram:
        return {"fits": False, "strategy": "none",
                "note": f"Il faut ≈ {need_vram:.0f} Go de mémoire vidéo ({vram:.0f} Go ici)."}
    note = ""
    if need_vram and not vram:
        note = f"Mémoire de la carte graphique non détectée : vérifiez qu'elle atteint ≈ {need_vram:.0f} Go."
    return {"fits": True, "strategy": "full", "note": note}


_QUANT = re.compile(r"(?<![A-Za-z0-9])((?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32)(?![A-Za-z0-9])", re.I)


def quant_from_name(name: str) -> str:
    """'z_image_turbo-Q4_K.gguf' -> 'Q4_K'."""
    m = _QUANT.search(name.rsplit("/", 1)[-1])
    return m.group(1).upper() if m else ""


def precision_of(spec, quantize: int | None) -> str:
    """Weight precision as it will be used (display only)."""
    if spec.precision:
        return spec.precision
    if spec.backend == "mlx":
        return f"{quantize} bits" if quantize else "bf16"
    if spec.backend in ("sdcpp", "llamacpp"):
        diffusion = spec.options.get("files", {}).get("diffusion-model") or spec.options.get("files", {}).get("model")
        return quant_from_name(diffusion[1]) if diffusion else ""
    return ""


_SDCPP_DEVICE = {"metal": "Metal", "cuda": "CUDA", "rocm": "ROCm", "vulkan": "Vulkan", "cpu": "processeur"}


def _engine_name(spec, engine: dict[str, Any]) -> str:
    if spec.backend == "pack":
        return engine.get("pack_engine") or engine.get("pack_name") or ""
    return {"sdcpp": "GGUF (stable-diffusion.cpp)", "llamacpp": "llama.cpp", "torch": "PyTorch + diffusers",
            "mlx": "MLX (Apple Silicon)"}.get(spec.backend, "")



def _engine_detail(spec, engine: dict[str, Any]) -> str:
    """Plain-language description of what installing brings (UI text)."""
    if spec.backend in audio_packs.OVERLAY_BACKENDS:
        return f"Environnement Python isolé avec {translate(engine.get('pack_contents') or '')}".rstrip()
    if spec.backend == "pack":
        pack = audio_packs.PACKS.get(engine.get("pack") or "")
        if pack and pack.native:  # prebuilt binaries: nothing Python to install
            return f"Programme autonome : {translate(engine.get('pack_contents') or '')}".rstrip()
        return f"environnement Python isolé avec {translate(engine.get('pack_contents') or '')}".rstrip()
    if spec.backend == "sdcpp":
        dev = _SDCPP_DEVICE.get(engine.get("install_variant") or engine.get("variant") or "", "")
        where = f" ({dev})" if dev else ""
        return f"Petit programme autonome qui exécute les modèles GGUF, sans Python{where}. Il est téléchargé une seule fois et sert à tous les modèles GGUF."
    if spec.backend == "llamacpp":
        dev = _SDCPP_DEVICE.get(engine.get("install_variant") or engine.get("variant") or "", "")
        where = f" ({dev})" if dev else ""
        return f"Petit programme autonome qui exécute les modèles de conversation (GGUF), sans Python{where}. Il est téléchargé une seule fois et sert à tous les modèles de chat."
    return ""


def _variant_info(base, v, selected: str) -> dict[str, Any]:
    st = downloads.status(with_variant(base, v.key))
    return {"key": v.key, "label": v.label, "size_gb": v.size_gb, "install": st["state"], "installed_gb": st["size_gb"],
            "need_gb": st["need_gb"], "temp_gb": st.get("temp_gb", 0.0), "selected": v.key == selected}


def engine_for(backend: str, pack: str | None, system: dict[str, Any]) -> dict[str, Any]:
    """Engine status (same shape as `system["engines"]`) for a model backend, on this machine."""
    if backend == "demo":
        return {"available": True}
    if backend == "pack":
        return audio_packs.engine_info(pack or "")
    return system["engines"].get(backend, {"available": False, "reason": "Moteur inconnu."})


def engine_compat(backend: str, pack: str | None = None, system: dict[str, Any] | None = None) -> dict[str, Any]:
    """{compatible, reason}: can this machine run (or install the engine for) a model of this backend?

    Shared by the preset list and the Hugging Face search so both mark the same models as unusable."""
    engine = engine_for(backend, pack, system or get_system())
    ok = bool(engine["available"] or engine.get("installable"))
    return {"compatible": ok, "reason": "" if ok else engine.get("reason", "")}


def _engine_and_plan(spec, system: dict[str, Any]) -> tuple[dict[str, Any], bool, dict[str, Any]]:
    """(engine status, engine usable, memory plan) of a model on this machine."""
    engine = engine_for(spec.backend, spec.options.get("pack"), system)
    # An engine the app can install is not a blocker; the UI offers to install it.
    usable = bool(engine["available"] or engine.get("installable"))
    if not usable:
        plan = {"fits": False, "strategy": "none", "note": engine.get("reason", "")}
    elif spec.backend == "pack":
        plan = _pack_plan(spec, system)
    else:
        plan = memory_plan(spec.weights_gb, spec.largest_component_gb, system, spec.backend,
                           spec.options.get("overhead_gb", 0.0))
    return engine, usable, plan


def plan_for(spec, system: dict[str, Any] | None = None) -> dict[str, Any]:
    """{compatible, note, degraded}: can this machine run the model, and what to tell the user when it cannot.

    The same verdict as the model list, for a model that is not in it yet (Hugging Face search)."""
    _engine, usable, plan = _engine_and_plan(spec, system or get_system())
    return {"compatible": bool(usable and plan["fits"]), "note": plan.get("note", ""),
            "degraded": bool(plan.get("degraded"))}


def describe_models() -> dict[str, Any]:
    system = get_system()
    settings = load_settings()
    apple = system["os"] == "Darwin" and system["arch"] == "arm64"
    models: list[dict[str, Any]] = []
    chosen = selected_variants()
    for base in MODELS.values():
        spec = resolve(base, chosen)
        if spec.backend == "mlx" and not apple:
            continue  # MLX only runs on Apple Silicon Macs, no point listing it elsewhere
        m = spec.to_public()
        engine, usable_engine, plan = _engine_and_plan(spec, system)
        status = downloads.status(spec)
        job = downloads.job(spec.id)
        compatible = bool(usable_engine and plan["fits"])
        quantize = settings["quantize"].get(spec.id, spec.default_quantize)
        m.update(
            variants=[_variant_info(base, v, spec.variant) for v in base.variants],
            variant=spec.variant,
            quantize=quantize,
            precision=precision_of(spec, quantize),
            engine_available=engine["available"],
            engine_reason=engine.get("reason") if not engine.get("installable") else None,
            needs_engine_install=bool(engine.get("installable") and not engine["available"]),
            engine_install_size_mb=engine.get("install_size_mb"),
            engine_pack=audio_packs.pack_of(spec),
            engine_name=_engine_name(spec, engine),
            engine_detail=_engine_detail(spec, engine),
            compatible=compatible,
            plan=plan,
            install=status["state"],
            installed_gb=status["size_gb"],
            temp_download_gb=status.get("temp_gb", 0.0),
            download=job.public() if job and job.state in ("running", "error") else None,
            ready=bool(compatible and engine["available"] and status["state"] == "installed"),
            # Kept for older UI code: "downloaded" means installed.
            downloaded=status["state"] == "installed",
        )
        models.append(m)

    def pick(kind: str, order: list[str]) -> dict[str, Any]:
        mine = [m for m in models if m["kind"] == kind and not (m.get("audio") or {}).get("task") == "stt"]
        ready = [m for m in mine if m["ready"]]
        usable = [m for m in mine if m["compatible"]]
        usable = [m for m in usable if not m["plan"].get("degraded")] or usable  # slow-on-CPU models only as a last resort
        by_id = {m["id"]: m for m in usable}
        starter = next((by_id[i] for i in order if i in by_id), usable[0] if usable else None)
        # Default: a ready model, else one already downloaded, else the recommended one.
        default = ready[0] if ready else (next((m for m in usable if m["install"] == "installed"), None)
                                          or starter or (mine[0] if mine else None))
        return {"default_model_id": default["id"] if default else None,
                "recommended_model_id": starter["id"] if starter else None, "ready": bool(ready)}

    image = pick("image", STARTER_ORDER)
    audio = pick("audio", AUDIO_STARTER_ORDER)
    video = pick("video", VIDEO_STARTER_ORDER)
    llm = pick("llm", LLM_STARTER_ORDER)
    diagram = pick("diagram", DIAGRAM_STARTER_ORDER)
    return {"models": models, **image, "audio": audio, "video": video, "llm": llm, "diagram": diagram}
