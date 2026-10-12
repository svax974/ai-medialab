"""Worker audio : charge un moteur de synthèse vocale une fois et enchaîne les générations.

Lancé par le serveur avec l'interpréteur du pack concerné :
    <pack>/python worker.py <module:Classe> '<options JSON>'

Protocole JSON, une ligne par message.
  stdin  (serveur -> worker) : {"type": "generate", ...} | {"type": "cancel"} | {"type": "shutdown"}
  fd privé (worker -> serveur) : mêmes types d'événements que le worker image
      loading / ready / load_error / item_start / step / audio / done / cancelled / error

stdout est redirigé vers stderr : les bibliothèques bavardes ne peuvent pas corrompre le protocole.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
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
    """Un worker qui tient des Go de mémoire ne doit pas survivre au serveur."""
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
        commands.put({"type": "shutdown"})  # le serveur a fermé le tube

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
        try:
            for index, item in enumerate(cmd["items"]):
                emit("item_start", job_id=job_id, index=index, seed=item.get("seed"), t=time.time())
                t0 = time.time()
                segments = item["segments"]  # [{"text", "voice", "label"?}]
                ctx = {k: item.get(k) for k in ("language", "instruct", "speed", "seed", "params")}
                ctx["params"] = ctx.get("params") or {}

                plan: list[tuple[int, str, str]] = []  # (segment, texte, séparation)
                for si, seg in enumerate(segments):
                    for text, sep in split_text(seg["text"], engine.max_chars):
                        plan.append((si, text, sep))
                total = len(plan)
                pieces: list[np.ndarray] = []
                markers: list[dict] = []  # position (s) de chaque segment, pour la timeline
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
                if peak > 0.99:  # évite l'écrêtage à l'export
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
