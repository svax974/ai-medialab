# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""One-off move of an old data folder into the current one.

Before the rename to « AI MediaLab » the desktop app stored its data under the identifier `app.chambrenoire.studio`.
The desktop shell (template) creates the current folder (logs, secrets) before any process starts, so the old
whole-folder rename is no longer possible: the entries of the old folder are moved one by one instead.
Pure standard library, no import of the rest of the engine (unit-tested alone).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

ENV_VAR = "IMAGEGEN_LEGACY_DATA_DIRS"
# Database names that mean « this folder already holds real data ».
DB_NAMES = ("ai-medialab.db", "chambre-noire.db", "ai-medialab.db.imported", "chambre-noire.db.imported")
# Written by the desktop shell in every data folder: never taken from the old one.
SHELL_ENTRIES = frozenset({"logs", "secrets.json"})


def legacy_dirs_from_env(environ: dict[str, str] | None = None) -> list[Path]:
    raw = (environ if environ is not None else os.environ).get(ENV_VAR, "")
    return [Path(p) for p in raw.split(os.pathsep) if p.strip()]


def migrate_legacy_data(data_dir: Path, legacy_dirs: list[Path]) -> list[str]:
    """Moves the content of the first old folder that exists into `data_dir`; returns the moved entry names.

    Nothing happens when `data_dir` already holds a database (it is in use) or when no old folder exists. An entry
    already present in `data_dir` is left in place (nothing is overwritten); the old folder is removed only when empty.
    """
    if any((data_dir / name).exists() for name in DB_NAMES):
        return []
    data_dir = data_dir.resolve()
    for legacy in legacy_dirs:
        legacy = legacy.resolve()
        if legacy == data_dir or not legacy.is_dir():
            continue
        data_dir.mkdir(parents=True, exist_ok=True)
        moved: list[str] = []
        for entry in sorted(legacy.iterdir()):
            if entry.name in SHELL_ENTRIES or (data_dir / entry.name).exists():
                continue
            shutil.move(str(entry), str(data_dir / entry.name))
            moved.append(entry.name)
        try:
            legacy.rmdir()
        except OSError:
            pass  # still holds the shell's own entries (logs, secrets) or conflicts: left for the user
        return moved
    return []
