# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Engine packs: one isolated Python environment per model family, installed on demand.

Isolated because the libraries pin incompatible versions of each other (Qwen3-TTS needs
`transformers==4.57.3`, the image engine `transformers>=5.17`, Chatterbox `==5.2.0`...). Two families:
"audio" (TTS, transcription) and "video" (models that need pinned dependencies and the authors' own code).

Install uses `uv` when available (fast, can fetch the Python version the pack wants), otherwise `venv` + `pip`
with the current interpreter (must be that exact version). Everything goes under `<data>/engines/<family>/<pack>/`,
no admin rights.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import AUDIO_PACKS_DIR, AUDIO_RUNTIME_DIR, ROOT_DIR, RUNTIME_PACKS_DIR, VIDEO_PACKS_DIR, VIDEO_RUNTIME_DIR
from .events import bus

PYTHON_VERSION = "3.12"  # default; kokoro needs < 3.13, qwen-tts, pocket-tts and chatterbox are fine on 3.12

FAMILY_DIRS = {"audio": AUDIO_PACKS_DIR, "video": VIDEO_PACKS_DIR, "runtime": RUNTIME_PACKS_DIR}
FAMILY_RUNTIMES = {"audio": AUDIO_RUNTIME_DIR, "video": VIDEO_RUNTIME_DIR}


@dataclass(frozen=True)
class PackArchive:
    """Official source code that is not a pip package, fetched from a pinned GitHub commit.

    Only the listed folders are extracted into `<pack>/src/`, which the worker puts on its import path."""

    url: str  # https://github.com/<owner>/<repo>/archive/<commit sha>.tar.gz
    folders: tuple[str, ...]


@dataclass(frozen=True)
class PackDef:
    id: str
    name: str
    requirements: tuple[str, ...]
    # Modules that must import for the pack to count as healthy.
    imports: tuple[str, ...]
    size_mb: int
    # PyTorch packages to install first from the GPU index (pip would pick the CPU build on Windows).
    torch_packages: tuple[str, ...] = ("torch",)
    # Extra libraries installed on Apple Silicon only.
    apple_requirements: tuple[str, ...] = ()
    note: str = ""
    # One-line description of what gets installed (shown before installing).
    contents: str = ""
    # Name of the inference engine itself, not the model family.
    engine: str = ""
    # "audio" or "video": picks the install folder and the worker script.
    family: str = "audio"
    # Python version of the environment (empty = PYTHON_VERSION).
    python: str = ""
    archives: tuple[PackArchive, ...] = ()
    # Hardware the pack needs: "" (any) or "cuda" (NVIDIA, or AMD on Linux through ROCm).
    gpu: str = ""
    # French sentence shown when the machine does not have that hardware.
    gpu_reason: str = ""
    # AMD/Linux PyTorch wheel index; the default one only carries recent PyTorch versions, pinned packs name an older one.
    rocm: str = "rocm6.4"
    # Folders of `<runtime>/shims/` put on the worker's import path (stand-ins for optional compiled libraries).
    shims: tuple[str, ...] = ()
    # Name of the prebuilt native runtime this pack installs instead of a Python environment ("" = Python pack).
    native: str = ""
    # Add-on of the main runtime ("runtime" family): the venv is built on the server's own interpreter and its site-packages
    # joins the import path of the image worker (`activate_overlays`), so the models run in-process there, not in a pack worker.
    overlay: bool = False
    # Download size on Apple Silicon when it differs from `size_mb` (0 = same).
    size_mb_apple: int = 0
    # Installing or removing this add-on changes what the PyTorch probe finds (see `system.reprobe`).
    reprobe: bool = False


PACKS: dict[str, PackDef] = {
    # PyTorch + diffusers (and mflux on Apple Silicon) for the image and video models of the main runtime. Not bundled with the
    # app: installed at first need. Versions follow engine/pyproject.toml, extras `torch` and `mlx`.
    "torch": PackDef(
        id="torch",
        name="PyTorch + diffusers (images et vidéos)",
        family="runtime",
        overlay=True,
        reprobe=True,
        torch_packages=("torch>=2.4,<3", "torchvision"),
        requirements=("diffusers>=0.41", "gguf>=0.10", "transformers>=5.17", "accelerate>=1.0", "peft>=0.17",
                      "sentencepiece", "protobuf", "safetensors"),
        apple_requirements=("mflux==0.20.0",),
        imports=("torch", "torchvision", "diffusers", "transformers", "gguf"),
        size_mb=4500,
        size_mb_apple=1700,
        engine="PyTorch + diffusers",
        contents="PyTorch, diffusers et transformers (et MLX sur Mac), pour les modèles d'image et de vidéo qui en ont besoin.",
    ),
    # PyAV (FFmpeg) for every video model: reading uploaded videos, thumbnails, writing the MP4. Not bundled: the PyPI wheel carries
    # GPL libraries (x264, x265), so the app never redistributes it, the user's machine downloads it (docs/components/ffmpeg.md).
    # Version follows engine/pyproject.toml, extra `ffmpeg`.
    "ffmpeg": PackDef(
        id="ffmpeg",
        name="FFmpeg (lecture et écriture des vidéos)",
        family="runtime",
        overlay=True,
        torch_packages=(),
        requirements=("av>=14",),
        imports=("av",),
        size_mb=50,
        engine="FFmpeg (PyAV)",
        contents="PyAV et les bibliothèques FFmpeg, pour lire les vidéos importées, créer les vignettes et écrire les clips en MP4.",
    ),
    "speech": PackDef(
        id="speech",
        name="Voix légères (Kokoro, Pocket TTS, Whisper)",
        requirements=("kokoro>=0.9.4", "misaki[en]>=0.9.4", "pocket-tts>=3.3", "faster-whisper>=1.1",
                      "soundfile>=0.12", "numpy>=2", "huggingface_hub>=0.30"),
        apple_requirements=("mlx-whisper>=0.4",),  # Whisper on Metal; faster-whisper stays for CT2 models
        imports=("kokoro", "pocket_tts", "faster_whisper", "soundfile"),
        size_mb=900,
        engine="PyTorch + CTranslate2",
        contents="Kokoro, Pocket TTS et Whisper (sans carte graphique requise).",
    ),
    "qwen3": PackDef(
        id="qwen3",
        name="Qwen3-TTS",
        requirements=("qwen-tts==0.1.1", "soundfile>=0.12", "huggingface_hub>=0.30"),
        imports=("qwen_tts", "soundfile"),
        size_mb=1100,
        torch_packages=("torch", "torchaudio"),
        engine="PyTorch",
        contents="la bibliothèque qwen-tts (le calcul passe par le GPU quand il y en a un).",
    ),
    # Native runtime: prebuilt ggml binaries, no Python environment (see `audiocpp.py`). Runs on any GPU through Metal,
    # CUDA or Vulkan, and on the CPU. Registered models are in `engines/audiocpp_specs.py`.
    "audiocpp": PackDef(
        id="audiocpp",
        name="audio.cpp (GGUF, tout GPU)",
        requirements=(), imports=(), size_mb=60, native="audiocpp",
        engine="audio.cpp (ggml)",
        contents="le moteur audio.cpp précompilé (Metal, CUDA, Vulkan ou processeur selon la machine), sans Python ni PyTorch.",
    ),
    # Video packs: NVIDIA (or AMD on Linux) only, versions pinned to what the authors tested.
    "kiwi": PackDef(
        id="kiwi",
        name="Kiwi-Edit (montage vidéo)",
        family="video",
        python="3.10",  # the authors' environment: Python 3.10, PyTorch 2.7 (CUDA 12.8)
        torch_packages=("torch==2.7.0", "torchvision==0.22.0"),
        rocm="rocm6.3",  # the rocm6.4 index starts at PyTorch 2.8
        # The weights repo ships the pipeline code (loaded with trust_remote_code), so no source archive is needed.
        # Its code only needs torch, torchvision, diffusers, transformers, einops, requests and packaging at import time
        # (decord and torchcodec are optional there: we hand it decoded frames). transformers 4.57.0 is the authors' pin
        # but was yanked from PyPI (broken extras metadata); 4.57.1 is the fixed re-release.
        requirements=("diffusers==0.36.0", "transformers==4.57.1", "accelerate", "einops", "huggingface_hub>=0.30",
                      "safetensors", "av", "pillow", "numpy", "tqdm", "requests", "packaging"),
        imports=("torch", "torchvision", "diffusers", "transformers", "accelerate", "einops", "av"),
        size_mb=4500,
        gpu="cuda",
        gpu_reason="Kiwi-Edit demande une carte graphique NVIDIA (CUDA 12.8) ; il ne tourne ni sur Mac Apple Silicon ni sur processeur.",
        engine="PyTorch 2.7 + diffusers",
        contents="PyTorch 2.7, diffusers 0.36 et transformers 4.57, aux versions du dépôt officiel (Python 3.10).",
    ),
    "bernini": PackDef(
        id="bernini",
        name="Bernini (génération et montage vidéo)",
        family="video",
        python="3.11",  # the authors' environment: Python 3.11, PyTorch 2.7.1, diffusers 0.35.2, transformers 4.57.3
        torch_packages=("torch==2.7.1", "torchvision==0.22.1"),
        rocm="rocm6.3",  # the rocm6.4 index starts at PyTorch 2.8
        # Pins from the authors' uv.lock. Left out on purpose: flash-attn (needs a compiler; see `shims`), torchcodec,
        # datasets, librosa, PyYAML, torchdata (training only), openai (prompt enhancer) and gradio (demo).
        requirements=("diffusers==0.35.2", "accelerate==0.34.2", "transformers==4.57.3", "huggingface_hub>=0.30",
                      "safetensors", "einops", "numpy", "pillow", "tqdm", "ftfy", "scipy", "decord", "imageio",
                      "imageio-ffmpeg", "av", "packaging"),
        # Neither `bernini` nor VeOmni is pip-installable from PyPI as we need them: both come from pinned commits of
        # their official repos. VeOmni (the v0.1.11 tag) is imported unconditionally by `bernini.pipeline`, even for
        # single-GPU inference (its logging helper, constants and sequence-parallel stubs); only its `veomni` folder
        # is taken, which needs just torch, transformers and packaging.
        archives=(PackArchive("https://github.com/bytedance/Bernini/archive/e6c2cf11843470b08491745947abcba9c3c6b079.tar.gz",
                              ("bernini",)),
                  PackArchive("https://github.com/ByteDance-Seed/VeOmni/archive/f90b3dc6fbb0ce693745223cc7a94064123dbf4d.tar.gz",
                              ("veomni",))),
        # `bernini.models` raises at import unless flash_attn is importable, although its attention layer falls back to
        # PyTorch SDPA. flash-attn has no Windows wheels and compiles on Linux, so a small stand-in stays on the path.
        shims=("bernini",),
        imports=("torch", "torchvision", "diffusers", "transformers", "decord", "veomni", "bernini.pipeline"),
        size_mb=4800,
        gpu="cuda",
        gpu_reason="Bernini demande une carte graphique NVIDIA (CUDA) ; il ne tourne ni sur Mac Apple Silicon ni sur processeur.",
        engine="PyTorch 2.7 + code officiel Bernini",
        contents="PyTorch 2.7.1, diffusers 0.35.2, transformers 4.57.3 et le code officiel de Bernini et VeOmni (Python 3.11).",
    ),
}


def python_of(pack: PackDef) -> str:
    if pack.overlay:  # built on the server's own interpreter: its compiled modules must match
        return f"{sys.version_info.major}.{sys.version_info.minor}"
    return pack.python or PYTHON_VERSION


def is_apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


def size_of(pack: PackDef) -> int:
    """Download size announced to the user, in MB."""
    return pack.size_mb_apple if pack.size_mb_apple and is_apple_silicon() else pack.size_mb


# Model backend -> pack whose installation it needs (add-ons of the main runtime).
OVERLAY_BACKENDS = {"torch": "torch", "mlx": "torch"}


def pack_of(spec: Any) -> str | None:
    """Pack a model needs: its own (backend "pack"), or the add-on of the main runtime (torch, mlx)."""
    if spec.backend == "pack":
        return spec.options.get("pack")
    return OVERLAY_BACKENDS.get(spec.backend)


def requirements_for(pack: PackDef) -> tuple[str, ...]:
    return pack.requirements + (pack.apple_requirements if is_apple_silicon() else ())


def _requirements_hash(pack: PackDef) -> str:
    parts = [python_of(pack), *requirements_for(pack), *pack.torch_packages]
    parts += [f"{a.url}|{','.join(a.folders)}" for a in pack.archives]  # absent for audio packs: their hash is unchanged
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:16]


def pack_dir(pack_id: str) -> Path:
    pack = PACKS.get(pack_id)
    return FAMILY_DIRS[pack.family if pack else "audio"] / pack_id


def code_dir(pack_id: str) -> Path:
    """Where a pack's official source code (see `PackArchive`) is extracted."""
    return pack_dir(pack_id) / "src"


def pack_env(pack_id: str) -> dict[str, str]:
    """Extra environment of a pack's worker: its extracted source code and shims on the import path.

    Video workers also run offline: the app downloads the weights itself, so nothing may reach for the Hub."""
    pack = PACKS.get(pack_id)
    paths = [str(code_dir(pack_id))] if code_dir(pack_id).is_dir() else []
    if pack:
        paths += [str(runtime_dir(pack_id) / "shims" / name) for name in pack.shims]
    env = {"PYTHONPATH": os.pathsep.join(paths)} if paths else {}
    if pack and pack.overlay:  # the server's own packages must not shadow the venv's
        env["PYTHONPATH"] = ""
    if pack and pack.native == "audiocpp":
        from . import audiocpp

        if found := audiocpp.installed_binary():
            env.update(AUDIOCPP_VARIANT=found[0], AUDIOCPP_BIN=str(found[1]))
    if pack and pack.family == "video":
        env["HF_HUB_OFFLINE"] = "1"
    return env


def venv_python(pack_id: str) -> Path:
    pack = PACKS.get(pack_id)
    if pack and pack.native:  # no environment of its own: the worker runs on the server's interpreter
        return Path(sys.executable)
    base = pack_dir(pack_id) / "venv"
    return base / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def overlay_site(pack_id: str) -> Path | None:
    """site-packages of an installed add-on's venv, None when it is not there."""
    base = pack_dir(pack_id) / "venv"
    found = sorted(base.glob("Lib/site-packages")) + sorted(base.glob("lib/python*/site-packages"))
    return found[0] if found else None


def overlay_paths() -> list[str]:
    """Import paths of the installed add-ons of the main runtime."""
    paths = []
    for pack in PACKS.values():
        site = overlay_site(pack.id) if pack.overlay and is_installed(pack.id) else None
        if site:
            paths.append(str(site))
    return paths


def activate_overlays() -> None:
    """Puts the installed add-ons first on this process's import path: called by the image worker before it loads a model."""
    for path in reversed(overlay_paths()):
        if path not in sys.path:
            sys.path.insert(0, path)


def activate_overlay(pack_id: str) -> bool:
    """Same for one add-on, in any process (the server uses it for FFmpeg only: it never imports PyTorch). False when absent."""
    site = overlay_site(pack_id) if is_installed(pack_id) else None
    if not site:
        return False
    if str(site) not in sys.path:
        sys.path.insert(0, str(site))
    return True


def runtime_dir(pack_id: str | None = None) -> Path:
    """Folder of the worker scripts of a pack's family (audio by default), shipped with the app."""
    pack = PACKS.get(pack_id or "")
    family = pack.family if pack else "audio"
    default, name = FAMILY_RUNTIMES[family], f"{family}_runtime"
    candidates = [default, ROOT_DIR / name, Path(__file__).resolve().parents[1] / name]
    return next((c for c in candidates if (c / "worker.py").is_file()), default)


def find_uv() -> str | None:
    env = os.environ.get("IMAGEGEN_UV")
    if env and Path(env).is_file():
        return env
    exe = "uv.exe" if sys.platform == "win32" else "uv"
    for base in (ROOT_DIR / "runtime" / "bin", Path(sys.executable).parent):
        if (base / exe).is_file():
            return str(base / exe)
    return shutil.which("uv")


def is_installed(pack_id: str) -> bool:
    pack = PACKS.get(pack_id)
    if pack and pack.native:
        from . import audiocpp

        return audiocpp.installed_binary() is not None
    marker = pack_dir(pack_id) / "ready.json"
    if not pack or not venv_python(pack_id).is_file() or not marker.is_file():
        return False
    try:
        return json.loads(marker.read_text()).get("hash") == _requirements_hash(pack)
    except (OSError, ValueError):
        return False


def can_install(python: str = PYTHON_VERSION) -> tuple[bool, str]:
    if find_uv():
        return True, ""
    if f"{sys.version_info.major}.{sys.version_info.minor}" == python:
        return True, ""
    return False, (f"Installation impossible : l'outil « uv » est introuvable et Python {python} n'est pas disponible "
                   f"(Python {sys.version_info.major}.{sys.version_info.minor} ici). Installez uv (docs.astral.sh/uv) : "
                   f"il télécharge lui-même la bonne version de Python.")


def _gpu_vendors(system: dict[str, Any]) -> set[str]:
    """GPU makers the machine has, even when the main runtime's PyTorch cannot use them (the pack ships its own)."""
    return {a["vendor"] for a in system.get("accelerators", [])} | {g["vendor"] for g in system.get("unusable_gpus", [])}


def torch_acceleration(system: dict[str, Any]) -> bool:
    """Whether a GPU the audio packs' own PyTorch can drive is present.

    NVIDIA (CUDA wheels on Windows and Linux), AMD on Linux (ROCm wheels) and Apple Silicon (Metal). Not covered, so
    such machines run PyTorch packs on the CPU: AMD on Windows (ROCm there is a preview limited to Radeon RX 7000/9000,
    served by AMD's own wheels, see `desktop/runtime/profiles.json`: not used by `_torch_index`), Intel (PyTorch has an
    XPU backend, not wired in the engines) and any GPU only Vulkan can use (PyTorch's Vulkan backend is unmaintained).
    Extend this together with `_torch_index` when one of those paths is added and tested."""
    vendors = _gpu_vendors(system)
    return "nvidia" in vendors or "apple" in vendors or ("amd" in vendors and system.get("os") == "Linux")


def unsupported_reason(pack: PackDef, system: dict[str, Any]) -> str | None:
    """Why this machine cannot run the pack at all (French), or None."""
    if pack.overlay and pack.torch_packages:
        return None if torch_acceleration(system) else "Aucun GPU exploitable par PyTorch (NVIDIA, AMD sous Linux ou Apple Silicon)."
    if pack.gpu != "cuda":
        return None
    vendors = _gpu_vendors(system)
    if "nvidia" in vendors or ("amd" in vendors and system.get("os") == "Linux"):
        return None
    return pack.gpu_reason or "Ce moteur demande une carte graphique NVIDIA (CUDA)."


def engine_info(pack_id: str, system: dict[str, Any] | None = None) -> dict[str, Any]:
    """Same shape as the engines in `system.py`, so the catalog handles them alike.

    `system`: the hardware, when the caller is building it (`system._compute` cannot call `get_system` again)."""
    pack = PACKS.get(pack_id)
    if not pack:
        return {"available": False, "reason": f"Pack audio inconnu : {pack_id}"}
    if is_installed(pack_id):
        return {"available": True, "pack": pack_id, "pack_name": pack.name, "pack_contents": pack.contents, "pack_engine": pack.engine}
    from .system import get_system

    blocked = unsupported_reason(pack, system or get_system())
    if blocked:  # listed with its description, but no install is offered
        return {"available": False, "pack": pack_id, "pack_name": pack.name, "pack_contents": pack.contents,
                "pack_engine": pack.engine, "reason": blocked}
    ok, why = (True, "") if pack.native else can_install(python_of(pack))
    info: dict[str, Any] = {"available": False, "pack": pack_id, "pack_name": pack.name, "pack_contents": pack.contents, "pack_engine": pack.engine,
                            "reason": f"Le moteur « {pack.name} » n'est pas installé."}
    if ok:
        info.update(installable=True, install_size_mb=size_of(pack))
    else:
        info["reason"] = why
    return info


def _torch_index(accelerators: list[dict[str, Any]], rocm: str = "rocm6.4") -> str | None:
    """PyTorch index matching the GPU (macOS: PyPI wheels, which include Metal)."""
    if sys.platform == "darwin":
        return None
    vendors = {a["vendor"] for a in accelerators}
    if "nvidia" in vendors:
        return "https://download.pytorch.org/whl/cu128"
    if "amd" in vendors and sys.platform.startswith("linux"):
        return f"https://download.pytorch.org/whl/{rocm}"
    if sys.platform == "win32":
        return "https://download.pytorch.org/whl/cpu"
    return None


def _reprobe() -> None:
    """An add-on of the main runtime appeared or went away: the hardware report must probe PyTorch again."""
    from . import system

    system.reprobe()


class PackInstallCancelled(Exception):
    pass


class PackInstaller:
    """One install at a time; state is broadcast live through the `pack.install` event."""

    def __init__(self) -> None:
        self.state: dict[str, Any] = {"state": "idle"}
        self._cancel = threading.Event()
        self._proc: subprocess.Popen | None = None

    def public(self) -> dict[str, Any]:
        return dict(self.state)

    @property
    def running(self) -> bool:
        return self.state.get("state") == "running"

    def _set(self, **kw: Any) -> None:
        self.state = {**self.state, **kw}
        bus.publish("pack.install", self.public())

    async def start(self, pack_id: str, tag: str | None = None) -> dict[str, Any]:
        """Starts the install; `tag` (native packs only, i.e. audio.cpp): a release other than the pinned one."""
        from .system import get_system

        pack = PACKS.get(pack_id)
        if not pack:
            raise KeyError(f"Pack audio inconnu : {pack_id}")
        if self.running:
            if self.state.get("pack") == pack_id:
                return self.public()
            raise RuntimeError("Une autre installation de moteur audio est déjà en cours.")
        system = get_system()
        blocked = unsupported_reason(pack, system)
        if blocked:
            raise RuntimeError(blocked)
        ok, why = (True, "") if pack.native else can_install(python_of(pack))
        if not ok:
            raise RuntimeError(why)
        free_mb = system["disk"]["free_gb"] * 1024
        need_mb = size_of(pack) * 2 + 500  # download + unpacked install
        if free_mb < need_mb:
            raise RuntimeError(f"Espace disque insuffisant : ≈ {need_mb} Mo nécessaires, {int(free_mb)} Mo libres.")
        self._cancel.clear()
        self._set(state="running", pack=pack_id, name=pack.name, message="Préparation…", error=None,
                  started_at=time.time(), size_mb=size_of(pack))
        accelerators = system["accelerators"]
        if pack.gpu or pack.native:  # the pack brings its own runtime: use the GPU the OS sees even if the main one can't
            accelerators = accelerators + system.get("unusable_gpus", [])
        asyncio.create_task(asyncio.to_thread(self._run, pack, accelerators, tag))
        return self.public()

    def cancel(self) -> bool:
        if not self.running:
            return False
        self._cancel.set()
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
        return True

    # Runs in a worker thread.

    def _exec(self, cmd: list[str], message: str, env: dict[str, str] | None = None) -> None:
        self._set(message=message)
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            env={**os.environ, **(env or {})},
        )
        tail: list[str] = []
        last = 0.0
        for line in self._proc.stdout or []:
            line = line.strip()
            if not line:
                continue
            tail = (tail + [line])[-12:]
            if time.time() - last > 0.4:  # don't flood the event stream
                self._set(detail=line[:160])
                last = time.time()
        code = self._proc.wait()
        if self._cancel.is_set():
            raise PackInstallCancelled()
        if code != 0:
            raise RuntimeError(f"{message} — échec (code {code}) : {' / '.join(tail[-4:])}")

    def _fetch_archive(self, archive: PackArchive, dest: Path) -> None:
        """Stream a pinned GitHub tarball and keep only `archive.folders` (regular files, no path escaping)."""
        self._set(message="Téléchargement du code officiel…", detail=archive.url.rsplit("/", 1)[-1][:60])
        dest.mkdir(parents=True, exist_ok=True)
        wanted = tuple(f.strip("/") + "/" for f in archive.folders)
        kept = 0
        with urllib.request.urlopen(archive.url, timeout=60) as resp, tarfile.open(fileobj=resp, mode="r|gz") as tar:
            for member in tar:
                if self._cancel.is_set():
                    raise PackInstallCancelled()
                rel = member.name.split("/", 1)[1] if "/" in member.name else ""  # drop the "<repo>-<sha>/" prefix
                if not member.isfile() or not rel.startswith(wanted) or ".." in Path(rel).parts:
                    continue
                target = dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(member)
                if src is not None:
                    target.write_bytes(src.read())
                    kept += 1
        if not kept:
            raise RuntimeError("Le code officiel téléchargé ne contient pas les dossiers attendus.")

    def _run_native(self, pack: PackDef, accelerators: list[dict[str, Any]], tag: str | None = None) -> None:
        from . import audiocpp
        from .engine_install import InstallCancelled

        def progress(done: int, total: int, message: str) -> None:
            if time.time() - getattr(self, "_last_progress", 0.0) > 0.4 or done >= total:
                self._last_progress = time.time()
                self._set(message=message, detail=f"{done >> 20} / {total >> 20} Mo")

        try:
            res = audiocpp.install([a["vendor"] for a in accelerators], progress=progress, cancel=self._cancel, tag=tag)
            self._set(state="done", message="Installé", detail=res["variant"])
            bus.publish("models.changed", {})
        except InstallCancelled:
            self._set(state="cancelled", message="Annulé", detail="")
        except Exception as exc:  # noqa: BLE001
            self._set(state="error", error=str(exc), message="Échec de l'installation", detail="")

    def _run(self, pack: PackDef, accelerators: list[dict[str, Any]], tag: str | None = None) -> None:
        if pack.native:
            return self._run_native(pack, accelerators, tag)
        target = pack_dir(pack.id)
        venv = target / "venv"
        try:
            shutil.rmtree(venv, ignore_errors=True)
            target.mkdir(parents=True, exist_ok=True)
            uv = find_uv()
            if uv:
                self._exec([uv, "venv", "--python", sys.executable if pack.overlay else python_of(pack), str(venv)],
                           "Création de l'environnement Python…")
                install = [uv, "pip", "install", "--python", str(venv_python(pack.id))]
            else:
                self._exec([sys.executable, "-m", "venv", str(venv)], "Création de l'environnement Python…")
                install = [str(venv_python(pack.id)), "-m", "pip", "install", "--disable-pip-version-check"]

            index = _torch_index(accelerators, pack.rocm)
            if pack.torch_packages:
                # No GPU-specific index (macOS, or Linux/Windows without a supported accelerator): plain PyPI wheels
                # still work (Metal on macOS, CPU elsewhere) — only the `--index-url` flag is conditional, never the
                # install itself, or `torch_packages` (e.g. torchvision) silently never gets installed at all.
                cmd = [*install, *pack.torch_packages, *(["--index-url", index] if index else [])]
                self._exec(cmd, f"Installation de PyTorch ({'GPU' if index and ('cu' in index or 'rocm' in index) else 'CPU'})…")
            self._exec([*install, *requirements_for(pack)], f"Installation des bibliothèques ({pack.name})…")
            if pack.archives:
                shutil.rmtree(code_dir(pack.id), ignore_errors=True)
                for archive in pack.archives:
                    self._fetch_archive(archive, code_dir(pack.id))

            self._set(message="Vérification…", detail="")
            check = "import " + ", ".join(pack.imports)
            self._exec([str(venv_python(pack.id)), "-c", check], "Vérification de l'installation…", env=pack_env(pack.id))
            (target / "ready.json").write_text(json.dumps(
                {"hash": _requirements_hash(pack), "installed_at": time.time(), "python": python_of(pack)}))
            self._set(state="done", message="Installé", detail="")
            if pack.reprobe:
                _reprobe()
            bus.publish("models.changed", {})
        except PackInstallCancelled:
            self._discard(pack)
            self._set(state="cancelled", message="Annulé", detail="")
        except Exception as exc:  # noqa: BLE001
            self._discard(pack)
            self._set(state="error", error=str(exc), message="Échec de l'installation", detail="")
        finally:
            self._proc = None

    @staticmethod
    def _discard(pack: PackDef) -> None:
        """Removes what a cancelled or failed install left: the environment and the extracted source code."""
        shutil.rmtree(pack_dir(pack.id) / "venv", ignore_errors=True)
        shutil.rmtree(code_dir(pack.id), ignore_errors=True)

    def uninstall(self, pack_id: str) -> None:
        if self.running and self.state.get("pack") == pack_id:
            raise RuntimeError("Une installation est en cours.")
        pack = PACKS.get(pack_id)
        if pack and pack.native:
            from . import audiocpp

            shutil.rmtree(audiocpp.install_root(), ignore_errors=True)
        shutil.rmtree(pack_dir(pack_id), ignore_errors=True)  # blocking; the caller publishes `models.changed`
        if pack and pack.reprobe:
            _reprobe()


installer = PackInstaller()
