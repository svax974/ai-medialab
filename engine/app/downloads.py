# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Model download manager (Hugging Face): install state, progress and deletion."""

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

from . import runtime_settings
from .engines import MODELS, all_specs, get_spec
from .engines.base import (HfSource, ModelSpec, _matches, _source_status, derived_dir, hf_hub_dir, installation_status,
                           repo_cache_dir)
from .events import bus
from .system import get_system

BACKEND_DIR = Path(__file__).resolve().parents[1]
_STATUS_TTL = 4.0
GATED_MESSAGE = ("Ce modèle est à accès restreint : acceptez sa licence sur la page Hugging Face du dépôt, puis "
                 "renseignez votre jeton d'accès dans Réglages → Modèles.")


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

    def status(self, spec: ModelSpec) -> dict[str, Any]:
        key = f"{spec.id}:{spec.variant}"
        cached = self._status_cache.get(key)
        if cached and time.time() - cached[0] < _STATUS_TTL:
            return cached[1]
        st = installation_status(spec)
        self._status_cache[key] = (time.time(), st)
        return st

    def invalidate(self) -> None:
        self._status_cache.clear()

    def active(self) -> list[dict[str, Any]]:
        return [j.public() for j in self.jobs.values() if j.state == "running"]

    def job(self, model_id: str) -> DownloadJob | None:
        return self.jobs.get(model_id)

    async def start(self, model_id: str, *, refresh: bool = False, need_gb: float | None = None) -> DownloadJob:
        """Starts the download of a model. `refresh`: fetch what changed on the Hub for a model that is already installed
        (an update, see `updates.py`); `need_gb` is then the size of the changed files, for the disk check."""
        spec = get_spec(model_id)
        if not spec.all_sources():
            raise ValueError("Ce modèle n'a rien à télécharger.")
        if spec.gated and not runtime_settings.get_settings().get("hf_token"):
            raise RuntimeError(GATED_MESSAGE)
        if (j := self.jobs.get(model_id)) and j.state == "running":
            return j
        if any(j.state == "running" for j in self.jobs.values()):
            raise RuntimeError("Un autre téléchargement est déjà en cours.")

        self.invalidate()
        status = self.status(spec)
        need_gb = need_gb if need_gb is not None else status["need_gb"]
        free_gb = get_system()["disk"]["free_gb"]
        if need_gb and free_gb < need_gb + 1:
            raise RuntimeError(
                f"Espace disque insuffisant : il faut environ {need_gb:.0f} Go et {free_gb:.0f} Go sont libres "
                f"({get_system()['paths']['models']})."
            )

        job = DownloadJob(model_id=model_id)
        self.jobs[model_id] = job
        asyncio.create_task(self._run(job, spec, refresh))
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
        """Delete the model files. Blocking, run it in a thread; the caller publishes `models.changed`.

        A derived variant (locally quantized-and-saved) never deletes the bf16 source it was produced from this
        way: only its own checkpoint is removed, so another quantization level can still be produced from it
        without a redownload. Freeing the bf16 copy itself is the separate `free_bf16` action."""
        spec = get_spec(model_id)
        sources = spec.all_sources()
        if not sources:
            raise ValueError("Ce modèle n'a rien à supprimer.")
        job = self.jobs.get(model_id)
        if job and job.state == "running":
            raise RuntimeError("Un téléchargement est en cours pour ce modèle.")
        targets = [s for s in sources if s.kind == "derived"] or sources
        freed = 0
        for src in targets:
            freed += _delete_source(src, keep=[s2 for m in all_specs() if m.id != spec.id for s2 in m.all_sources()
                                               if s2.kind == "hf" and s2.repo == src.repo])
        self.invalidate()
        mine = {(s.repo, p) for s in targets if s.kind == "hf" for p in (s.patterns or ["*"])}
        shared = [m.id for m in all_specs() if m.id != spec.id
                  and any((s.repo, p) in mine for s in m.all_sources() if s.kind == "hf" for p in (s.patterns or ["*"]))]
        return {"freed_gb": round(freed / 1024**3, 2), "also_affects": shared}

    def free_bf16(self, model_id: str) -> dict[str, Any]:
        """Delete the full-precision source once at least one locally quantized variant is installed from it."""
        spec = get_spec(model_id)
        bf16_sources = [s for s in spec.all_sources() if s.kind == "hf"]
        derived_sources = [s for s in spec.all_sources() if s.kind == "derived"]
        if not derived_sources:
            raise ValueError("Ce modèle n'a pas de version quantifiée : rien à libérer.")
        if not any(_source_status(s)["state"] == "installed" for s in derived_sources):
            raise RuntimeError("Aucune version quantifiée installée pour ce modèle : la copie complète reste nécessaire.")
        if not bf16_sources:
            raise ValueError("Ce modèle n'a pas de copie pleine précision.")
        job = self.jobs.get(model_id)
        if job and job.state == "running":
            raise RuntimeError("Un téléchargement est en cours pour ce modèle.")
        freed = 0
        for src in bf16_sources:
            freed += _delete_source(src, keep=[s2 for m in all_specs() if m.id != spec.id for s2 in m.all_sources()
                                               if s2.kind == "hf" and s2.repo == src.repo])
        self.invalidate()
        return {"freed_gb": round(freed / 1024**3, 2)}

    async def _run(self, job: DownloadJob, spec: ModelSpec, refresh: bool = False) -> None:
        """Download each repo in turn, with progress accumulated across all of them. `refresh` also visits the repos that
        are installed: `snapshot_download` fetches only the files whose id changed on the Hub."""
        sources = spec.all_sources()
        estimates = [int((s.size_gb or 0) * 1024**3) for s in sources]
        known: list[int | None] = [None] * len(sources)  # real sizes, known once a repo has been handled
        done_before = 0
        env = dict(os.environ)
        token = runtime_settings.get_settings().get("hf_token")
        if token:
            env["HF_TOKEN"] = token
        env.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        error: str | None = None
        for i, src in enumerate(sources):
            if job.cancelled:
                break
            st = _source_status(src)
            if st["state"] == "installed" and not refresh:
                known[i] = st["size"]
                done_before += st["size"]
                continue
            module, argv = ("app.quantize_worker", [spec.id]) if src.kind == "derived" else \
                ("app.download_worker", [src.repo, json.dumps(src.patterns)])
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", module, *argv,
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
                if src.kind == "derived":
                    continue  # produced by an atomic rename: no .incomplete markers, no HF revisions to prune
                self._clean_incomplete(src.repo)
                if refresh:  # the replaced files of the old revision are dead weight now
                    from .updates import prune_replaced

                    await asyncio.to_thread(prune_replaced, src.repo)
            self.invalidate()
        self._publish(job)
        bus.publish("models.changed", {})

    @staticmethod
    def _clean_incomplete(repo: str) -> None:
        """Remove partial files left by earlier cancelled attempts."""
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
    """Every symlink under the repo trees (snapshots/ and blobs/)."""
    for repo in hub.glob("models--*"):
        for sub in ("snapshots", "blobs"):
            d = repo / sub
            if d.is_dir():
                for p in d.rglob("*"):
                    if p.is_symlink():
                        yield p


def _delete_source(src: HfSource, keep: list[HfSource]) -> int:
    """Delete the files of a repo that belong to this model and no other; returns bytes freed.

    The Hugging Face cache (huggingface_hub >= 1.0) keeps data in a global deduplicated store
    (`hub/blobs/xx/<hash>`) and each repo only holds links, so removing the repo frees nothing by itself:
    the data no link points to must be removed afterwards.

    Models can share a repo (e.g. a text encoder). Then only files no other model needs are removed;
    with no other model on the repo, the whole repo goes.

    A derived source (`kind="derived"`) is a locally produced checkpoint under `DERIVED_DIR`: never shared,
    simply removed outright."""
    if src.kind == "derived":
        root = derived_dir(src)
        if not root.is_dir():
            return 0
        freed = sum(p.stat().st_size for p in root.rglob("*") if p.is_file() and not p.is_symlink())
        shutil.rmtree(root, ignore_errors=True)
        return freed

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
                elif p.is_file():  # old layout: data stored in the repo itself
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
        # blobs/ links of this repo that became orphans
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

    # Data that no link in the cache points to anymore.
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
