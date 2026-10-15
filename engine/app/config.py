# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

import os
from pathlib import Path

from .legacy_data import legacy_dirs_from_env, migrate_legacy_data

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("IMAGEGEN_DATA_DIR", ROOT_DIR / "data")).expanduser().resolve()

# Engines installed from within the app (the app itself may live on a read-only volume).
ENGINES_DIR = DATA_DIR / "engines"
# Audio engines: one isolated Python env per pack (their dependencies can conflict), installed on demand.
# The code running inside them (worker, engines) ships with the app.
AUDIO_PACKS_DIR = ENGINES_DIR / "audio"
AUDIO_RUNTIME_DIR = ROOT_DIR / "engine" / "audio_runtime"
# Video engines that cannot share the main environment (pinned dependencies, official code): same mechanism.
VIDEO_PACKS_DIR = ENGINES_DIR / "video"
VIDEO_RUNTIME_DIR = ROOT_DIR / "engine" / "video_runtime"

UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"
THUMBS_DIR = DATA_DIR / "thumbs"
PREVIEWS_DIR = DATA_DIR / "previews"
# Private generation (private_session.py): one random folder per session, never listed in MEDIA_DIRS (its own mount).
PRIVATE_DIR = DATA_DIR / "private"

# Enables the demo model (synthetic images, no GPU) for UI testing.
DEMO_MODE = os.environ.get("IMAGEGEN_DEMO", "0") == "1"

MEDIA_DIRS = {
    "uploads": UPLOADS_DIR,
    "outputs": OUTPUTS_DIR,
    "thumbs": THUMBS_DIR,
    "previews": PREVIEWS_DIR,
}


def adopt_legacy_data_dir() -> None:
    """Desktop: moves in an old data folder (identifier before the rename), see legacy_data.py.

    Runs when this module is imported, i.e. before any other module can open (and so create) the database."""
    moved = migrate_legacy_data(DATA_DIR, legacy_dirs_from_env())
    if moved:
        print(f"[engine] données de l'ancien dossier reprises : {', '.join(moved)}", flush=True)


adopt_legacy_data_dir()


def ensure_dirs() -> None:
    for d in (DATA_DIR, *MEDIA_DIRS.values()):
        d.mkdir(parents=True, exist_ok=True)
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    PRIVATE_DIR.chmod(0o700)
