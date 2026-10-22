# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""What the engine keeps for itself: a small JSON file in the data folder (`engine-state.json`).

Everything the application owns (conversations, messages, assets, voices, studio settings) lives in the NestJS
database. The engine keeps only what it needs to rebuild its model registry at startup: the recipes of the models
added from Hugging Face (`custom_models`, see `engines/custom.py`). The studio settings pushed by Nest stay in memory
(`runtime_settings.py`): the Hugging Face token is never written here.

First start: when the file does not exist yet, the recipes are taken from the old database of the engine
(`ai-medialab.db`, `chambre-noire.db`, or `ai-medialab.db.imported` once Nest has imported it), read-only, key
`custom_models` of its `settings` table. The old database is never modified. A file is always written (empty when
there is nothing to take over), so the old database is read once.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

FILE_NAME = "engine-state.json"
# Old databases, newest name first; `.imported` is what Nest renames `ai-medialab.db` to after its import.
LEGACY_DB_NAMES = ("ai-medialab.db", "chambre-noire.db", "ai-medialab.db.imported", "chambre-noire.db.imported")
LEGACY_SETTINGS_KEY = "custom_models"

_lock = threading.Lock()


def state_path(data_dir: Path) -> Path:
    return data_dir / FILE_NAME


def read_legacy_settings(data_dir: Path) -> dict[str, Any]:
    """The `settings` table of the first old database found (read-only), `{}` when none or unreadable."""
    for name in LEGACY_DB_NAMES:
        path = data_dir / name
        if not path.is_file():
            continue
        try:
            conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
            try:
                rows = conn.execute("SELECT key, value FROM settings").fetchall()
            finally:
                conn.close()
            return {k: json.loads(v) for k, v in rows}
        except (sqlite3.Error, ValueError) as exc:
            print(f"[engine] ancienne base illisible ({name}) : {exc}", flush=True)
    return {}


def _write(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load(data_dir: Path) -> dict[str, Any]:
    """The state; created from the old database the first time."""
    path = state_path(data_dir)
    with _lock:
        if path.is_file():
            try:
                return dict(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError) as exc:
                print(f"[engine] {FILE_NAME} illisible, ignoré : {exc}", flush=True)
                return {}
        legacy = read_legacy_settings(data_dir)
        state: dict[str, Any] = {}
        if legacy.get(LEGACY_SETTINGS_KEY):
            state["custom_models"] = list(legacy[LEGACY_SETTINGS_KEY])
            print(f"[engine] modèles personnalisés repris de l'ancienne base ({len(state['custom_models'])})", flush=True)
        _write(path, state)
        return state


def update(data_dir: Path, **values: Any) -> None:
    """Merges the given keys into the state file (atomic replace)."""
    state = load(data_dir)
    with _lock:
        _write(state_path(data_dir), {**state, **values})
