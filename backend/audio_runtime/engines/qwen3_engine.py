"""Qwen3-TTS (Alibaba, Apache-2.0) : voix premium pilotables par consigne, création de voix, clonage.

Trois familles de checkpoints, un seul moteur :
  *-CustomVoice : neuf voix intégrées + consigne de style (1.7B)
  *-VoiceDesign : la voix est décrite en langage naturel
  *-Base        : clonage à partir d'un extrait (+ transcription facultative)
"""

from __future__ import annotations

import os

import numpy as np

from . import Engine, pick_device, seed_everything
from common import to_mono_float32

LANGUAGE_NAMES = {
    "zh": "chinese", "en": "english", "ja": "japanese", "ko": "korean", "de": "german", "fr": "french",
    "ru": "russian", "pt": "portuguese", "es": "spanish", "it": "italian",
}


class Qwen3Engine(Engine):
    sample_rate = 24000
    max_chars = 400

    def load(self) -> None:
        import torch
        from qwen_tts import Qwen3TTSModel

        repo = self.options["repo"]
        kind = str(self.options.get("variant") or repo.rsplit("-", 1)[-1]).lower()
        self.variant = "base" if kind.endswith("base") else "design" if "design" in kind else "custom"
        device = pick_device(self.options.get("device"))
        # float16 donne des NaN sur ce modèle (probabilités invalides) ; bfloat16 sur GPU, float32 sur CPU.
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        self.device = device
        self.model = Qwen3TTSModel.from_pretrained(repo, device_map=device, dtype=dtype)
        self._prompts: dict[tuple, object] = {}

    def _language(self, ctx: dict) -> str:
        code = (ctx.get("language") or "auto").split("-")[0].lower()
        return LANGUAGE_NAMES.get(code, "auto")

    def synth(self, text: str, voice: dict, ctx: dict) -> np.ndarray:
        seed_everything(ctx.get("seed"))
        params = ctx.get("params") or {}
        kw = {}
        if params.get("temperature"):
            kw.update(do_sample=True, temperature=float(params["temperature"]))
        lang = self._language(ctx)
        instruct = (ctx.get("instruct") or "").strip() or None

        if self.variant == "custom":
            wavs, sr = self.model.generate_custom_voice(
                text=text, speaker=(voice.get("id") or "vivian").lower(), language=lang, instruct=instruct, **kw)
        elif self.variant == "design":
            description = (voice.get("description") or instruct or "").strip()
            if not description:
                raise ValueError("Décrivez la voix à créer (âge, timbre, caractère…).")
            wavs, sr = self.model.generate_voice_design(text=text, instruct=description, language=lang, **kw)
        else:
            path = voice.get("ref_audio")
            if voice.get("kind") != "clone" or not path:
                raise ValueError("Ce modèle clone une voix : choisissez ou enregistrez une voix de référence.")
            ref_text = (voice.get("ref_text") or "").strip() or None
            key = (path, os.path.getmtime(path), ref_text)
            if key not in self._prompts:
                self._prompts[key] = self.model.create_voice_clone_prompt(
                    ref_audio=path, ref_text=ref_text, x_vector_only_mode=ref_text is None)
            wavs, sr = self.model.generate_voice_clone(
                text=text, language=lang, voice_clone_prompt=self._prompts[key], **kw)
        self.sample_rate = int(sr)
        return to_mono_float32(wavs[0])
