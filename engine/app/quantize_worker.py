# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Quantize-and-save subprocess: `python -m app.quantize_worker <model_id>`.

Builds the model from its official bf16 source (already cached locally — the download step for that
source runs before this one, see `downloads.py::DownloadManager._run`), quantizes it once and saves the
result under `DERIVED_DIR`, for the variant currently selected for `model_id`. Writes one JSON line per
event on stdout, same protocol as `download_worker.py`. The output is written to a temporary directory
and renamed into place only on success, so a killed process never leaves a half-written checkpoint that
`installation_status()` could mistake for installed.
"""

from __future__ import annotations

import importlib
import json
import os
import shutil
import sys
import threading
import time


def emit(**event) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def main() -> int:
    model_id = sys.argv[1]

    from . import audio_packs

    audio_packs.activate_overlays()  # MLX/mflux: installed on demand, visible to this process only

    from .config import DERIVED_DIR
    from .engines import get_spec

    spec = get_spec(model_id)
    bits = spec.options.get("produce_quantize")
    local_dir = spec.options.get("local_dir")
    entry = spec.options.get("quantize_entry")
    if not (bits and local_dir and entry):
        emit(type="error", error=f"« {model_id} » (variante {spec.variant!r}) n'a rien à quantifier localement.")
        return 1

    module_name, func_name = entry.split(":")
    produce = getattr(importlib.import_module(module_name), func_name)

    dest = DERIVED_DIR / local_dir
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)

    stop = threading.Event()

    def heartbeat() -> None:
        # mflux exposes no byte-level progress for quantize+save (unlike snapshot_download's tqdm bars),
        # so this only keeps the UI from looking stalled during the (several-minutes) one-time pass;
        # `_run()` ignores event types other than "progress"/"error", so this is informational only.
        while not stop.wait(2.0):
            emit(type="working")

    threading.Thread(target=heartbeat, daemon=True).start()

    parent = os.getppid()

    def watch_parent() -> None:
        while True:
            time.sleep(2)
            if os.getppid() != parent:  # server is gone, stop working
                os._exit(0)

    threading.Thread(target=watch_parent, daemon=True).start()

    try:
        emit(type="start")
        produce(bits=bits, dest=tmp)
    except KeyboardInterrupt:
        shutil.rmtree(tmp, ignore_errors=True)
        return 130
    except BaseException as exc:  # noqa: BLE001
        shutil.rmtree(tmp, ignore_errors=True)
        emit(type="error", error=_describe(exc))
        return 1
    finally:
        stop.set()

    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)
    emit(type="done", path=str(dest))
    return 0


def _describe(exc: BaseException) -> str:
    name = exc.__class__.__name__
    text = str(exc).strip()
    low = (name + " " + text).lower()
    if "no space left" in low or "errno 28" in low:
        return "Espace disque insuffisant."
    if "memoryerror" in low or "out of memory" in low or "metal" in low and "memory" in low:
        return "Mémoire insuffisante pour quantifier ce modèle sur cette machine."
    return f"{name}: {text}"[:500]


if __name__ == "__main__":
    raise SystemExit(main())
