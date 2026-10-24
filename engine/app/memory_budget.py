# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Global memory budget: how much of the machine's memory the models loaded at the same time may take.

Several models can stay resident together (a media worker, the chat model, an OCR model) as long as their weights
fit under one ceiling for the whole application. A holder (`jobs.py`, `llm.py`) registers a `Slot`; before it loads a
model it asks `make_room`, which unloads the least recently used idle models until the new one fits, or answers with
the refusal to show. Running a model stays one at a time (a generation, a reply, a transcription): only residency is shared.

The ceiling is the `memory_limit_gb` setting (Settings, pushed by Nest), 80 % of the machine's memory when unset, and never
above what `memory_guard.preflight` would leave free. It is a budget, not a measurement: `memory_guard.preflight` (free memory
right now) and the watchdog (kills a model before the machine runs out) stay in force whatever the ceiling says.

When the weights do not share the processor's memory (a separate graphics card) the sum means nothing: every other
model is unloaded first, as before.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from . import memory_guard, runtime_settings

DEFAULT_FRACTION = 0.8


@dataclass
class Resident:
    """A model held in memory: what it is, what it is counted for (GB) and when it was last used."""

    model_id: str
    name: str
    gb: float
    last_used: float = field(default_factory=time.time)


@dataclass
class Slot:
    """One holder of a resident model: how to read it, whether it is working, how to unload it."""

    key: str
    resident: Callable[[], Resident | None]
    busy: Callable[[], bool]
    evict: Callable[[], Awaitable[None]]


_slots: dict[str, Slot] = {}


def register(slot: Slot) -> None:
    _slots[slot.key] = slot


def unregister(key: str) -> None:
    _slots.pop(key, None)


def memory_shared() -> bool:
    """True when the weights live in the memory the processor uses (unified memory, or no graphics card)."""
    from .system import get_system

    accelerators = get_system()["accelerators"]
    return not accelerators or bool(accelerators[0].get("unified"))


def machine_gb() -> float:
    from .system import get_system

    return float(get_system()["ram_gb"])


def ceiling_gb(machine: float | None = None) -> float:
    """What the loaded models may take together: the setting, else 80 % of the machine, never past the safety reserve."""
    machine = machine if machine is not None else machine_gb()
    hard = max(0.0, machine - memory_guard.reserve_gb(machine))
    wanted = runtime_settings.get_settings().get("memory_limit_gb")
    limit = float(wanted) if wanted and wanted > 0 else machine * DEFAULT_FRACTION
    return round(min(limit, hard), 1)


def residents(skip: str | None = None) -> list[tuple[Slot, Resident]]:
    """The models held right now (the holder `skip` left out), least recently used first."""
    found = [(slot, res) for key, slot in _slots.items() if key != skip and (res := slot.resident()) is not None]
    return sorted(found, key=lambda pair: pair[1].last_used)


def snapshot() -> dict[str, Any]:
    """Budget and resident models, for the status of the engine."""
    held = residents()
    return {"ceiling_gb": ceiling_gb(), "used_gb": round(sum(r.gb for _, r in held), 1),
            "models": [{"model_id": r.model_id, "name": r.name, "gb": round(r.gb, 1)} for _, r in held]}


async def make_room(need_gb: float | None, requester: str, name: str) -> str | None:
    """Unloads idle models, least recently used first, until `need_gb` fits under the ceiling next to the others
    (the holder `requester` is about to replace its own model, so it does not count). Returns the refusal message, or None."""
    if not need_gb:
        return None
    if not memory_shared():
        for slot, _res in residents(skip=requester):
            if not slot.busy():
                await slot.evict()
        return None
    ceiling = ceiling_gb()
    if need_gb > ceiling:
        return (f"« {name} » demande ≈ {memory_guard.fmt_gb(need_gb)} Go, au-dessus du plafond de mémoire des modèles "
                f"({memory_guard.fmt_gb(ceiling)} Go). Relevez-le dans Réglages ou choisissez un modèle plus léger.")
    tried: set[str] = set()
    while True:
        held = residents(skip=requester)
        used = sum(r.gb for _, r in held)
        if used + need_gb <= ceiling:
            return None
        idle = [slot for slot, _r in held if not slot.busy() and slot.key not in tried]
        if not idle:
            names = ", ".join(r.name for _, r in held)
            return (f"Pas assez de place sous le plafond de mémoire des modèles ({memory_guard.fmt_gb(ceiling)} Go) pour "
                    f"charger « {name} » ({memory_guard.fmt_gb(need_gb)} Go) : {names} est en cours d'utilisation. "
                    "Attendez sa fin ou relevez le plafond dans Réglages.")
        tried.add(idle[0].key)  # a holder that fails to let go is not asked twice
        await idle[0].evict()
