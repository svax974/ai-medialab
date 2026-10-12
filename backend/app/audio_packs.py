"""Packs de moteurs audio : un environnement Python isolé par famille de modèles, installé à la demande.

Pourquoi isolés : les bibliothèques de synthèse vocale épinglent des versions incompatibles entre elles
(Qwen3-TTS exige `transformers==4.57.3`, le moteur image `transformers>=5.17`, Chatterbox `==5.2.0`…).
Un environnement par pack évite tout conflit, et chaque pack ne s'installe que si l'on utilise ses modèles.

Installation : `uv` si disponible (rapide, et capable de récupérer un Python 3.12), sinon `venv` + `pip`
avec l'interpréteur courant (3.12 requis). Rien n'exige de droits administrateur : tout va dans
`<données>/engines/audio/<pack>/`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import AUDIO_PACKS_DIR, AUDIO_RUNTIME_DIR, ROOT_DIR
from .events import bus

PYTHON_VERSION = "3.12"  # kokoro exige < 3.13 ; qwen-tts, pocket-tts et chatterbox vivent bien en 3.12


@dataclass(frozen=True)
class PackDef:
    id: str
    name: str
    requirements: tuple[str, ...]
    # Modules à pouvoir importer pour considérer le pack comme sain.
    imports: tuple[str, ...]
    size_mb: int
    # Paquets PyTorch à installer d'abord depuis l'index du GPU (sinon pip prend la version CPU sous Windows).
    torch_packages: tuple[str, ...] = ("torch",)
    note: str = ""
    # Ce qu'on installe, en une phrase (affiché avant l'installation).
    contents: str = ""
    # Nom du moteur d'inférence lui-même (et non de la famille de modèles) : ce qu'on installe vraiment.
    engine: str = ""


PACKS: dict[str, PackDef] = {
    "speech": PackDef(
        id="speech",
        name="Voix légères (Kokoro, Pocket TTS, Whisper)",
        requirements=("kokoro>=0.9.4", "misaki[en]>=0.9.4", "pocket-tts>=3.3", "faster-whisper>=1.1",
                      "soundfile>=0.12", "numpy>=2", "huggingface_hub>=0.30"),
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
}


def _requirements_hash(pack: PackDef) -> str:
    return hashlib.sha256(json.dumps([PYTHON_VERSION, *pack.requirements, *pack.torch_packages]).encode()).hexdigest()[:16]


def pack_dir(pack_id: str) -> Path:
    return AUDIO_PACKS_DIR / pack_id


def venv_python(pack_id: str) -> Path:
    base = pack_dir(pack_id) / "venv"
    return base / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def runtime_dir() -> Path:
    """Dossier du worker audio (livré avec l'application)."""
    candidates = [AUDIO_RUNTIME_DIR, ROOT_DIR / "audio_runtime", Path(__file__).resolve().parents[1] / "audio_runtime"]
    return next((c for c in candidates if (c / "worker.py").is_file()), AUDIO_RUNTIME_DIR)


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
    marker = pack_dir(pack_id) / "ready.json"
    if not pack or not venv_python(pack_id).is_file() or not marker.is_file():
        return False
    try:
        return json.loads(marker.read_text()).get("hash") == _requirements_hash(pack)
    except (OSError, ValueError):
        return False


def can_install() -> tuple[bool, str]:
    if find_uv():
        return True, ""
    if sys.version_info[:2] == (3, 12):
        return True, ""
    return False, (f"Installation impossible : ni « uv » ni Python {PYTHON_VERSION} ne sont disponibles "
                   f"(Python {sys.version_info.major}.{sys.version_info.minor} ici).")


def engine_info(pack_id: str) -> dict[str, Any]:
    """Même forme que les moteurs de `system.py`, pour que le catalogue les traite pareil."""
    pack = PACKS.get(pack_id)
    if not pack:
        return {"available": False, "reason": f"Pack audio inconnu : {pack_id}"}
    if is_installed(pack_id):
        return {"available": True, "pack": pack_id, "pack_name": pack.name, "pack_contents": pack.contents, "pack_engine": pack.engine}
    ok, why = can_install()
    info: dict[str, Any] = {"available": False, "pack": pack_id, "pack_name": pack.name, "pack_contents": pack.contents, "pack_engine": pack.engine,
                            "reason": f"Le moteur « {pack.name} » n'est pas installé."}
    if ok:
        info.update(installable=True, install_size_mb=pack.size_mb)
    else:
        info["reason"] = why
    return info


# --- Installation ---------------------------------------------------------------------------------------

def _torch_index(accelerators: list[dict[str, Any]]) -> str | None:
    """Index PyTorch adapté au GPU (macOS : roues PyPI, qui incluent Metal)."""
    if sys.platform == "darwin":
        return None
    vendors = {a["vendor"] for a in accelerators}
    if "nvidia" in vendors:
        return "https://download.pytorch.org/whl/cu128"
    if "amd" in vendors and sys.platform.startswith("linux"):
        return "https://download.pytorch.org/whl/rocm6.4"
    if sys.platform == "win32":
        return "https://download.pytorch.org/whl/cpu"
    return None


class PackInstallCancelled(Exception):
    pass


class PackInstaller:
    """Une installation à la fois ; l'état est diffusé en temps réel (événement `pack.install`)."""

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

    async def start(self, pack_id: str) -> dict[str, Any]:
        from .system import get_system

        pack = PACKS.get(pack_id)
        if not pack:
            raise KeyError(f"Pack audio inconnu : {pack_id}")
        if self.running:
            if self.state.get("pack") == pack_id:
                return self.public()
            raise RuntimeError("Une autre installation de moteur audio est déjà en cours.")
        ok, why = can_install()
        if not ok:
            raise RuntimeError(why)
        system = get_system()
        free_mb = system["disk"]["free_gb"] * 1024
        need_mb = pack.size_mb * 2 + 500  # téléchargement + installation
        if free_mb < need_mb:
            raise RuntimeError(f"Espace disque insuffisant : ≈ {need_mb} Mo nécessaires, {int(free_mb)} Mo libres.")
        self._cancel.clear()
        self._set(state="running", pack=pack_id, name=pack.name, message="Préparation…", error=None,
                  started_at=time.time(), size_mb=pack.size_mb)
        accelerators = system["accelerators"]
        asyncio.create_task(asyncio.to_thread(self._run, pack, accelerators))
        return self.public()

    def cancel(self) -> bool:
        if not self.running:
            return False
        self._cancel.set()
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
        return True

    # -- thread ----------------------------------------------------------------------------------------------

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
            if time.time() - last > 0.4:  # ne pas inonder le flux d'événements
                self._set(detail=line[:160])
                last = time.time()
        code = self._proc.wait()
        if self._cancel.is_set():
            raise PackInstallCancelled()
        if code != 0:
            raise RuntimeError(f"{message} — échec (code {code}) : {' / '.join(tail[-4:])}")

    def _run(self, pack: PackDef, accelerators: list[dict[str, Any]]) -> None:
        target = pack_dir(pack.id)
        venv = target / "venv"
        try:
            shutil.rmtree(venv, ignore_errors=True)
            target.mkdir(parents=True, exist_ok=True)
            uv = find_uv()
            if uv:
                self._exec([uv, "venv", "--python", PYTHON_VERSION, str(venv)], "Création de l'environnement Python…")
                install = [uv, "pip", "install", "--python", str(venv_python(pack.id))]
            else:
                self._exec([sys.executable, "-m", "venv", str(venv)], "Création de l'environnement Python…")
                install = [str(venv_python(pack.id)), "-m", "pip", "install", "--disable-pip-version-check"]

            index = _torch_index(accelerators)
            if index and pack.torch_packages:
                self._exec([*install, *pack.torch_packages, "--index-url", index],
                           f"Installation de PyTorch ({'GPU' if 'cu' in index or 'rocm' in index else 'CPU'})…")
            self._exec([*install, *pack.requirements], f"Installation des bibliothèques ({pack.name})…")

            self._set(message="Vérification…", detail="")
            check = "import " + ", ".join(pack.imports)
            self._exec([str(venv_python(pack.id)), "-c", check], "Vérification de l'installation…")
            (target / "ready.json").write_text(json.dumps(
                {"hash": _requirements_hash(pack), "installed_at": time.time(), "python": PYTHON_VERSION}))
            self._set(state="done", message="Installé", detail="")
            bus.publish("models.changed", {})
        except PackInstallCancelled:
            shutil.rmtree(venv, ignore_errors=True)
            self._set(state="cancelled", message="Annulé", detail="")
        except Exception as exc:  # noqa: BLE001
            shutil.rmtree(venv, ignore_errors=True)
            self._set(state="error", error=str(exc), message="Échec de l'installation", detail="")
        finally:
            self._proc = None

    def uninstall(self, pack_id: str) -> None:
        if self.running and self.state.get("pack") == pack_id:
            raise RuntimeError("Une installation est en cours.")
        shutil.rmtree(pack_dir(pack_id), ignore_errors=True)  # bloquant ; l'appelant publie `models.changed`


installer = PackInstaller()
