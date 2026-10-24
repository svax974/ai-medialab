# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Live memory report and the emergency stop.

`live()` is what the left panel shows: the machine's memory (`memory_stats.sample`), the models held and the ceiling
(`memory_budget.snapshot`), and what is running right now. `stop_everything()` is the red button for when a model runs away: it ends
what is queued, kills the generation worker and the chat and OCR servers at once (their whole process trees, `sd-cli` included, so
the memory comes back), and leaves each waiting caller a clear reason. Downloads and installs are not touched: they use the disk,
not the models' memory.
"""

from __future__ import annotations

import asyncio
from typing import Any

from . import memory_budget, memory_guard, memory_stats
from .events import bus

REASON = ("Arrêt d'urgence demandé : le modèle a été arrêté de force et sa mémoire libérée. "
          "Relancez le travail quand la machine a retrouvé de la marge.")
SAMPLE_EVERY_S = 2.0


def activity() -> dict[str, Any]:
    """What is running or loaded, for the button (enabled only when there is something to stop)."""
    from .jobs import jobs
    from .llm import managers

    chat, ocr = managers()
    working = bool(jobs.current) or chat.generating or ocr.generating
    held = memory_budget.residents()
    return {"working": working, "queued": len(jobs.pending), "loaded": len(held),
            "can_stop": working or bool(jobs.pending) or bool(held)}


def live() -> dict[str, Any]:
    return {**memory_stats.sample(), "budget": memory_budget.snapshot(), "activity": activity()}


async def stop_everything() -> dict[str, Any]:
    """Ends the queued jobs, kills every model process. Returns what was stopped."""
    from .jobs import _pid, jobs
    from .llm import managers

    cancelled = 0
    for job_id in list(jobs.pending):  # first, so that nothing starts again once the worker is gone
        if await jobs.cancel(job_id):
            cancelled += 1
    killed: list[str] = []
    worker = jobs.worker
    if worker is not None and worker.alive:
        pid = _pid(worker)
        if pid is not None:
            jobs.guard.stop_process(pid, REASON)
            killed.append(getattr(worker, "model_id", "worker"))
    for manager in managers():
        server = manager.server
        if server is not None and server.alive:
            manager.guard.stop_process(server.proc.pid, REASON)
            killed.append(server.model_id)
    print(f"[memory] arrêt d'urgence : {len(killed)} modèle(s) arrêté(s), {cancelled} travail(aux) en attente annulé(s)", flush=True)
    bus.publish("memory.sample", live())
    return {"stopped": killed, "cancelled": cancelled}


async def monitor() -> None:
    """Publishes `memory.sample` every few seconds for the left panel (the browser does not poll). Ends when cancelled."""
    while True:
        try:
            bus.publish("memory.sample", await asyncio.to_thread(live))
        except Exception as exc:  # noqa: BLE001  a failed reading must not stop the next one
            print(f"[memory] lecture impossible : {exc}", flush=True)
        await asyncio.sleep(SAMPLE_EVERY_S)
