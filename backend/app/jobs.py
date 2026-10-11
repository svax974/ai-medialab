"""File d'attente des générations et cycle de vie du processus worker (côté serveur).

Une seule génération à la fois (le GPU est partagé) ; un seul modèle chargé à la fois
(la mémoire unifiée ne permet pas d'en garder deux). Le modèle reste chargé entre deux
générations, puis est déchargé après un délai d'inactivité configurable.
"""

from __future__ import annotations

import asyncio
import json
import multiprocessing as mp
import queue as queue_mod
import random
import threading
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from . import db, repo
from .config import OUTPUTS_DIR, PREVIEWS_DIR
from .engines import get_spec
from .engines.base import GenerationRequest
from .events import bus
from .media import asset_path, make_thumb, media_url, resolve_size
from .worker import run_worker

DEFAULT_SETTINGS: dict[str, Any] = {
    "keep_alive_minutes": 10,  # -1 = jamais décharger, 0 = décharger après chaque génération
    "previews": True,
    "low_memory": True,  # libère l'encodeur de texte après l'encodage du prompt
    "quantize": {},  # model_id -> bits (None = pleine précision)
}


def load_settings() -> dict[str, Any]:
    return {**DEFAULT_SETTINGS, **db.get_settings()}


def new_seed() -> int:
    return random.randint(0, 2**31 - 1)


class WorkerHandle:
    """Processus worker + pont de ses événements vers la boucle asyncio."""

    def __init__(self, model_id: str, quantize: int | None, options: dict, loop: asyncio.AbstractEventLoop):
        ctx = mp.get_context("spawn")
        self.model_id = model_id
        self.quantize = quantize
        self.commands = ctx.Queue()
        self.events_mp = ctx.Queue()
        self.cancel_event = ctx.Event()
        self.events: asyncio.Queue[dict] = asyncio.Queue()
        self.loop = loop
        self.process = ctx.Process(
            target=run_worker,
            args=(model_id, quantize, options, self.commands, self.events_mp, self.cancel_event),
            name=f"worker-{model_id}",
            daemon=True,
        )
        self.process.start()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self) -> None:
        while True:
            try:
                evt = self.events_mp.get(timeout=0.5)
            except queue_mod.Empty:
                if not self.process.is_alive():
                    self.loop.call_soon_threadsafe(
                        self.events.put_nowait, {"type": "exit", "code": self.process.exitcode}
                    )
                    return
                continue
            except (EOFError, OSError):
                return
            self.loop.call_soon_threadsafe(self.events.put_nowait, evt)

    @property
    def alive(self) -> bool:
        return self.process.is_alive()

    def send(self, cmd: dict) -> None:
        self.commands.put(cmd)

    async def stop(self) -> None:
        if self.process.is_alive():
            try:
                self.commands.put({"type": "shutdown"})
            except Exception:
                pass
            await asyncio.to_thread(self.process.join, 5)
        if self.process.is_alive():
            self.process.terminate()
            await asyncio.to_thread(self.process.join, 5)
        if self.process.is_alive():
            self.process.kill()


class JobManager:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.pending: list[str] = []  # ordre d'attente, pour l'affichage
        self.worker: WorkerHandle | None = None
        self.state = "idle"  # idle | loading | ready | busy
        self.current: str | None = None
        self.load_started_at: float | None = None
        self.last_error: str | None = None
        self.progress: dict[str, dict] = {}  # message_id -> dernier état de progression
        self._idle_task: asyncio.Task | None = None
        self._runner: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- Cycle de vie ---------------------------------------------------------------------------

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._runner = asyncio.create_task(self._run())

    async def shutdown(self) -> None:
        if self._runner:
            self._runner.cancel()
        if self.worker:
            await self.worker.stop()
            self.worker = None

    # --- API publique ---------------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "model_id": self.worker.model_id if self.worker and self.worker.alive else None,
            "quantize": self.worker.quantize if self.worker and self.worker.alive else None,
            "load_started_at": self.load_started_at,
            "current_message_id": self.current,
            "queue": list(self.pending),
            "last_error": self.last_error,
        }

    def enqueue(self, message_id: str) -> None:
        self.pending.append(message_id)
        self.queue.put_nowait(message_id)
        self._publish_status()

    async def cancel(self, message_id: str) -> bool:
        if message_id in self.pending:
            self.pending.remove(message_id)
            self._finish(message_id, "cancelled")
            self._publish_status()
            return True
        if self.current == message_id and self.worker:
            self.worker.cancel_event.set()
            if self.state == "loading":
                # Annuler pendant le chargement : on arrête le worker.
                await self.unload()
            return True
        return False

    async def unload(self) -> None:
        if self.worker:
            w, self.worker = self.worker, None
            await w.stop()
        if self.state != "busy":
            self.state = "idle"
        self._publish_status()

    def snapshot(self) -> list[dict]:
        return list(self.progress.values())

    # --- Boucle principale ----------------------------------------------------------------------

    async def _run(self) -> None:
        while True:
            message_id = await self.queue.get()
            if message_id not in self.pending:
                continue  # annulé pendant l'attente
            self.pending.remove(message_id)
            if self._idle_task:
                self._idle_task.cancel()
                self._idle_task = None
            self.current = message_id
            try:
                await self._process(message_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # garde-fou : la boucle ne doit jamais mourir
                self._finish(message_id, "error", f"Erreur interne : {exc}")
            finally:
                self.current = None
                self.progress.pop(message_id, None)
                if self.worker and self.worker.alive:
                    self.state = "ready"
                elif self.state != "loading":
                    self.state = "idle"
                self._publish_status()
                if self.queue.empty():
                    self._schedule_idle_unload()

    async def _process(self, message_id: str) -> None:
        msg = repo.get_message(message_id)
        if not msg or msg["status"] != "queued":
            return
        try:
            plan = self._build_plan(msg)
        except ValueError as exc:
            self._finish(message_id, "error", str(exc))
            return

        spec = get_spec(plan["model_id"])
        if spec.hf_repo:
            from .downloads import downloads

            downloads.invalidate()
            if downloads.status(spec)["state"] != "installed":
                self._finish(message_id, "error",
                             f"Le modèle « {spec.name} » n'est pas (entièrement) téléchargé. "
                             "Ouvrez Réglages → Modèles pour le télécharger.")
                return

        settings = load_settings()
        quantize = settings["quantize"].get(plan["model_id"], spec.default_quantize)
        self.progress[message_id] = self._progress_base(message_id, plan)
        self._update(message_id, status="loading", started_at=db.now(), params=plan["params"])
        if not await self._ensure_worker(message_id, plan["model_id"], quantize):
            return

        self.state = "busy"
        self._update(message_id, status="running")
        self._publish_status()
        steps = plan["params"]["steps"]
        preview_every = max(2, round(steps / 5)) if settings["previews"] else 0
        self.worker.cancel_event.clear()
        self.worker.send(
            {
                "type": "generate",
                "job_id": message_id,
                "items": plan["items"],
                "preview_every": preview_every,
                "preview_dir": str(PREVIEWS_DIR),
            }
        )
        await self._consume(message_id, plan)

    async def _consume(self, message_id: str, plan: dict) -> None:
        count = len(plan["items"])
        prog = self.progress.setdefault(message_id, self._progress_base(message_id, plan))
        prog.update(phase="running", count=count)
        item_started = time.time()
        while True:
            evt = await self.worker.events.get()
            kind = evt["type"]
            if kind == "item_start":
                item_started = evt["t"]
                prog.update(index=evt["index"], step=0, preview_url=None)
                self._publish_progress(prog)
            elif kind == "step":
                step, total = evt["step"], evt["total"]
                elapsed = max(0.0, evt["t"] - item_started)
                per_step = elapsed / step if step else None
                remaining_steps = (total - step) + (count - evt["index"] - 1) * total
                prog.update(
                    index=evt["index"], step=step, total=total,
                    eta=round(per_step * remaining_steps, 1) if per_step else None,
                    seconds_per_step=round(per_step, 2) if per_step else None,
                )
                self._publish_progress(prog)
            elif kind == "preview":
                prog["preview_url"] = media_url("previews", Path(evt["path"]).name) + f"?t={time.time():.0f}"
                self._publish_progress(prog)
            elif kind == "image":
                asset = await asyncio.to_thread(self._register_output, message_id, plan, evt)
                bus.publish("job.image", {"message_id": message_id, "conversation_id": plan["conversation_id"],
                                          "asset": asset})
            elif kind == "done":
                self._finish(message_id, "done")
                return
            elif kind == "cancelled":
                self._finish(message_id, "cancelled")
                return
            elif kind == "error":
                print(evt.get("trace", ""), flush=True)
                self._finish(message_id, "error", evt["error"])
                return
            elif kind == "exit":
                self.worker = None
                self.state = "idle"
                self._finish(
                    message_id, "error",
                    f"Le processus du modèle s'est arrêté (code {evt['code']}). "
                    "Mémoire insuffisante ? Essayez une quantification plus forte ou une taille plus petite.",
                )
                return

    async def _ensure_worker(self, message_id: str, model_id: str, quantize: int | None) -> bool:
        w = self.worker
        if w and w.alive and w.model_id == model_id and w.quantize == quantize:
            return True
        if w:
            self.worker = None
            await w.stop()

        self.state = "loading"
        self.load_started_at = time.time()
        self.last_error = None
        prog = self.progress.setdefault(message_id, {"message_id": message_id})
        prog.update(phase="loading", load_started_at=self.load_started_at)
        self._publish_progress(prog)
        self._publish_status()

        options = {"low_memory": load_settings()["low_memory"]}
        self.worker = WorkerHandle(model_id, quantize, options, asyncio.get_running_loop())
        while True:
            worker = self.worker
            if worker is None:  # annulé pendant le chargement
                self._finish(message_id, "cancelled")
                return False
            evt = await worker.events.get()
            if self.worker is not worker:
                self._finish(message_id, "cancelled")
                return False
            if evt["type"] == "ready":
                self.state = "ready"
                self.load_started_at = None
                return True
            if evt["type"] in ("load_error", "exit"):
                await worker.stop()
                self.worker = None
                self.state = "idle"
                self.load_started_at = None
                error = evt.get("error") or f"Le processus de chargement s'est arrêté (code {evt.get('code')})."
                print(evt.get("trace", ""), flush=True)
                self.last_error = error
                self._finish(message_id, "error", f"Échec du chargement du modèle : {error}")
                return False

    def _schedule_idle_unload(self) -> None:
        minutes = load_settings()["keep_alive_minutes"]
        if minutes is None or minutes < 0 or not self.worker:
            return

        async def later() -> None:
            await asyncio.sleep(max(0, minutes) * 60)
            if self.current is None and self.queue.empty():
                await self.unload()

        self._idle_task = asyncio.create_task(later())

    # --- Préparation -----------------------------------------------------------------------------

    def _build_plan(self, msg: dict) -> dict:
        try:
            spec = get_spec(msg["model_id"])
        except KeyError as exc:
            raise ValueError(str(exc)) from None
        params = dict(msg["params"])

        with db.connect() as conn:
            refs = conn.execute(
                "SELECT a.kind, a.filename FROM message_refs r JOIN assets a ON a.id = r.asset_id "
                "WHERE r.message_id = ? ORDER BY r.position",
                (msg["parent_id"],),
            ).fetchall()
        ref_paths = [asset_path(r["kind"], r["filename"]) for r in refs]
        ref_paths = [p for p in ref_paths if p.is_file()]
        if spec.reference_mode == "none":
            ref_paths = []
        else:
            ref_paths = ref_paths[: spec.max_references]
        if spec.requires_references and not ref_paths:
            raise ValueError(f"{spec.name} a besoin d'au moins une image de référence.")
        if not msg["prompt"].strip():
            raise ValueError("Le prompt est vide.")

        defaults = spec.default_params()
        width, height = resolve_size(
            params,
            multiple=spec.size_multiple,
            min_side=spec.min_side,
            max_side=spec.max_side,
            default_megapixels=spec.default_megapixels,
            reference=ref_paths[0] if ref_paths else None,
        )
        steps = int(params.get("steps") or defaults.get("steps") or 30)
        guidance = params.get("guidance", defaults.get("guidance"))
        strength = params.get("strength", defaults.get("strength")) if ref_paths else None
        negative = params.get("negative_prompt") or None
        seeds = params.get("seeds") or [new_seed()]

        params.update(width=width, height=height, steps=steps, seeds=seeds)
        if guidance is not None:
            params["guidance"] = float(guidance)
        if strength is not None:
            params["strength"] = float(strength)
        else:
            params.pop("strength", None)
        params["references_used"] = len(ref_paths)

        items = []
        for i, seed in enumerate(seeds):
            req = GenerationRequest(
                prompt=msg["prompt"],
                width=width,
                height=height,
                steps=steps,
                seed=int(seed),
                guidance=float(guidance) if guidance is not None else None,
                negative_prompt=negative,
                references=[str(p) for p in ref_paths],
                strength=float(strength) if strength is not None else None,
            )
            items.append({"request": asdict(req), "output": str(OUTPUTS_DIR / f"{msg['id']}_{i}.png")})
        return {
            "model_id": spec.id,
            "conversation_id": msg["conversation_id"],
            "params": params,
            "items": items,
            "prompt": msg["prompt"],
        }

    def _register_output(self, message_id: str, plan: dict, evt: dict) -> dict:
        path = Path(evt["path"])
        asset_id = db.new_id()
        thumb = make_thumb(path, asset_id)
        from PIL import Image

        with Image.open(path) as img:
            width, height = img.size
        meta = {
            "model_id": plan["model_id"],
            "prompt": plan["prompt"],
            "steps": plan["params"]["steps"],
            "guidance": plan["params"].get("guidance"),
            "strength": plan["params"].get("strength"),
            "seconds": evt.get("seconds"),
        }
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO assets (id, kind, conversation_id, message_id, filename, thumb, width, height, seed, "
                "position, meta, created_at) VALUES (?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (asset_id, plan["conversation_id"], message_id, path.name, thumb, width, height, evt["seed"],
                 evt["index"], json.dumps(meta), db.now()),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        return repo.asset_public(row)

    # --- Publication ------------------------------------------------------------------------------

    def _progress_base(self, message_id: str, plan: dict) -> dict:
        return {"message_id": message_id, "conversation_id": plan["conversation_id"]}

    def _update(self, message_id: str, **fields: Any) -> None:
        repo.update_message(message_id, **fields)
        msg = repo.get_message(message_id)
        if msg:
            bus.publish("message.updated", msg)

    def _finish(self, message_id: str, status: str, error: str | None = None) -> None:
        self.progress.pop(message_id, None)
        repo.update_message(message_id, status=status, error=error, finished_at=db.now())
        repo.delete_previews(message_id)
        msg = repo.get_message(message_id)
        if msg:
            bus.publish("message.updated", msg)

    def _publish_progress(self, prog: dict) -> None:
        bus.publish("job.progress", prog)

    def _publish_status(self) -> None:
        bus.publish("engine.status", self.status())


jobs = JobManager()
