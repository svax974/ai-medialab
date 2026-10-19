# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Detects the hardware and available inference engines (Metal, NVIDIA/CUDA, AMD/ROCm).

The PyTorch probe runs in a subprocess: importing torch takes seconds and hundreds of MB, which we
don't want to pay for (or keep) in the server process. It runs once per process (the runtime does not change) in the
background: until it ends, `get_system()` answers at once with the rest (memory, disk, Apple Silicon or the GPUs the OS
sees, llama.cpp, stable-diffusion.cpp), `torch.pending` true and the torch engine unavailable; the end of the probe drops
the cache and calls the callback given to `warm_up` (the server publishes `models.changed`).
"""

from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
from typing import Any, Callable

import psutil

from .config import DATA_DIR

_TORCH_PROBE = r"""
import json
out = {"torch": None, "cuda": False, "hip": None, "mps": False, "devices": []}
try:
    import torch
    out["torch"] = torch.__version__
    out["hip"] = getattr(torch.version, "hip", None)
    out["cuda_version"] = getattr(torch.version, "cuda", None)
    if torch.cuda.is_available():
        out["cuda"] = True
        for i in range(torch.cuda.device_count()):
            p = torch.cuda.get_device_properties(i)
            out["devices"].append({"name": p.name, "memory_gb": round(p.total_memory / 1024**3, 1)})
    out["mps"] = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    try:
        import diffusers
        out["diffusers"] = diffusers.__version__
    except Exception as exc:
        out["diffusers_error"] = str(exc)
except Exception as exc:
    out["error"] = str(exc)
print("@@PROBE@@" + json.dumps(out))
"""

_PENDING_TORCH: dict[str, Any] = {"torch": None, "pending": True}

_lock = threading.Lock()
_cache: dict[str, Any] | None = None
_torch_info: dict[str, Any] | None = None  # result of the probe, None until it ends
_probe_started = False
_on_probe_done: Callable[[], None] | None = None


def hf_cache_dir() -> str:
    from huggingface_hub import constants

    return str(constants.HF_HUB_CACHE)


def _run(cmd: list[str], timeout: float = 6) -> str | None:
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return res.stdout if res.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _probe_torch() -> dict[str, Any]:
    from . import audio_packs

    overlays = audio_packs.overlay_paths()
    if not overlays and importlib.util.find_spec("torch") is None:
        return {"torch": None, "error": "PyTorch n'est pas installé dans ce runtime."}
    # The add-on's packages are put first on the import path of the probe process only: the server never imports torch.
    out = _run([sys.executable, "-c", f"import sys; sys.path[:0] = {overlays!r}\n{_TORCH_PROBE}"], timeout=90)
    if out:
        for line in out.splitlines():
            if line.startswith("@@PROBE@@"):
                return json.loads(line[len("@@PROBE@@"):])
    return {"torch": None, "error": "La sonde PyTorch a échoué."}


def reprobe() -> None:
    """Probes PyTorch again (an add-on of the runtime was installed or removed); the hardware report is rebuilt after it."""
    global _probe_started, _torch_info, _cache
    with _lock:
        _probe_started = False
        _torch_info = None
        _cache = None
    _start_probe()


def _gpu_names_fallback() -> list[dict[str, Any]]:
    """GPU names as the OS sees them, independent of PyTorch (helps diagnose a mismatched runtime)."""
    found: list[dict[str, Any]] = []
    if shutil.which("nvidia-smi"):
        out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        for line in (out or "").splitlines():
            name, _, mem = line.partition(",")
            found.append({"vendor": "nvidia", "name": name.strip(), "memory_gb": round(float(mem or 0) / 1024, 1)})
    if platform.system() == "Windows" and not found:
        out = _run(["powershell", "-NoProfile", "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"])
        for name in (out or "").splitlines():
            name = name.strip()
            if not name:
                continue
            low = name.lower()
            vendor = "nvidia" if "nvidia" in low else "amd" if ("amd" in low or "radeon" in low) else "other"
            found.append({"vendor": vendor, "name": name, "memory_gb": None})
    elif platform.system() == "Linux" and not found:
        out = _run(["lspci"]) or ""
        for line in out.splitlines():
            if "VGA" in line or "3D controller" in line or "Display controller" in line:
                low = line.lower()
                vendor = "nvidia" if "nvidia" in low else "amd" if ("amd" in low or "ati" in low) else "other"
                found.append({"vendor": vendor, "name": line.split(": ", 1)[-1].strip(), "memory_gb": None})
    return found


def _compute(torch_info: dict[str, Any]) -> dict[str, Any]:
    vm = psutil.virtual_memory()
    system = platform.system()
    arch = platform.machine()
    apple = system == "Darwin" and arch == "arm64"

    accelerators: list[dict[str, Any]] = []
    if torch_info.get("cuda"):
        hip = bool(torch_info.get("hip"))
        for d in torch_info["devices"]:
            accelerators.append({
                "vendor": "amd" if hip else "nvidia",
                "backend": "rocm" if hip else "cuda",
                "name": d["name"],
                "memory_gb": d["memory_gb"],
                "unified": False,
            })
    if torch_info.get("mps") or apple:
        accelerators.append({
            "vendor": "apple",
            "backend": "metal",
            "name": _chip_name(),
            "memory_gb": round(vm.total / 1024**3, 1),
            "unified": True,
            "torch_mps": bool(torch_info.get("mps")),
        })

    # Diagnostics: GPUs present but unusable by PyTorch in this runtime.
    unusable = []
    fallback_gpus = _gpu_names_fallback()
    if not torch_info.get("cuda") and torch_info.get("torch") is not None:
        for g in fallback_gpus:
            if g["vendor"] in ("nvidia", "amd"):
                unusable.append({**g, "reason": _why_unusable(g["vendor"], torch_info)})
    if not accelerators:  # no PyTorch in this runtime: list the GPUs the OS sees (VRAM may be unknown)
        for g in fallback_gpus:
            accelerators.append({"vendor": g["vendor"], "backend": "vulkan", "name": g["name"],
                                 "memory_gb": g.get("memory_gb"), "unified": False})

    hardware = {"os": system, "accelerators": accelerators, "unusable_gpus": unusable}
    engines = {
        "mlx": _engine_mlx(apple, hardware),
        "torch": _engine_torch(torch_info, accelerators, hardware),
        "sdcpp": _engine_sdcpp(accelerators),
        "llamacpp": _engine_llamacpp(accelerators),
    }
    from huggingface_hub import constants

    cache = str(constants.HF_HUB_CACHE)
    return {
        "os": system,
        "arch": arch,
        "cpu": platform.processor() or arch,
        "cpu_cores": psutil.cpu_count(logical=False) or psutil.cpu_count(),
        "ram_gb": round(vm.total / 1024**3, 1),
        "ram_free_gb": round(vm.available / 1024**3, 1),
        "accelerators": accelerators,
        "unusable_gpus": unusable,
        "engines": engines,
        "torch": {**{k: torch_info.get(k) for k in ("torch", "cuda_version", "hip", "diffusers")},
                  "pending": bool(torch_info.get("pending"))},
        "paths": {"data": str(DATA_DIR), "models": cache},
        "python": sys.version.split()[0],
    }


def _chip_name() -> str:
    out = _run(["sysctl", "-n", "machdep.cpu.brand_string"])
    return (out or "Apple Silicon").strip()


def _why_unusable(vendor: str, torch_info: dict[str, Any]) -> str:
    if torch_info.get("torch") is None:
        return "PyTorch est absent du runtime."
    if vendor == "nvidia":
        return "Ce runtime embarque PyTorch sans CUDA : utilisez la version « NVIDIA » de l'application."
    return "Ce runtime embarque PyTorch sans ROCm : utilisez la version « AMD » de l'application (RDNA 3/4 sur Windows ; Linux/ROCm pour les autres cartes)."


def _engine_mlx(apple: bool, hardware: dict[str, Any]) -> dict[str, Any]:
    """MLX comes with the add-on of the runtime (mflux), or with the runtime itself in development."""
    from . import audio_packs

    if not apple:
        return {"available": False, "reason": "MLX nécessite un Mac Apple Silicon."}
    if audio_packs.is_installed("torch") or importlib.util.find_spec("mflux") is not None:
        return {"available": True, "device": "metal"}
    return audio_packs.engine_info("torch", hardware)


def _engine_torch(info: dict[str, Any], accelerators: list[dict[str, Any]], hardware: dict[str, Any]) -> dict[str, Any]:
    from . import audio_packs

    if info.get("pending"):
        return {"available": False, "pending": True, "reason": "Détection de PyTorch en cours…"}
    if info.get("torch") is None:
        if not audio_packs.is_installed("torch"):  # absent from the runtime: the app can install it
            return audio_packs.engine_info("torch", hardware)
        return {"available": False, "reason": info.get("error") or "PyTorch est absent."}
    if info.get("diffusers") is None:
        return {"available": False, "reason": f"diffusers est absent : {info.get('diffusers_error', '')}"}
    for a in accelerators:
        if a["backend"] in ("cuda", "rocm"):
            return {"available": True, "device": "cuda", "backend": a["backend"]}
    for a in accelerators:
        if a["backend"] == "metal" and a.get("torch_mps"):
            return {"available": True, "device": "mps", "backend": "metal"}
    return {"available": False, "reason": "Aucun GPU exploitable par PyTorch (CUDA, ROCm ou Metal)."}


def _engine_sdcpp(accelerators: list[dict[str, Any]]) -> dict[str, Any]:
    from . import sdcpp

    from . import engine_install

    vendors = [a["vendor"] for a in accelerators]
    res = sdcpp.pick(vendors)
    if res["available"]:
        res["device"] = res["variant"]
        return res
    # Not usable: can the app install it itself?
    present = set(sdcpp.find_variants())
    candidates = [v for v in engine_install.candidate_variants(vendors) if v not in present]
    if candidates:
        res["installable"] = True
        res["install_variant"] = candidates[0]
        res["install_size_mb"] = engine_install.install_size_mb(candidates[0])
    return res


def _engine_llamacpp(accelerators: list[dict[str, Any]]) -> dict[str, Any]:
    """llama.cpp (chat models): installed, or installable by the app (every release has a CPU build, so always)."""
    from . import llamacpp

    return llamacpp.pick([a["vendor"] for a in accelerators])


def get_system(refresh: bool = False) -> dict[str, Any]:
    """Hardware and engines; never waits for the PyTorch probe (see the module docstring). `refresh`: detect again
    (an engine was installed); the probe result is kept."""
    global _cache
    _start_probe()
    with _lock:
        if _cache is None or refresh:
            _cache = _compute(_torch_info or _PENDING_TORCH)
        info = dict(_cache)
    # These change constantly, so they're never cached.
    info["ram_free_gb"] = round(psutil.virtual_memory().available / 1024**3, 1)
    info["disk"] = _disk_info(info["paths"]["models"])
    return info


def _disk_info(path: str) -> dict[str, Any]:
    probe = path
    while probe and not os.path.exists(probe):
        probe = os.path.dirname(probe)
    usage = shutil.disk_usage(probe or "/")
    return {"free_gb": round(usage.free / 1024**3, 1), "total_gb": round(usage.total / 1024**3, 1)}


def _start_probe() -> None:
    global _probe_started
    with _lock:
        if _probe_started:
            return
        _probe_started = True
    threading.Thread(target=_finish_probe, daemon=True, name="torch-probe").start()


def _finish_probe() -> None:
    global _torch_info, _cache
    info = _probe_torch()
    with _lock:
        _torch_info = info
        _cache = None
        callback = _on_probe_done
    if callback is not None:
        callback()


def warm_up(on_probe_done: Callable[[], None] | None = None) -> None:
    """Start the PyTorch probe at server startup; `on_probe_done` is called from its thread once it ended."""
    global _on_probe_done
    _on_probe_done = on_probe_done
    _start_probe()


def _llamacpp_plan(need_gb: float, system: dict[str, Any], accel: dict[str, Any] | None) -> dict[str, Any]:
    """Chat model (weights plus KV cache plus buffers, see `engines/llm_models.memory_need_gb`) on llama.cpp: on the GPU
    when it holds everything (`-ngl all`), else the layers that do not fit run on the CPU (slower, `--fit` places them),
    and without a GPU everything runs on the CPU. Unified memory is one pool, kept to 1.2 times the need."""
    ram = system["ram_gb"]
    if accel is not None and accel["unified"]:
        ok = ram >= need_gb * 1.2
        return {"fits": ok, "strategy": "full",
                "note": "" if ok else f"Il faut ≈ {need_gb * 1.2:.0f} Go de mémoire ({ram:.0f} Go ici)."}
    vram = (accel or {}).get("memory_gb")
    if accel is not None and (vram is None or vram >= need_gb * 1.1):
        return {"fits": True, "strategy": "full", "note": ""}
    if ram + (vram or 0) >= need_gb * 1.3:
        note = ("Aucun GPU détecté : tout ou partie du modèle tourne sur le processeur (plus lent)." if accel is None else
                f"{vram:.0f} Go de VRAM < {need_gb:.0f} Go : tout ou partie du modèle tourne sur le processeur (plus lent).")
        return {"fits": True, "strategy": "model_offload", "note": note}
    return {"fits": False, "strategy": "none",
            "note": f"{(vram or 0):.0f} Go de VRAM et {ram:.0f} Go de RAM ne suffisent pas ({need_gb:.0f} Go nécessaires)."}


def memory_plan(weights_gb: float | None, largest_gb: float | None, system: dict[str, Any], engine: str,
                overhead_gb: float = 0.0) -> dict[str, Any]:
    """Decide how to load a model on this machine.

    `overhead_gb`: memory used while computing on top of the weights (video latents and attention), GGUF engine only.

    strategy: "full" (all on the GPU), "model_offload" (one component at a time on the GPU),
    "sequential" (layer by layer, very slow) or "none" (won't fit).
    """
    if not weights_gb:
        return {"fits": True, "strategy": "full", "note": ""}
    ram = system["ram_gb"]
    accel = system["accelerators"][0] if system["accelerators"] else None

    if engine == "mlx":
        # Quantized weights plus headroom; unified memory.
        ok = ram >= weights_gb * 0.55
        return {"fits": ok, "strategy": "full",
                "note": "" if ok else f"≈ {weights_gb * 0.55:.0f} Go de mémoire nécessaires, {ram:.0f} Go disponibles."}

    if engine == "sdcpp":
        # Quantized (GGUF) weights; stable-diffusion.cpp places them itself based on free memory
        # (GPU, then RAM, then disk: --auto-fit). VRAM only affects speed, not feasibility.
        if accel is None:
            return {"fits": False, "strategy": "none", "note": "Aucun GPU compatible détecté."}
        weights_gb = weights_gb + overhead_gb
        if accel["unified"]:
            ok = ram >= weights_gb * 1.3
            return {"fits": ok, "strategy": "full",
                    "note": "" if ok else f"Il faut ≈ {weights_gb * 1.3:.0f} Go de mémoire ({ram:.0f} Go ici)."}
        vram = accel["memory_gb"]
        if vram is None or vram >= weights_gb * 1.1:
            return {"fits": True, "strategy": "full", "note": ""}
        if ram + vram >= weights_gb * 1.2:
            return {"fits": True, "strategy": "model_offload",
                    "note": f"{vram:.0f} Go de VRAM < {weights_gb:.0f} Go de poids : une partie reste en RAM (plus lent)."}
        return {"fits": False, "strategy": "none",
                "note": f"{vram:.0f} Go de VRAM + {ram:.0f} Go de RAM ne suffisent pas ({weights_gb:.0f} Go de poids)."}

    if engine == "llamacpp":
        return _llamacpp_plan(weights_gb + overhead_gb, system, accel)

    if accel is None:
        return {"fits": False, "strategy": "none", "note": "Aucun GPU compatible détecté."}
    if accel["unified"]:  # MPS: CPU offload is pointless, it is the same memory.
        ok = ram >= weights_gb * 1.35
        return {"fits": ok, "strategy": "full",
                "note": "" if ok else f"Il faut ≈ {weights_gb * 1.35:.0f} Go de mémoire unifiée en pleine précision ({ram:.0f} Go ici). "
                                      "Préférez la variante MLX quantifiée."}
    vram = accel["memory_gb"] or 0
    largest = largest_gb or weights_gb
    if vram >= weights_gb * 1.1:
        return {"fits": True, "strategy": "full", "note": ""}
    if vram >= largest * 1.15 and ram >= weights_gb * 1.1:
        return {"fits": True, "strategy": "model_offload",
                "note": f"{vram:.0f} Go de VRAM < {weights_gb:.0f} Go : les composants passent un à un sur le GPU (plus lent)."}
    if ram >= weights_gb * 1.1 and vram >= 6:
        return {"fits": True, "strategy": "sequential",
                "note": "VRAM très limitée : déchargement couche par couche, génération très lente."}
    return {"fits": False, "strategy": "none",
            "note": f"{vram:.0f} Go de VRAM et {ram:.0f} Go de RAM ne suffisent pas pour ce modèle ({weights_gb:.0f} Go)."}
