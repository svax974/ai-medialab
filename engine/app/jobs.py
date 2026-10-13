# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Generation queue and worker process lifecycle (server side).

One generation at a time (the GPU is shared) and one model loaded at a time (unified memory
can't hold two). The model stays loaded between generations and is unloaded after a
configurable idle delay.
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

from . import audio_packs, db, repo, runtime_settings
from .audio_worker import AudioWorkerHandle
from .config import OUTPUTS_DIR, PREVIEWS_DIR
from .engines import get_spec
from .engines.base import GenerationRequest
from .events import bus
from .media import asset_path, image_size, make_thumb, media_url, probe_video, resolve_size, video_frame_count, video_size, video_thumb
from .worker import run_worker

DEFAULT_SETTINGS: dict[str, Any] = {
    "keep_alive_minutes": 10,  # -1 = never unload, 0 = unload after each generation
    "previews": True,
    "low_memory": True,  # free the text encoder after encoding the prompt
    "quantize": {},  # model_id -> bits (None = full precision)
    "variant": {},  # model_id -> chosen quantization (a `Variant` key)
}


def load_settings() -> dict[str, Any]:
    return {**DEFAULT_SETTINGS, **runtime_settings.get_settings()}


def new_seed() -> int:
    return random.randint(0, 2**31 - 1)


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


class JobManager:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.pending: list[str] = []  # wait order, for display
        self.worker: WorkerHandle | None = None
        self.state = "idle"  # idle | loading | ready | busy
        self.current: str | None = None
        self.load_started_at: float | None = None
        self.last_error: str | None = None
        self.progress: dict[str, dict] = {}  # message_id -> latest progress state
        self._idle_task: asyncio.Task | None = None
        self._runner: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._runner = asyncio.create_task(self._run())

    async def shutdown(self) -> None:
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
                # Cancelling during load: just kill the worker.
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

    async def _run(self) -> None:
        while True:
            message_id = await self.queue.get()
            if message_id not in self.pending:
                continue  # cancelled while waiting
            self.pending.remove(message_id)
            if self._idle_task:
                self._idle_task.cancel()
                self._idle_task = None
            self.current = message_id
            try:
                await self._process(message_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # safety net: this loop must never die
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
        if spec.backend == "pack":
            pack = spec.options["pack"]
            if not audio_packs.is_installed(pack):
                self._finish(message_id, "error",
                             f"Le moteur « {audio_packs.PACKS[pack].name} » n'est pas installé. "
                             "Ouvrez Modèles pour l'installer.")
                return
        if spec.backend == "sdcpp":
            from .system import get_system

            engine = get_system()["engines"]["sdcpp"]
            if not engine["available"]:
                self._finish(message_id, "error", (engine.get("reason") or "Moteur GGUF indisponible.")
                             + " Ouvrez Modèles pour l'installer.")
                return
        if spec.all_sources():
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
        if not await self._ensure_worker(message_id, plan["model_id"], quantize, plan):
            return

        self.state = "busy"
        self._update(message_id, status="running")
        self._publish_status()
        steps = plan["params"]["steps"]
        preview_every = max(2, round(steps / 5)) if settings["previews"] and spec.kind == "image" else 0
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
                prog.update(index=evt["index"], step=0, preview_url=None, stage=None)
                self._publish_progress(prog)
            elif kind == "phase":
                prog.update(stage=evt["phase"], index=evt["index"])
                if evt["phase"] == "sampling":
                    item_started = evt["t"]  # loading and encoding the prompt are not part of the step time
                else:
                    prog.update(step=0, eta=None, seconds_per_step=None)
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
            elif kind == "audio":
                asset = await asyncio.to_thread(self._register_audio, message_id, plan, evt)
                bus.publish("job.image", {"message_id": message_id, "conversation_id": plan["conversation_id"],
                                          "asset": asset})
            elif kind == "video":
                asset = await asyncio.to_thread(self._register_video, message_id, plan, evt)
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
                hint = {"audio": "Mémoire insuffisante ? Essayez un modèle plus léger.",
                        "video": "Mémoire insuffisante ? Essayez une variante plus légère ou une durée/définition plus faible.",
                        }.get(plan.get("kind"), "Mémoire insuffisante ? Essayez une quantification plus forte ou une taille plus petite.")
                self._finish(message_id, "error", f"Le processus du modèle s'est arrêté (code {evt['code']}). {hint}")
                return

    async def _ensure_worker(self, message_id: str, model_id: str, quantize: int | None, plan: dict) -> bool:
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

        spec = get_spec(model_id)
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

    def _build_plan(self, msg: dict) -> dict:
        try:
            spec = get_spec(msg["model_id"])
        except KeyError as exc:
            raise ValueError(str(exc)) from None
        if spec.kind == "audio":
            return self._build_audio_plan(msg, spec)
        if spec.kind == "video":
            return self._build_video_plan(msg, spec)
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

    def _build_audio_plan(self, msg: dict, spec) -> dict:
        from .dialogue import parse_dialogue
        from .voices import resolve_voice

        params = dict(msg["params"])
        caps = spec.audio
        text = msg["prompt"].strip()
        if not text:
            raise ValueError("Le texte est vide.")
        if caps.task != "tts":
            raise ValueError(f"{spec.name} ne synthétise pas de voix.")
        codes = [l.code for l in caps.languages]
        language = params.get("language") or (codes[0] if codes else "en")
        if codes and language not in codes:
            language = codes[0]
        instruct = (params.get("instruct") or "").strip()
        default_voice = resolve_voice(spec, params.get("voice"), language, instruct)

        cast = params.get("cast") or {}
        if cast:
            segments = parse_dialogue(text, {n: resolve_voice(spec, v, language, instruct) for n, v in cast.items()},
                                      default_voice)
        else:
            segments = [{"text": text, "voice": default_voice}]
        if not any(s["text"].strip() for s in segments):
            raise ValueError("Le texte est vide.")

        defaults = spec.default_params()
        speed = float(params.get("speed", defaults.get("speed", 1.0)) or 1.0)
        extra = {k: params[k] for k in defaults if k not in ("speed",) and k in params}
        seeds = params.get("seeds") or [new_seed()]
        params.update(language=language, seeds=seeds, steps=1, speed=speed)
        items = []
        for i, seed in enumerate(seeds):
            items.append({
                "segments": segments, "language": language, "instruct": instruct or None, "speed": speed,
                "seed": int(seed), "params": extra, "output": str(OUTPUTS_DIR / f"{msg['id']}_{i}.wav"),
            })
        voice_label = segments[0]["voice"].get("label") or segments[0]["voice"].get("id") or ""
        return {
            "kind": "audio", "model_id": spec.id, "conversation_id": msg["conversation_id"], "params": params,
            "items": items, "prompt": msg["prompt"], "voice_label": voice_label,
            "speakers": [s.get("label") for s in segments if s.get("label")],
        }

    def _build_video_plan(self, msg: dict, spec) -> dict:
        params = dict(msg["params"])
        caps = spec.video
        if not msg["prompt"].strip():
            raise ValueError("Le prompt est vide.")
        with db.connect() as conn:
            refs = conn.execute(
                "SELECT a.kind, a.filename, a.media FROM message_refs r JOIN assets a ON a.id = r.asset_id "
                "WHERE r.message_id = ? ORDER BY r.position",
                (msg["parent_id"],),
            ).fetchall()
        existing = [(r["media"], asset_path(r["kind"], r["filename"])) for r in refs]
        images = [p for m, p in existing if m == "image" and p.is_file()]
        videos = [p for m, p in existing if m == "video" and p.is_file()]

        # Decide the task from what is attached: a source video edits, a start image animates, else text only.
        if videos and caps.video_input != "none":
            # A reference image rides along with the edit when the model takes one (Kiwi-Edit, Bernini).
            task, images = "v2v", (images[:1] if caps.image_input != "none" else [])
        elif images and caps.image_input != "none":
            task = "i2v"
            images = images[: 2 if caps.last_frame else 1]
        else:
            task, images = "t2v", []
        if task != "v2v":
            videos = []
        if caps.image_input == "required" and task != "i2v":
            raise ValueError(f"{spec.name} a besoin d'une image de départ.")
        if caps.video_input == "required" and task != "v2v":
            raise ValueError(f"{spec.name} a besoin d'une vidéo source.")

        res = next((r for r in caps.resolutions if r.id == params.get("resolution")),
                   next((r for r in caps.resolutions if r.id == caps.default_resolution), caps.resolutions[0]))
        aspect = str(params.get("aspect") or "16:9")
        ratio = None
        if aspect not in ("16:9", "9:16", "1:1", "4:3", "3:4"):
            # "auto" (or anything unknown): follow the start image / source video.
            ref = images[0] if images else None
            if ref is not None:
                w0, h0 = image_size(ref)
                ratio = w0 / h0
            elif videos:
                info = probe_video(videos[0])
                ratio = info["width"] / info["height"]
            aspect = "16:9"
        width, height = video_size(aspect, res.short_side, res.long_side, spec.size_multiple, ratio)

        defaults = spec.default_params()
        seconds = float(params.get("seconds") or caps.default_seconds)
        frames = video_frame_count(seconds, caps.fps, caps.frame_step, caps.min_seconds, caps.max_seconds)
        steps = int(params.get("steps") or defaults.get("steps") or 30)
        guidance = params.get("guidance", defaults.get("guidance"))
        strength = params.get("strength", defaults.get("strength")) if task == "v2v" else None
        negative = params.get("negative_prompt") or None
        seeds = (params.get("seeds") or [new_seed()])[:2]

        params.update(width=width, height=height, steps=steps, seeds=seeds, frames=frames, fps=caps.fps,
                      seconds=round(frames / caps.fps, 2), resolution=res.id, aspect=aspect, task=task)
        if guidance is not None:
            params["guidance"] = float(guidance)
        if strength is not None:
            params["strength"] = float(strength)
        else:
            params.pop("strength", None)
        params["references_used"] = len(images) + len(videos)

        items = []
        for i, seed in enumerate(seeds):
            req = GenerationRequest(
                prompt=msg["prompt"], width=width, height=height, steps=steps, seed=int(seed),
                guidance=float(guidance) if guidance is not None else None, negative_prompt=negative,
                references=[str(p) for p in images], strength=float(strength) if strength is not None else None,
                extra={"task": task, "frames": frames, "fps": caps.fps, "video": str(videos[0]) if videos else None,
                       **{p.key: bool(params.get(p.key, p.default)) for p in spec.params if p.type == "bool"}},
            )
            items.append({"request": asdict(req), "output": str(OUTPUTS_DIR / f"{msg['id']}_{i}.mp4")})
        return {"kind": "video", "model_id": spec.id, "conversation_id": msg["conversation_id"], "params": params,
                "items": items, "prompt": msg["prompt"]}

    def _register_video(self, message_id: str, plan: dict, evt: dict) -> dict:
        path = Path(evt["path"])
        asset_id = db.new_id()
        thumb = video_thumb(path, asset_id)
        meta = {
            "model_id": plan["model_id"], "prompt": plan["prompt"], "steps": plan["params"]["steps"],
            "guidance": plan["params"].get("guidance"), "seconds": evt.get("seconds"), "fps": evt.get("fps"),
            "frames": evt.get("frames"), "has_audio": evt.get("has_audio"), "video_seconds": evt.get("duration"),
            "task": plan["params"].get("task"), "strength": plan["params"].get("strength"),
        }
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO assets (id, kind, media, conversation_id, message_id, filename, thumb, width, height, "
                "seed, duration, position, meta, created_at) VALUES (?, 'generated', 'video', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (asset_id, plan["conversation_id"], message_id, path.name, thumb, evt.get("width"), evt.get("height"),
                 evt["seed"], evt.get("duration"), evt["index"], json.dumps(meta), db.now()),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        return repo.asset_public(row)

    def _register_audio(self, message_id: str, plan: dict, evt: dict) -> dict:
        path = Path(evt["path"])
        asset_id = db.new_id()
        meta = {
            "model_id": plan["model_id"], "prompt": plan["prompt"], "seconds": evt.get("seconds"),
            "language": plan["params"].get("language"), "instruct": plan["items"][0].get("instruct"),
            "voice": plan.get("voice_label"), "speakers": plan.get("speakers"),
            "sample_rate": evt.get("sample_rate"), "peaks": evt.get("peaks"), "markers": evt.get("markers"),
        }
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO assets (id, kind, media, conversation_id, message_id, filename, seed, duration, "
                "position, meta, created_at) VALUES (?, 'generated', 'audio', ?, ?, ?, ?, ?, ?, ?, ?)",
                (asset_id, plan["conversation_id"], message_id, path.name, evt.get("seed"), evt.get("duration"),
                 evt["index"], json.dumps(meta), db.now()),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        return repo.asset_public(row)

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
