# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Transcribe a clip with Whisper, used for voice-cloning reference samples.

MLX conversions (weights.npz / weights.safetensors) run on Metal through mlx-whisper; CTranslate2 models
(model.bin) run on the CPU through faster-whisper. The engine is picked from the files in the model folder.

    python transcribe.py <audio> <model-dir> [language]   ->   one JSON line on stdout
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

    # Decode ourselves (WAV, FLAC, OGG, MP3 via libsndfile) to avoid depending on PyAV/ffmpeg.
    samples, _ = read_audio(audio, 16000)
    if os.path.isfile(os.path.join(model_dir, "model.bin")):
        from faster_whisper import WhisperModel

        model = WhisperModel(model_dir, device="cpu", compute_type="int8")
        segments, info = model.transcribe(samples, language=language, vad_filter=True, beam_size=5)
        text = " ".join(s.text.strip() for s in segments).strip()
        detected, duration = info.language, info.duration
    else:
        import mlx_whisper

        result = mlx_whisper.transcribe(samples, path_or_hf_repo=model_dir, language=language)
        text = result["text"].strip()
        detected, duration = result.get("language") or language, len(samples) / 16000
    _out.write(json.dumps({"text": text, "language": detected, "duration": round(duration, 2)},
                          ensure_ascii=False) + "\n")
    _out.flush()


if __name__ == "__main__":
    try:
        main()
    except BaseException as exc:  # noqa: BLE001
        _out.write(json.dumps({"error": str(exc) or exc.__class__.__name__}, ensure_ascii=False) + "\n")
        _out.flush()
        sys.exit(1)
