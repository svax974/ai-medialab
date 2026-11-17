# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Shap-E's Diffusers pipeline and its mesh-to-GLB export."""
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from .base import Engine, GenerationCancelled, GenerationRequest, Hooks


class ShapEEngine(Engine):
    def load(self) -> None:
        import torch
        from diffusers import ShapEImg2ImgPipeline, ShapEPipeline
        from .diffusers_engine import _pick_device

        self.device = _pick_device(torch)
        if self.device == "cpu":
            raise RuntimeError("Shap-E demande un GPU exploitable par PyTorch.")
        cls = ShapEImg2ImgPipeline if self.spec.options["image"] else ShapEPipeline
        dtype = torch.float32 if self.device == "mps" else torch.float16
        self.pipe = cls.from_pretrained(self.spec.hf_repo, torch_dtype=dtype, variant="fp16", local_files_only=True).to(self.device)
        self.pipe.set_progress_bar_config(disable=True)

    def generate(self, req: GenerationRequest, hooks: Hooks) -> Any:
        import torch
        from PIL import Image

        if hooks.is_cancelled():
            raise GenerationCancelled()
        condition = Image.open(req.references[0]).convert("RGB") if self.spec.options["image"] else req.prompt
        hooks.on_phase("sampling")
        result = self.pipe(condition, guidance_scale=req.guidance, num_inference_steps=req.steps, frame_size=256,
                           generator=torch.Generator(device="cpu").manual_seed(req.seed), output_type="mesh").images[0]
        if hooks.is_cancelled():
            raise GenerationCancelled()
        hooks.on_phase("encode")
        return result

    def save(self, result: Any, path: Path) -> None:
        import trimesh
        from diffusers.utils import export_to_ply

        with TemporaryDirectory() as tmp:
            ply = Path(tmp) / "mesh.ply"
            export_to_ply(result, str(ply))
            trimesh.load(str(ply)).export(str(path), file_type="glb")
