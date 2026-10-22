# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Audio worker: loads a TTS engine once and runs generations back to back.

Started by the server with the interpreter of the relevant pack:
    <pack>/python worker.py <module:Class> '<options JSON>'

JSON protocol, one message per line.
  stdin (server -> worker): {"type": "generate", ...} | {"type": "cancel"} | {"type": "shutdown"}
  private fd (worker -> server): same event types as the image worker
      loading / ready / load_error / item_start / step / audio / done / cancelled / error

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
    """A worker holding GBs of memory must not outlive the server."""
    ppid = os.getppid()

    def watch() -> None:
        while True:
            time.sleep(2)
            if os.getppid() != ppid:
                os._exit(0)

    threading.Thread(target=watch, daemon=True, name="parent-watch").start()


class Cancelled(Exception):
    pass


def describe(exc: BaseException) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    low = text.lower()
    if "out of memory" in low or "insufficient memory" in low:
        return f"Mémoire insuffisante : {text}"
    return text


def main() -> None:
    from common import peaks, silence, split_text, trim_silence, write_wav
    import numpy as np

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
                emit("item_start", job_id=job_id, index=index, seed=item.get("seed"), t=time.time())
                t0 = time.time()
                segments = item["segments"]  # [{"text", "voice", "label"?}]
                ctx = {k: item.get(k) for k in ("language", "instruct", "speed", "seed", "params")}
                ctx["params"] = ctx.get("params") or {}

                plan: list[tuple[int, str, str]] = []  # (segment, text, separator)
                for si, seg in enumerate(segments):
                    for text, sep in split_text(seg["text"], engine.max_chars):
                        plan.append((si, text, sep))
                total = len(plan)
                pieces: list[np.ndarray] = []
                markers: list[dict] = []  # start time (s) of each segment, for the timeline
                cursor = 0
                for n, (si, text, sep) in enumerate(plan):
                    if cancel.is_set():
                        raise Cancelled()
                    audio = engine.synth(text, segments[si]["voice"], ctx)
                    if cancel.is_set():
                        raise Cancelled()
                    audio = trim_silence(audio, engine.sample_rate)
                    if not markers or markers[-1]["segment"] != si:
                        markers.append({"segment": si, "start": round(cursor / engine.sample_rate, 2),
                                        "label": segments[si].get("label")})
                    pieces.append(audio)
                    cursor += audio.size
                    last = n == total - 1
                    if not last:
                        next_seg = plan[n + 1][0]
                        gap = 0.55 if next_seg != si else (0.5 if sep == "paragraph" else 0.18)
                        g = silence(gap, engine.sample_rate)
                        pieces.append(g)
                        cursor += g.size
                    emit("step", job_id=job_id, index=index, step=n + 1, total=total, t=time.time())
                full = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
                peak = float(np.abs(full).max() or 1.0)
                if peak > 0.99:  # avoid clipping on export
                    full = full * (0.97 / peak)
                write_wav(item["output"], full, engine.sample_rate)
                emit(
                    "audio",
                    job_id=job_id,
                    index=index,
                    path=item["output"],
                    seed=item.get("seed"),
                    seconds=round(time.time() - t0, 1),
                    duration=round(full.size / engine.sample_rate, 2),
                    sample_rate=engine.sample_rate,
                    peaks=peaks(full),
                    markers=markers,
                )
            emit("done", job_id=job_id)
        except Cancelled:
            emit("cancelled", job_id=job_id)
        except BaseException as exc:  # noqa: BLE001
            emit("error", job_id=job_id, error=describe(exc), trace=traceback.format_exc())
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                break


if __name__ == "__main__":
    main()
