"""Chemins et réglages d'environnement."""

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("IMAGEGEN_DATA_DIR", ROOT_DIR / "data")).expanduser().resolve()
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

# Moteurs installés depuis l'application (l'application elle-même peut être en lecture seule).
ENGINES_DIR = DATA_DIR / "engines"

DB_PATH = DATA_DIR / "chambre-noire.db"
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
