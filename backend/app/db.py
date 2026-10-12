"""Persistance SQLite : conversations, messages, images et réglages.

Accès synchrone volontairement simple : une connexion par opération, mode WAL.
Les routes FastAPI synchrones s'exécutent dans le pool de threads.
"""

import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Iterator

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    parent_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    prompt          TEXT NOT NULL DEFAULT '',
    model_id        TEXT,
    params          TEXT NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'done',
    error           TEXT,
    created_at      REAL NOT NULL,
    started_at      REAL,
    finished_at     REAL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS assets (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('upload', 'generated')),
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
    filename        TEXT NOT NULL,
    thumb           TEXT,
    original_name   TEXT,
    width           INTEGER,
    height          INTEGER,
    seed            INTEGER,
    position        INTEGER NOT NULL DEFAULT 0,
    favorite        INTEGER NOT NULL DEFAULT 0,
    meta            TEXT NOT NULL DEFAULT '{}',
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_assets_message ON assets(message_id);

CREATE TABLE IF NOT EXISTS message_refs (
    message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (message_id, asset_id)
);

CREATE TABLE IF NOT EXISTS voices (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('clone', 'design')),
    filename    TEXT,
    transcript  TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    language    TEXT,
    duration    REAL,
    peaks       TEXT NOT NULL DEFAULT '[]',
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);
"""


def new_id() -> str:
    """Identifiant triable chronologiquement (horodatage ms + aléa)."""
    return f"{int(time.time() * 1000):011x}{secrets.token_hex(5)}"


def now() -> float:
    return time.time()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Colonnes ajoutées après la première version (bases existantes).
MIGRATIONS = [
    ("conversations", "mode", "TEXT NOT NULL DEFAULT 'image'"),  # image | audio
    ("assets", "media", "TEXT NOT NULL DEFAULT 'image'"),  # image | audio
    ("assets", "duration", "REAL"),
]


def _migrate(conn: sqlite3.Connection) -> None:
    for table, column, ddl in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_media ON assets(media, kind, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_conv_mode ON conversations(mode, updated_at)")


def init_db() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        _migrate(conn)
        # Les générations interrompues par un arrêt du serveur ne reprendront pas.
        conn.execute(
            "UPDATE messages SET status = 'error', error = 'Interrompu par l''arrêt du serveur', finished_at = ? "
            "WHERE status IN ('queued', 'loading', 'running')",
            (now(),),
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    d = dict(row)
    for key in ("params", "meta", "peaks"):
        if key in d and isinstance(d[key], str):
            d[key] = json.loads(d[key] or "{}")
    return d


# --- Réglages -----------------------------------------------------------------------------------

def get_settings() -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: json.loads(r["value"]) for r in rows}


def put_settings(values: dict[str, Any]) -> None:
    with connect() as conn:
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [(k, json.dumps(v)) for k, v in values.items()],
        )
