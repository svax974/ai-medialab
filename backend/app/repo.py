# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Queries and serialization of the objects exposed by the API."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from . import db
from .config import OUTPUTS_DIR, PREVIEWS_DIR, THUMBS_DIR, UPLOADS_DIR
from .media import media_url


def asset_public(row: sqlite3.Row | dict) -> dict[str, Any]:
    a = db.row_to_dict(row) if isinstance(row, sqlite3.Row) else dict(row)
    folder = "uploads" if a["kind"] == "upload" else "outputs"
    return {
        "id": a["id"],
        "kind": a["kind"],
        "media": a.get("media") or "image",
        "duration": a.get("duration"),
        "url": media_url(folder, a["filename"]),
        "thumb_url": media_url("thumbs", a.get("thumb")) or media_url(folder, a["filename"]),
        "width": a.get("width"),
        "height": a.get("height"),
        "seed": a.get("seed"),
        "original_name": a.get("original_name"),
        "favorite": bool(a.get("favorite")),
        "meta": a.get("meta") or {},
        "conversation_id": a.get("conversation_id"),
        "message_id": a.get("message_id"),
        "created_at": a.get("created_at"),
    }


def message_public(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    m = db.row_to_dict(row)
    refs = conn.execute(
        "SELECT a.* FROM message_refs r JOIN assets a ON a.id = r.asset_id "
        "WHERE r.message_id = ? ORDER BY r.position",
        (m["id"],),
    ).fetchall()
    outputs = conn.execute(
        "SELECT * FROM assets WHERE message_id = ? AND kind = 'generated' ORDER BY position", (m["id"],)
    ).fetchall()
    m["references"] = [asset_public(r) for r in refs]
    m["outputs"] = [asset_public(r) for r in outputs]
    return m


def get_message(message_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        return message_public(conn, row) if row else None


def conversation_summary(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    c = dict(row)
    cover = conn.execute(
        "SELECT * FROM assets WHERE conversation_id = ? AND kind = 'generated' AND media = 'image' ORDER BY created_at DESC LIMIT 1",
        (c["id"],),
    ).fetchone()
    stats = conn.execute(
        "SELECT COUNT(*) AS n, SUM(status IN ('queued','loading','running')) AS busy "
        "FROM messages WHERE conversation_id = ? AND role = 'assistant'",
        (c["id"],),
    ).fetchone()
    c["pinned"] = bool(c["pinned"])
    c["cover"] = asset_public(cover) if cover else None
    c["generation_count"] = stats["n"] or 0
    c["busy"] = bool(stats["busy"])
    return c


def list_conversations(query: str | None = None, mode: str | None = None) -> list[dict[str, Any]]:
    with db.connect() as conn:
        where, args = [], []
        if mode:
            where.append("c.mode = ?")
            args.append(mode)
        if query:
            like = f"%{query}%"
            where.append("(c.title LIKE ? OR m.prompt LIKE ?)")
            args += [like, like]
        sql = ("SELECT DISTINCT c.* FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id"
               + (" WHERE " + " AND ".join(where) if where else "")
               + " ORDER BY c.pinned DESC, c.updated_at DESC")
        rows = conn.execute(sql, args).fetchall()
        return [conversation_summary(conn, r) for r in rows]


def get_conversation(conversation_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if not row:
            return None
        conv = conversation_summary(conn, row)
        msgs = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id", (conversation_id,)
        ).fetchall()
        conv["messages"] = [message_public(conn, m) for m in msgs]
        return conv


def touch_conversation(conn: sqlite3.Connection, conversation_id: str) -> None:
    conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (db.now(), conversation_id))


def update_message(message_id: str, **fields: Any) -> None:
    if not fields:
        return
    if "params" in fields:
        fields["params"] = json.dumps(fields["params"])
    cols = ", ".join(f"{k} = ?" for k in fields)
    with db.connect() as conn:
        conn.execute(f"UPDATE messages SET {cols} WHERE id = ?", (*fields.values(), message_id))


def delete_asset_files(row: sqlite3.Row | dict) -> None:
    folder = UPLOADS_DIR if row["kind"] == "upload" else OUTPUTS_DIR
    for path in (folder / row["filename"], THUMBS_DIR / (row["thumb"] or "")):
        if path.is_file():
            path.unlink(missing_ok=True)


def purge_assets(conn: sqlite3.Connection, asset_rows: list[sqlite3.Row]) -> None:
    """Delete assets, except those still used as a reference by a remaining message.

    Call after deleting the related messages/conversations, once the cascaded refs are gone."""
    for a in asset_rows:
        still_used = conn.execute("SELECT 1 FROM message_refs WHERE asset_id = ? LIMIT 1", (a["id"],)).fetchone()
        if still_used:
            conn.execute("UPDATE assets SET message_id = NULL WHERE id = ?", (a["id"],))
        else:
            conn.execute("DELETE FROM assets WHERE id = ?", (a["id"],))
            delete_asset_files(a)


def delete_previews(job_id: str) -> None:
    for p in PREVIEWS_DIR.glob(f"{job_id}_*"):
        p.unlink(missing_ok=True)
