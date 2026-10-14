# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Image files: reference uploads, thumbnails, output size computation."""

from __future__ import annotations

import functools
import io
import math
import secrets
import time
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageOps

from .config import OUTPUTS_DIR, PREVIEWS_DIR, THUMBS_DIR, UPLOADS_DIR

THUMB_SIZE = 640
MAX_UPLOAD_SIDE = 4096
# "Origin" size reuses the reference's size, capped so a big photo doesn't trigger a huge job
# (12 MP would take tens of minutes). Larger sizes are still possible with a custom size.
NATIVE_MAX_MP = 1.6

Image.MAX_IMAGE_PIXELS = 120_000_000


def new_id() -> str:
    """Time-sortable id (ms timestamp + random suffix), the form of every asset id."""
    return f"{int(time.time() * 1000):011x}{secrets.token_hex(5)}"


def media_url(kind: str, filename: str | None) -> str | None:
    return f"/media/{kind}/{filename}" if filename else None


def load_upload(data: bytes) -> Image.Image:
    """Open an uploaded image: apply EXIF orientation, flatten transparency onto white."""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    if max(img.size) > MAX_UPLOAD_SIDE:
        img.thumbnail((MAX_UPLOAD_SIDE, MAX_UPLOAD_SIDE), Image.Resampling.LANCZOS)
    return img


def save_upload(asset_id: str, data: bytes) -> tuple[str, int, int]:
    img = load_upload(data)
    filename = f"{asset_id}.png"
    img.save(UPLOADS_DIR / filename, optimize=False)
    return filename, img.width, img.height


def make_thumb(src: Path, asset_id: str) -> str:
    filename = f"{asset_id}.webp"
    with Image.open(src) as img:
        # RGBA outputs (native transparency from Qwen Image 2.1) keep their alpha channel.
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "PA") else "RGB")
        img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
        img.save(THUMBS_DIR / filename, quality=86)
    return filename


def delete_previews(job_id: str) -> None:
    """Remove the intermediate preview images of a job."""
    for p in PREVIEWS_DIR.glob(f"{job_id}_*"):
        p.unlink(missing_ok=True)


def asset_path(kind: str, filename: str) -> Path:
    return (UPLOADS_DIR if kind == "upload" else OUTPUTS_DIR) / filename


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return ImageOps.exif_transpose(img).size


def parse_aspect(aspect: str) -> float | None:
    try:
        a, b = aspect.split(":")
        return float(a) / float(b)
    except (ValueError, ZeroDivisionError):
        return None


def snap(value: float, multiple: int, lo: int, hi: int) -> int:
    v = int(round(value / multiple)) * multiple
    return max(lo, min(hi, v))


def resolve_size(
    params: dict,
    *,
    multiple: int,
    min_side: int,
    max_side: int,
    default_megapixels: float,
    reference: Path | None,
) -> tuple[int, int]:
    """Final dimensions from the UI params.

    - aspect "custom": explicit width/height.
    - aspect "auto": ratio of the first reference image (square if none). If `megapixels` is missing or 0
      ("Origin"), that image's size is kept, capped at NATIVE_MAX_MP, or
      enlarged with its ratio up to the model's minimum side.
    - aspect "W:H": the given ratio.
    The target area is `megapixels`, rounded to the multiple the model requires.
    """
    aspect = str(params.get("aspect") or "1:1")
    if aspect == "custom":
        w = float(params.get("width") or 1024)
        h = float(params.get("height") or 1024)
        return snap(w, multiple, min_side, max_side), snap(h, multiple, min_side, max_side)

    ratio = None
    if aspect == "auto" and reference is not None:
        rw, rh = image_size(reference)
        if not params.get("megapixels"):  # "Origin": keep the reference size
            scale = min(1.0, max_side / max(rw, rh), math.sqrt(NATIVE_MAX_MP * 1024 * 1024 / (rw * rh)))
            # A reference smaller than the model's minimum is enlarged as a whole, so its ratio survives.
            scale = min(max(scale, min_side / min(rw, rh)), max_side / max(rw, rh))
            return snap(rw * scale, multiple, min_side, max_side), snap(rh * scale, multiple, min_side, max_side)
        ratio = rw / rh
    if ratio is None:
        ratio = parse_aspect(aspect) or 1.0

    mp = float(params.get("megapixels") or default_megapixels)
    mp = max(0.1, min(4.0, mp))
    area = mp * 1024 * 1024
    w = math.sqrt(area * ratio)
    h = w / ratio
    # Enforce the max side without distorting the ratio.
    scale = min(1.0, max_side / max(w, h))
    return snap(w * scale, multiple, min_side, max_side), snap(h * scale, multiple, min_side, max_side)


# Video

VIDEO_EXTENSIONS = (".mp4", ".mov", ".webm", ".mkv", ".m4v")
MAX_VIDEO_UPLOAD = 500 * 1024 * 1024


def is_video_upload(filename: str | None, content_type: str | None) -> bool:
    return bool((filename or "").lower().endswith(VIDEO_EXTENSIONS) or (content_type or "").startswith("video/"))


def video_frame_count(seconds: float, fps: int, step: int, min_seconds: float, max_seconds: float) -> int:
    """Frames for a duration, in the n * step + 1 form video models require."""
    seconds = max(min_seconds, min(max_seconds, seconds))
    n = max(1, round(seconds * fps / step))
    return n * step + 1


def video_size(aspect: str, short_side: int, long_side: int, multiple: int, ratio: float | None = None) -> tuple[int, int]:
    """(width, height) for an aspect ratio at a given definition.

    The shorter side gets `short_side`; the longer one follows the ratio but never exceeds `long_side`."""
    ratio = ratio or parse_aspect(aspect) or 16 / 9
    if ratio >= 1:
        w, h = short_side * ratio, float(short_side)
        if w > long_side:
            w, h = float(long_side), long_side / ratio
    else:
        w, h = float(short_side), short_side / ratio
        if h > long_side:
            w, h = long_side * ratio, float(long_side)
    return snap(w, multiple, multiple, 4096), snap(h, multiple, multiple, 4096)


def fit_image(img: Image.Image, width: int, height: int) -> Image.Image:
    """Center-crop and resize to the exact target size (no stretching)."""
    return ImageOps.fit(img, (width, height), Image.Resampling.LANCZOS)


def probe_video(path: Path) -> dict:
    """Width, height, duration (s) and fps of a video file; raises on unreadable files."""
    import av

    with av.open(str(path)) as container:
        stream = next((s for s in container.streams if s.type == "video"), None)
        if stream is None:
            raise ValueError("Aucune piste vidéo.")
        ctx = stream.codec_context
        fps = float(stream.average_rate or stream.guessed_rate or 0)
        if container.duration:
            duration = container.duration / 1_000_000
        elif stream.duration and stream.time_base:
            duration = float(stream.duration * stream.time_base)
        else:
            duration = 0.0
        return {"width": ctx.width, "height": ctx.height, "duration": round(duration, 3), "fps": round(fps, 3),
                "has_audio": any(s.type == "audio" for s in container.streams)}


def read_frames(path: Path, max_frames: int, size: tuple[int, int] | None = None) -> list[Image.Image]:
    """First `max_frames` frames as RGB images (fitted to `size` when given)."""
    import av

    frames: list[Image.Image] = []
    with av.open(str(path)) as container:
        for frame in container.decode(video=0):
            img = frame.to_image().convert("RGB")
            frames.append(fit_image(img, *size) if size else img)
            if len(frames) >= max_frames:
                break
    if not frames:
        raise ValueError("Vidéo vide ou illisible.")
    return frames


def read_video_with_audio(path: Path):
    """(frames uint8 [F, H, W, 3], audio float32 [channels, samples] or None, sample rate or None) of a video file."""
    import av
    import numpy as np

    with av.open(str(path)) as container:
        frames = np.stack([f.to_ndarray(format="rgb24") for f in container.decode(video=0)]) \
            if any(s.type == "video" for s in container.streams) else np.zeros((0, 0, 0, 3), np.uint8)
    chunks, rate = [], None
    with av.open(str(path)) as container:
        if any(s.type == "audio" for s in container.streams):
            rate = container.streams.audio[0].rate
            for frame in container.decode(audio=0):
                arr = frame.to_ndarray()
                channels = len(frame.layout.channels)
                if not frame.format.is_planar:
                    arr = arr.reshape(-1, channels).T
                if arr.dtype.kind in "iu":
                    arr = arr.astype(np.float32) / 32768.0
                chunks.append(arr.astype(np.float32))
    audio = np.concatenate(chunks, axis=1) if chunks else None
    return frames, audio, (int(rate) if audio is not None and rate else None)


def video_thumb(src: Path, asset_id: str) -> str:
    """WebP thumbnail of the first frame."""
    filename = f"{asset_id}.webp"
    img = read_frames(src, 1)[0]
    img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
    img.save(THUMBS_DIR / filename, quality=86)
    return filename


# H.264 encoders, preferred first: Apple's VideoToolbox and Cisco's OpenH264 keep FFmpeg under the LGPL, libx264
# (GPL) is only a fallback for GPL builds such as PyAV's PyPI wheels. Why, and which build ships:
# docs/components/ffmpeg.md.
# Same list in video_runtime/common.py (pack environments cannot import the app).
H264_ENCODERS = ("h264_videotoolbox", "libopenh264", "libx264")


def _h264_settings(name: str, width: int, height: int, fps: int) -> tuple[dict[str, str], int]:
    """(encoder options, bit rate in bit/s, 0 = the encoder's own quality setting) for one H.264 encoder."""
    if name == "libx264":
        return {"crf": "18", "preset": "medium"}, 0
    # No CRF outside x264: a generous bit rate (0.25 bit per pixel per frame, at least 2 Mbit/s) keeps details.
    bit_rate = max(2_000_000, int(width * height * fps * 0.25))
    return ({"profile": "high"} if name == "h264_videotoolbox" else {}), bit_rate


@functools.lru_cache(maxsize=32)
def h264_encoder(width: int, height: int, fps: int) -> tuple[str, dict[str, str], int]:
    """First encoder of `H264_ENCODERS` this FFmpeg build has and that opens at this size: (name, options, bit rate)."""
    import av

    for name in H264_ENCODERS:
        options, bit_rate = _h264_settings(name, width, height, fps)
        try:
            ctx = av.CodecContext.create(name, "w")
            ctx.width, ctx.height, ctx.pix_fmt = width, height, "yuv420p"
            ctx.time_base, ctx.framerate = Fraction(1, fps), Fraction(fps, 1)
            ctx.bit_rate, ctx.options = bit_rate, dict(options)
            ctx.open()
        except (ValueError, av.FFmpegError):  # unknown in this build, or no hardware session for this size
            continue
        return name, options, bit_rate
    raise RuntimeError("Aucun encodeur H.264 disponible dans cette version de FFmpeg.")


def encode_mp4(frames, fps: int, path: Path, audio=None, sample_rate: int | None = None) -> None:
    """Write H.264 (yuv420p, encoder from `h264_encoder`) frames, with an optional AAC track (FFmpeg's native
    encoder), as a web-friendly MP4.

    `frames`: uint8 array [F, H, W, 3]. `audio`: float array [channels, samples] in [-1, 1]."""
    import av
    import numpy as np

    frames = np.asarray(frames)
    _, height, width, _ = frames.shape
    container = av.open(str(path), mode="w", options={"movflags": "+faststart"})
    try:
        name, options, bit_rate = h264_encoder(width, height, int(fps))
        stream = container.add_stream(name, rate=int(fps))
        stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
        stream.options = dict(options)
        if bit_rate:
            stream.bit_rate = bit_rate
        astream = None
        if audio is not None and sample_rate:
            astream = container.add_stream("aac", rate=int(sample_rate))
            astream.layout = "stereo"
        for arr in frames:
            for packet in stream.encode(av.VideoFrame.from_ndarray(arr, format="rgb24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        if astream is not None:
            samples = np.asarray(audio, dtype=np.float32)
            if samples.ndim == 1:
                samples = samples[None]
            if samples.shape[0] == 1:
                samples = np.repeat(samples, 2, axis=0)
            samples = samples[:2]
            pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).T.reshape(1, -1)  # interleaved L R
            aframe = av.AudioFrame.from_ndarray(np.ascontiguousarray(pcm), format="s16", layout="stereo")
            aframe.sample_rate = int(sample_rate)
            resampler = av.audio.resampler.AudioResampler(format="fltp", layout="stereo", rate=int(sample_rate))
            for rframe in resampler.resample(aframe):
                for packet in astream.encode(rframe):
                    container.mux(packet)
            for packet in astream.encode():
                container.mux(packet)
    finally:
        container.close()
