# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""PyTorch + diffusers engine: NVIDIA (CUDA), AMD (ROCm) and Apple (MPS).

One generic engine driven by `ModelSpec.options`:

    pipeline        diffusers pipeline class (e.g. "QwenImage21Pipeline")
    img2img         class used when a start image is given ("init" references), built with from_pipe
    guidance_arg    name of the pipeline's guidance argument ("true_cfg_scale", "guidance_scale"...)
    image_arg       argument that receives the reference images (default "image")
    image_is_list   pass references as a list (multi-image editing) or a single image
    load_kwargs     from_pretrained arguments (e.g. variant="fp16")
    call_kwargs     fixed arguments added to every call (e.g. max_sequence_length)

Arguments the pipeline doesn't accept are dropped (filtered by signature), so most models need no
new code.
"""

from __future__ import annotations

import gc
import inspect
from typing import Any

from PIL import Image, ImageOps

from .base import Engine, GenerationCancelled, GenerationRequest, Hooks


class DiffusersEngine(Engine):
    def load(self) -> None:
        import torch
        import diffusers

        from ..system import get_system, memory_plan

        system = get_system()
        self.device = _pick_device(torch)
        if self.device == "cpu":
            raise RuntimeError(
                "Aucun GPU exploitable par PyTorch (CUDA, ROCm ou Metal) : la génération sur CPU est "
                "impraticable pour ce modèle."
            )
        self.dtype = _pick_dtype(torch, self.device)
        o = self.spec.options
        cls = getattr(diffusers, o["pipeline"])
        load_kwargs = dict(o.get("load_kwargs", {}))
        plan = memory_plan(self.spec.weights_gb, self.spec.largest_component_gb, system, "torch")
        if not plan["fits"]:
            raise RuntimeError(f"Ce modèle ne tient pas sur cette machine. {plan['note']}")
        self.strategy = plan["strategy"]

        pipe = cls.from_pretrained(self.spec.hf_repo, torch_dtype=self.dtype, **load_kwargs)
        if self.strategy == "full":
            pipe.to(self.device)
        elif self.strategy == "model_offload":
            pipe.enable_model_cpu_offload()
        else:
            pipe.enable_sequential_cpu_offload()
        if hasattr(pipe, "set_progress_bar_config"):
            pipe.set_progress_bar_config(disable=True)
        self.pipe = pipe
        self.i2i = None  # img2img pipeline, created on demand
        self._tune_memory()

    def _tune_memory(self) -> None:
        # Tiled VAE decoding avoids the memory spike on large images.
        vae = getattr(self.pipe, "vae", None)
        if vae is not None and hasattr(vae, "enable_tiling"):
            try:
                vae.enable_tiling()
            except Exception:
                pass

    def generate(self, req: GenerationRequest, hooks: Hooks) -> Image.Image:
        import torch

        o = self.spec.options
        pipe = self.pipe
        refs = [_load(p) for p in req.references][: max(self.spec.max_references, 0)]
        use_i2i = bool(refs) and self.spec.reference_mode == "init"
        if use_i2i:
            pipe = self._img2img_pipe()

        # Keep the generator on CPU so the same seed gives the same result on every machine.
        generator = torch.Generator(device="cpu").manual_seed(req.seed)
        total = req.steps

        def on_step(_pipe, step, _timestep, cb_kwargs):
            hooks.on_step(step + 1, total)
            if hooks.is_cancelled():
                raise GenerationCancelled()
            return cb_kwargs

        kwargs: dict[str, Any] = dict(
            prompt=req.prompt,
            width=req.width,
            height=req.height,
            num_inference_steps=req.steps,
            generator=generator,
            callback_on_step_end=on_step,
            output_type="pil",
        )
        kwargs.update(o.get("call_kwargs", {}))
        guidance_arg = o.get("guidance_arg")
        if guidance_arg and req.guidance is not None:
            kwargs[guidance_arg] = req.guidance
        negative = (req.negative_prompt or "").strip()
        if negative:
            kwargs["negative_prompt"] = negative
        if refs:
            image_arg = o.get("image_arg", "image")
            if use_i2i:
                kwargs[image_arg] = refs[0]
                if req.strength is not None:
                    kwargs["strength"] = req.strength
                # img2img: output size follows the start image.
                kwargs["width"], kwargs["height"] = refs[0].size
            else:
                kwargs[image_arg] = refs if o.get("image_is_list", True) else refs[0]

        accepted = set(inspect.signature(pipe.__call__).parameters)
        if "kwargs" not in accepted:
            dropped = [k for k in kwargs if k not in accepted]
            kwargs = {k: v for k, v in kwargs.items() if k in accepted}
            if dropped:
                print(f"[diffusers] arguments ignored by {type(pipe).__name__}: {dropped}", flush=True)

        try:
            with torch.inference_mode():
                result = pipe(**kwargs)
        finally:
            gc.collect()
            self._empty_cache()
        return result.images[0]

    def _img2img_pipe(self):
        if self.i2i is None:
            import diffusers

            cls = getattr(diffusers, self.spec.options["img2img"])
            self.i2i = cls.from_pipe(self.pipe)
            if hasattr(self.i2i, "set_progress_bar_config"):
                self.i2i.set_progress_bar_config(disable=True)
        return self.i2i

    def _empty_cache(self) -> None:
        import torch

        if self.device == "cuda":
            torch.cuda.empty_cache()
        elif self.device == "mps":
            torch.mps.empty_cache()


def _load(path: str) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def _pick_device(torch) -> str:
    if torch.cuda.is_available():  # also true for ROCm builds (torch.version.hip)
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _pick_dtype(torch, device: str):
    if device == "cuda":
        # bf16 on Ampere+ / RDNA3+, fp16 on older cards.
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    return torch.bfloat16
