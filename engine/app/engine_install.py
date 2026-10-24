# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Installs the GGUF engine (stable-diffusion.cpp) from within the app.

Fetches the official build for the detected GPU (CUDA on NVIDIA, ROCm on AMD, Metal on Apple, Vulkan otherwise),
checks its SHA-256 (published by GitHub), extracts it without ever leaving the target folder, then checks that
the build actually sees a GPU. If not (missing driver), the next build is tried, ending on Vulkan, which works
almost everywhere.

No admin rights: everything goes under `<data>/engines/sdcpp/<variant>/`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

from . import sdcpp
from .config import ENGINES_DIR
from .events import bus

REPO = "leejet/stable-diffusion.cpp"
# Release the app installs. "latest" is not used: the video models need Metal Wan support (from master-745), FLUX 3
# Klein needs master-968, and the memory manager regressed for Wan 2.2 / LTX between master-864 and master-899
# (issue #1976, fixed by PR #2181, first released in master-995), so we pin a build that was checked. master-999 was
# run on a Mac (Metal) with Klein and with Wan 2.2 5B (same time and memory as master-956); LTX and the CUDA, ROCm
# and Vulkan builds were not re-run. `IMAGEGEN_SDCPP_TAG=latest` (or any release tag) overrides it.
PINNED_TAG = "master-999-e0ed724"
DOWNLOAD_PREFIX = f"https://github.com/{REPO}/releases/download/"

# (os, variant) -> release asset patterns: the first is the build, any others are add-ons.
ASSETS: dict[tuple[str, str], list[str]] = {
    ("macos", "metal"): [r"-bin-Darwin-.*-arm64\.zip$"],
    ("windows", "vulkan"): [r"-bin-win-vulkan-x64\.zip$"],
    ("windows", "cuda"): [r"-bin-win-cuda12-x64\.zip$", r"^cudart-sd-bin-win-cu12-x64\.zip$"],
    ("windows", "rocm"): [r"-bin-win-rocm-.*-x64\.zip$"],
    ("windows", "cpu"): [r"-bin-win-cpu-x64\.zip$"],
    ("linux", "vulkan"): [r"-bin-Linux-.*-x86_64-vulkan\.zip$"],
    ("linux", "rocm"): [r"-bin-Linux-.*-x86_64-rocm-.*\.zip$"],
    ("linux", "cpu"): [r"-bin-Linux-[^-]*-[^-]*-x86_64\.zip$"],
}
# Rough sizes in MB (release master-999), to show before downloading.
APPROX_MB: dict[tuple[str, str], int] = {
    ("macos", "metal"): 37, ("windows", "vulkan"): 30, ("windows", "cuda"): 900, ("windows", "rocm"): 264,
    ("windows", "cpu"): 18, ("linux", "vulkan"): 37, ("linux", "rocm"): 296, ("linux", "cpu"): 27,
}


class InstallCancelled(Exception):
    pass


def host_os() -> str:
    return {"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux")


def candidate_variants(vendors: list[str], os_name: str | None = None) -> list[str]:
    """Builds to try, in order of preference, based on the detected GPU vendors."""
    os_name = os_name or host_os()
    order: list[str] = []
    for vendor in vendors or ["other"]:
        for v in sdcpp.PREFERENCE.get(vendor, sdcpp.PREFERENCE["other"]):
            if v not in order:
                order.append(v)
    if "vulkan" not in order:
        order.append("vulkan")
    return [v for v in order if (os_name, v) in ASSETS]


def default_tag() -> str:
    return os.environ.get("IMAGEGEN_SDCPP_TAG") or PINNED_TAG


def install_size_mb(variant: str, os_name: str | None = None) -> int:
    return APPROX_MB.get((os_name or host_os(), variant), 0)


def _http_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "ai-medialab", "Accept": "application/vnd.github+json"})
    if token := os.environ.get("GITHUB_TOKEN"):
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _download(url: str, dest: Path, on_bytes: Callable[[int], None], cancel: threading.Event | None,
              prefix: str = DOWNLOAD_PREFIX) -> str:
    if not url.startswith(prefix):
        raise RuntimeError(f"Adresse de téléchargement inattendue : {url}")
    sha = hashlib.sha256()
    req = urllib.request.Request(url, headers={"User-Agent": "ai-medialab"})
    with urllib.request.urlopen(req, timeout=60) as r, dest.open("wb") as f:
        while chunk := r.read(1 << 20):
            if cancel is not None and cancel.is_set():
                raise InstallCancelled()
            f.write(chunk)
            sha.update(chunk)
            on_bytes(len(chunk))
    return sha.hexdigest()


def safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """Extract, rejecting any path that would escape the target folder (zip-slip)."""
    root = dest.resolve()
    for info in zf.infolist():
        target = (dest / info.filename).resolve()
        if root != target and root not in target.parents:
            raise RuntimeError(f"Archive refusée : chemin hors du dossier cible ({info.filename})")
    zf.extractall(dest)


def _safe_link(member: tarfile.TarInfo, dest: Path) -> bool:
    """A symbolic link whose target is relative and stays inside the target folder (versioned libraries: `libx.0.dylib` -> `libx.0.1.dylib`)."""
    if not member.issym() or os.path.isabs(member.linkname):
        return False
    root = dest.resolve()
    target = (dest / Path(member.name).parent / member.linkname).resolve()
    return root == target or root in target.parents


def safe_extract_tar(tf: tarfile.TarFile, dest: Path) -> None:
    """Same guarantee for tarballs: regular files, folders and symbolic links that stay inside the target folder, nothing else."""
    root = dest.resolve()
    members = tf.getmembers()
    for m in members:
        target = (dest / m.name).resolve()
        if root != target and root not in target.parents:
            raise RuntimeError(f"Archive refusée : chemin hors du dossier cible ({m.name})")
        if not (m.isfile() or m.isdir() or _safe_link(m, dest)):
            raise RuntimeError(f"Archive refusée : entrée non ordinaire ({m.name})")
    tf.extractall(dest, members=members, filter="data")


def install_variant(
    os_name: str,
    variant: str,
    dest_root: Path,
    *,
    tag: str | None = None,
    progress: Callable[[int, int, str], None] | None = None,
    cancel: threading.Event | None = None,
    allow_unverified: bool = False,
) -> dict[str, Any]:
    """Download, verify and install a build into dest_root/<variant>/. Returns its metadata."""
    tag = tag or default_tag()
    patterns = ASSETS.get((os_name, variant))
    if not patterns:
        raise RuntimeError(f"Pas de build « {variant} » pour {os_name}.")
    url = f"https://api.github.com/repos/{REPO}/releases/" + ("latest" if tag == "latest" else f"tags/{tag}")
    release = _http_json(url)
    chosen = []
    for pat in patterns:
        matches = [a for a in release["assets"] if re.search(pat, a["name"])]
        if len(matches) != 1:
            raise RuntimeError(f"Fichier « {pat} » : {len(matches)} correspondance(s) dans {release['tag_name']}.")
        chosen.append(matches[0])
    total = sum(a["size"] for a in chosen)
    done = 0

    def on_bytes(n: int) -> None:
        nonlocal done
        done += n
        if progress:
            progress(done, total, f"Téléchargement du moteur ({variant})")

    dest_root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".install-", dir=dest_root))
    try:
        stage = tmp / "stage"
        stage.mkdir()
        meta: dict[str, Any] = {"tag": release["tag_name"], "assets": []}
        for asset in chosen:
            expected = (asset.get("digest") or "").removeprefix("sha256:")
            archive = tmp / asset["name"]
            got = _download(asset["browser_download_url"], archive, on_bytes, cancel)
            if expected and got != expected:
                raise RuntimeError(f"Somme de contrôle invalide pour {asset['name']} : fichier refusé.")
            if not expected and not allow_unverified:
                raise RuntimeError(f"Aucune somme de contrôle publiée pour {asset['name']} : fichier refusé.")
            if progress:
                progress(done, total, "Installation")
            with zipfile.ZipFile(archive) as zf:
                safe_extract(zf, stage)
            archive.unlink()
            meta["assets"].append({"name": asset["name"], "sha256": got})
        target = dest_root / variant
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(stage), str(target))
        for exe in ("sd-cli", "sd-server"):
            p = target / exe
            if p.is_file():
                p.chmod(0o755)
        (target / "VERSION.json").write_text(json.dumps(meta, indent=2) + "\n")
        return meta
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class EngineInstaller:
    """One install at a time; state is broadcast live through the `engine.install` event."""

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

    async def start(self, variant: str | None = None, tag: str | None = None) -> dict[str, Any]:
        """Starts the install; `tag`: a release other than the pinned one (an update to a newer, untested build)."""
        from .system import get_system

        if self.running:
            return self.public()
        system = get_system()
        vendors = [a["vendor"] for a in system["accelerators"]]
        variants = [variant] if variant else candidate_variants(vendors)
        if not variants:
            raise RuntimeError("Aucune build de stable-diffusion.cpp n'existe pour ce système.")
        need_mb = install_size_mb(variants[0]) * 2 + 50
        free_mb = system["disk"]["free_gb"] * 1024
        if free_mb < need_mb:
            raise RuntimeError(f"Espace disque insuffisant : ≈ {need_mb} Mo nécessaires, {int(free_mb)} Mo libres.")
        self._loop = asyncio.get_running_loop()
        self._cancel.clear()
        self._set(state="running", variant=variants[0], done=0, total=0, message="Préparation…", error=None)
        asyncio.create_task(asyncio.to_thread(self._run, variants, tag))
        return self.public()

    def cancel(self) -> bool:
        if not self.running:
            return False
        self._cancel.set()
        return True

    # Runs in a worker thread.

    def _run(self, variants: list[str], tag: str | None = None) -> None:
        notes: list[str] = []
        try:
            for variant in variants:
                self._set(variant=variant, done=0, total=0, message=f"Moteur « {variant} »…")
                try:
                    install_variant(host_os(), variant, ENGINES_DIR / "sdcpp", tag=tag, progress=self._progress, cancel=self._cancel)
                except InstallCancelled:
                    raise
                except Exception as exc:  # noqa: BLE001
                    notes.append(f"{variant} : {exc}")
                    continue
                binary = ENGINES_DIR / "sdcpp" / variant / sdcpp.binary_name()
                self._set(message="Vérification du GPU…")
                if sdcpp.gpu_devices(binary):
                    from .system import get_system

                    get_system(refresh=True)
                    self._set(state="done", variant=variant, message="Moteur prêt.", error=None)
                    self._publish_models_changed()
                    return
                shutil.rmtree(binary.parent, ignore_errors=True)  # unusable here (missing driver), free the space
                notes.append(f"{variant} : aucun GPU exploitable (pilote manquant ?)")
            self._set(state="error", error="Aucune build n'a trouvé de GPU exploitable. " + " · ".join(notes)
                      + (" Installez ou mettez à jour le pilote de votre carte graphique (Vulkan)."
                         if host_os() != "macos" else ""))
        except InstallCancelled:
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
            self._loop.call_soon_threadsafe(bus.publish, "engine.install", self.public())
        self._last_publish = time.time()

    def _publish_models_changed(self) -> None:
        if self._loop is not None:
            self._loop.call_soon_threadsafe(bus.publish, "models.changed", {})


installer = EngineInstaller()
