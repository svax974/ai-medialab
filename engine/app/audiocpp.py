# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""audio.cpp (ggml) binaries: one runtime for many audio models (speech synthesis, transcription…).

Upstream: https://github.com/0xShug0/audio.cpp (Apache-2.0). It ships prebuilt CLIs for Metal, Vulkan, CUDA and CPU.
The app installs the build that suits the machine under `<engines>/audiocpp/<variant>/`, checks its SHA-256 (published
by GitHub) and that it sees a GPU, and falls back build by build, ending on the CPU.

Review notes for this component live in `docs/components/audiocpp.md`.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Any, Callable

from . import engine_install as ei
from .config import ENGINES_DIR

REPO = "0xShug0/audio.cpp"
# Release the app installs. `IMAGEGEN_AUDIOCPP_TAG=latest` (or any tag) overrides it.
PINNED_TAG = "v0.9.1"
DOWNLOAD_PREFIX = f"https://github.com/{REPO}/releases/download/"

# (os, arch, variant) -> release asset patterns: the first is the build, any others are add-ons.
ASSETS: dict[tuple[str, str, str], list[str]] = {
    ("macos", "arm64", "metal"): [r"-bin-macos-arm64-metal\.tar\.gz$"],
    ("macos", "x86_64", "metal"): [r"-bin-macos-x64-metal\.tar\.gz$"],
    ("windows", "x86_64", "cuda"): [r"-bin-windows-x64-cuda12\.4\.zip$", r"-cudart-windows-x64-cuda12\.4\.zip$"],
    ("windows", "x86_64", "vulkan"): [r"-bin-windows-x64-vulkan\.zip$"],
    ("windows", "x86_64", "cpu"): [r"-bin-windows-x64-cpu\.zip$"],
    ("linux", "x86_64", "vulkan"): [r"-bin-ubuntu-x64-vulkan\.tar\.gz$"],
    ("linux", "x86_64", "cpu"): [r"-bin-ubuntu-x64-cpu\.tar\.gz$"],
}
# Rough sizes in MB (release v0.9.1), shown before downloading.
APPROX_MB: dict[tuple[str, str, str], int] = {
    ("macos", "arm64", "metal"): 29, ("macos", "x86_64", "metal"): 30, ("windows", "x86_64", "cuda"): 1020,
    ("windows", "x86_64", "vulkan"): 58, ("windows", "x86_64", "cpu"): 25, ("linux", "x86_64", "vulkan"): 75,
    ("linux", "x86_64", "cpu"): 49,
}
# Preference by GPU vendor. There is no ROCm build upstream: AMD goes through Vulkan.
PREFERENCE = {"apple": ("metal",), "nvidia": ("cuda", "vulkan"), "amd": ("vulkan",), "other": ("vulkan",)}
VARIANTS = ("metal", "cuda", "vulkan", "cpu")
NON_GPU_PREFIXES = ("CPU", "BLAS")
BINARIES = ("audiocpp_cli", "audiocpp_server")


def host_arch() -> str:
    import platform

    m = platform.machine().lower()
    return "arm64" if m in ("arm64", "aarch64") else "x86_64"


def binary_name(tool: str = "audiocpp_cli") -> str:
    return f"{tool}.exe" if sys.platform == "win32" else tool


def default_tag() -> str:
    return os.environ.get("IMAGEGEN_AUDIOCPP_TAG") or PINNED_TAG


def install_root() -> Path:
    return Path(os.environ.get("IMAGEGEN_AUDIOCPP_DIR") or ENGINES_DIR / "audiocpp")


def candidate_variants(vendors: list[str], os_name: str | None = None, arch: str | None = None) -> list[str]:
    """Builds to try, in order of preference, ending on the CPU (audio models are usable without a GPU)."""
    os_name, arch = os_name or ei.host_os(), arch or host_arch()
    order: list[str] = []
    for vendor in vendors or ["other"]:
        for v in PREFERENCE.get(vendor, PREFERENCE["other"]):
            if v not in order:
                order.append(v)
    for fallback in ("vulkan", "cpu"):
        if fallback not in order:
            order.append(fallback)
    return [v for v in order if (os_name, arch, v) in ASSETS]


def install_size_mb(variant: str) -> int:
    return APPROX_MB.get((ei.host_os(), host_arch(), variant), 0)


def find_installed() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for variant in VARIANTS:
        p = install_root() / variant / binary_name()
        if p.is_file():
            found[variant] = p
    return found


def installed_binary() -> tuple[str, Path] | None:
    """The build to run: the first installed one in the preference order of this machine."""
    found = find_installed()
    forced = os.environ.get("IMAGEGEN_AUDIOCPP_VARIANT")
    for variant in ([forced] if forced else []) + list(VARIANTS):
        if variant in found:
            return variant, found[variant]
    return None


def list_devices(binary: Path) -> list[tuple[str, str, str]]:
    """Compute devices this build sees (`--list-devices`): [(id, name, kind)], e.g. ("MTL:0", "Apple M3 Max", "GPU")."""
    try:
        out = subprocess.run([str(binary), "--list-devices"], capture_output=True, text=True, timeout=60,
                             cwd=str(binary.parent)).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [(m[1], m[2], m[3]) for m in re.finditer(r'^(\S+:\d+)\s+"([^"]*)"\s+\[(\w+)\]', out, re.M)]


def gpu_devices(binary: Path) -> list[tuple[str, str, str]]:
    return [d for d in list_devices(binary) if d[2].upper() == "GPU"]


def version_info(binary: Path) -> dict[str, Any]:
    try:
        return json.loads((binary.parent / "VERSION.json").read_text())
    except (OSError, ValueError):
        return {}


def _extract(archive: Path, dest: Path) -> None:
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            ei.safe_extract(zf, dest)
    else:
        with tarfile.open(archive) as tf:
            ei.safe_extract_tar(tf, dest)


def install_variant(os_name: str, arch: str, variant: str, *, tag: str | None = None,
                    progress: Callable[[int, int, str], None] | None = None,
                    cancel: threading.Event | None = None) -> dict[str, Any]:
    """Download, verify and install one build into `install_root()/<variant>/`. Returns its metadata."""
    tag = tag or default_tag()
    patterns = ASSETS.get((os_name, arch, variant))
    if not patterns:
        raise RuntimeError(f"Pas de build « {variant} » d'audio.cpp pour {os_name} ({arch}).")
    release = ei._http_json(f"https://api.github.com/repos/{REPO}/releases/"
                            + ("latest" if tag == "latest" else f"tags/{tag}"))
    chosen = []
    for pat in patterns:
        matches = [a for a in release["assets"] if re.search(pat, a["name"])]
        if len(matches) != 1:
            raise RuntimeError(f"Fichier « {pat} » : {len(matches)} correspondance(s) dans {release['tag_name']}.")
        chosen.append(matches[0])
    total, done = sum(a["size"] for a in chosen), 0

    def on_bytes(n: int) -> None:
        nonlocal done
        done += n
        if progress:
            progress(done, total, f"Téléchargement du moteur audio ({variant})")

    root = install_root()
    root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".install-", dir=root))
    try:
        stage = tmp / "stage"
        stage.mkdir()
        meta: dict[str, Any] = {"tag": release["tag_name"], "assets": []}
        for asset in chosen:
            expected = (asset.get("digest") or "").removeprefix("sha256:")
            if not expected:
                raise RuntimeError(f"Aucune somme de contrôle publiée pour {asset['name']} : fichier refusé.")
            archive = tmp / asset["name"]
            got = ei._download(asset["browser_download_url"], archive, on_bytes, cancel, DOWNLOAD_PREFIX)
            if got != expected:
                raise RuntimeError(f"Somme de contrôle invalide pour {asset['name']} : fichier refusé.")
            if progress:
                progress(done, total, "Installation")
            _extract(archive, stage)
            archive.unlink()
            meta["assets"].append({"name": asset["name"], "sha256": got})
        target = root / variant
        shutil.rmtree(target, ignore_errors=True)
        shutil.move(str(stage), str(target))
        for exe in BINARIES:
            p = target / binary_name(exe)
            if p.is_file():
                p.chmod(0o755)
        (target / "VERSION.json").write_text(json.dumps(meta, indent=2) + "\n")
        return meta
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def install(vendors: list[str], progress: Callable[[int, int, str], None] | None = None,
            cancel: threading.Event | None = None, tag: str | None = None) -> dict[str, Any]:
    """Install the best build that works here. Tries each candidate and keeps the first that sees a GPU,
    or the CPU build as a last resort. Returns {variant, device, notes}."""
    notes: list[str] = []
    os_name, arch = ei.host_os(), host_arch()
    for variant in candidate_variants(vendors, os_name, arch):
        try:
            install_variant(os_name, arch, variant, tag=tag, progress=progress, cancel=cancel)
        except ei.InstallCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            notes.append(f"{variant} : {exc}")
            continue
        binary = install_root() / variant / binary_name()
        if variant == "cpu" or gpu_devices(binary):
            return {"variant": variant, "notes": notes}
        shutil.rmtree(binary.parent, ignore_errors=True)  # unusable here (missing driver): free the space
        notes.append(f"{variant} : aucun GPU exploitable (pilote manquant ?)")
    raise RuntimeError("Aucune build d'audio.cpp n'est utilisable ici. " + " · ".join(notes))


def model_file(repo: str, filename: str) -> Path | None:
    """A GGUF already downloaded into the Hugging Face cache (the same lookup the audio worker does)."""
    from .engines.base import repo_cache_dir

    snapshots = repo_cache_dir(repo) / "snapshots"
    if snapshots.is_dir():
        for snap in sorted(snapshots.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if (snap / filename).is_file():
                return snap / filename
    return None


def transcribe_command(binary: str, backend: str, family: str, model: str, audio: str, out: str, language: str | None,
                       threads: int, language_option: bool) -> list[str]:
    """`audiocpp_cli` command line for one transcription. Pure: nothing is started here."""
    cmd = [binary, "--task", "asr", "--family", family, "--model", model, "--backend", backend, "--threads", str(threads),
           "--audio", audio, "--text-out", out]
    if language and language != "auto" and language_option:
        cmd += ["--request-option", f"language={language.split('-')[0].lower()}"]
    return cmd


def run_transcribe(family: str, model: str, audio: str, language: str | None, *, language_option: bool = True,
                   timeout: int = 300) -> dict[str, Any]:
    """Transcribe a clip with an audio.cpp ASR model. Returns {text, language, duration} like the Whisper path."""
    import soundfile as sf

    found = installed_binary()
    if not found:
        raise RuntimeError("Le moteur audio.cpp n'est pas installé (Modèles → Moteurs).")
    variant, binary = found
    data, rate = sf.read(audio, dtype="float32", always_2d=False)
    with tempfile.TemporaryDirectory(prefix="audiocpp-asr-") as tmp:
        wav, out = str(Path(tmp) / "in.wav"), str(Path(tmp) / "out.txt")
        mono = data if data.ndim == 1 else data.mean(axis=1)  # any format libsndfile reads -> mono WAV for the CLI
        sf.write(wav, mono, rate, subtype="PCM_16")
        cmd = transcribe_command(str(binary), variant, family, model, wav, out, language,
                                 max(2, (os.cpu_count() or 4) // 2) if variant == "cpu" else 4, language_option)
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                              cwd=str(binary.parent))
        if proc.returncode != 0 or not Path(out).is_file():
            lines = [l.strip() for l in (proc.stdout + proc.stderr).splitlines() if l.strip() and not l.startswith("ggml_")]
            raise RuntimeError(f"audio.cpp a échoué (code {proc.returncode}) : {' / '.join(lines[-3:])}")
        text = Path(out).read_text(encoding="utf-8").strip()
    return {"text": text, "language": (language or "").split("-")[0].lower(), "duration": round(len(mono) / rate, 2)}
