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
from .engines.base import HfSource, ModelSpec, _matches, _source_status, hf_hub_dir, installation_status, repo_cache_dir
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
        if not spec.all_sources():
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
        asyncio.create_task(self._run(job, spec))
        self._publish(job)
        return job

    async def cancel(self, model_id: str) -> bool:
        job = self.jobs.get(model_id)
        if not job or job.state != "running":
            return False
        job.cancelled = True
        if job.proc:
            try:
                job.proc.terminate()
            except ProcessLookupError:
                pass
        return True

    def delete(self, model_id: str) -> dict[str, Any]:
        spec = get_spec(model_id)
        sources = spec.all_sources()
        if not sources:
            raise ValueError("Ce modèle n'a rien à supprimer.")
        job = self.jobs.get(model_id)
        if job and job.state == "running":
            raise RuntimeError("Un téléchargement est en cours pour ce modèle.")
        freed = 0
        for src in sources:
            freed += _delete_source(src, keep=[s2 for m in MODELS.values() if m.id != spec.id for s2 in m.all_sources()
                                               if s2.repo == src.repo])
        self.invalidate()
        mine = {(s.repo, p) for s in sources for p in (s.patterns or ["*"])}
        shared = [m.id for m in MODELS.values() if m.id != spec.id
                  and any((s.repo, p) in mine for s in m.all_sources() for p in (s.patterns or ["*"]))]
        bus.publish("models.changed", {})
        return {"freed_gb": round(freed / 1024**3, 2), "also_affects": shared}

    # --- Suivi du sous-processus -------------------------------------------------------------------------

    async def _run(self, job: DownloadJob, spec: ModelSpec) -> None:
        """Télécharge chaque dépôt à la suite ; la progression est cumulée sur l'ensemble."""
        sources = spec.all_sources()
        estimates = [int((s.size_gb or 0) * 1024**3) for s in sources]
        known: list[int | None] = [None] * len(sources)  # tailles réelles, connues une fois le dépôt traité
        done_before = 0
        env = dict(os.environ)
        token = db.get_settings().get("hf_token")
        if token:
            env["HF_TOKEN"] = token
        env.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        error: str | None = None
        for i, src in enumerate(sources):
            if job.cancelled:
                break
            st = _source_status(src)
            if st["state"] == "installed":
                known[i] = st["size"]
                done_before += st["size"]
                continue
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "app.download_worker", src.repo, json.dumps(src.patterns),
                cwd=str(BACKEND_DIR), env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            job.proc = proc
            last_publish = 0.0
            assert proc.stdout
            async for raw in proc.stdout:
                try:
                    evt = json.loads(raw)
                except ValueError:
                    continue
                if evt.get("type") == "progress":
                    known[i] = evt["total"]
                    remaining = sum(estimates[k] for k in range(i + 1, len(sources)))
                    job.done = done_before + evt["done"]
                    job.total = sum(k for k in known[: i + 1] if k) + remaining
                    job.rate = evt["rate"]
                    if time.time() - last_publish > 0.4:
                        last_publish = time.time()
                        self._publish(job)
                elif evt.get("type") == "error":
                    error = evt["error"]
            code = await proc.wait()
            job.proc = None
            if job.cancelled:
                break
            if code != 0:
                error = error or f"Le téléchargement s'est arrêté (code {code})."
                break
            done_before += known[i] or estimates[i]
            job.done = done_before

        self.invalidate()
        if job.cancelled:
            job.state = "cancelled"
        elif error:
            job.state, job.error = "error", error
        else:
            job.state = "done"
            job.done = job.total = done_before or job.total
            for src in sources:
                self._clean_incomplete(src.repo)
        self._publish(job)
        bus.publish("models.changed", {})

    @staticmethod
    def _clean_incomplete(repo: str) -> None:
        """Supprime les fichiers partiels laissés par d'anciennes tentatives annulées."""
        blobs = repo_cache_dir(repo) / "blobs"
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


def _repo_links(hub: Path):
    """Tous les liens symboliques des arbres de dépôts (snapshots/ et blobs/)."""
    for repo in hub.glob("models--*"):
        for sub in ("snapshots", "blobs"):
            d = repo / sub
            if d.is_dir():
                for p in d.rglob("*"):
                    if p.is_symlink():
                        yield p


def _delete_source(src: HfSource, keep: list[HfSource]) -> int:
    """Supprime les fichiers d'un dépôt qui appartiennent à ce modèle et à aucun autre ; retourne les octets libérés.

    Le cache Hugging Face (huggingface_hub ≥ 1.0) range les données dans un magasin global dédupliqué
    (`hub/blobs/xx/<hash>`) ; chaque dépôt ne contient que des liens. Supprimer le dépôt ne libère donc rien :
    il faut ensuite retirer les données qu'aucun lien ne référence plus.

    Plusieurs modèles peuvent partager un dépôt (ex. un encodeur de texte) : on ne retire alors que les fichiers
    requis par aucun autre. Sans autre modèle sur ce dépôt, tout le dépôt est retiré."""
    import shutil

    hub = hf_hub_dir().resolve()
    root = repo_cache_dir(src.repo)
    if not root.exists():
        return 0
    freed = 0
    targets: set[Path] = set()
    if not keep:
        for p in root.rglob("*"):
            try:
                if p.is_symlink():
                    targets.add(p.resolve())
                elif p.is_file():  # ancienne disposition : données dans le dépôt
                    freed += p.stat().st_size
            except OSError:
                pass
        shutil.rmtree(root, ignore_errors=True)
    else:
        protected = [pat for k in keep for pat in (k.patterns or ["*"])]
        snapshots = root / "snapshots"
        for snap in snapshots.iterdir() if snapshots.is_dir() else []:
            for p in list(snap.rglob("*")):
                rel = p.relative_to(snap).as_posix()
                if not (p.is_symlink() or p.is_file()):
                    continue
                if (src.patterns is None or _matches(rel, src.patterns)) and not _matches(rel, protected):
                    try:
                        targets.add(p.resolve())
                    except OSError:
                        pass
                    p.unlink(missing_ok=True)
        # liens de blobs/ du dépôt devenus orphelins
        blobs = root / "blobs"
        if blobs.is_dir():
            live = set()
            for p in (root / "snapshots").rglob("*") if (root / "snapshots").is_dir() else []:
                if p.is_symlink():
                    try:
                        live.add(p.resolve())
                    except OSError:
                        pass
            for p in blobs.iterdir():
                if p.is_symlink():
                    try:
                        if p.resolve() in targets and p.resolve() not in live:
                            p.unlink(missing_ok=True)
                    except OSError:
                        pass

    # Données qu'aucun lien du cache ne référence plus.
    referenced: set[Path] = set()
    for p in _repo_links(hub):
        try:
            referenced.add(p.resolve())
        except OSError:
            pass
    for t in targets:
        try:
            if t.is_file() and hub in t.parents and t not in referenced:
                freed += t.stat().st_size
                t.unlink()
                if t.parent != hub / "blobs" and not any(t.parent.iterdir()):
                    t.parent.rmdir()
        except OSError:
            pass
    return freed


downloads = DownloadManager()
