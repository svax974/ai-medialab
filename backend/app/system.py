"""Détection du matériel et des moteurs d'inférence disponibles (Metal, NVIDIA/CUDA, AMD/ROCm).

La sonde PyTorch tourne dans un sous-processus : importer torch coûte plusieurs secondes et des centaines
de Mo, et on ne veut pas les payer (ni les garder) dans le processus du serveur.
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
from typing import Any

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

_lock = threading.Lock()
_cache: dict[str, Any] | None = None


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
    if importlib.util.find_spec("torch") is None:
        return {"torch": None, "error": "PyTorch n'est pas installé dans ce runtime."}
    out = _run([sys.executable, "-c", _TORCH_PROBE], timeout=90)
    if out:
        for line in out.splitlines():
            if line.startswith("@@PROBE@@"):
                return json.loads(line[len("@@PROBE@@"):])
    return {"torch": None, "error": "La sonde PyTorch a échoué."}


def _gpu_names_fallback() -> list[dict[str, Any]]:
    """Noms de GPU vus par le système, indépendamment de PyTorch (utile pour diagnostiquer un runtime inadapté)."""
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


def _compute() -> dict[str, Any]:
    vm = psutil.virtual_memory()
    system = platform.system()
    arch = platform.machine()
    apple = system == "Darwin" and arch == "arm64"

    torch_info = _probe_torch()
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

    # Pour le diagnostic : GPU présents mais non exploitables par ce runtime.
    unusable = []
    if not torch_info.get("cuda"):
        for g in _gpu_names_fallback():
            if g["vendor"] in ("nvidia", "amd"):
                unusable.append({**g, "reason": _why_unusable(g["vendor"], torch_info)})

    engines = {
        "mlx": _engine_mlx(apple),
        "torch": _engine_torch(torch_info, accelerators),
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
        "torch": {k: torch_info.get(k) for k in ("torch", "cuda_version", "hip", "diffusers")},
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


def _engine_mlx(apple: bool) -> dict[str, Any]:
    if not apple:
        return {"available": False, "reason": "MLX nécessite un Mac Apple Silicon."}
    if importlib.util.find_spec("mflux") is None:
        return {"available": False, "reason": "mflux n'est pas installé dans ce runtime."}
    return {"available": True, "device": "metal"}


def _engine_torch(info: dict[str, Any], accelerators: list[dict[str, Any]]) -> dict[str, Any]:
    if info.get("torch") is None:
        return {"available": False, "reason": info.get("error") or "PyTorch est absent."}
    if info.get("diffusers") is None:
        return {"available": False, "reason": "diffusers est absent : " + str(info.get("diffusers_error", ""))}
    for a in accelerators:
        if a["backend"] in ("cuda", "rocm"):
            return {"available": True, "device": "cuda", "backend": a["backend"]}
    for a in accelerators:
        if a["backend"] == "metal" and a.get("torch_mps"):
            return {"available": True, "device": "mps", "backend": "metal"}
    return {"available": False, "reason": "Aucun GPU exploitable par PyTorch (CUDA, ROCm ou Metal)."}


def get_system(refresh: bool = False) -> dict[str, Any]:
    global _cache
    with _lock:
        if _cache is None or refresh:
            _cache = _compute()
        info = dict(_cache)
    # Valeurs qui changent à tout instant.
    info["ram_free_gb"] = round(psutil.virtual_memory().available / 1024**3, 1)
    info["disk"] = _disk_info(info["paths"]["models"])
    return info


def _disk_info(path: str) -> dict[str, Any]:
    probe = path
    while probe and not os.path.exists(probe):
        probe = os.path.dirname(probe)
    usage = shutil.disk_usage(probe or "/")
    return {"free_gb": round(usage.free / 1024**3, 1), "total_gb": round(usage.total / 1024**3, 1)}


def warm_up() -> None:
    """Lance la détection en arrière-plan au démarrage du serveur."""
    threading.Thread(target=get_system, daemon=True, name="system-probe").start()


# --- Planificateur mémoire -------------------------------------------------------------------------

def memory_plan(weights_gb: float | None, largest_gb: float | None, system: dict[str, Any], engine: str) -> dict[str, Any]:
    """Décide comment charger un modèle sur cette machine.

    strategy : "full" (tout sur le GPU), "model_offload" (un composant à la fois sur le GPU),
    "sequential" (couche par couche, très lent) ou "none" (ne tiendra pas).
    """
    if not weights_gb:
        return {"fits": True, "strategy": "full", "note": ""}
    ram = system["ram_gb"]
    accel = system["accelerators"][0] if system["accelerators"] else None

    if engine == "mlx":
        # Poids quantifiés + marge ; mémoire unifiée.
        ok = ram >= weights_gb * 0.55
        return {"fits": ok, "strategy": "full",
                "note": "" if ok else f"≈ {weights_gb * 0.55:.0f} Go de mémoire nécessaires, {ram:.0f} Go disponibles."}

    if accel is None:
        return {"fits": False, "strategy": "none", "note": "Aucun GPU compatible détecté."}
    if accel["unified"]:  # MPS : le « décharge CPU » n'a aucun intérêt, c'est la même mémoire.
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
