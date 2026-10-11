"""Binaires stable-diffusion.cpp (GGUF) : localisation, détection des GPU utilisables, choix du backend.

Un « variant » est une build du même programme pour un backend de calcul : metal (macOS), cuda, rocm,
vulkan (tous GPU, y compris NVIDIA, AMD et Intel) ou cpu. Ils vivent dans `<engines>/sdcpp/<variant>/` ;
`scripts/fetch_sdcpp.py` les télécharge depuis les versions officielles (somme de contrôle vérifiée).

Le variant est choisi d'après le GPU détecté (CUDA sur NVIDIA, ROCm sur AMD, Metal sur Apple, Vulkan sinon),
avec repli sur Vulkan ; `IMAGEGEN_SDCPP_VARIANT` impose un variant (utile pour comparer les vitesses).
"""

from __future__ import annotations

import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import ROOT_DIR

VARIANTS = ("metal", "cuda", "rocm", "vulkan", "cpu")
# Ordre de préférence selon le fournisseur du GPU.
PREFERENCE = {
    "apple": ("metal", "vulkan"),
    "nvidia": ("cuda", "vulkan"),
    "amd": ("rocm", "vulkan"),
    "other": ("vulkan",),
}
NON_GPU = {"CPU", "BLAS"}


def engines_roots() -> list[Path]:
    roots = []
    if env := os.environ.get("IMAGEGEN_ENGINES_DIR"):
        roots.append(Path(env))
    roots.append(ROOT_DIR / "engines")  # développement : <projet>/engines ; application : <ressources>/engines
    return roots


def binary_name(tool: str = "sd-cli") -> str:
    return f"{tool}.exe" if sys.platform == "win32" else tool


def find_variants() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for root in engines_roots():
        for variant in VARIANTS:
            p = root / "sdcpp" / variant / binary_name()
            if variant not in found and p.is_file():
                found[variant] = p
    return found


@lru_cache(maxsize=16)
def _devices(binary: str, mtime: float) -> tuple[tuple[str, str], ...]:
    """Appareils de calcul vus par cette build (`--list-devices`) : [(nom, description)]."""
    try:
        out = subprocess.run([binary, "--list-devices"], capture_output=True, text=True, timeout=30,
                             cwd=str(Path(binary).parent)).stdout
    except (OSError, subprocess.SubprocessError):
        return ()
    devices = []
    for line in out.splitlines():
        name, _, desc = line.partition("\t")
        if name and desc and " " not in name.strip():
            devices.append((name.strip(), desc.strip()))
    return tuple(devices)


def list_devices(binary: Path) -> list[tuple[str, str]]:
    return list(_devices(str(binary), binary.stat().st_mtime))


def gpu_devices(binary: Path) -> list[tuple[str, str]]:
    return [d for d in list_devices(binary) if d[0].upper() not in NON_GPU and not d[0].upper().startswith("CPU")]


def pick(vendors: list[str]) -> dict[str, Any]:
    """Choisit la build à utiliser. Retourne {available, variant, binary, devices, reason}."""
    variants = find_variants()
    if not variants:
        return {"available": False, "reason": "Le moteur GGUF (stable-diffusion.cpp) n'est pas installé : "
                "lancez scripts/fetch_sdcpp.py ou utilisez une version de l'application qui l'embarque."}
    forced = os.environ.get("IMAGEGEN_SDCPP_VARIANT")
    order: list[str] = [forced] if forced else []
    for vendor in (vendors or ["other"]):
        for v in PREFERENCE.get(vendor, PREFERENCE["other"]):
            if v not in order:
                order.append(v)
    tried = []
    for variant in order:
        binary = variants.get(variant)
        if not binary:
            continue
        gpus = gpu_devices(binary)
        if gpus:
            return {"available": True, "variant": variant, "binary": str(binary), "devices": [d[1] for d in gpus],
                    "alternatives": [v for v in variants if v != variant]}
        tried.append(variant)
    return {"available": False, "reason": "Aucun GPU exploitable par les builds présentes"
            + (f" ({', '.join(tried)})" if tried else "") + " : pilote manquant ou GPU non pris en charge."}
