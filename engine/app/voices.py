# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Voice reference clips (cloning) and resolution of the voice to use for a generation.

The voice library itself belongs to the NestJS server (`audio-studio`); the engine prepares the clips and resolves
the voice from the library the caller passes with the job."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np

from .config import UPLOADS_DIR

MAX_REF_SECONDS = 30.0
MIN_REF_SECONDS = 1.0
REF_SAMPLE_RATE = 24000


def voice_path(filename: str) -> Path:
    return UPLOADS_DIR / filename


def decode_audio(data: bytes) -> tuple[np.ndarray, int]:
    """Decode WAV / FLAC / OGG / MP3 into a mono float32 array."""
    import soundfile as sf

    samples, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    return samples.mean(axis=1), int(sr)


def resample(audio: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or audio.size == 0:
        return audio
    n = int(round(audio.size * dst / src))
    return np.interp(np.linspace(0, 1, n, endpoint=False), np.linspace(0, 1, audio.size, endpoint=False), audio).astype(np.float32)


def peaks_of(audio: np.ndarray, bins: int = 120) -> list[float]:
    if audio.size == 0:
        return [0.0] * bins
    edges = np.linspace(0, audio.size, bins + 1, dtype=int)
    vals = np.array([np.abs(audio[a:b]).max() if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])])
    return [round(float(v / (vals.max() or 1.0)), 3) for v in vals]


def prepare_reference(data: bytes) -> tuple[np.ndarray, float]:
    """Reference clip ready for cloning: mono, 24 kHz, edge silence trimmed, 30 s at most."""
    audio, sr = decode_audio(data)
    audio = resample(audio, sr, REF_SAMPLE_RATE)
    loud = np.flatnonzero(np.abs(audio) > 0.01)
    if loud.size:
        pad = int(0.1 * REF_SAMPLE_RATE)
        audio = audio[max(0, loud[0] - pad): min(audio.size, loud[-1] + pad)]
    duration = audio.size / REF_SAMPLE_RATE
    if duration < MIN_REF_SECONDS:
        raise ValueError("Extrait trop court : il faut au moins une seconde de parole.")
    if duration > MAX_REF_SECONDS:
        audio = audio[: int(MAX_REF_SECONDS * REF_SAMPLE_RATE)]
        duration = MAX_REF_SECONDS
    peak = float(np.abs(audio).max() or 1.0)
    if peak < 0.5:  # very quiet clip: bring it up to a usable level
        audio = audio * (0.8 / peak)
    return audio.astype(np.float32), duration


def store_reference(voice_id: str, audio: np.ndarray) -> str:
    """Writes the prepared clip as `voice_<id>.wav` in the uploads folder and returns the file name."""
    import soundfile as sf

    filename = f"voice_{voice_id}.wav"
    sf.write(str(voice_path(filename)), audio, REF_SAMPLE_RATE, subtype="PCM_16")
    return filename


def resolve_voice(spec, ref: dict[str, Any] | None, language: str, instruct: str,
                  library: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """Effective voice in the format the worker expects: preset | clone | design.

    `ref` is {"source": "preset", "id": "ff_siwis"}, {"source": "library", "id": "<voice>"} or None.
    `library` (voices the caller resolved: id -> {"path", "transcript", "name"}) is looked at before the engine's own;
    the engine has no library of its own: without the voice there, it no longer exists."""
    caps = spec.audio
    ref = ref or {}
    if ref.get("source") == "library":
        given = (library or {}).get(ref.get("id", ""))
        if given is None:
            raise ValueError("Cette voix n'existe plus dans votre bibliothèque.")
        if caps.clone == "none":
            raise ValueError(f"{spec.name} ne sait pas cloner une voix : choisissez un modèle de clonage "
                             "ou l'une de ses voix intégrées.")
        return {"kind": "clone", "ref_audio": str(given["path"]), "ref_text": given.get("transcript") or None,
                "label": given.get("name") or ""}
    if caps.design:
        if not instruct:
            raise ValueError("Décrivez la voix à créer (âge, timbre, caractère…).")
        return {"kind": "design", "description": instruct, "label": "Voix décrite"}
    presets = [v for v in caps.voices if v.language in (language, "*")]
    if ref.get("source") == "preset":
        found = next((v for v in caps.voices if v.id == ref.get("id")), None)
        if found:
            return {"kind": "preset", "id": found.id, "label": found.name}
    if presets:
        return {"kind": "preset", "id": presets[0].id, "label": presets[0].name}
    if caps.clone != "none":
        raise ValueError("Ce modèle clone une voix : choisissez ou enregistrez une voix de référence.")
    raise ValueError("Aucune voix disponible pour cette langue avec ce modèle.")
