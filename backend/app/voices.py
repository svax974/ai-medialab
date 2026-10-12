"""Bibliothèque de voix (clonage) et résolution de la voix à utiliser pour une génération."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import numpy as np

from . import db
from .config import UPLOADS_DIR

MAX_REF_SECONDS = 30.0
MIN_REF_SECONDS = 1.0
REF_SAMPLE_RATE = 24000


def voice_path(filename: str) -> Path:
    return UPLOADS_DIR / filename


def voice_public(row: Any) -> dict[str, Any]:
    v = db.row_to_dict(row)
    return {
        "id": v["id"], "name": v["name"], "kind": v["kind"], "transcript": v["transcript"],
        "description": v["description"], "language": v["language"], "duration": v["duration"],
        "peaks": v["peaks"], "url": f"/media/uploads/{v['filename']}" if v["filename"] else None,
        "created_at": v["created_at"],
    }


def list_voices() -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM voices ORDER BY created_at DESC").fetchall()
    return [voice_public(r) for r in rows]


def get_voice(voice_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM voices WHERE id = ?", (voice_id,)).fetchone()
    return voice_public(row) if row else None


def decode_audio(data: bytes) -> tuple[np.ndarray, int]:
    """Décode WAV / FLAC / OGG / MP3 en vecteur mono float32."""
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
    """Extrait de référence prêt pour le clonage : mono, 24 kHz, silences de bord retirés, 30 s au plus."""
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
    if peak < 0.5:  # extrait très faible : on le ramène à un niveau correct
        audio = audio * (0.8 / peak)
    return audio.astype(np.float32), duration


def save_voice(*, name: str, kind: str, audio: np.ndarray, transcript: str = "", description: str = "",
               language: str | None = None) -> dict[str, Any]:
    import soundfile as sf

    voice_id = db.new_id()
    filename = f"voice_{voice_id}.wav"
    sf.write(str(voice_path(filename)), audio, REF_SAMPLE_RATE, subtype="PCM_16")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO voices (id, name, kind, filename, transcript, description, language, duration, peaks, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (voice_id, name.strip()[:80] or "Voix sans nom", kind, filename, transcript.strip(), description.strip(),
             language, round(audio.size / REF_SAMPLE_RATE, 2), json.dumps(peaks_of(audio)), db.now()),
        )
    return get_voice(voice_id)  # type: ignore[return-value]


def delete_voice(voice_id: str) -> bool:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM voices WHERE id = ?", (voice_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM voices WHERE id = ?", (voice_id,))
    if row["filename"]:
        voice_path(row["filename"]).unlink(missing_ok=True)
    return True


# --- Résolution pour une génération --------------------------------------------------------------------------

def resolve_voice(spec, ref: dict[str, Any] | None, language: str, instruct: str) -> dict[str, Any]:
    """Voix effective, au format attendu par le worker : preset | clone | design.

    `ref` : {"source": "preset", "id": "ff_siwis"} ou {"source": "library", "id": "<voix>"} ou None."""
    caps = spec.audio
    ref = ref or {}
    if ref.get("source") == "library":
        voice = get_voice(ref.get("id", ""))
        if not voice:
            raise ValueError("Cette voix n'existe plus dans votre bibliothèque.")
        if caps.clone == "none":
            raise ValueError(f"{spec.name} ne sait pas cloner une voix : choisissez un modèle de clonage "
                             "ou l'une de ses voix intégrées.")
        return {"kind": "clone", "ref_audio": str(voice_path(Path(voice["url"]).name)),
                "ref_text": voice["transcript"] or None, "label": voice["name"]}
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
