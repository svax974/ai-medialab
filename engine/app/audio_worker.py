# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Server side of a pack worker (audio or video): a subprocess (the pack's interpreter) bridged to the asyncio loop.

Exposes the same interface as `jobs.WorkerHandle` (image process) so `JobManager` has a single code path:
`model_id`, `quantize`, `alive`, `events`, `send`, `cancel_event`, `stop`.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import threading
from collections import deque
from typing import Any

from . import audio_packs


class _Cancel:
    """Stand-in for `multiprocessing.Event`: `set()` asks the worker to stop the current generation."""

    def __init__(self, handle: "AudioWorkerHandle") -> None:
        self._handle = handle

    def set(self) -> None:
        self._handle.send({"type": "cancel"})

    def clear(self) -> None:  # the worker resets its own flag on each generation
        pass


class AudioWorkerHandle:
    def __init__(self, model_id: str, pack: str, engine: str, options: dict, loop: asyncio.AbstractEventLoop,
                 env: dict[str, str] | None = None):
        self.model_id = model_id
        self.quantize = None
        self.loop = loop
        self.events: asyncio.Queue[dict] = asyncio.Queue()
        self.cancel_event = _Cancel(self)
        self.stderr_tail: deque[str] = deque(maxlen=40)
        self._write_lock = threading.Lock()
        self.process = subprocess.Popen(
            [str(audio_packs.venv_python(pack)), str(audio_packs.runtime_dir(pack) / "worker.py"), engine, json.dumps(options)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
            encoding="utf-8", env=_worker_env({**(env or {}), **audio_packs.pack_env(pack)}),
            cwd=str(audio_packs.runtime_dir(pack)),
        )
        threading.Thread(target=self._read, daemon=True, name=f"audio-{model_id}").start()
        threading.Thread(target=self._read_stderr, daemon=True, name=f"audio-{model_id}-err").start()

    def _push(self, evt: dict) -> None:
        self.loop.call_soon_threadsafe(self.events.put_nowait, evt)

    def _read(self) -> None:
        for line in self.process.stdout or []:
            try:
                self._push(json.loads(line))
            except ValueError:
                continue
        code = self.process.wait()
        self._push({"type": "exit", "code": code, "stderr": "\n".join(self.stderr_tail)})

    def _read_stderr(self) -> None:
        for line in self.process.stderr or []:
            line = line.rstrip()
            if line:
                self.stderr_tail.append(line)
                print(f"[audio:{self.model_id}] {line}", file=sys.stderr, flush=True)

    @property
    def alive(self) -> bool:
        return self.process.poll() is None

    def send(self, cmd: dict[str, Any]) -> None:
        with self._write_lock:
            try:
                assert self.process.stdin
                self.process.stdin.write(json.dumps(cmd, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
            except (BrokenPipeError, OSError, ValueError):
                pass

    async def stop(self) -> None:
        if self.alive:
            self.send({"type": "shutdown"})
            try:
                await asyncio.to_thread(self.process.wait, 5)
            except subprocess.TimeoutExpired:
                pass
        if self.alive:
            self.process.terminate()
            try:
                await asyncio.to_thread(self.process.wait, 5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                # Wait for the end: the next model must not start loading while this one still holds its memory.
                await asyncio.to_thread(self.process.wait, 5)


def _worker_env(extra: dict[str, str] | None) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "VIRTUAL_ENV"))}
    env.update(PYTHONUNBUFFERED="1", PYTHONNOUSERSITE="1", PYTHONUTF8="1", PYTORCH_ENABLE_MPS_FALLBACK="1",
               HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
    env.update(extra or {})
    return env


def run_transcribe(pack: str, audio: str, model_dir: str, language: str | None, timeout: int = 300) -> dict[str, Any]:
    """Transcribe a file in a one-shot process inside the pack environment."""
    proc = subprocess.run(
        [str(audio_packs.venv_python(pack)), str(audio_packs.runtime_dir() / "transcribe.py"), audio, model_dir,
         language or ""],
        capture_output=True, text=True, encoding="utf-8", env=_worker_env(None), timeout=timeout,
        cwd=str(audio_packs.runtime_dir()),
    )
    lines = [l for l in proc.stdout.splitlines() if l.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"Transcription impossible : {(proc.stderr or '').strip()[-300:] or 'aucune sortie'}")
    result = json.loads(lines[-1])
    if "error" in result:
        raise RuntimeError(f"Transcription impossible : {result['error']}")
    return result
