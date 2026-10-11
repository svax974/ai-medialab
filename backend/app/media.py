"""Fichiers images : import des références, vignettes, calcul des dimensions."""

from __future__ import annotations

import io
import math
from pathlib import Path

from PIL import Image, ImageOps

from .config import OUTPUTS_DIR, THUMBS_DIR, UPLOADS_DIR

THUMB_SIZE = 640
MAX_UPLOAD_SIDE = 4096
# « Origine » reprend la taille de la référence, plafonnée pour ne pas surprendre par un calcul énorme
# (une photo de 12 Mpx coûterait des dizaines de minutes) ; une taille plus grande reste possible en « Libre ».
NATIVE_MAX_MP = 1.6

Image.MAX_IMAGE_PIXELS = 120_000_000


def media_url(kind: str, filename: str | None) -> str | None:
    return f"/media/{kind}/{filename}" if filename else None


def load_upload(data: bytes) -> Image.Image:
    """Ouvre une image importée : orientation EXIF appliquée, transparence aplatie sur blanc."""
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
        # Les sorties RGBA (transparence native de Qwen Image 2.1) gardent leur canal alpha.
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
    """Dimensions finales à partir des paramètres de l'interface.

    - aspect "custom" : largeur/hauteur explicites ;
    - aspect "auto"   : ratio de la première image de référence (sinon carré) ; si `megapixels` est absent ou 0
                        ("Origine"), la taille de cette image est reprise telle quelle (plafonnée à NATIVE_MAX_MP) ;
    - aspect "W:H"    : ratio donné.
    La surface visée est `megapixels`, arrondie au multiple requis par le modèle.
    """
    aspect = str(params.get("aspect") or "1:1")
    if aspect == "custom":
        w = float(params.get("width") or 1024)
        h = float(params.get("height") or 1024)
        return snap(w, multiple, min_side, max_side), snap(h, multiple, min_side, max_side)

    ratio = None
    if aspect == "auto" and reference is not None:
        rw, rh = image_size(reference)
        if not params.get("megapixels"):  # « Origine » : on garde la taille de la référence
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
    # Respecte la borne max sans déformer le ratio.
    scale = min(1.0, max_side / max(w, h))
    return snap(w * scale, multiple, min_side, max_side), snap(h * scale, multiple, min_side, max_side)
