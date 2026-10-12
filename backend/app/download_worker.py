# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Download subprocess: `python -m app.download_worker <repo> <patterns_json>`.

Writes one JSON line per event on stdout. Killing the process is enough to cancel: partial files
(.incomplete) stay in the cache and the download resumes where it stopped.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time


def emit(**event) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def main() -> int:
    repo = sys.argv[1]
    patterns = json.loads(sys.argv[2]) or None

    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm

    bars: dict[str, "tqdm"] = {}
    devnull = open(os.devnull, "w")

    class ByteBars(tqdm):
        """Captures the aggregate byte bars snapshot_download creates (network and disk write)."""

        def __init__(self, *args, **kwargs):
            kwargs.pop("name", None)
            # A disabled bar stops updating `n`, so keep it enabled but silent.
            kwargs["disable"] = False
            kwargs["file"] = devnull
            super().__init__(*args, **kwargs)
            if kwargs.get("unit") == "B":
                # snapshot_download creates the network bar first, then the disk-write bar.
                bars["transfer" if "transfer" not in bars else "disk"] = self

    stop = threading.Event()

    def report() -> None:
        last_t, last_n, rate = time.time(), 0, 0.0
        while not stop.wait(0.5):
            disk, transfer = bars.get("disk"), bars.get("transfer")
            if not disk or not (disk.total or 0):
                continue
            n = max(disk.n, transfer.n if transfer else 0)
            now = time.time()
            if now > last_t:
                inst = (n - last_n) / (now - last_t)
                rate = inst if rate == 0 else 0.7 * rate + 0.3 * inst
                last_t, last_n = now, n
            emit(type="progress", done=int(min(n, disk.total)), total=int(disk.total), rate=int(rate))

    threading.Thread(target=report, daemon=True).start()

    parent = os.getppid()

    def watch_parent() -> None:
        while True:
            time.sleep(2)
            if os.getppid() != parent:  # server is gone, stop downloading
                os._exit(0)

    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        emit(type="start")
        path = snapshot_download(repo_id=repo, allow_patterns=patterns, tqdm_class=ByteBars)
    except KeyboardInterrupt:
        return 130
    except BaseException as exc:  # noqa: BLE001
        emit(type="error", error=_describe(exc))
        return 1
    finally:
        stop.set()
    emit(type="done", path=str(path))
    return 0


def _describe(exc: BaseException) -> str:
    name = exc.__class__.__name__
    text = str(exc).strip()
    low = (name + " " + text).lower()
    if any(k in low for k in ("connecterror", "connectionerror", "name resolution", "offline", "timeout", "temporary failure")):
        return "Impossible de joindre Hugging Face : vérifiez la connexion Internet."
    if "gated" in low or "401" in low or "403" in low:
        return ("Accès refusé : ce modèle est à accès restreint. Acceptez sa licence sur la page Hugging Face du dépôt "
                "(avec le compte du jeton), puis renseignez le jeton dans Réglages → Modèles.")
    if "no space left" in low or "errno 28" in low:
        return "Espace disque insuffisant."
    return f"{name}: {text}"[:500]


if __name__ == "__main__":
    raise SystemExit(main())
