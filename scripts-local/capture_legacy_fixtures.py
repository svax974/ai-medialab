# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Captures the public shapes produced by the legacy engine (`app/repo.py`, `app/voices.py`) on a demo database.

The rows come from `back/src/modules/legacy-import/testing/legacyDemo.json`; the output,
`expectedPublic.json` next to it, is what the Nest mappers must reproduce exactly (they are compared in
`publicShapes.spec.ts`). Uses a throw-away data folder (never `data/`) and loads neither torch nor any model.

    IMAGEGEN_DATA_DIR=$(mktemp -d) engine/.venv/bin/python scripts-local/capture_legacy_fixtures.py
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
if not os.environ.get("IMAGEGEN_DATA_DIR"):
    sys.exit("Set IMAGEGEN_DATA_DIR to a throw-away folder (never the real data/).")

from app import db, repo, voices  # noqa: E402

FIXTURES = ROOT / "back/src/modules/legacy-import/testing"
JSON_COLUMNS = {"params", "meta", "peaks"}
ORDER = ["conversations", "messages", "assets", "message_refs", "voices"]


def load_demo() -> None:
    demo = json.loads((FIXTURES / "legacyDemo.json").read_text())
    with db.connect() as conn:
        conn.executescript(db.SCHEMA)  # not init_db(): its sweep would rewrite the busy messages
        db._migrate(conn)
        for table in ORDER:
            for row in demo[table]:
                values = {k: json.dumps(v) if k in JSON_COLUMNS else v for k, v in row.items()}
                cols = ", ".join(values)
                marks = ", ".join("?" * len(values))
                conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(values.values()))


def gallery_items(**filters) -> list[dict]:
    """Same query as `list_assets` of `app/api/routes.py` (kept out of the import: routes pull in the whole engine)."""
    kind, media = filters.get("kind", "generated"), filters.get("media", "image")
    sql = ("SELECT a.*, c.title AS conversation_title, m.prompt AS prompt, m.model_id AS model_id "
           "FROM assets a LEFT JOIN conversations c ON c.id = a.conversation_id "
           "LEFT JOIN messages m ON m.id = a.message_id WHERE a.kind = ? AND a.media = ? ORDER BY a.created_at DESC")
    with db.connect() as conn:
        rows = conn.execute(sql, (kind, media)).fetchall()
    items = []
    for r in rows:
        a = repo.asset_public(r)
        a.update(conversation_title=r["conversation_title"], prompt=r["prompt"], model_id=r["model_id"])
        items.append(a)
    return items


def main() -> None:
    load_demo()
    with db.connect() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM conversations").fetchall()]
        msg_ids = [r["id"] for r in conn.execute("SELECT id FROM messages").fetchall()]
        asset_ids = [r["id"] for r in conn.execute("SELECT id FROM assets").fetchall()]
        assets = {i: repo.asset_public(conn.execute("SELECT * FROM assets WHERE id = ?", (i,)).fetchone())
                  for i in asset_ids}
    out = {
        "conversationList": repo.list_conversations(),
        "conversationListAudio": repo.list_conversations(mode="audio"),
        "conversationListQuery": repo.list_conversations(query="plage"),
        "conversations": {i: repo.get_conversation(i) for i in ids},
        "messages": {i: repo.get_message(i) for i in msg_ids},
        "assets": assets,
        "gallery": {
            "generatedImage": gallery_items(),
            "generatedAudio": gallery_items(media="audio"),
            "uploadImage": gallery_items(kind="upload"),
        },
        "voices": voices.list_voices(),
    }
    (FIXTURES / "expectedPublic.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    print("expectedPublic.json written")


if __name__ == "__main__":
    main()
