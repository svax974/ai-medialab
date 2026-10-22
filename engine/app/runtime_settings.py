# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Studio settings pushed by the NestJS server, kept in memory.

Nest owns the settings (its `studio_*` module config). It pushes them with `PUT /engine/v1/runtime/settings` when
it starts, every time the link to the engine comes back, and after every change. They are never written to disk (the
Hugging Face token is among them); until the first push the defaults of `jobs.DEFAULT_SETTINGS` apply.
"""

from __future__ import annotations

import threading
from typing import Any

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
    """The pushed studio settings (empty until Nest has sent them)."""
    with _lock:
        return {} if _pushed is None else dict(_pushed)
