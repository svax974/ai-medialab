# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video engines run inside the video worker (one pack = one isolated Python environment)."""

from __future__ import annotations

import importlib


def create(engine: str, options: dict):
    module_name, class_name = engine.split(":")
    cls = getattr(importlib.import_module(f"engines.{module_name}"), class_name)
    return cls(options)


class Engine:
    """Engine contract: `load()` once, then `generate()` per clip.

    `generate(req, output)` gets the request dict built by the server (prompt, width, height, steps, seed, guidance,
    negative_prompt, references, extra={task, frames, fps, video}), writes the MP4 at `output` and returns its
    description {width, height, fps, frames, has_audio, duration}. It reports progress through `self.on_step` and
    stops by raising `common.Cancelled` when `self.cancelled()` becomes true (both are replaced by the worker).
    """

    def __init__(self, options: dict):
        self.options = options

    def load(self) -> None:
        raise NotImplementedError

    def generate(self, req: dict, output: str) -> dict:
        raise NotImplementedError

    def cancelled(self) -> bool:
        return False

    def on_step(self, step: int, total: int) -> None:
        pass


def require_cuda() -> str:
    """Both packs target NVIDIA (or AMD through ROCm): fail early and clearly anywhere else."""
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("Aucune carte graphique CUDA (NVIDIA) ou ROCm (AMD) utilisable : ce modèle ne tourne pas "
                           "sur Mac ni sur processeur.")
    torch.cuda.set_device(0)
    return "cuda:0"
