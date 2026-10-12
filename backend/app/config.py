# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("IMAGEGEN_DATA_DIR", ROOT_DIR / "data")).expanduser().resolve()
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

# Engines installed from within the app (the app itself may live on a read-only volume).
ENGINES_DIR = DATA_DIR / "engines"
# Audio engines: one isolated Python env per pack (their dependencies can conflict), installed on demand.
# The code running inside them (worker, engines) ships with the app.
AUDIO_PACKS_DIR = ENGINES_DIR / "audio"
AUDIO_RUNTIME_DIR = ROOT_DIR / "backend" / "audio_runtime"
# Video engines that cannot share the main environment (pinned dependencies, official code): same mechanism.
VIDEO_PACKS_DIR = ENGINES_DIR / "video"
VIDEO_RUNTIME_DIR = ROOT_DIR / "backend" / "video_runtime"

DB_PATH = DATA_DIR / "ai-medialab.db"
UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"
THUMBS_DIR = DATA_DIR / "thumbs"
PREVIEWS_DIR = DATA_DIR / "previews"

# Enables the demo model (synthetic images, no GPU) for UI testing.
DEMO_MODE = os.environ.get("IMAGEGEN_DEMO", "0") == "1"

MEDIA_DIRS = {
    "uploads": UPLOADS_DIR,
    "outputs": OUTPUTS_DIR,
    "thumbs": THUMBS_DIR,
    "previews": PREVIEWS_DIR,
}


def ensure_dirs() -> None:
    for d in (DATA_DIR, *MEDIA_DIRS.values()):
        d.mkdir(parents=True, exist_ok=True)
    # Migration: the DB was named chambre-noire.db before the project rename (including the SQLite WAL/SHM files).
    legacy = DATA_DIR / "chambre-noire.db"
    if legacy.exists() and not DB_PATH.exists():
        for suffix in ("", "-wal", "-shm"):
            old = legacy.with_name(legacy.name + suffix)
            if old.exists():
                old.rename(DB_PATH.with_name(DB_PATH.name + suffix))
