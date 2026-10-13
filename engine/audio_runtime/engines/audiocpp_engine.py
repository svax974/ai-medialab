# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""audio.cpp (ggml, Apache-2.0) speech synthesis through its `audiocpp_cli`: Metal, CUDA, Vulkan or CPU, no PyTorch.

One CLI process per text chunk: the model is loaded for the call and freed right after, so nothing stays resident
between chunks and cancelling is a plain kill. (A persistent `audiocpp_server` would avoid the reload; see
`docs/components/audiocpp.md`.)

Options (from `engines/audiocpp_specs.py`):
  family     audio.cpp family name (`qwen3_tts`, `kokoro_tts`...)
  repo/file  GGUF file in the Hugging Face cache; `files` ({language: file}) when each language has its own model
             (Pocket TTS), the one matching the generation language is used
  mode       "preset" (builtin voice id) | "clone" (reference sample) | "design" (voice described in text)
  voice_embeddings  folder (next to the GGUF) holding `<voice>.safetensors` preset voices (Pocket TTS)
  task       audio.cpp task name when it is not `tts` (Chatterbox only exposes `clon`)
  request    request options the family understands; others are never sent (sliders of the UI share their names)
  language   "names" when the family wants `french` rather than `fr`
The binary and the backend come from the environment (`AUDIOCPP_BIN`, `AUDIOCPP_VARIANT`) set by the server.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from . import Engine
from common import read_audio, to_mono_float32

LANGUAGE_NAMES = {
    "zh": "chinese", "en": "english", "ja": "japanese", "ko": "korean", "de": "german", "fr": "french",
    "ru": "russian", "pt": "portuguese", "es": "spanish", "it": "italian",
}


def find_model(repo: str, filename: str) -> Path:
    """Path of a file already downloaded into the Hugging Face cache (the app downloads it before the first run)."""
    from huggingface_hub import constants

    snapshots = Path(constants.HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}" / "snapshots"
    for snap in sorted(snapshots.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        if (snap / filename).is_file():
            return snap / filename
    raise FileNotFoundError(f"Modèle introuvable dans le cache Hugging Face : {repo}/{filename}")


def build_command(binary: str, backend: str, o: dict, text: str, voice: dict, ctx: dict, out: str, threads: int) -> list[str]:
    """The `audiocpp_cli` command line for one chunk. Pure: no process is started here."""
    mode = o.get("mode", "preset")
    params = ctx.get("params") or {}
    cmd = [binary, "--task", o.get("task", "tts"), "--family", o["family"], "--model", o["model_path"], "--backend", backend,
           "--threads", str(threads), "--text", text, "--out", out]
    lang = (ctx.get("language") or "").split("-")[0].lower()
    if lang and lang != "auto":
        cmd += ["--language", LANGUAGE_NAMES.get(lang, lang) if o.get("language") == "names" else lang]
    request: dict[str, object] = {}
    if ctx.get("seed") is not None:
        request["seed"] = int(ctx["seed"])
    for name, value in params.items():  # UI sliders: only those the family declares are sent (see `request` below)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            request[name] = float(value)
    if ctx.get("speed") not in (None, 1, 1.0):
        request["speed"] = float(ctx["speed"])
    instruct = (ctx.get("instruct") or "").strip()
    if mode == "design":
        description = (voice.get("description") or instruct).strip()
        if not description:
            raise ValueError("Décrivez la voix à créer (âge, timbre, caractère…).")
        cmd += ["--instruct", description]
    elif mode == "clone":
        ref = voice.get("ref_audio")
        if voice.get("kind") != "clone" or not ref:
            raise ValueError("Ce modèle clone une voix : choisissez ou enregistrez une voix de référence.")
        cmd += ["--voice-ref", ref]
        if (voice.get("ref_text") or "").strip():
            cmd += ["--reference-text", voice["ref_text"].strip()]
    else:
        if voice.get("kind") == "clone" and voice.get("ref_audio") and o.get("clone"):
            cmd += ["--voice-ref", voice["ref_audio"]]
        elif voice.get("id") and o.get("voice_embeddings"):
            # audio.cpp resolves symlinks and would look for the voice next to the real file in the cache's
            # `blobs/`: hand it the path inside the snapshot instead.
            path = Path(o["model_path"]).parent / o["voice_embeddings"] / f"{voice['id']}.safetensors"
            cmd += ["--request-option", f"voice_embedding_path={path}"]
        elif voice.get("id"):
            cmd += ["--voice-id", voice["id"]]
        if instruct:
            cmd += ["--instruct", instruct]
    for key, value in request.items():
        if key in o.get("request", ()):
            cmd += ["--request-option", f"{key}={value}"]
    return cmd


class AudioCppEngine(Engine):
    sample_rate = 24000
    max_chars = 400

    def load(self) -> None:
        self.binary = os.environ.get("AUDIOCPP_BIN", "")
        self.backend = os.environ.get("AUDIOCPP_VARIANT", "cpu")
        if not self.binary or not Path(self.binary).is_file():
            raise RuntimeError("Le moteur audio.cpp n'est pas installé.")
        o = self.options
        files = o.get("files") or {"": o["file"]}
        self.model_paths = {lang: str(find_model(o["repo"], f)) for lang, f in files.items()}
        self.threads = max(2, (os.cpu_count() or 4) // 2) if self.backend == "cpu" else 4
        self.max_chars = int(o.get("max_chars", self.max_chars))

    def model_for(self, ctx: dict) -> str:
        """GGUF to use for this generation: the one of the requested language when the model has one per language."""
        lang = (ctx.get("language") or "").split("-")[0].lower()
        return self.model_paths.get(lang) or next(iter(self.model_paths.values()))

    def synth(self, text: str, voice: dict, ctx: dict) -> np.ndarray:
        with tempfile.TemporaryDirectory(prefix="audiocpp-") as tmp:
            out = str(Path(tmp) / "out.wav")
            cmd = build_command(self.binary, self.backend, {**self.options, "model_path": self.model_for(ctx)},
                                text, voice, ctx, out, self.threads)
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    encoding="utf-8", errors="replace", cwd=str(Path(self.binary).parent))
            tail: list[str] = []
            import threading

            def drain() -> None:
                for line in proc.stdout or []:
                    if line.strip():
                        tail.append(line.strip())
                        del tail[:-12]

            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            while proc.poll() is None:
                if self.cancelled():
                    proc.kill()
                    proc.wait()
                    return np.zeros(1, dtype=np.float32)
                time.sleep(0.1)
            reader.join(2)
            if proc.returncode != 0 or not Path(out).is_file():
                useful = [l for l in tail if not l.startswith("ggml_") and "metal" not in l.lower()] or tail
                raise RuntimeError(f"audio.cpp a échoué (code {proc.returncode}) : {' / '.join(useful[-3:])}")
            audio, sr = read_audio(out)
        self.sample_rate = int(sr)
        return to_mono_float32(audio)
