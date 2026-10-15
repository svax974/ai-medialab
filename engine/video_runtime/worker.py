# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video worker: loads a video model once and runs generations back to back.

Started by the server with the interpreter of the relevant pack:
    <pack>/python worker.py <module:Class> '<options JSON>'

JSON protocol, one message per line (same as the audio worker).
  stdin (server -> worker): {"type": "generate", "job_id", "items": [{"request", "output"}]} | {"type": "cancel"}
                            | {"type": "shutdown"}
  private fd (worker -> server): loading / ready / load_error / item_start / step / video / done / cancelled / error

stdout is redirected to stderr so chatty libraries can't corrupt the protocol stream.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import tempfile
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_proto = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
_proto_lock = threading.Lock()


def emit(kind: str, **data) -> None:
    with _proto_lock:
        _proto.write(json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n")
        _proto.flush()


def _exit_with_parent() -> None:
    """A worker holding GBs of GPU memory must not outlive the server."""
    ppid = os.getppid()

    def watch() -> None:
        while True:
            time.sleep(2)
            if os.getppid() != ppid:
                os._exit(0)

    threading.Thread(target=watch, daemon=True, name="parent-watch").start()


def describe(exc: BaseException) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    low = text.lower()
    if "out of memory" in low or "insufficient memory" in low:
        return f"Mémoire insuffisante : {text}. Essayez une durée ou une définition plus faible."
    return text


def main() -> None:
    from common import Cancelled

    _exit_with_parent()
    engine_spec = sys.argv[1]
    options = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

    commands: "queue.Queue[dict]" = queue.Queue()
    cancel = threading.Event()

    def read_stdin() -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("type") == "cancel":
                cancel.set()
            else:
                commands.put(msg)
        commands.put({"type": "shutdown"})  # the server closed the pipe

    threading.Thread(target=read_stdin, daemon=True, name="stdin").start()

    emit("loading", pid=os.getpid())
    started = time.time()
    try:
        import engines

        engine = engines.create(engine_spec, options)
        engine.cancelled = cancel.is_set
        engine.load()
    except BaseException as exc:  # noqa: BLE001
        emit("load_error", error=describe(exc), trace=traceback.format_exc())
        return
    emit("ready", load_seconds=round(time.time() - started, 1))

    while True:
        cmd = commands.get()
        if cmd.get("type") == "shutdown":
            break
        if cmd.get("type") != "generate":
            continue
        job_id = cmd["job_id"]
        cancel.clear()
        tempfile.tempdir = cmd.get("tmp_dir")  # private generation: temporary files stay in the session folder
        try:
            for index, item in enumerate(cmd["items"]):
                req = item["request"]
                if cancel.is_set():
                    raise Cancelled()
                engine.on_step = lambda step, total, index=index: emit(
                    "step", job_id=job_id, index=index, step=step, total=total, t=time.time())
                emit("item_start", job_id=job_id, index=index, seed=req.get("seed"), t=time.time())
                t0 = time.time()
                info = engine.generate(req, item["output"])
                emit("video", job_id=job_id, index=index, path=item["output"], seed=req.get("seed"),
                     seconds=round(time.time() - t0, 1), **info)
                if cancel.is_set():
                    raise Cancelled()
            emit("done", job_id=job_id)
        except Cancelled:
            emit("cancelled", job_id=job_id)
        except BaseException as exc:  # noqa: BLE001
            emit("error", job_id=job_id, error=describe(exc), trace=traceback.format_exc())
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                break


if __name__ == "__main__":
    main()
