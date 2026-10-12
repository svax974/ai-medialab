# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Bernini-R 1.3B (ByteDance, Apache-2.0): the renderer of Bernini alone, fine-tuned from Wan 2.1 1.3B.

Runs the authors' own `BerniniRendererPipeline` (their `bernini/` package, extracted by the pack installer into
`<pack>/src`) the way `infer_single_gpu.py` does. It has no planner: it follows the prompt and the attached media
directly. Task routing mirrors the authors' scripts:
    text only                -> t2v  (guidance_mode t2v_apg)
    source video             -> v2v  (v2v_apg)
    source video + reference -> rv2v (rv2v)
    reference image only     -> r2v  (r2v_apg)
"""

from __future__ import annotations

import os

from . import Engine, require_cuda
from common import Cancelled, local_snapshot, probe


class _Bar:
    """Stand-in for tqdm in `bernini.models.wan_diffusion`: the sampler calls `update(1)` once per denoising step."""

    engine: "BerniniEngine | None" = None

    def __init__(self, iterable=None, *args, **kwargs):
        self.iterable = iterable
        self.total = len(iterable) if hasattr(iterable, "__len__") else 0
        self.n = 0

    def __iter__(self):
        return iter(self.iterable if self.iterable is not None else ())

    def update(self, n: int = 1) -> None:
        engine = _Bar.engine
        self.n += n
        if engine is not None:
            engine.on_step(min(self.n, self.total or self.n), self.total or self.n)
            if engine.cancelled():
                raise Cancelled()

    def close(self) -> None:
        pass

    def set_description(self, *args, **kwargs) -> None:
        pass

    def set_postfix(self, *args, **kwargs) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class BerniniEngine(Engine):
    def load(self) -> None:
        import torch

        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
        device = torch.device(require_cuda())
        from bernini.models import wan_diffusion
        from bernini.pipeline import BerniniRendererPipeline

        wan_diffusion.tqdm = _Bar  # progress and cancellation come from the sampler's own progress bar
        _Bar.engine = self
        root = local_snapshot(self.options["sources"][0])
        # Same arguments as `bernini.cli.build_pipeline` for a diffusers-format directory.
        self.pipe = BerniniRendererPipeline.from_pretrained(
            root, high_noise_ckpt=None, low_noise_ckpt=None, device=device, load_ckpt_weights=False,
            use_unipc=True, shift=5.0, use_src_id_rotary_emb=True, interpolate_src_id=True, max_trained_src_id=5,
        )

    def generate(self, req: dict, output: str) -> dict:
        import torch
        from bernini.cli import DEFAULT_NEG_PROMPT
        from bernini.prompt_enhancer import get_system_prompt_for_task

        extra = req["extra"]
        video = extra.get("video")
        refs = list(req.get("references") or [])
        if video:
            task, mode = ("rv2v", "rv2v") if refs else ("v2v", "v2v_apg")
        elif refs:
            task, mode = "r2v", "r2v_apg"
        else:
            task, mode = "t2v", "t2v_apg"
        negative = (req.get("negative_prompt") or "").strip() or DEFAULT_NEG_PROMPT
        with torch.inference_mode():
            self.pipe(
                req["prompt"],
                neg_prompt=negative, num_frames=int(extra["frames"]), fps=int(extra.get("fps") or 16),
                max_image_size=max(int(req["width"]), int(req["height"])),  # a source video sets its own output size
                height=int(req["height"]), width=int(req["width"]),
                video=video or None, images=refs or None,
                num_inference_steps=int(req["steps"]), guidance_mode=mode,
                omega_vid=1.25, omega_img=4.5, omega_txt=4.0, omega_scale=0.8, flow_shift=5.0,
                seed=int(req["seed"]), eta=0.5, norm_threshold=(50.0, 50.0, 50.0), momentum=0,
                system_prompt=get_system_prompt_for_task(task), output_path=output,
            )
        torch.cuda.empty_cache()
        return probe(output)
