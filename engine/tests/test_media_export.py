# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Light copy of a video for sending: size, frame rate, file weight (PyAV, tiny synthetic clips, no model)."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, media
from app.main import app

H: dict[str, str] = {}  # no ENGINE_TOKEN in the environment: the routes are open


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
    client = TestClient(app)
    first = client.post("/engine/v1/media/video-export", json=body, headers=H)
    assert first.status_code == 200, first.text
    name = first.json()["filename"]
    made = (config.EXPORTS_DIR / name).stat().st_mtime_ns
    assert client.post("/engine/v1/media/video-export", json=body, headers=H).json()["filename"] == name
    assert (config.EXPORTS_DIR / name).stat().st_mtime_ns == made
    outside = client.post("/engine/v1/media/video-export", json={**body, "source_path": "/etc/hosts"}, headers=H)
    assert outside.status_code == 422


def test_the_gif_loops_keeps_the_size_asked_and_has_one_palette(clip, tmp_path):
    from PIL import Image

    out = tmp_path / "anim.gif"
    result = media.export_gif(clip, out, short_side=48, max_fps=12)
    with Image.open(out) as gif:
        assert gif.size == (80, 48) == (result["width"], result["height"])
        assert gif.n_frames == 12 and gif.info["loop"] == 0 and gif.info["duration"] == 80  # GIF counts in hundredths of a second


def test_a_long_clip_is_cut_at_the_frame_limit_for_a_gif(clip, tmp_path, monkeypatch):
    monkeypatch.setattr(media, "GIF_MAX_FRAMES", 5)
    out = tmp_path / "short.gif"
    media.export_gif(clip, out, short_side=48, max_fps=24)
    from PIL import Image

    with Image.open(out) as gif:
        assert gif.n_frames == 5


def test_the_route_makes_a_gif_next_to_the_mp4(clip):
    body = {"source_path": str(clip), "short_side": 120, "max_fps": 10, "format": "gif"}
    client = TestClient(app)
    first = client.post("/engine/v1/media/video-export", json=body, headers=H)
    assert first.status_code == 200, first.text
    assert first.json()["filename"].endswith("-120p10.gif")
    again = client.post("/engine/v1/media/video-export", json=body, headers=H).json()
    assert again["width"] == first.json()["width"] and again["bytes"] == first.json()["bytes"]
