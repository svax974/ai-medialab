# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Kiwi-Edit (ShowLab, NUS): video editing by instruction, with an optional reference image.

The weights repo is self-contained: it ships the pipeline code (`pipeline_kiwi_edit.py`, `mllm_encoder.py`,
`wan_video_vae.py`) that diffusers loads with `trust_remote_code`, exactly like the authors' `diffusers_demo.py`.
This engine follows that demo: bfloat16 everything on one CUDA device, one forward pass per step (the pipeline has
classifier-free guidance commented out, so there is no guidance scale and no negative prompt).
"""

from __future__ import annotations

import os

from . import Engine, require_cuda
from common import Cancelled, fit, local_snapshot, read_frames_at, write_mp4


class KiwiEngine(Engine):
    def load(self) -> None:
        import torch
        from diffusers import DiffusionPipeline

        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
        self.device = require_cuda()
        root = local_snapshot(self.options["sources"][0])
        pipe = DiffusionPipeline.from_pretrained(root, trust_remote_code=True)
        pipe.to(self.device, dtype=torch.bfloat16)
        pipe.mllm_encoder._ensure_qwen_loaded()  # the Qwen2.5-VL part loads lazily: do it now so "ready" is honest
        self.pipe = pipe

    def _bar(self):
        """`progress_bar` argument of the pipeline: reports each denoising step and honours cancellation."""
        def bar(iterable):
            steps = list(iterable)
            for i, item in enumerate(steps):
                if self.cancelled():
                    raise Cancelled()
                yield item
                self.on_step(i + 1, len(steps))
        return bar

    def generate(self, req: dict, output: str) -> dict:
        from PIL import Image, ImageOps
        import torch

        extra = req["extra"]
        width, height, fps = int(req["width"]), int(req["height"]), int(extra.get("fps") or 15)
        if not extra.get("video"):
            raise ValueError("Kiwi-Edit a besoin d'une vidéo source.")
        frames = read_frames_at(extra["video"], fps, int(extra["frames"]), (width, height))
        frames = frames[: (len(frames) - 1) // 4 * 4 + 1]  # a shorter source still has to be 4n + 1 frames
        refs = [fit(ImageOps.exif_transpose(Image.open(p)), width, height) for p in req.get("references") or []][:1]
        with torch.inference_mode():
            video = self.pipe(
                prompt=req["prompt"], source_video=frames, ref_image=refs or None, height=height, width=width,
                num_frames=len(frames), num_inference_steps=int(req["steps"]), guidance_scale=1.0,
                seed=int(req["seed"]), tiled=True, progress_bar=self._bar(),
            )
        torch.cuda.empty_cache()
        return write_mp4(video, fps, output)
