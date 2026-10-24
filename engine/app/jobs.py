# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Generation queue and worker process lifecycle (server side).

One generation at a time (the GPU is shared). The model stays loaded between generations and is unloaded after a
configurable idle delay, or earlier when another model needs its place under the global memory ceiling
(`memory_budget.py`): the worker can stay loaded next to the chat model when both fit.

The manager is stateless with respect to the studio: it runs `JobRequest`s (see `job_plans.py`) and reports
`job.started`, `job.progress`, `job.preview`, `job.output`, `job.done`, `job.failed` and `job.cancelled` events to the
job's sink (the event bus by default). It never touches conversations, messages or assets; the callers do
(`api/jobs.py` for NestJS).
"""

from __future__ import annotations

import asyncio
import multiprocessing as mp
import queue as queue_mod
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

from . import audio_packs, memory_budget, memory_guard, runtime_settings
from .audio_worker import AudioWorkerHandle
from .config import PREVIEWS_DIR
from .engines import get_spec
from .events import bus
from .job_outputs import describe_output
from .job_plans import JobRequest, build_plan
from .media import delete_previews, media_url
from .private_session import media_url as private_media_url, sanitize_error, session_dir, subfolder
from .worker import run_worker

HISTORY_SIZE = 100  # finished jobs kept so a reconnecting caller can learn how they ended

DEFAULT_SETTINGS: dict[str, Any] = {
    "keep_alive_minutes": 10,  # -1 = never unload, 0 = unload after each generation
    "previews": True,
    "low_memory": True,  # free the text encoder after encoding the prompt
    "memory_limit_gb": 0,  # ceiling for the models loaded together (`memory_budget.py`); 0 = 80 % of the machine
    "quantize": {},  # model_id -> bits (None = full precision)
    "variant": {},  # model_id -> chosen quantization (a `Variant` key)
}


def load_settings() -> dict[str, Any]:
    return {**DEFAULT_SETTINGS, **runtime_settings.get_settings()}


def _runtime_has(backend: str) -> bool:
    """Whether the main runtime brings a backend itself (development environment, older full bundles)."""
    import importlib.util

    module = {"torch": "torch", "mlx": "mflux"}.get(backend)
    return module is not None and importlib.util.find_spec(module) is not None


class WorkerHandle:
    """Worker process plus a bridge from its events to the asyncio loop."""

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
            # Wait for the end: the next model must not start loading while this one still holds its memory.
            await asyncio.to_thread(self.process.join, 5)


MEDIA_SLOT = "media"  # key of the generation worker in the memory budget


def _pid(worker: Any) -> int | None:
    """Process id of a worker handle (image process or pack subprocess), None when there is none."""
    process = getattr(worker, "process", None)
    return getattr(process, "pid", None)


def _bus_sink(_job: JobRequest, name: str, data: dict[str, Any]) -> None:
    bus.publish(name, data)


class JobManager:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.pending: list[str] = []  # wait order, for display
        self.jobs: dict[str, JobRequest] = {}  # queued or running
        self.history: OrderedDict[str, dict[str, Any]] = OrderedDict()  # finished, newest last
        self.worker: WorkerHandle | AudioWorkerHandle | None = None
        self.state = "idle"  # idle | loading | ready | busy
        self.current: str | None = None
        self.load_started_at: float | None = None
        self.last_used = time.time()  # end of the last job: which model the memory budget unloads first
        self.last_error: str | None = None
        self.progress: dict[str, dict] = {}  # job_id -> latest progress state
        self._cancel_requested: set[str] = set()
        self._idle_task: asyncio.Task | None = None
        self._runner: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        # Kills the worker before the machine runs out of memory (see memory_guard.py).
        self.guard = memory_guard.MemoryWatchdog(self._watched_pid)

    def _watched_pid(self) -> int | None:
        w = self.worker
        return _pid(w) if w and w.alive else None

    def resident(self) -> memory_budget.Resident | None:
        """The model the worker holds, as the memory budget counts it."""
        w = self.worker
        if not (w and w.alive):
            return None
        spec = get_spec(w.model_id)
        return memory_budget.Resident(w.model_id, spec.name, spec.weights_gb or 0.0, self.last_used)

    def busy(self) -> bool:
        return self.current is not None or bool(self.pending)

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._runner = asyncio.create_task(self._run())
        self.guard.start()

    async def shutdown(self) -> None:
        self.guard.stop()
        if self._runner:
            self._runner.cancel()
        if self.worker:
            await self.worker.stop()
            self.worker = None

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

    def submit(self, job: JobRequest) -> None:
        """Queues a job; a job id that is still queued or running is refused (ValueError)."""
        if job.job_id in self.jobs:
            raise ValueError(f"Le job {job.job_id} est déjà en file ou en cours.")
        self.history.pop(job.job_id, None)
        job.state = "queued"
        self.jobs[job.job_id] = job
        self.pending.append(job.job_id)
        self.queue.put_nowait(job.job_id)
        self._publish_status()

    def describe(self, job_id: str) -> dict[str, Any] | None:
        """State of a job: queued or running, or one of the last finished ones; None when unknown."""
        job = self.jobs.get(job_id)
        if job is None:
            return self.history.get(job_id)
        return {
            "job_id": job.job_id, "state": job.state, "error": job.error, "outputs": list(job.outputs),
            "queue_position": self.pending.index(job_id) if job_id in self.pending else None,
            "progress": dict(job.progress) or None,
        }

    def active(self) -> list[dict[str, Any]]:
        return [d for d in (self.describe(i) for i in self.jobs) if d]

    async def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if job is None:
            return False
        if job_id in self.pending:
            self.pending.remove(job_id)
            self._finish(job, "cancelled")
            self._publish_status()
            return True
        if self.current == job_id:
            if self.worker:
                self.worker.cancel_event.set()
                if self.state == "loading":
                    # Cancelling during load: just kill the worker.
                    await self.unload()
            else:
                self._cancel_requested.add(job_id)  # still preparing: stops before the worker starts
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
        return [dict(p) for i, p in self.progress.items() if i in self.jobs]

    async def _run(self) -> None:
        while True:
            job_id = await self.queue.get()
            if job_id not in self.pending:
                continue  # cancelled while waiting
            self.pending.remove(job_id)
            job = self.jobs[job_id]
            if self._idle_task:
                self._idle_task.cancel()
                self._idle_task = None
            self.current = job_id
            self.guard.begin_job()
            try:
                await self._process(job)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # safety net: this loop must never die
                self._finish(job, "failed", f"Erreur interne : {exc}")
            finally:
                if job_id in self.jobs:  # a path above forgot to finish it
                    self._finish(job, "failed", "Erreur interne : le job s'est arrêté sans résultat.")
                stats = self.guard.job_stats()
                if not job.private_dir:  # a private job leaves no line: not even when it ran (the id is a timestamp)
                    print(f"[memory] job {job_id} : mémoire libre au plus bas {stats['min_free_gb']} Go, "
                          f"processus du modèle au plus haut {stats['peak_worker_gb']} Go", flush=True)
                self.current = None
                self.last_used = time.time()
                self._cancel_requested.discard(job_id)
                if self.worker and self.worker.alive:
                    self.state = "ready"
                elif self.state != "loading":
                    self.state = "idle"
                self._publish_status()
                if self.queue.empty():
                    self._schedule_idle_unload()

    async def _process(self, job: JobRequest) -> None:
        try:
            plan = build_plan(job)
        except ValueError as exc:
            self._finish(job, "failed", str(exc))
            return
        error = self._availability_error(plan["model_id"])
        if error:
            self._finish(job, "failed", error)
            return

        spec = get_spec(plan["model_id"])
        settings = load_settings()
        quantize = settings["quantize"].get(plan["model_id"], spec.default_quantize)
        job.progress = self.progress[job.job_id] = self._progress_base(job)
        job.state = "loading"
        self._emit(job, "job.started", {"kind": plan["kind"], "model_id": plan["model_id"], "params": plan["params"],
                                        "started_at": time.time()})
        if not await self._ensure_worker(job, plan["model_id"], quantize, plan):
            return
        if job.job_id in self._cancel_requested:
            self._finish(job, "cancelled")
            return

        self.state = "busy"
        job.state = "running"
        self._publish_status()
        steps = plan["params"]["steps"]
        preview_every = max(2, round(steps / 5)) if settings["previews"] and spec.kind == "image" else 0
        self.worker.cancel_event.clear()
        self.worker.send(
            {
                "type": "generate",
                "job_id": job.job_id,
                "items": plan["items"],
                "preview_every": preview_every,
                "preview_dir": str(subfolder(session_dir(job.private_dir), "previews") if job.private_dir else PREVIEWS_DIR),
                "tmp_dir": str(subfolder(session_dir(job.private_dir), "tmp")) if job.private_dir else None,
            }
        )
        await self._consume(job, plan)

    def _availability_error(self, model_id: str) -> str | None:
        """Why the model cannot run right now (engine or weights not installed), as the message to show."""
        spec = get_spec(model_id)
        pack = audio_packs.pack_of(spec)
        if pack and not audio_packs.is_installed(pack) and not _runtime_has(spec.backend):
            return (f"Le moteur « {audio_packs.PACKS[pack].name} » n'est pas installé. "
                    "Ouvrez Modèles pour l'installer.")
        if spec.backend == "sdcpp":
            from .system import get_system

            engine = get_system()["engines"]["sdcpp"]
            if not engine["available"]:
                return (engine.get("reason") or "Moteur GGUF indisponible.") + " Ouvrez Modèles pour l'installer."
        if spec.all_sources():
            from .downloads import downloads

            downloads.invalidate()
            if downloads.status(spec)["state"] != "installed":
                return (f"Le modèle « {spec.name} » n'est pas (entièrement) téléchargé. "
                        "Ouvrez Réglages → Modèles pour le télécharger.")
        return None

    async def _consume(self, job: JobRequest, plan: dict) -> None:
        count = len(plan["items"])
        prog = job.progress
        prog.update(phase="running", count=count)
        self._publish_progress(job)
        item_started = time.time()
        while True:
            evt = await self.worker.events.get()
            kind = evt["type"]
            if kind == "item_start":
                item_started = evt["t"]
                prog.update(index=evt["index"], step=0, preview_url=None, stage=None)
                self._publish_progress(job)
            elif kind == "phase":
                prog.update(stage=evt["phase"], index=evt["index"])
                if evt["phase"] == "sampling":
                    item_started = evt["t"]  # loading and encoding the prompt are not part of the step time
                else:
                    prog.update(step=0, eta=None, seconds_per_step=None)
                self._publish_progress(job)
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
                self._publish_progress(job)
            elif kind == "preview":
                name = Path(evt["path"]).name
                base = private_media_url(job.private_dir, "previews", name) if job.private_dir else media_url("previews", name)
                prog["preview_url"] = base + f"?t={time.time():.0f}"
                self._emit(job, "job.preview", {"index": evt["index"], "path": evt["path"], "filename": name,
                                                "url": prog["preview_url"]})
            elif kind in ("image", "audio", "video"):
                output = await asyncio.to_thread(describe_output, plan, evt)
                job.outputs.append(output)
                self._emit(job, "job.output", output)
            elif kind == "done":
                self._finish(job, "done")
                return
            elif kind == "cancelled":
                self._finish(job, "cancelled")
                return
            elif kind == "error":
                self._report_failure(job, evt)
                self._finish(job, "failed", self._model_error(job, evt["error"]))
                return
            elif kind == "exit":
                pid = _pid(self.worker)
                self.worker = None
                self.state = "idle"
                tripped = self.guard.tripped(pid)
                if tripped:
                    self._finish(job, "failed", tripped)
                    return
                hint = {"audio": "Mémoire insuffisante ? Essayez un modèle plus léger.",
                        "video": "Mémoire insuffisante ? Essayez une variante plus légère ou une durée/définition plus faible.",
                        }.get(plan.get("kind"), "Mémoire insuffisante ? Essayez une quantification plus forte ou une taille plus petite.")
                self._finish(job, "failed", f"Le processus du modèle s'est arrêté (code {evt['code']}). {hint}")
                return

    async def _ensure_worker(self, job: JobRequest, model_id: str, quantize: int | None, plan: dict) -> bool:
        w = self.worker
        if w and w.alive and w.model_id == model_id and w.quantize == quantize:
            return True
        if w:
            self.worker = None
            await w.stop()

        from .llm import any_generating

        if any_generating():  # a chat or OCR reply is being written: its model stays, this job fails with the reason
            refused = "Une réponse de chat est en cours : relancez la génération quand elle est terminée."
            self._finish(job, "failed", refused)
            return False

        spec = get_spec(model_id)
        # Other models stay loaded while they fit under the global ceiling; the oldest idle ones leave otherwise.
        refused = await memory_budget.make_room(spec.weights_gb, MEDIA_SLOT, spec.name) or self._memory_preflight(spec)
        if refused:
            self.last_error = refused
            self._finish(job, "failed", refused)
            return False

        self.state = "loading"
        self.load_started_at = time.time()
        self.last_error = None
        job.progress.update(phase="loading", load_started_at=self.load_started_at)
        self._publish_progress(job)
        self._publish_status()

        if spec.backend == "pack":
            # Audio and video packs share the worker handle; the pack's family picks the worker script.
            token = runtime_settings.get_settings().get("hf_token")
            options = {**spec.options, "language": plan["params"].get("language"),
                       "sources": [{"repo": src.repo, "patterns": src.patterns} for src in spec.all_sources()]}
            self.worker = AudioWorkerHandle(
                model_id, spec.options["pack"], spec.engine, options,
                asyncio.get_running_loop(), env={"HF_TOKEN": token} if token else None,
            )
        else:
            options = {"low_memory": load_settings()["low_memory"]}
            self.worker = WorkerHandle(model_id, quantize, options, asyncio.get_running_loop())
        while True:
            worker = self.worker
            if worker is None:  # cancelled during load
                self._finish(job, "cancelled")
                return False
            evt = await worker.events.get()
            if self.worker is not worker:
                self._finish(job, "cancelled")
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
                tripped = self.guard.tripped(_pid(worker))
                if tripped:
                    self.last_error = tripped
                    self._finish(job, "failed", tripped)
                    return False
                error = self._model_error(job, evt.get("error")) or f"Le processus de chargement s'est arrêté (code {evt.get('code')})."
                self._report_failure(job, evt)
                self.last_error = error
                self._finish(job, "failed", f"Échec du chargement du modèle : {error}")
                return False

    def _memory_preflight(self, spec) -> str | None:
        """Refusal message when the memory free right now can't take the model's weights (shared memory only: on a
        separate graphics card the weights go to its own memory)."""
        if not spec.weights_gb:
            return None
        from .system import get_system

        system = get_system()
        accel = system["accelerators"][0] if system["accelerators"] else None
        if accel and not accel.get("unified"):
            return None
        return memory_guard.preflight(spec.weights_gb, memory_guard.available_gb(), system["ram_gb"], spec.name)

    def _schedule_idle_unload(self) -> None:
        minutes = load_settings()["keep_alive_minutes"]
        if minutes is None or minutes < 0 or not self.worker:
            return

        async def later() -> None:
            await asyncio.sleep(max(0, minutes) * 60)
            if self.current is None and self.queue.empty():
                await self.unload()

        self._idle_task = asyncio.create_task(later())

    def _progress_base(self, job: JobRequest) -> dict:
        return {"job_id": job.job_id}

    def _emit(self, job: JobRequest, name: str, data: dict[str, Any] | None = None) -> None:
        """Hands an event to the job's sink; a failing sink never stops the queue."""
        try:
            (job.sink or _bus_sink)(job, name, {"job_id": job.job_id, **(data or {})})
        except Exception as exc:  # noqa: BLE001
            print(f"job sink failed on {name} ({job.job_id}): {exc!r}", flush=True)

    @staticmethod
    def _model_error(job: JobRequest, error: str | None) -> str | None:
        """An error text a model wrote: it may quote the prompt or the files, so a private job only keeps what is safe."""
        return sanitize_error(error, job.prompt) if job.private_dir else error

    @staticmethod
    def _report_failure(job: JobRequest, evt: dict[str, Any]) -> None:
        """Journal line of a failed job: the trace for a normal one; a private one never writes content (a trace quotes it)."""
        print(f"[private] job {job.job_id} : échec (détails non journalisés)" if job.private_dir else evt.get("trace", ""),
              flush=True)

    def _finish(self, job: JobRequest, state: str, error: str | None = None) -> None:
        """Ends a job (`done`, `failed` or `cancelled`): keeps its outcome, cleans the previews, tells the sink.

        A private job leaves no outcome behind: it is not in the history of finished jobs."""
        self.progress.pop(job.job_id, None)
        job.state, job.error = state, error
        self.jobs.pop(job.job_id, None)
        if not job.private_dir:
            self.history[job.job_id] = {"job_id": job.job_id, "state": state, "error": error,
                                        "outputs": list(job.outputs), "queue_position": None, "progress": None}
            while len(self.history) > HISTORY_SIZE:
                self.history.popitem(last=False)
        delete_previews(job.job_id, session_dir(job.private_dir) / "previews" if job.private_dir else None)  # never re-created
        name = {"done": "job.done", "failed": "job.failed", "cancelled": "job.cancelled"}[state]
        self._emit(job, name, {"error": error} if state == "failed" else {"outputs": len(job.outputs)})

    def _publish_progress(self, job: JobRequest) -> None:
        self._emit(job, "job.progress", dict(job.progress))

    def _publish_status(self) -> None:
        bus.publish("engine.status", self.status())


jobs = JobManager()
memory_budget.register(memory_budget.Slot(MEDIA_SLOT, lambda: jobs.resident(), lambda: jobs.busy(), lambda: jobs.unload()))
