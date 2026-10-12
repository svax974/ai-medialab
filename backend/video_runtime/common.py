# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Helpers for the video worker: reading source frames, writing the MP4.

Runs inside a pack's environment (PyAV, Pillow and numpy only), so it must not import anything from the app.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


class Cancelled(Exception):
    """Raised from a progress hook when the user cancelled the generation."""


def fit(img: Image.Image, width: int, height: int) -> Image.Image:
    """Center-crop and resize to the exact target size (no stretching)."""
    return ImageOps.fit(img.convert("RGB"), (width, height), Image.Resampling.LANCZOS)


def valid_frame_count(n: int) -> int:
    """Largest 4k + 1 not above `n` (what the Wan-based video models accept), 0 when there is none."""
    return (n - 1) // 4 * 4 + 1 if n >= 1 else 0


def read_frames_at(path: str, fps: float, count: int, size: tuple[int, int] | None = None) -> list[Image.Image]:
    """Up to `count` frames sampled at `fps` from the start of a video, so motion keeps its speed whatever the
    source frame rate is. Frames are fitted to `size` (width, height) when given."""
    import av

    frames: list[Image.Image] = []
    next_t = 0.0
    with av.open(str(path)) as container:
        for frame in container.decode(video=0):
            t = float(frame.time or 0.0)
            if t + 1e-6 < next_t:
                continue
            img = frame.to_image().convert("RGB")
            frames.append(fit(img, *size) if size else img)
            next_t = len(frames) / fps
            if len(frames) >= count:
                break
    if not frames:
        raise ValueError("Vidéo source vide ou illisible.")
    return frames


def write_mp4(frames, fps: int, path: str) -> dict:
    """Write PIL images or a uint8 [F, H, W, 3] array as a web-friendly H.264 MP4; returns the clip description."""
    import av

    arrays = [np.asarray(f.convert("RGB")) if isinstance(f, Image.Image) else np.asarray(f) for f in frames]
    height, width = arrays[0].shape[:2]
    container = av.open(str(path), mode="w", options={"movflags": "+faststart"})
    try:
        stream = container.add_stream("libx264", rate=int(fps))
        stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
        stream.options = {"crf": "18", "preset": "medium"}
        for arr in arrays:
            for packet in stream.encode(av.VideoFrame.from_ndarray(arr, format="rgb24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()
    return {"width": width, "height": height, "fps": int(fps), "frames": len(arrays), "has_audio": False,
            "duration": round(len(arrays) / fps, 3)}


def probe(path: str) -> dict:
    """Clip description of an MP4 written by another library."""
    import av

    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or stream.guessed_rate or 0)
        frames = stream.frames or sum(1 for _ in container.decode(video=0))
        return {"width": stream.codec_context.width, "height": stream.codec_context.height, "fps": round(fps),
                "frames": int(frames), "has_audio": False, "duration": round(frames / fps, 3) if fps else 0.0}


def local_snapshot(source: dict) -> str:
    """Folder of a Hugging Face repo already downloaded by the app (never downloads anything here)."""
    from huggingface_hub import snapshot_download

    return snapshot_download(source["repo"], allow_patterns=source.get("patterns"), local_files_only=True)


def must_exist(path: str | Path) -> str:
    if not Path(path).is_file():
        raise FileNotFoundError(f"Fichier introuvable : {path}")
    return str(path)
