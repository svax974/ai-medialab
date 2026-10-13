# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Studio settings pushed by the NestJS server, kept in memory.

Nest owns the settings (its `studio_*` module config). It pushes them with `PUT /engine/v1/runtime/settings` when
it starts and after every change. Once a push has been received, the engine reads the studio keys here and no longer
in its own database; until then (standalone launch, legacy UI) the database values keep applying.
Other keys of the `settings` table (the custom model list) are not studio settings and still come from the database.
"""

from __future__ import annotations

import threading
from typing import Any

from . import db

STUDIO_KEYS = ("keep_alive_minutes", "previews", "low_memory", "quantize", "variant", "hf_token")

_lock = threading.Lock()
_pushed: dict[str, Any] | None = None


def apply(values: dict[str, Any]) -> None:
    """Replaces the pushed studio settings (unknown keys are ignored)."""
    global _pushed
    with _lock:
        _pushed = {k: v for k, v in values.items() if k in STUDIO_KEYS}


def received() -> bool:
    """True once Nest has pushed its settings."""
    with _lock:
        return _pushed is not None


def reset() -> None:
    """Forgets the pushed settings (tests)."""
    global _pushed
    with _lock:
        _pushed = None


def get_settings() -> dict[str, Any]:
    """The `settings` table, with the studio keys taken from the pushed values when Nest has sent any."""
    stored = db.get_settings()
    with _lock:
        pushed = None if _pushed is None else dict(_pushed)
    if pushed is None:
        return stored
    return {**{k: v for k, v in stored.items() if k not in STUDIO_KEYS}, **pushed}
