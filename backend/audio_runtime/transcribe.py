"""Transcription d'un extrait (Whisper via faster-whisper), pour retranscrire une voix de référence.

    python transcribe.py <audio> <dossier-modèle> [langue]   ->   une ligne JSON sur stdout
"""

from __future__ import annotations

import json
import os
import sys

_out = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)


def main() -> None:
    audio, model_dir = sys.argv[1], sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ("", "auto") else None
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from common import read_audio
    from faster_whisper import WhisperModel

    # On décode nous-mêmes (WAV, FLAC, OGG, MP3 via libsndfile) : pas de dépendance à PyAV/ffmpeg.
    samples, _ = read_audio(audio, 16000)
    model = WhisperModel(model_dir, device="cpu", compute_type="int8")
    segments, info = model.transcribe(samples, language=language, vad_filter=True, beam_size=5)
    text = " ".join(s.text.strip() for s in segments).strip()
    _out.write(json.dumps({"text": text, "language": info.language, "duration": round(info.duration, 2)},
                          ensure_ascii=False) + "\n")
    _out.flush()


if __name__ == "__main__":
    try:
        main()
    except BaseException as exc:  # noqa: BLE001
        _out.write(json.dumps({"error": str(exc) or exc.__class__.__name__}, ensure_ascii=False) + "\n")
        _out.flush()
        sys.exit(1)
