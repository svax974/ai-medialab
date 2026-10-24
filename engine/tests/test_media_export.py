# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Light copy of a video for sending: size, frame rate, file weight (PyAV, tiny synthetic clips, no model)."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, media
from app.main import app


@pytest.fixture()
def clip(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "EXPORTS_DIR", tmp_path / "exports")
    rng = np.random.default_rng(1)
    frames = rng.integers(0, 255, (24, 96, 160, 3), dtype=np.uint8)
    path = tmp_path / "clip.mp4"
    media.encode_mp4(frames, 24, path)
    return path


def test_export_size_keeps_the_aspect_and_never_enlarges():
    assert media.export_size(832, 480, 240) == (416, 240)
    assert media.export_size(480, 832, 240) == (240, 416)
    assert media.export_size(160, 96, 360) == (160, 96)


def test_the_copy_is_smaller_slower_in_frames_and_lighter(clip, tmp_path):
    out = tmp_path / "light.mp4"
    result = media.export_video(clip, out, short_side=48, max_fps=12)
    info = media.probe_video(out)
    assert (result["width"], result["height"]) == (80, 48) == (info["width"], info["height"])
    assert result["fps"] == 12 and abs(info["fps"] - 12) < 0.5
    assert result["bytes"] < clip.stat().st_size


def test_the_route_reuses_an_unchanged_export(clip, tmp_path):
    body = {"source_path": str(clip), "short_side": 120, "max_fps": 12}  # the route accepts 120 px at least
    with TestClient(app) as client:
        headers = {"X-Engine-Token": config.ENGINE_TOKEN} if hasattr(config, "ENGINE_TOKEN") else {}
        first = client.post("/engine/v1/media/video-export", json=body, headers=headers)
        assert first.status_code == 200, first.text
        name = first.json()["filename"]
        made = (config.EXPORTS_DIR / name).stat().st_mtime_ns
        assert client.post("/engine/v1/media/video-export", json=body, headers=headers).json()["filename"] == name
        assert (config.EXPORTS_DIR / name).stat().st_mtime_ns == made
        outside = client.post("/engine/v1/media/video-export", json={**body, "source_path": "/etc/hosts"}, headers=headers)
        assert outside.status_code == 422
