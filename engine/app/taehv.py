# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""TAEHV, the tiny video decoders used for the "fast decode" mode of the Wan models (`sd-cli --tae`).

The full Wan VAE decodes with 3D convolutions, which Metal runs as a scalar kernel: 150-170 s even for a few frames.
TAEHV (madebyollin/taehv, MIT) is a small distilled decoder: 0.7 s for 480x832x9 on an M3 Max, at the price of a little
detail. The two files (23 MB each) exist only as safetensors in the taehv repo, so they are fetched on first use from a
pinned commit, checked against their sha256 and stored under `<data>/engines/taehv/`. If anything fails the caller falls
back to the full VAE, so offline use keeps working.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path
from typing import Callable

from . import config

COMMIT = "011dfc2112197741c540e0bdd5b7b67bcc930771"
URL = f"https://github.com/madebyollin/taehv/raw/{COMMIT}/safetensors/{{name}}.safetensors"

# name -> (size in bytes, sha256). taew2_2 matches the Wan 2.2 5B VAE, taew2_1 the Wan 2.1 VAE (every A14B).
FILES: dict[str, tuple[int, str]] = {
    "taew2_2": (22_848_048, "b84609b2a133d48434bd9636bfcb44bf05168dc436e2d3cecf26256faa1f5325"),
    "taew2_1": (22_642_902, "04766eac0221b5390b985ae3fdcca652cbb4b1e8b82b28ea7ff89dfad1b1a93f"),
}


class TaeUnavailable(RuntimeError):
    """The fast decoder could not be obtained; the message is meant for the user."""


def tae_path(name: str) -> Path:
    return config.ENGINES_DIR / "taehv" / f"{name}.safetensors"


def is_ready(name: str) -> bool:
    path = tae_path(name)
    return path.is_file() and path.stat().st_size == FILES[name][0]


def _fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "ai-medialab"})
    with urllib.request.urlopen(req, timeout=60) as r, dest.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)


def ensure_tae(name: str, fetch: Callable[[str, Path], None] | None = None) -> Path:
    """Path of the decoder, downloading it if needed. Raises TaeUnavailable (French message) on any failure.

    `fetch(url, dest)` writes the file at `dest`; replaceable for tests."""
    path = tae_path(name)
    if is_ready(name):
        return path
    size, sha = FILES[name]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    try:
        (fetch or _fetch)(URL.format(name=name), tmp)
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if digest != sha or tmp.stat().st_size != size:
            raise TaeUnavailable("Le décodeur rapide téléchargé est corrompu (somme de contrôle invalide).")
        os.replace(tmp, path)  # atomic: a half-written file never carries the final name
    except TaeUnavailable:
        raise
    except Exception as e:
        raise TaeUnavailable(f"Impossible de télécharger le décodeur rapide ({e.__class__.__name__}).") from e
    finally:
        tmp.unlink(missing_ok=True)
    return path
