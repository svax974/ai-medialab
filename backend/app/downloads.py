"""Gestionnaire de téléchargement des modèles (Hugging Face), état d'installation et suppression."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import db
from .engines import MODELS, get_spec
from .engines.base import ModelSpec, installation_status, repo_cache_dir
from .events import bus
from .system import get_system

BACKEND_DIR = Path(__file__).resolve().parents[1]
_STATUS_TTL = 4.0


@dataclass
class DownloadJob:
    model_id: str
    state: str = "running"  # running | error | cancelled | done
    done: int = 0
    total: int = 0
    rate: int = 0
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    proc: asyncio.subprocess.Process | None = None
    cancelled: bool = False

    def public(self) -> dict[str, Any]:
        remaining = max(0, self.total - self.done)
        return {
            "model_id": self.model_id,
            "state": self.state,
            "done": self.done,
            "total": self.total,
            "rate": self.rate,
            "eta": round(remaining / self.rate) if self.rate > 0 and self.state == "running" else None,
            "error": self.error,
        }


class DownloadManager:
    def __init__(self) -> None:
        self.jobs: dict[str, DownloadJob] = {}
        self._status_cache: dict[str, tuple[float, dict[str, Any]]] = {}

    # --- État --------------------------------------------------------------------------------------------

    def status(self, spec: ModelSpec) -> dict[str, Any]:
        cached = self._status_cache.get(spec.id)
        if cached and time.time() - cached[0] < _STATUS_TTL:
            return cached[1]
        st = installation_status(spec)
        self._status_cache[spec.id] = (time.time(), st)
        return st

    def invalidate(self) -> None:
        self._status_cache.clear()

    def active(self) -> list[dict[str, Any]]:
        return [j.public() for j in self.jobs.values() if j.state == "running"]

    def job(self, model_id: str) -> DownloadJob | None:
        return self.jobs.get(model_id)

    # --- Actions -----------------------------------------------------------------------------------------

    async def start(self, model_id: str) -> DownloadJob:
        spec = get_spec(model_id)
        if not spec.hf_repo:
            raise ValueError("Ce modèle n'a rien à télécharger.")
        if (j := self.jobs.get(model_id)) and j.state == "running":
            return j
        if any(j.state == "running" for j in self.jobs.values()):
            raise RuntimeError("Un autre téléchargement est déjà en cours.")

        self.invalidate()
        status = self.status(spec)
        need_gb = max(0.0, (spec.download_size_gb or 0) - status["size_gb"])
        free_gb = get_system()["disk"]["free_gb"]
        if need_gb and free_gb < need_gb + 1:
            raise RuntimeError(
                f"Espace disque insuffisant : il faut environ {need_gb:.0f} Go et {free_gb:.0f} Go sont libres "
                f"({get_system()['paths']['models']})."
            )

        job = DownloadJob(model_id=model_id)
        self.jobs[model_id] = job
        env = dict(os.environ)
        token = db.get_settings().get("hf_token")
        if token:
            env["HF_TOKEN"] = token
        env.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        job.proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.download_worker", spec.hf_repo, json.dumps(spec.hf_patterns),
            cwd=str(BACKEND_DIR), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        asyncio.create_task(self._watch(job))
        self._publish(job)
        return job

    async def cancel(self, model_id: str) -> bool:
        job = self.jobs.get(model_id)
        if not job or job.state != "running" or not job.proc:
            return False
        job.cancelled = True
        try:
            job.proc.terminate()
        except ProcessLookupError:
            pass
        return True

    def delete(self, model_id: str) -> dict[str, Any]:
        spec = get_spec(model_id)
        if not spec.hf_repo:
            raise ValueError("Ce modèle n'a rien à supprimer.")
        job = self.jobs.get(model_id)
        if job and job.state == "running":
            raise RuntimeError("Un téléchargement est en cours pour ce modèle.")
        root = repo_cache_dir(spec.hf_repo)
        freed = 0
        if root.exists():
            for p in root.rglob("*"):
                try:
                    if p.is_file() and not p.is_symlink():
                        freed += p.stat().st_size
                except OSError:
                    pass
            shutil.rmtree(root, ignore_errors=True)
        self.invalidate()
        shared = [m.id for m in MODELS.values() if m.hf_repo == spec.hf_repo and m.id != spec.id]
        bus.publish("models.changed", {})
        return {"freed_gb": round(freed / 1024**3, 2), "also_affects": shared}

    # --- Suivi du sous-processus -------------------------------------------------------------------------

    async def _watch(self, job: DownloadJob) -> None:
        proc = job.proc
        assert proc and proc.stdout
        last_publish = 0.0
        try:
            async for raw in proc.stdout:
                try:
                    evt = json.loads(raw)
                except ValueError:
                    continue
                kind = evt.get("type")
                if kind == "progress":
                    job.done, job.total, job.rate = evt["done"], evt["total"], evt["rate"]
                    if time.time() - last_publish > 0.4:
                        last_publish = time.time()
                        self._publish(job)
                elif kind == "error":
                    job.error = evt["error"]
        finally:
            code = await proc.wait()
        self.invalidate()
        if job.cancelled:
            job.state = "cancelled"
        elif code == 0:
            job.state = "done"
            job.done = job.total or job.done
            self._clean_incomplete(job.model_id)
        else:
            job.state = "error"
            job.error = job.error or f"Le téléchargement s'est arrêté (code {code})."
        self._publish(job)
        bus.publish("models.changed", {})

    @staticmethod
    def _clean_incomplete(model_id: str) -> None:
        """Supprime les fichiers partiels laissés par d'anciennes tentatives annulées."""
        spec = get_spec(model_id)
        blobs = repo_cache_dir(spec.hf_repo) / "blobs"
        if blobs.is_dir():
            for p in blobs.glob("*.incomplete"):
                p.unlink(missing_ok=True)

    def _publish(self, job: DownloadJob) -> None:
        bus.publish("download.progress", job.public())

    async def shutdown(self) -> None:
        for job in self.jobs.values():
            if job.state == "running" and job.proc:
                try:
                    job.proc.terminate()
                except ProcessLookupError:
                    pass


downloads = DownloadManager()
