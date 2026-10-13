# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Kokoro-82M (Apache-2.0): very fast, preset voices only (no cloning), several languages."""

from __future__ import annotations

import os
import shutil
import tempfile

import numpy as np

from . import Engine, pick_device, seed_everything

# Voice id prefix -> Kokoro phonemizer language code.
LANG_BY_PREFIX = {"a": "a", "b": "b", "e": "e", "f": "f", "h": "h", "i": "i", "p": "p", "j": "j", "z": "z"}


def _short_espeak_data() -> None:
    """eSpeak-ng truncates its data path at 160 characters and falls back to a path hardcoded in the
    library (which doesn't exist), so phonemization fails. Paths of an installed app (a venv under
    "Application Support"...) easily exceed that, so copy the data to a short path."""
    import espeakng_loader

    src = espeakng_loader.get_data_path()
    if len(src) <= 120:
        os.environ.setdefault("PHONEMIZER_ESPEAK_DATA_PATH", src)
        return
    dst = os.path.join(tempfile.gettempdir(), "cn-espeak-ng-data")
    if not os.path.isfile(os.path.join(dst, "phontab")):
        tmp = f"{dst}.{os.getpid()}"
        shutil.copytree(src, tmp)
        try:
            os.rename(tmp, dst)
        except OSError:  # another worker created it in the meantime
            shutil.rmtree(tmp, ignore_errors=True)
    os.environ["PHONEMIZER_ESPEAK_DATA_PATH"] = dst


class KokoroEngine(Engine):
    sample_rate = 24000
    max_chars = 500

    def load(self) -> None:
        import torch

        _short_espeak_data()
        import misaki.espeak  # noqa: F401  (sets the data path on import...)
        from phonemizer.backend.espeak.wrapper import EspeakWrapper

        EspeakWrapper.set_data_path(None)  # ...so let the environment variable take over again
        from kokoro import KModel

        self.repo = self.options.get("repo", "hexgrad/Kokoro-82M")
        self.device = pick_device(self.options.get("device") or ("cpu" if torch.backends.mps.is_available() else None))
        self.model = KModel(repo_id=self.repo).to(self.device).eval()
        self.pipelines: dict[str, object] = {}

    def _pipeline(self, lang: str):
        from kokoro import KPipeline

        if lang not in self.pipelines:
            self.pipelines[lang] = KPipeline(lang_code=lang, repo_id=self.repo, model=self.model)
        return self.pipelines[lang]

    def synth(self, text: str, voice: dict, ctx: dict) -> np.ndarray:
        voice_id = voice.get("id") or "af_heart"
        pipe = self._pipeline(LANG_BY_PREFIX.get(voice_id[0], "a"))
        seed_everything(ctx.get("seed"))
        speed = float(ctx.get("speed") or 1.0)
        parts = [a.detach().cpu().numpy() for _, _, a in pipe(text, voice=voice_id, speed=speed) if a is not None]
        return np.concatenate(parts).astype(np.float32) if parts else np.zeros(1, dtype=np.float32)
