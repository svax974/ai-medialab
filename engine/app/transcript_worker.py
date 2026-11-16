# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Disposable media worker. Everything on disk belongs to the calling Nest job; no application state."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from . import audio_packs, transcription
from .audio_worker import _worker_env
from .engines import MODELS
from .engines.base import repo_cache_dir
from .transcript_media import download_audio, model_snapshot, prepare_chunks

_out = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)


def emit(event: dict) -> None:
    _out.write(json.dumps(event, ensure_ascii=False) + "\n")
    _out.flush()


def recognize(spec, folder: Path, language: str | None) -> None:
    """Whisper holds its model across chunks; native audio.cpp uses its existing ASR CLI."""
    pack = audio_packs.PACKS[spec.options["pack"]]
    if pack.native:
        done = 0.0
        for index, chunk in enumerate(sorted(folder.glob("chunk-*.wav"))):
            result = transcription.transcribe(spec, str(chunk), language)
            done += result.get("duration") or 0
            emit({"type": "segment", "index": index, "text": result["text"], "language": result.get("language"), "done": done})
        return
    snapshot = model_snapshot(repo_cache_dir(spec.options["repo"]))
    command = [str(audio_packs.venv_python(pack.id)), str(audio_packs.runtime_dir() / "transcribe_batch.py"),
               str(folder), str(snapshot), language or ""]
    with subprocess.Popen(command, stdout=subprocess.PIPE, text=True, encoding="utf-8", env=_worker_env(None)) as process:
        for line in process.stdout:
            event = json.loads(line)
            if event.get("type") == "error":
                raise RuntimeError(event["message"])
            emit(event)
        if process.wait() != 0:
            raise RuntimeError("Le modèle de transcription s'est arrêté.")


def run(request: dict) -> None:
    folder = Path(request["folder"])
    with tempfile.TemporaryDirectory(prefix="transcribe-", dir=folder) as temporary:
        chunks = Path(temporary)
        # Native ASR also creates WAV copies; a killed worker must leave them in Nest's cleanup scope.
        tempfile.tempdir = temporary
        for key in ("TMPDIR", "TMP", "TEMP"):
            os.environ[key] = temporary
        if request.get("url"):
            source, title = download_audio(request["url"], chunks, emit)
        else:
            source, title = Path(request["path"]), ""
        emit({"type": "progress", "stage": "preparing", "done": 0, "total": 0})
        count, duration = prepare_chunks(source, chunks, emit)
        if request.get("url"):
            source.unlink(missing_ok=True)
        emit({"type": "prepared", "duration": duration, "chunks": count, "title": title})
        recognize(MODELS[request["model_id"]], chunks, request.get("language"))
        emit({"type": "done"})


if __name__ == "__main__":
    try:
        run(json.loads(sys.stdin.read()))
    except Exception as exc:
        emit({"type": "error", "message": str(exc)[:1000]})
        sys.exit(1)
