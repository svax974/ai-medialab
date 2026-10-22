# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""llama.cpp (`llama-server`): the runtime of the chat models, installed from within the app.

Upstream: https://github.com/ggml-org/llama.cpp (MIT). Every release ships prebuilt binaries for Metal (Apple Silicon),
CUDA, ROCm, Vulkan and the CPU. The app installs the build that suits the machine under `<engines>/llamacpp/<variant>/`,
checks its SHA-256 (published by GitHub) and that it runs, and falls back build by build, ending on the CPU.

The archives are not downloaded by the tests and their layout was not seen: the program is looked for wherever the archive
puts it (`find_binary_dir`), and the libraries it needs travel with its folder. Review notes: `docs/components/llamacpp.md`.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from . import engine_install as ei
from .config import ENGINES_DIR
from .events import bus

REPO = "ggml-org/llama.cpp"
# Release the app installs: the newest one published at least 14 days before it was pinned (2026-10-15 09:42 UTC, release of
# 2026-10-01 09:32 UTC), whose 35 assets all have a published SHA-256 and include every one of the table below. `IMAGEGEN_LLAMACPP_TAG=latest` (or any tag) overrides it.
PINNED_TAG = "b11317"
DOWNLOAD_PREFIX = f"https://github.com/{REPO}/releases/download/"
SERVER = "llama-server"

# (os, arch, variant) -> release asset patterns (the first is the build, any others are add-ons next to it). Anchored on
# `^llama-` so that the CUDA runtime archives (`cudart-llama-…`, same ending) never match the build pattern.
ASSETS: dict[tuple[str, str, str], list[str]] = {
    ("macos", "arm64", "metal"): [r"^llama-b\d+-bin-macos-arm64\.tar\.gz$"],
    ("macos", "x86_64", "cpu"): [r"^llama-b\d+-bin-macos-x64\.tar\.gz$"],
    ("linux", "x86_64", "cpu"): [r"^llama-b\d+-bin-ubuntu-x64\.tar\.gz$"],
    ("linux", "x86_64", "vulkan"): [r"^llama-b\d+-bin-ubuntu-vulkan-x64\.tar\.gz$"],
    ("linux", "x86_64", "cuda"): [r"^llama-b\d+-bin-ubuntu-cuda-12\.8-x64\.tar\.gz$",
                                  r"^cudart-llama-b\d+-bin-ubuntu-cuda-12\.8-x64\.tar\.gz$"],
    ("linux", "x86_64", "rocm"): [r"^llama-b\d+-bin-ubuntu-rocm-10\.0-x64\.tar\.gz$"],
    ("linux", "arm64", "cpu"): [r"^llama-b\d+-bin-ubuntu-arm64\.tar\.gz$"],
    ("linux", "arm64", "vulkan"): [r"^llama-b\d+-bin-ubuntu-vulkan-arm64\.tar\.gz$"],
    ("windows", "x86_64", "cpu"): [r"^llama-b\d+-bin-win-cpu-x64\.zip$"],
    ("windows", "x86_64", "vulkan"): [r"^llama-b\d+-bin-win-vulkan-x64\.zip$"],
    ("windows", "x86_64", "cuda"): [r"^llama-b\d+-bin-win-cuda-12\.4-x64\.zip$", r"^cudart-llama-bin-win-cuda-12\.4-x64\.zip$"],
    ("windows", "x86_64", "rocm"): [r"^llama-b\d+-bin-win-rocm-10\.0-x64\.zip$"],
    ("windows", "arm64", "cpu"): [r"^llama-b\d+-bin-win-cpu-arm64\.zip$"],
}
# Rough sizes in MB (release b11320, a few builds after the pinned one), shown before downloading.
APPROX_MB: dict[tuple[str, str, str], int] = {
    ("macos", "arm64", "metal"): 11, ("macos", "x86_64", "cpu"): 10, ("linux", "x86_64", "cpu"): 16,
    ("linux", "x86_64", "vulkan"): 30, ("linux", "x86_64", "cuda"): 163 + 566, ("linux", "x86_64", "rocm"): 231,
    ("linux", "arm64", "cpu"): 12, ("linux", "arm64", "vulkan"): 23, ("windows", "x86_64", "cpu"): 18,
    ("windows", "x86_64", "vulkan"): 31, ("windows", "x86_64", "cuda"): 251 + 373, ("windows", "x86_64", "rocm"): 244,
    ("windows", "arm64", "cpu"): 11,
}
# Preference by GPU vendor; every list ends on the CPU (a chat model is usable without a GPU, only slower).
PREFERENCE = {"apple": ("metal",), "nvidia": ("cuda", "vulkan"), "amd": ("rocm", "vulkan"), "other": ("vulkan",)}
VARIANTS = ("metal", "cuda", "rocm", "vulkan", "cpu")
LIBRARY_SUFFIXES = (".dll", ".so", ".dylib")


def host_arch() -> str:
    import platform

    return "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x86_64"


def binary_name(tool: str = SERVER) -> str:
    return f"{tool}.exe" if os.name == "nt" else tool


def default_tag() -> str:
    return os.environ.get("IMAGEGEN_LLAMACPP_TAG") or PINNED_TAG


def install_root() -> Path:
    return Path(os.environ.get("IMAGEGEN_LLAMACPP_DIR") or ENGINES_DIR / "llamacpp")


def candidate_variants(vendors: list[str], os_name: str | None = None, arch: str | None = None) -> list[str]:
    """Builds to try, in order of preference, ending on the CPU."""
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
    """The build to run: the first installed one in the preference order (`IMAGEGEN_LLAMACPP_VARIANT` forces one)."""
    found = find_installed()
    forced = os.environ.get("IMAGEGEN_LLAMACPP_VARIANT")
    for variant in ([forced] if forced else []) + list(VARIANTS):
        if variant in found:
            return variant, found[variant]
    return None


def version_info(binary: Path) -> dict[str, Any]:
    try:
        return json.loads((binary.parent / "VERSION.json").read_text())
    except (OSError, ValueError):
        return {}


def build_number(binary: Path) -> int | None:
    """Release number of an installed build (`b11312` -> 11312)."""
    m = re.match(r"b(\d+)$", str(version_info(binary).get("tag", "")))
    return int(m.group(1)) if m else None


_DEVICE = re.compile(r"^\s*(\S+?):\s+(.+?)\s+\((\d+) MiB", re.M)


@lru_cache(maxsize=8)
def _devices(binary: str, mtime: float) -> tuple[tuple[str, str], ...] | None:
    """Compute devices the build sees (`--list-devices`): ((name, description), …), or None when the program does not run."""
    try:
        proc = subprocess.run([binary, "--list-devices"], capture_output=True, text=True, timeout=60,
                              cwd=str(Path(binary).parent))
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return tuple((m[1], m[2]) for m in _DEVICE.finditer(proc.stdout + proc.stderr))


def list_devices(binary: Path) -> tuple[tuple[str, str], ...] | None:
    return _devices(str(binary), binary.stat().st_mtime)


def gpu_devices(devices: tuple[tuple[str, str], ...]) -> list[tuple[str, str]]:
    return [d for d in devices if not d[0].upper().startswith(("CPU", "BLAS"))]


def usable(variant: str, binary: Path) -> bool:
    """Whether a freshly installed build is worth keeping: it runs and, for a GPU build, sees a GPU. An output whose
    devices cannot be read is given the benefit of the doubt (llama.cpp falls back to the CPU by itself)."""
    devices = list_devices(binary)
    if devices is None:
        return False
    return variant == "cpu" or not devices or bool(gpu_devices(devices))


def pick(vendors: list[str]) -> dict[str, Any]:
    """Engine status for `system.get_system()["engines"]["llamacpp"]`: {available, variant, binary, reason, …}."""
    found = installed_binary()
    if found:
        variant, binary = found
        devices = list_devices(binary)
        if devices is not None:
            return {"available": True, "variant": variant, "binary": str(binary), "device": variant,
                    "devices": [d[1] for d in gpu_devices(devices)] or [d[1] for d in devices],
                    "tag": version_info(binary).get("tag")}
        return {"available": False, "reason": "Le moteur de chat (llama.cpp) installé ne démarre pas : réinstallez-le."}
    res: dict[str, Any] = {"available": False, "reason": "Le moteur de chat (llama.cpp) n'est pas installé."}
    candidates = candidate_variants(vendors)
    if candidates:
        res.update(installable=True, install_variant=candidates[0], install_size_mb=install_size_mb(candidates[0]))
    return res


# Install --------------------------------------------------------------------------------------------------------------

def _extract(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            ei.safe_extract(zf, dest)
    else:
        with tarfile.open(archive) as tf:
            ei.safe_extract_tar(tf, dest)


def find_binary_dir(stage: Path) -> Path:
    """Folder holding `llama-server` inside an extracted archive (the archive may or may not wrap it in a folder)."""
    hits = sorted(p.parent for p in stage.rglob(binary_name()) if p.is_file())
    if not hits:
        raise RuntimeError("L'archive ne contient pas llama-server.")
    return hits[0]


def _add_libraries(folder: Path, extra: Path) -> None:
    """Copies the shared libraries of an add-on archive (the CUDA runtime) next to the program."""
    for p in extra.rglob("*"):
        if p.is_file() and (p.name.endswith(LIBRARY_SUFFIXES) or ".so." in p.name):
            shutil.copy2(p, folder / p.name)


def _choose_assets(release: dict[str, Any], patterns: list[str]) -> list[dict[str, Any]]:
    chosen = []
    for pat in patterns:
        matches = [a for a in release["assets"] if re.search(pat, a["name"])]
        if len(matches) != 1:
            raise RuntimeError(f"Fichier « {pat} » : {len(matches)} correspondance(s) dans {release['tag_name']}.")
        chosen.append(matches[0])
    return chosen


def _fetch(chosen: list[dict[str, Any]], tmp: Path, on_bytes: Callable[[int], None], cancel: threading.Event | None,
           installing: Callable[[], None]) -> tuple[list[Path], list[dict[str, str]]]:
    """Downloads every asset, checks its published SHA-256 and extracts it to `tmp/stage<i>`: (folders, metadata)."""
    folders, assets = [], []
    for i, asset in enumerate(chosen):
        expected = (asset.get("digest") or "").removeprefix("sha256:")
        if not expected:
            raise RuntimeError(f"Aucune somme de contrôle publiée pour {asset['name']} : fichier refusé.")
        archive = tmp / asset["name"]
        got = ei._download(asset["browser_download_url"], archive, on_bytes, cancel, DOWNLOAD_PREFIX)
        if got != expected:
            raise RuntimeError(f"Somme de contrôle invalide pour {asset['name']} : fichier refusé.")
        installing()
        _extract(archive, tmp / f"stage{i}")
        folders.append(tmp / f"stage{i}")
        archive.unlink()
        assets.append({"name": asset["name"], "sha256": got})
    return folders, assets


def install_variant(os_name: str, arch: str, variant: str, *, tag: str | None = None,
                    progress: Callable[[int, int, str], None] | None = None,
                    cancel: threading.Event | None = None) -> dict[str, Any]:
    """Download, verify and install one build into `install_root()/<variant>/`. Returns its metadata."""
    tag = tag or default_tag()
    patterns = ASSETS.get((os_name, arch, variant))
    if not patterns:
        raise RuntimeError(f"Pas de build « {variant} » de llama.cpp pour {os_name} ({arch}).")
    release = ei._http_json(f"https://api.github.com/repos/{REPO}/releases/"
                            + ("latest" if tag == "latest" else f"tags/{tag}"))
    chosen = _choose_assets(release, patterns)
    total, done = sum(a["size"] for a in chosen), 0

    def on_bytes(n: int) -> None:
        nonlocal done
        done += n
        if progress:
            progress(done, total, f"Téléchargement du moteur de chat ({variant})")

    root = install_root()
    root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".install-", dir=root))
    try:
        folders, assets = _fetch(chosen, tmp, on_bytes, cancel, lambda: progress and progress(done, total, "Installation"))
        binary_dir = find_binary_dir(folders[0])
        for extra in folders[1:]:
            _add_libraries(binary_dir, extra)
        target = root / variant
        shutil.rmtree(target, ignore_errors=True)
        shutil.move(str(binary_dir), str(target))
        for exe in (target / binary_name(SERVER), target / binary_name("llama-cli")):
            if exe.is_file():
                exe.chmod(0o755)
        meta = {"tag": release["tag_name"], "assets": assets}
        (target / "VERSION.json").write_text(json.dumps(meta, indent=2) + "\n")
        return meta
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def install(vendors: list[str], progress: Callable[[int, int, str], None] | None = None,
            cancel: threading.Event | None = None, tag: str | None = None) -> dict[str, Any]:
    """Installs the best build that works here: each candidate in turn, the first that runs (and sees a GPU when it is a GPU
    build) is kept. Returns {variant, notes}."""
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
        if usable(variant, binary):
            return {"variant": variant, "notes": notes}
        shutil.rmtree(binary.parent, ignore_errors=True)  # unusable here (missing driver): free the space
        notes.append(f"{variant} : ne démarre pas ou ne voit aucun GPU (pilote manquant ?)")
    raise RuntimeError("Aucune build de llama.cpp n'est utilisable ici. " + " · ".join(notes))


class LlamacppInstaller:
    """One install at a time; the state is broadcast live through the `llamacpp.install` event (same shape as
    `engine.install`: state idle | running | done | error | cancelled, variant, done, total, message, error)."""

    def __init__(self) -> None:
        self.state: dict[str, Any] = {"state": "idle"}
        self._cancel = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last_publish = 0.0

    def public(self) -> dict[str, Any]:
        return dict(self.state)

    @property
    def running(self) -> bool:
        return self.state.get("state") == "running"

    async def start(self, tag: str | None = None) -> dict[str, Any]:
        from .system import get_system

        if self.running:
            return self.public()
        system = get_system()
        variants = candidate_variants([a["vendor"] for a in system["accelerators"]])
        if not variants:
            raise RuntimeError("Aucune build de llama.cpp n'existe pour ce système.")
        need_mb = install_size_mb(variants[0]) * 2 + 50
        free_mb = system["disk"]["free_gb"] * 1024
        if free_mb < need_mb:
            raise RuntimeError(f"Espace disque insuffisant : ≈ {need_mb} Mo nécessaires, {int(free_mb)} Mo libres.")
        self._loop = asyncio.get_running_loop()
        self._cancel.clear()
        self._set(state="running", variant=variants[0], done=0, total=0, message="Préparation…", error=None)
        asyncio.create_task(asyncio.to_thread(self._run, [a["vendor"] for a in system["accelerators"]], tag))
        return self.public()

    def cancel(self) -> bool:
        if not self.running:
            return False
        self._cancel.set()
        return True

    # Runs in a worker thread.

    def _run(self, vendors: list[str], tag: str | None) -> None:
        try:
            res = install(vendors, progress=self._progress, cancel=self._cancel, tag=tag)
            from .system import get_system

            get_system(refresh=True)
            self._set(state="done", variant=res["variant"], message="Moteur de chat prêt.", error=None)
            if self._loop is not None:
                self._loop.call_soon_threadsafe(bus.publish, "models.changed", {})
        except ei.InstallCancelled:
            self._set(state="cancelled", message="Installation annulée.")
        except Exception as exc:  # noqa: BLE001
            self._set(state="error", error=f"{exc}")

    def _progress(self, done: int, total: int, message: str) -> None:
        now = time.time()
        if now - self._last_publish < 0.4 and done < total:
            return
        self._set(done=done, total=total, message=message)

    def _set(self, **fields: Any) -> None:
        self.state.update(fields)
        if self._loop is not None:
            self._loop.call_soon_threadsafe(bus.publish, "llamacpp.install", self.public())
        self._last_publish = time.time()


installer = LlamacppInstaller()
