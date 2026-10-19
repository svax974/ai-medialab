# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Worker process: loads a model once and runs generations back to back.

It runs in a separate process (multiprocessing "spawn") so that:
- the web server stays responsive during MLX compute;
- unloading a model really frees its memory (the process exits);
- a crash (out of memory, Metal error) doesn't take the server down.

Protocol: the parent sends dicts on `commands`, the worker answers with dicts on `events`.
"""

from __future__ import annotations

import os
import tempfile
import time
import traceback
from pathlib import Path


def _exit_with_parent() -> None:
    """The worker holds GBs of memory, so it must never outlive the server (even if that is killed hard)."""
    import multiprocessing
    import threading

    parent = multiprocessing.parent_process()
    if parent is None:
        return

    def watch() -> None:
        parent.join()  # returns as soon as the parent process is gone
        os._exit(0)

    threading.Thread(target=watch, daemon=True, name="parent-watch").start()


def run_worker(model_id: str, quantize: int | None, options: dict, commands, events, cancel_event) -> None:
    from . import audio_packs

    audio_packs.activate_overlays()  # PyTorch, diffusers, MLX: installed on demand, visible to this process only
    from PIL import Image

    _exit_with_parent()

    from .engines import create_engine, get_spec
    from .engines.base import GenerationCancelled, GenerationRequest, Hooks

    def emit(kind: str, **data) -> None:
        events.put({"type": kind, **data})

    emit("loading", model_id=model_id, pid=os.getpid())
    started = time.time()
    try:
        spec = get_spec(model_id)
        engine = create_engine(spec, quantize, options)
        engine.load()
    except BaseException as exc:  # noqa: BLE001
        emit("load_error", error=_describe(exc), trace=traceback.format_exc())
        return
    emit("ready", model_id=model_id, load_seconds=round(time.time() - started, 1))

    while True:
        cmd = commands.get()
        if cmd is None or cmd.get("type") == "shutdown":
            break
        if cmd.get("type") != "generate":
            continue

        job_id = cmd["job_id"]
        cancel_event.clear()
        tempfile.tempdir = cmd.get("tmp_dir")  # private generation: temporary files stay in the session folder
        items: list[dict] = cmd["items"]
        preview_every = int(cmd.get("preview_every") or 0)
        try:
            for index, item in enumerate(items):
                req = GenerationRequest(**item["request"])
                output = Path(item["output"])
                preview_base = Path(cmd["preview_dir"]) / f"{job_id}_{index}"
                counter = {"n": 0}

                def on_step(step: int, total: int, index=index) -> None:
                    emit("step", job_id=job_id, index=index, step=step, total=total, t=time.time())

                def on_preview(image: Image.Image, index=index, base=preview_base, counter=counter) -> None:
                    counter["n"] += 1
                    path = base.with_name(f"{base.name}_{counter['n']}.jpg")
                    image.convert("RGB").save(path, quality=80)
                    emit("preview", job_id=job_id, index=index, path=str(path))

                def on_phase(phase: str, index=index) -> None:
                    emit("phase", job_id=job_id, index=index, phase=phase, t=time.time())

                hooks = Hooks(on_step, on_preview, cancel_event.is_set, preview_every, on_phase)
                emit("item_start", job_id=job_id, index=index, seed=req.seed, t=time.time())
                t0 = time.time()
                result = engine.generate(req, hooks)
                if spec.kind == "video":
                    info = engine.save(result, output)
                    emit("video", job_id=job_id, index=index, path=str(output), seed=req.seed,
                         seconds=round(time.time() - t0, 1), **info)
                else:
                    engine.save(result, output)
                    emit(
                        "image",
                        job_id=job_id,
                        index=index,
                        path=str(output),
                        seed=req.seed,
                        seconds=round(time.time() - t0, 1),
                    )
                if cancel_event.is_set():
                    raise GenerationCancelled()
            emit("done", job_id=job_id)
        except GenerationCancelled:
            emit("cancelled", job_id=job_id)
        except BaseException as exc:  # noqa: BLE001
            emit("error", job_id=job_id, error=_describe(exc), trace=traceback.format_exc())
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                break


def _describe(exc: BaseException) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    lowered = text.lower()
    if "out of memory" in lowered or "insufficient memory" in lowered:
        return f"Mémoire insuffisante : {text}. Essayez une quantification plus forte ou une taille plus petite."
    if "gpu timeout" in lowered or "commandbuffercallbackerrortimeout" in lowered:
        return (
            "Le GPU a expiré, généralement parce que la mémoire est saturée (swap). Fermez des applications "
            "gourmandes, activez l'économie de mémoire ou réduisez la taille, puis réessayez."
        )
    return text
