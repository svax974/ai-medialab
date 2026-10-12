"""Pocket TTS (Kyutai, CC-BY-4.0) : ~100 M de paramètres, temps réel sur CPU, clonage vocal zéro-shot."""

from __future__ import annotations

import os

import numpy as np

from . import Engine, seed_everything
from common import to_mono_float32

LANGUAGES = {"en": "english", "fr": "french", "de": "german", "es": "spanish", "it": "italian",
             "pt": "portuguese", "nl": "dutch"}


class PocketEngine(Engine):
    sample_rate = 24000
    max_chars = 320

    def load(self) -> None:
        self.model = None
        self.language = None
        self._voices: dict[tuple, object] = {}
        self._ensure(self.options.get("language") or "en")

    def _ensure(self, code: str) -> None:
        from pocket_tts import TTSModel

        name = LANGUAGES.get((code or "en").split("-")[0].lower(), "english")
        if self.model is not None and self.language == name:
            return
        self.model = None  # libère l'ancien modèle avant de charger le suivant
        self._voices.clear()
        self.model = TTSModel.load_model(language=name)
        self.language = name
        self.sample_rate = int(self.model.sample_rate)

    def _state(self, voice: dict):
        if voice.get("kind") == "clone":
            path = voice["ref_audio"]
            key = ("clone", path, os.path.getmtime(path))
            source = path
        else:
            key = ("preset", voice.get("id") or "alba")
            source = key[1]
        if key not in self._voices:
            self._voices[key] = self.model.get_state_for_audio_prompt(source)
        return self._voices[key]

    def synth(self, text: str, voice: dict, ctx: dict) -> np.ndarray:
        self._ensure(ctx.get("language") or "en")
        seed_everything(ctx.get("seed"))
        audio = self.model.generate_audio(self._state(voice), text)
        return to_mono_float32(audio)
