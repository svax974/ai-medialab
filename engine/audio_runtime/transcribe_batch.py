# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Long transcription worker: bounded WAV chunks, one model load, NDJSON results. Runs in the speech pack."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_out = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)


def transcriber(model_dir: str):
    """Load the chosen Whisper implementation once for the complete media."""
    if Path(model_dir, "model.bin").is_file():
        from faster_whisper import WhisperModel

        model = WhisperModel(model_dir, device="cpu", compute_type="int8")

        def run(samples, language):
            segments, info = model.transcribe(samples, language=language, vad_filter=True, beam_size=5)
            return " ".join(segment.text.strip() for segment in segments).strip(), info.language

        return run
    import mlx_whisper

    def run_mlx(samples, language):
        result = mlx_whisper.transcribe(samples, path_or_hf_repo=model_dir, language=language)
        return result["text"].strip(), result.get("language") or language

    return run_mlx


def main() -> None:
    from common import read_audio

    folder, model_dir, language = sys.argv[1:4]
    language = language or None
    run = transcriber(model_dir)
    done = 0.0
    for index, path in enumerate(sorted(Path(folder).glob("chunk-*.wav"))):
        samples, _ = read_audio(str(path), 16000)
        text, detected = run(samples, language)
        done += len(samples) / 16000
        _out.write(json.dumps({"type": "segment", "index": index, "text": text, "language": detected, "done": done}, ensure_ascii=False) + "\n")
        _out.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _out.write(json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n")
        _out.flush()
        sys.exit(1)
