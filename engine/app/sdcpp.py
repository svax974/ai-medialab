# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""stable-diffusion.cpp (GGUF) binaries: locating them, detecting usable GPUs, picking the backend.

A "variant" is a build of the same program for one compute backend: metal (macOS), cuda, rocm,
vulkan (any GPU, including NVIDIA, AMD and Intel) or cpu. They live in `<engines>/sdcpp/<variant>/`;
`scripts-local/fetch_sdcpp.py` downloads them from the official releases (checksum verified).

The variant follows the detected GPU (CUDA on NVIDIA, ROCm on AMD, Metal on Apple, Vulkan otherwise),
falling back to Vulkan. `IMAGEGEN_SDCPP_VARIANT` forces one, handy for comparing speeds.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import ENGINES_DIR, ROOT_DIR

VARIANTS = ("metal", "cuda", "rocm", "vulkan", "cpu")
# Preference order by GPU vendor.
PREFERENCE = {
    "apple": ("metal", "vulkan"),
    "nvidia": ("cuda", "vulkan"),
    "amd": ("rocm", "vulkan"),
    "other": ("vulkan",),
}
NON_GPU = {"CPU", "BLAS"}


def engines_roots() -> list[Path]:
    """Folders to search for builds: the app (or repo) first, then engines the user installed.

    `IMAGEGEN_ENGINES_DIR` replaces the first one (bundled builds), for tests and custom setups."""
    return [Path(os.environ.get("IMAGEGEN_ENGINES_DIR") or ROOT_DIR / "engines"), ENGINES_DIR]


def binary_name(tool: str = "sd-cli") -> str:
    return f"{tool}.exe" if sys.platform == "win32" else tool


# Oldest macOS build that runs Wan video: before master-745 the Metal backend lacks IM2COL_3D.
METAL_VIDEO_MIN_BUILD = 745


def build_number(binary: Path) -> int | None:
    """Release number of an installed build (`master-956-...` -> 956), from the VERSION.json the installer writes."""
    try:
        tag = json.loads((Path(binary).parent / "VERSION.json").read_text()).get("tag", "")
    except (OSError, ValueError):
        return None
    m = re.match(r"master-(\d+)", str(tag))
    return int(m.group(1)) if m else None


# `--prompt-file` and `--negative-prompt-file` of sd-cli (examples/common/common.cpp): read at master-720, unknown at master-700.
PROMPT_FILE_MIN_BUILD = 720


def prompt_args(binary: Path, prompt: str, negative: str | None, folder: Path | None) -> list[str]:
    """The prompt arguments of one sd-cli run. With a `folder` (a private session's temporary folder) and a build that
    reads prompt files, the texts go through files there (0600, removed with the folder) instead of the command line,
    which other processes of the user can read while the job runs; otherwise `-p` and `-n` as always."""
    negative = (negative or "").strip()
    number = build_number(binary)
    if folder is not None and number is not None and number >= PROMPT_FILE_MIN_BUILD:
        args: list[str] = []
        for flag, name, text in (("--prompt-file", "prompt.txt", prompt), ("--negative-prompt-file", "negative.txt", negative)):
            if flag == "--negative-prompt-file" and not negative:
                continue
            path = folder / name
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            args += [flag, str(path)]
        return args
    return ["-p", prompt] + (["-n", negative] if negative else [])


def video_unsupported(binary: Path, variant: str) -> str | None:
    """French error when this build cannot run video models, else None (unknown versions are given the benefit of the doubt)."""
    number = build_number(binary)
    if variant == "metal" and number is not None and number < METAL_VIDEO_MIN_BUILD:
        return (f"Le moteur GGUF installé (version {number}) est trop ancien pour la vidéo sur Mac : il faut la version "
                f"{METAL_VIDEO_MIN_BUILD} ou plus récente. Réinstallez le moteur depuis l'écran « Modèles ».")
    return None


def model_unsupported(binary: Path, min_build: int | None) -> str | None:
    """French error when this build predates the architecture of a model (`options["min_build"]`), else None."""
    number = build_number(binary)
    if min_build and number is not None and number < min_build:
        return (f"Le moteur GGUF installé (version {number}) est trop ancien pour ce modèle : il faut la version "
                f"{min_build} ou plus récente. Réinstallez le moteur depuis l'écran « Modèles ».")
    return None


def outdated_for(spec: Any, engine: dict[str, Any]) -> bool:
    """True when the installed build is too old for this model (the engine can be updated by the app, see `catalog.py`)."""
    if spec.backend != "sdcpp" or not engine.get("available") or not engine.get("binary"):
        return False
    binary = Path(engine["binary"])
    too_old = model_unsupported(binary, spec.options.get("min_build"))
    if spec.kind == "video":
        too_old = too_old or video_unsupported(binary, str(engine.get("variant")))
    return too_old is not None


def find_variants() -> dict[str, Path]:
    """One build per variant: the newest of the folders (a build the user installed or updated beats an older bundled one),
    the first folder winning a tie or when versions are unknown."""
    found: dict[str, Path] = {}
    for root in engines_roots():
        for variant in VARIANTS:
            p = root / "sdcpp" / variant / binary_name()
            if not p.is_file():
                continue
            if variant not in found or (build_number(p) or 0) > (build_number(found[variant]) or 0):
                found[variant] = p
    return found


@lru_cache(maxsize=16)
def _devices(binary: str, mtime: float) -> tuple[tuple[str, str], ...]:
    """Compute devices this build sees (`--list-devices`): [(name, description)]."""
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
    """Pick the build to use. Returns {available, variant, binary, devices, reason}."""
    variants = find_variants()
    if not variants:
        return {"available": False, "reason": "Le moteur GGUF (stable-diffusion.cpp) n'est pas installé."}
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
    tried_note = f" ({', '.join(tried)})" if tried else ""
    return {"available": False, "reason": f"Aucun GPU exploitable par les builds présentes{tried_note} : pilote manquant ou GPU non pris en charge."}
