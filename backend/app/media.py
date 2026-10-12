# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Image files: reference uploads, thumbnails, output size computation."""

from __future__ import annotations

import io
import math
from pathlib import Path

from PIL import Image, ImageOps

from .config import OUTPUTS_DIR, THUMBS_DIR, UPLOADS_DIR

THUMB_SIZE = 640
MAX_UPLOAD_SIDE = 4096
# "Origin" size reuses the reference's size, capped so a big photo doesn't trigger a huge job
# (12 MP would take tens of minutes). Larger sizes are still possible with a custom size.
NATIVE_MAX_MP = 1.6

Image.MAX_IMAGE_PIXELS = 120_000_000


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
      ("Origin"), that image's size is kept as is, capped at NATIVE_MAX_MP.
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
