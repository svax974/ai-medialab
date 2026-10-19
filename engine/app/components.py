# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""What the app downloads besides the models: the "components", in two levels.

- **base** ("Données de base"): shared by several engines, installed once. The PyTorch add-on (diffusers, MLX) and FFmpeg
  (every video model).
- **engine** ("Moteur d'exécution"): runs one family of models. stable-diffusion.cpp, llama.cpp, audio.cpp and the Python
  packs (voices, Qwen3-TTS, Kiwi-Edit, Bernini).

A model needs a list of components (`components_of`), base first. Nothing here installs: `setup_runner.py` runs the installers
that already exist (`audio_packs`, `engine_install`, `llamacpp`), and `uninstall` removes a component together with the models
that need it, so no installed model is left without its engine. Pure functions take `system` (the hardware report) so tests
never probe the machine.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from typing import Any

from . import audio_packs
from .config import ENGINES_DIR
from .events import bus

BASE = "base"
ENGINE = "engine"
# Components of the "base" level; any other component is an engine.
BASE_IDS = ("torch", "ffmpeg")
SDCPP = "sdcpp"
LLAMACPP = "llamacpp"
# Order of the lists shown to the user.
ORDER = ("torch", "ffmpeg", SDCPP, LLAMACPP, "audiocpp", "speech", "qwen3", "kiwi", "bernini")


def kind_of(component_id: str) -> str:
    return BASE if component_id in BASE_IDS else ENGINE


def components_of(spec: Any) -> list[str]:
    """Components a model needs, base first (FFmpeg for every video model)."""
    base: list[str] = ["ffmpeg"] if spec.kind == "video" else []
    if spec.backend == "sdcpp":
        engine = [SDCPP]
    elif spec.backend == "llamacpp":
        engine = [LLAMACPP]
    elif pack := audio_packs.pack_of(spec):
        engine = [pack]
    else:  # demo model: nothing to install
        engine = []
    ids = [*base, *engine]
    return sorted(set(ids), key=lambda i: (kind_of(i) != BASE, ORDER.index(i) if i in ORDER else len(ORDER)))


def _system(system: dict[str, Any] | None) -> dict[str, Any]:
    if system is not None:
        return system
    from .system import get_system

    return get_system()


def _sdcpp_user_dir() -> Path:
    return ENGINES_DIR / "sdcpp"


def is_installed(component_id: str) -> bool:
    if component_id == SDCPP:
        from . import sdcpp

        return bool(sdcpp.find_variants())
    if component_id == LLAMACPP:
        from . import llamacpp

        return llamacpp.installed_binary() is not None
    return audio_packs.is_installed(component_id)


def removable(component_id: str) -> bool:
    """False for a build shipped inside the application (stable-diffusion.cpp's Metal / Vulkan builds): nothing to delete."""
    if component_id == SDCPP:
        return _sdcpp_user_dir().is_dir()
    return True


def name_and_contents(component_id: str) -> tuple[str, str]:
    if component_id == SDCPP:
        return "stable-diffusion.cpp", "Le moteur d'images et de vidéos au format GGUF (Metal, CUDA, ROCm ou Vulkan selon la machine)."
    if component_id == LLAMACPP:
        return "llama.cpp", "Le moteur du chat (modèles de langage GGUF), sans Python."
    pack = audio_packs.PACKS[component_id]
    return pack.name, pack.contents


def size_mb(component_id: str, system: dict[str, Any] | None = None) -> int:
    """Download size announced for the component on this machine (0 when unknown)."""
    if component_id in audio_packs.PACKS:
        return audio_packs.size_of(audio_packs.PACKS[component_id])
    engine = _system(system)["engines"].get(component_id, {})
    return int(engine.get("install_size_mb") or 0)


def blocked_reason(component_id: str, system: dict[str, Any] | None = None) -> str | None:
    """Why this machine cannot use the component at all (French), or None."""
    if component_id in audio_packs.PACKS:
        return audio_packs.unsupported_reason(audio_packs.PACKS[component_id], _system(system))
    return None


def disk_mb(component_id: str) -> int:
    """Space the installed component takes, in MB (0 when absent)."""
    if component_id == SDCPP:
        folder = _sdcpp_user_dir()
    elif component_id == LLAMACPP:
        from . import llamacpp

        folder = llamacpp.install_root()
    elif component_id == "audiocpp":
        from . import audiocpp

        folder = audiocpp.install_root()
    else:
        folder = audio_packs.pack_dir(component_id)
    return _folder_mb(folder)


def _folder_mb(folder: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(folder):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                continue
    return total >> 20


def dependants(component_id: str) -> list[dict[str, str]]:
    """Installed models that need the component: removing it removes them (id, name, kind)."""
    from .downloads import downloads
    from .engines import all_specs

    found = []
    for spec in all_specs():
        if component_id in components_of(spec) and spec.all_sources() and downloads.status(spec)["state"] == "installed":
            found.append({"id": spec.id, "name": spec.name, "kind": spec.kind})
    return found


def describe(system: dict[str, Any] | None = None, with_disk: bool = False) -> list[dict[str, Any]]:
    """Every component with its state, for the management page."""
    system = _system(system)
    rows = []
    for cid in ORDER:
        name, contents = name_and_contents(cid)
        installed = is_installed(cid)
        rows.append({
            "id": cid, "kind": kind_of(cid), "name": name, "contents": contents,
            "installed": installed, "removable": installed and removable(cid),
            "size_mb": size_mb(cid, system), "blocked": None if installed else blocked_reason(cid, system),
            "disk_mb": disk_mb(cid) if (with_disk and installed) else 0,
            "dependants": dependants(cid) if installed else [],
        })
    return rows


def in_use(component_id: str) -> str | None:
    """Why the component cannot be removed right now (French), or None: a model of it is loaded, or it is installing."""
    from .engine_install import installer as sdcpp_installer
    from .jobs import jobs
    from .llm import llm

    if component_id == LLAMACPP and llm.server is not None and llm.server.alive:
        return "Le moteur de chat est en cours d'utilisation : déchargez le modèle d'abord."
    if jobs.worker and jobs.worker.alive:
        from .engines import get_spec

        if component_id in components_of(get_spec(jobs.worker.model_id)):
            return "Ce moteur est en cours d'utilisation : déchargez le modèle d'abord."
    if component_id == SDCPP and sdcpp_installer.running:
        return "Une installation est en cours."
    if component_id == LLAMACPP:
        from . import llamacpp

        if llamacpp.installer.running:
            return "Une installation est en cours."
    return None


def remove_files(component_id: str) -> None:
    """Deletes the component (blocking, run it in a thread). The models that need it are handled by `uninstall`."""
    if component_id == SDCPP:
        shutil.rmtree(_sdcpp_user_dir(), ignore_errors=True)
    elif component_id == LLAMACPP:
        from . import llamacpp

        shutil.rmtree(llamacpp.install_root(), ignore_errors=True)
    else:
        audio_packs.installer.uninstall(component_id)
    if component_id in (SDCPP, LLAMACPP):
        from .system import get_system

        get_system(refresh=True)


async def uninstall(component_id: str) -> dict[str, Any]:
    """Removes a component and, first, the installed models that need it. Raises KeyError (unknown), RuntimeError (in use,
    built into the application, a download of one of those models is running)."""
    from .downloads import downloads

    if component_id not in ORDER:
        raise KeyError("Composant inconnu.")
    if not removable(component_id):
        raise RuntimeError("Ce moteur est intégré à l'application : il ne peut pas être supprimé.")
    if why := in_use(component_id):
        raise RuntimeError(why)
    models = dependants(component_id)
    if running := [m for m in models if (job := downloads.job(m["id"])) and job.state == "running"]:
        raise RuntimeError(f"Un téléchargement est en cours pour « {running[0]['name']} ».")
    for model in models:
        await asyncio.to_thread(downloads.delete, model["id"])
    await asyncio.to_thread(remove_files, component_id)  # replies once everything is deleted
    downloads.invalidate()
    bus.publish("models.changed", {})
    return {"ok": True, "removed_models": models}
