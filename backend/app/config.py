"""Chemins et réglages d'environnement."""

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("IMAGEGEN_DATA_DIR", ROOT_DIR / "data")).expanduser().resolve()
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

# Moteurs installés depuis l'application (l'application elle-même peut être en lecture seule).
ENGINES_DIR = DATA_DIR / "engines"
# Moteurs audio : un environnement Python isolé par « pack » (dépendances parfois incompatibles entre elles),
# installés à la demande. Le code qui y tourne (worker, moteurs) est livré avec l'application.
AUDIO_PACKS_DIR = ENGINES_DIR / "audio"
AUDIO_RUNTIME_DIR = ROOT_DIR / "backend" / "audio_runtime"

DB_PATH = DATA_DIR / "ai-medialab.db"
UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"
THUMBS_DIR = DATA_DIR / "thumbs"
PREVIEWS_DIR = DATA_DIR / "previews"

# Active le modèle « Démo » (images synthétiques, sans GPU) pour tester l'interface.
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
    # Migration : la base s'appelait « chambre-noire.db » avant le renommage du projet (journaux SQLite compris).
    legacy = DATA_DIR / "chambre-noire.db"
    if legacy.exists() and not DB_PATH.exists():
        for suffix in ("", "-wal", "-shm"):
            old = legacy.with_name(legacy.name + suffix)
            if old.exists():
                old.rename(DB_PATH.with_name(DB_PATH.name + suffix))
