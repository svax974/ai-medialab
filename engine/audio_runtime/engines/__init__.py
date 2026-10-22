# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""TTS engines run inside the audio worker (one pack = one isolated Python environment)."""

from __future__ import annotations

import importlib


def create(engine: str, options: dict):
    module_name, class_name = engine.split(":")
    cls = getattr(importlib.import_module(f"engines.{module_name}"), class_name)
    return cls(options)


class Engine:
    """Engine contract: `load()` once, then `synth()` per text chunk.

    `voice`: {"kind": "preset"|"clone"|"design", "id", "ref_audio", "ref_text", "description"}
    `ctx`:   {"language", "instruct", "speed", "seed", "params"}
    Returns a mono float32 vector at `self.sample_rate`.
    """

    sample_rate = 24000
    max_chars = 400

    def __init__(self, options: dict):
        self.options = options

    def load(self) -> None:
        raise NotImplementedError

    def synth(self, text: str, voice: dict, ctx: dict) -> "np.ndarray":  # noqa: F821
        raise NotImplementedError

    def cancelled(self) -> bool:  # replaced by the worker
        return False


def pick_device(prefer: str | None = None) -> str:
    """cuda (NVIDIA / ROCm) > mps (Apple) > cpu."""
    import torch

    if prefer:
        return prefer
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def seed_everything(seed: int | None) -> None:
    if seed is None:
        return
    import random

    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed % (2**32))
    torch.manual_seed(seed)
