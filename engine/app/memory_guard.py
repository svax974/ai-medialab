# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Memory guard: a generation must never exhaust the machine's memory.

On a Mac the CPU and the GPU share one memory: when a model overflows it, the whole machine freezes or restarts
instead of the program failing. Three safety nets, all in the engine's main process (never in the worker, which is
the one that may run away):

- `preflight`: before a model is loaded, the memory free right now must hold its weights plus the reserve; the job
  is refused with the numbers otherwise (other applications may be using what the planner counted on).
- `MemoryWatchdog`: while a worker is alive, the free memory is read several times a second; below the reserve, or
  when macOS reports critical memory pressure, the worker and its children (e.g. `sd-cli`) are killed at once and the
  job fails with an explanation. Killing a process gives all of its memory back, GPU included.
- per-job statistics (lowest free memory, peak of the worker's processes), printed in the engine log.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import sys
import threading
import time
from typing import Callable

import psutil

GIB = 1024**3
POLL_SECONDS = 0.2
# The worker tree's memory is summed less often (it walks every child process).
RSS_EVERY = 5


def reserve_gb(total_gb: float) -> float:
    """Memory kept free for the system and the other applications: 8 % of the RAM, at least 2.5 GB."""
    return round(max(2.5, total_gb * 0.08), 1)


def total_gb() -> float:
    return psutil.virtual_memory().total / GIB


def available_gb() -> float:
    return psutil.virtual_memory().available / GIB


def _macos_pressure() -> Callable[[], int] | None:
    """Reader of macOS's memory pressure level (1 normal, 2 warning, 4 critical), or None elsewhere."""
    if sys.platform != "darwin":
        return None
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c"))
    except OSError:
        return None

    def read() -> int:
        value, size = ctypes.c_int(0), ctypes.c_size_t(ctypes.sizeof(ctypes.c_int))
        ok = libc.sysctlbyname(b"kern.memorystatus_vm_pressure_level", ctypes.byref(value), ctypes.byref(size), None, 0)
        return value.value if ok == 0 else 1

    return read


PRESSURE_CRITICAL = 4


def tree_rss_gb(pid: int) -> float:
    """Resident memory of a process and all of its children (a worker and the `sd-cli` it runs)."""
    try:
        proc = psutil.Process(pid)
        procs = [proc, *proc.children(recursive=True)]
    except psutil.Error:
        return 0.0
    total = 0
    for p in procs:
        try:
            total += p.memory_info().rss
        except psutil.Error:
            pass
    return total / GIB


def kill_tree(pid: int) -> None:
    """Kill a process and its children right away (children first, so none is left orphaned)."""
    try:
        proc = psutil.Process(pid)
        children = proc.children(recursive=True)
    except psutil.Error:
        return
    for p in [*children, proc]:
        try:
            p.kill()
        except psutil.Error:
            pass
    psutil.wait_procs([*children, proc], timeout=5)


def fmt_gb(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def preflight(need_gb: float | None, free_gb: float, machine_gb: float, name: str) -> str | None:
    """Why loading `need_gb` of weights now would put the machine at risk (message to show), or None."""
    if not need_gb:
        return None
    reserve = reserve_gb(machine_gb)
    if free_gb - need_gb >= reserve:
        return None
    return (f"Mémoire insuffisante pour charger « {name} » maintenant : {fmt_gb(free_gb)} Go libres, il en faut "
            f"≈ {fmt_gb(need_gb + reserve)} ({fmt_gb(need_gb)} Go de poids et {fmt_gb(reserve)} Go de réserve pour le "
            "système). Fermez des applications gourmandes, puis relancez.")


class MemoryWatchdog:
    """Watches the free memory while a worker runs and kills it before the machine runs out (see the module doc).

    `target` gives the pid to protect (None: nothing to watch). The thread starts with `start()` and never blocks
    the event loop; `tripped(pid)` tells why a given worker was killed, so its job can say it."""

    def __init__(self, target: Callable[[], int | None], reserve: float | None = None,
                 read_available: Callable[[], float] = available_gb,
                 read_pressure: Callable[[], int] | None = None) -> None:
        self.target = target
        self.reserve = reserve if reserve is not None else reserve_gb(total_gb())
        self.read_available = read_available
        self.read_pressure = read_pressure if read_pressure is not None else _macos_pressure()
        self._trips: dict[int, str] = {}
        self._lock = threading.Lock()
        self._stats = {"min_free": float("inf"), "peak_rss": 0.0}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, daemon=True, name="memory-watchdog")
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def tripped(self, pid: int | None) -> str | None:
        with self._lock:
            return self._trips.get(pid) if pid is not None else None

    def begin_job(self) -> None:
        with self._lock:
            self._stats = {"min_free": float("inf"), "peak_rss": 0.0}

    def job_stats(self) -> dict[str, float]:
        with self._lock:
            free = self._stats["min_free"]
            return {"min_free_gb": round(free, 1) if free != float("inf") else round(self.read_available(), 1),
                    "peak_worker_gb": round(self._stats["peak_rss"], 1)}

    def check(self, pid: int, tick: int = 0) -> str | None:
        """One reading for worker `pid`; kills it and returns the reason when the machine is at risk."""
        free = self.read_available()
        pressure = self.read_pressure() if self.read_pressure else 1
        with self._lock:
            self._stats["min_free"] = min(self._stats["min_free"], free)
        if tick % RSS_EVERY == 0:
            rss = tree_rss_gb(pid)
            with self._lock:
                self._stats["peak_rss"] = max(self._stats["peak_rss"], rss)
        if free >= self.reserve and pressure < PRESSURE_CRITICAL:
            return None
        why = (f"la mémoire de la machine allait manquer ({fmt_gb(free)} Go libres, réserve de {fmt_gb(self.reserve)} Go)"
               if free < self.reserve else "macOS signale une pression mémoire critique")
        reason = (f"Arrêté par la protection mémoire : {why}. Le modèle a été déchargé pour protéger la machine. "
                  "Essayez une définition plus petite, moins d'images à la fois, une quantification plus forte, ou "
                  "fermez des applications gourmandes.")
        with self._lock:
            self._trips[pid] = reason
        print(f"[memory] worker {pid} tué : {why}", flush=True)
        kill_tree(pid)
        return reason

    def _loop(self) -> None:
        tick = 0
        while not self._stop.is_set():
            pid = self.target()
            if pid is not None and pid not in self._trips:
                try:
                    self.check(pid, tick)
                except Exception as exc:  # noqa: BLE001  the guard must never die
                    print(f"[memory] lecture impossible : {exc}", flush=True)
            tick += 1
            time.sleep(POLL_SECONDS)
