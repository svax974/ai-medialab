# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Transcription of voice-cloning reference samples: which model runs, and how.

Two families of engines can do it: Whisper in the `speech` pack (PyTorch / CTranslate2 / MLX) and the audio.cpp ASR
models (GGUF, any GPU, no PyTorch). The text is only a suggestion: the voice editor always lets the user correct it.
"""

from __future__ import annotations

from typing import Any, Callable

from . import audio_packs, audiocpp
from .engines.base import ModelSpec, repo_cache_dir

# Whisper first: it has always been the default, and it runs on Metal on a Mac. The audio.cpp models follow (the light
# one before the accurate one) and take over when the `speech` pack is not installed.
PREFERRED = ("whisper-small", "whisper-large-v3-turbo", "qwen3-asr-gguf-small", "qwen3-asr-gguf")


def stt_models(models: dict[str, ModelSpec]) -> list[ModelSpec]:
    return [m for m in models.values() if m.audio and m.audio.task == "stt"]


def ordered(models: dict[str, ModelSpec], preferred: str | None = None) -> list[ModelSpec]:
    """Models to try, in order: the one asked for, or the preferred ones then the others alphabetically."""
    stt = stt_models(models)
    if preferred:
        return [m for m in stt if m.id == preferred]
    return sorted(stt, key=lambda m: (m.id not in PREFERRED, PREFERRED.index(m.id) if m.id in PREFERRED else 0, m.id))


def choose(candidates: list[ModelSpec], downloaded: Callable[[ModelSpec], bool],
           engine_ready: Callable[[ModelSpec], bool]) -> tuple[ModelSpec | None, str]:
    """First candidate with its weights *and* its engine in place, else (None, French reason)."""
    have = [m for m in candidates if downloaded(m)]
    if not have:
        return None, ("Aucun modèle de transcription n'est téléchargé : installez « Whisper Small » ou "
                      "« Qwen3-ASR » (Modèles → Audio).")
    for m in have:
        if engine_ready(m):
            return m, ""
    pack = audio_packs.PACKS.get(have[0].options.get("pack", ""))
    return None, f"Le moteur « {pack.name if pack else have[0].options.get('pack')} » n'est pas installé (Modèles → Moteurs)."


def transcribe(spec: ModelSpec, audio: str, language: str | None) -> dict[str, Any]:
    """Run the chosen model on a clip. Returns {text, language, duration, model}."""
    pack = audio_packs.PACKS[spec.options["pack"]]
    if pack.native:
        model = audiocpp.model_file(spec.options["repo"], spec.options["file"])
        if model is None:
            raise RuntimeError("Modèle de transcription introuvable sur le disque.")
        result = audiocpp.run_transcribe(spec.options["family"], str(model), audio, language,
                                         language_option=bool(spec.options.get("language_option", True)))
    else:
        from .audio_worker import run_transcribe

        snaps = sorted((repo_cache_dir(spec.options["repo"]) / "snapshots").glob("*"))
        if not snaps:
            raise RuntimeError("Modèle de transcription introuvable sur le disque.")
        result = run_transcribe(spec.options["pack"], audio, str(snaps[-1]), language)
    return {**result, "model": spec.id}
