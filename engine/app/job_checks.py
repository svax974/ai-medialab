# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Checks made when a generation is requested, before anything is stored: does the model exist, can it do what is
asked, are the attached files what it needs. The messages are shown to the user as they are."""

from __future__ import annotations

from typing import Any

from .engines import get_spec

MAX_COUNT = 4
MAX_VIDEO_COUNT = 2  # a video takes minutes to hours, so batches stay small


def check_generation(model_id: str, reference_media: list[str]) -> dict[str, Any]:
    """`reference_media`: the media (`image`, `video`, `audio`) of each attached asset, in order.

    Returns `{kind, name, max_count, default_params}`; ValueError carries the message of a refusal."""
    try:
        spec = get_spec(model_id)
    except KeyError as exc:
        raise ValueError(str(exc)) from None
    if spec.kind == "llm":
        raise ValueError(f"{spec.name} est un modèle de chat : il ne génère ni image, ni audio, ni vidéo.")
    if spec.kind == "image" and spec.requires_references and not reference_media:
        raise ValueError(f"{spec.name} a besoin d'au moins une image de référence.")
    if spec.kind == "audio" and spec.audio.task != "tts":
        raise ValueError(f"{spec.name} ne synthétise pas de voix.")
    if spec.kind == "video":
        caps = spec.video
        if caps.image_input == "required" and "image" not in reference_media:
            raise ValueError(f"{spec.name} a besoin d'une image de départ.")
        if caps.video_input == "required" and "video" not in reference_media:
            raise ValueError(f"{spec.name} a besoin d'une vidéo source.")
    return {"kind": spec.kind, "name": spec.name, "max_count": MAX_VIDEO_COUNT if spec.kind == "video" else MAX_COUNT,
            "default_params": spec.default_params()}
