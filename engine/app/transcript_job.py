# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Cancellable transcription subprocess, under the same memory budget and watchdog as media jobs."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import AsyncIterator
import anyio

from . import memory_budget, memory_guard
from .config import ROOT_DIR

_lock = asyncio.Lock()
_process: asyncio.subprocess.Process | None = None


def busy() -> bool:
    """Whether the transcription owns its worker, including preparation and shutdown."""
    return _lock.locked()


async def stop() -> None:
    """Stop the active transcription and every model/downloader child process."""
    await _kill(_process)
    # Reaping the process alone does not acknowledge the streaming scope's cleanup.
    async with _lock:
        pass


async def _kill(process: asyncio.subprocess.Process | None) -> None:
    if process and process.returncode is None:
        await asyncio.to_thread(memory_guard.kill_tree, process.pid)
        await process.wait()


def worker_env() -> dict[str, str]:
    """Only runtime/cache locations; never pass engine/Hugging Face tokens to remote JS."""
    allowed = {"PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "SystemRoot", "WINDIR",
               "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "HF_HOME", "HF_HUB_CACHE",
               "HUGGINGFACE_HUB_CACHE", "XDG_CACHE_HOME", "XDG_DATA_HOME", "IMAGEGEN_DATA_DIR", "APP_DATA_DIR",
               "IMAGEGEN_ROOT", "TRANSCRIPT_NODE"}
    return {**{key: value for key, value in os.environ.items() if key in allowed}, "PYTHONNOUSERSITE": "1",
            "PYTHONPATH": os.pathsep.join(str(path) for path in (ROOT_DIR / "engine-runtime/site-packages", ROOT_DIR / "engine")),
            "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1", "HF_HUB_OFFLINE": "1"}


async def read(spec, request: dict) -> AsyncIterator[dict]:
    """Stream results without loading any model in the API process."""
    global _process
    if _lock.locked():
        yield {"type": "error", "message": "Une transcription est déjà en cours."}
        return
    async with _lock:
        need = (spec.weights_gb or 1) + 1
        refusal = await memory_budget.make_room(need, "transcription", spec.name)
        refusal = refusal or memory_guard.preflight(need, memory_guard.available_gb(), memory_guard.total_gb(), spec.name)
        if refusal:
            yield {"type": "error", "code": "memory", "message": refusal}
            return
        _process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.transcript_worker", cwd=str(ROOT_DIR / "engine"), env=worker_env(), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=1024 * 1024)
        guard = _watch(spec, need)
        try:
            _process.stdin.write(json.dumps(request).encode())
            await _process.stdin.drain()
            _process.stdin.close()
            async for event in _events(_process, guard):
                yield event
        finally:
            # Starlette cancels the streaming scope when its client disconnects.
            with anyio.CancelScope(shield=True):
                guard.stop()
                await _kill(_process)
                memory_budget.unregister("transcription")
                _process = None


def _watch(spec, need: float):
    guard = memory_guard.MemoryWatchdog(lambda: _process.pid if _process and _process.returncode is None else None)
    resident = memory_budget.Resident(spec.id, spec.name, need)
    memory_budget.register(memory_budget.Slot("transcription", lambda: resident, lambda: True, stop))
    guard.begin_job()
    guard.start()
    return guard


async def _events(process: asyncio.subprocess.Process, guard) -> AsyncIterator[dict]:
    ended = False
    while True:
        try:
            line = await asyncio.wait_for(process.stdout.readline(), timeout=10)
        except asyncio.TimeoutError:
            yield {"type": "heartbeat"}
            continue
        if not line:
            break
        event = json.loads(line)
        yield event
        if event.get("type") in ("done", "error"):
            ended = True
            break
    if not ended:
        reason = guard.tripped(process.pid)
        yield {"type": "error", "code": "memory" if reason else "closed",
               "message": reason or "Le moteur de transcription s'est arrêté avant la fin."}
