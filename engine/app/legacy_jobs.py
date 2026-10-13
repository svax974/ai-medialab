# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Adapter between the legacy `/api/messages` routes (messages and assets in the engine's own database) and the
stateless `JobManager`. Removed with the legacy interface (H6).

A queued assistant message becomes a `JobRequest` whose sink writes the message and asset rows and publishes the old
event names (`message.updated`, `job.progress` with `message_id` and `conversation_id`, `job.image`). The generation
logic itself is the manager's, shared with the `/engine/v1/jobs` API.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import db, repo
from .config import OUTPUTS_DIR
from .engines import get_spec
from .events import bus
from .job_plans import JobRequest
from .jobs import jobs
from .media import asset_path

_RUNNING_SET: set[str] = set()  # messages already switched to `running`


def request_from_message(msg: dict[str, Any]) -> JobRequest:
    """The job of an assistant message: its prompt's reference files (in order) as inputs, outputs in `outputs/`."""
    with db.connect() as conn:
        refs = conn.execute(
            "SELECT a.kind, a.filename FROM message_refs r JOIN assets a ON a.id = r.asset_id "
            "WHERE r.message_id = ? ORDER BY r.position",
            (msg["parent_id"],),
        ).fetchall()
    return JobRequest(
        job_id=msg["id"], model_id=msg["model_id"], prompt=msg["prompt"], params=dict(msg["params"]),
        inputs=[str(asset_path(r["kind"], r["filename"])) for r in refs], output_dir=str(OUTPUTS_DIR),
        sink=legacy_sink, extra={"message_id": msg["id"], "conversation_id": msg["conversation_id"]},
    )


def enqueue(message_id: str) -> None:
    """Queues a message that is still `queued`; a model the registry does not know fails it right away."""
    msg = repo.get_message(message_id)
    if not msg or msg["status"] != "queued":
        return
    try:
        get_spec(msg["model_id"])
    except KeyError as exc:
        _finish_message(message_id, "error", str(exc))
        return
    jobs.submit(request_from_message(msg))


def legacy_sink(job: JobRequest, name: str, data: dict[str, Any]) -> None:
    mid = job.job_id
    if name == "job.started":
        _update(mid, status="loading", started_at=db.now(), params=data["params"])
    elif name == "job.progress":
        if data.get("phase") == "running" and mid not in _RUNNING_SET:
            _RUNNING_SET.add(mid)
            _update(mid, status="running")
        bus.publish("job.progress", {**data, **job.extra})
    elif name == "job.preview":
        bus.publish("job.progress", {**job.progress, **job.extra})
    elif name == "job.output":
        asset = _insert_asset(job, data)
        bus.publish("job.image", {"message_id": mid, "conversation_id": job.extra["conversation_id"], "asset": asset})
    elif name in ("job.done", "job.cancelled"):
        _finish_message(mid, "done" if name == "job.done" else "cancelled")
    elif name == "job.failed":
        _finish_message(mid, "error", data.get("error"))


def _update(message_id: str, **fields: Any) -> None:
    repo.update_message(message_id, **fields)
    msg = repo.get_message(message_id)
    if msg:
        bus.publish("message.updated", msg)


def _finish_message(message_id: str, status: str, error: str | None = None) -> None:
    _RUNNING_SET.discard(message_id)
    _update(message_id, status=status, error=error, finished_at=db.now())


def _insert_asset(job: JobRequest, out: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO assets (id, kind, media, conversation_id, message_id, filename, thumb, width, height, seed, "
            "duration, position, meta, created_at) VALUES (?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (out["asset_id"], out["media"], job.extra["conversation_id"], job.job_id, Path(out["path"]).name,
             out["thumb"], out["width"], out["height"], out["seed"], out["duration"], out["index"],
             json.dumps(out["meta"]), db.now()),
        )
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (out["asset_id"],)).fetchone()
    return repo.asset_public(row)
