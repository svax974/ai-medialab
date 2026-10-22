# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Description of a file a job produced: what the caller needs to register it as an asset.

The engine owns the media files, so it also makes the thumbnail and probes dimensions and duration. The caller
(NestJS) stores the row; `asset_id` is chosen here because the thumbnail is named after it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .media import make_thumb, new_id, video_thumb
from .private_session import session_dir, subfolder


def describe_output(plan: dict[str, Any], evt: dict[str, Any]) -> dict[str, Any]:
    """`evt` is the worker's `image` / `audio` / `video` event; blocking (image decoding), run in a thread."""
    media = evt["type"]
    path = Path(evt["path"])
    asset_id = new_id()
    params = plan["params"]
    private = plan.get("private_dir")
    thumbs = subfolder(session_dir(private), "thumbs") if private else None
    out: dict[str, Any] = {
        "index": evt["index"], "media": media, "asset_id": asset_id, "path": str(path), "filename": path.name,
        "thumb": None, "width": None, "height": None, "seed": evt.get("seed"), "duration": None,
    }
    if media == "image":
        from PIL import Image

        out["thumb"] = make_thumb(path, asset_id, thumbs)
        with Image.open(path) as img:
            out["width"], out["height"] = img.size
        out["meta"] = {
            "model_id": plan["model_id"], "prompt": plan["prompt"], "steps": params["steps"],
            "guidance": params.get("guidance"), "strength": params.get("strength"), "seconds": evt.get("seconds"),
        }
    elif media == "video":
        out["thumb"] = video_thumb(path, asset_id, thumbs)
        out.update(width=evt.get("width"), height=evt.get("height"), duration=evt.get("duration"))
        out["meta"] = {
            "model_id": plan["model_id"], "prompt": plan["prompt"], "steps": params["steps"],
            "guidance": params.get("guidance"), "seconds": evt.get("seconds"), "fps": evt.get("fps"),
            "frames": evt.get("frames"), "has_audio": evt.get("has_audio"), "video_seconds": evt.get("duration"),
            "task": params.get("task"), "strength": params.get("strength"),
        }
    else:
        out["duration"] = evt.get("duration")
        out["meta"] = {
            "model_id": plan["model_id"], "prompt": plan["prompt"], "seconds": evt.get("seconds"),
            "language": params.get("language"), "instruct": plan["items"][0].get("instruct"),
            "voice": plan.get("voice_label"), "speakers": plan.get("speakers"),
            "sample_rate": evt.get("sample_rate"), "peaks": evt.get("peaks"), "markers": evt.get("markers"),
        }
    if private:  # the caller already has the prompt in memory; what describes the file must not carry it
        out["meta"].pop("prompt", None)
        out["meta"].pop("instruct", None)
    return out
