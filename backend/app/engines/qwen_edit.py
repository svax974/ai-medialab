# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Qwen Image Edit 2509 via mflux: instruction-based editing with 1 to 3 reference images."""

from __future__ import annotations

from .base import ModelSpec, ParamSpec
from .mflux_common import MfluxEngine

SPEC = ModelSpec(
    id="qwen-image-edit",
    name="Qwen Image Edit",
    family="Qwen",
    description="Édition d'images par instruction (« mets-lui un chapeau ») et composition de "
    "plusieurs images de référence (personnes, objets, décors).",
    engine="app.engines.qwen_edit:QwenEditEngine",
    backend="mlx",
    reference_mode="multi",
    max_references=3,
    requires_references=True,
    text_to_image=False,
    params=[
        ParamSpec("steps", "Étapes", "int", 20, 4, 60, 1, "Plus d'étapes = plus de détails, plus lent."),
        ParamSpec("guidance", "Guidance", "float", 2.5, 1.0, 10.0, 0.5, "Fidélité à l'instruction.", advanced=True),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
    ],
    size_multiple=16,
    max_side=2048,
    default_quantize=4,
    hf_repo="Qwen/Qwen-Image-Edit-2509",
    hf_patterns=["transformer/*", "text_encoder/*", "vae/*", "tokenizer/*", "processor/*", "scheduler/*"],
    check_files=["transformer/*.safetensors", "text_encoder/*.safetensors", "vae/*.safetensors"],
    download_size_gb=58,
    license="Apache 2.0",
    weights_gb=57,
    largest_component_gb=40,
    memory_hint="Modèle 20B : quantification 4 bits recommandée avec 36 Go de mémoire.",
    tags=["édition", "multi-images", "Metal natif"],
)


class QwenEditEngine(MfluxEngine):
    encoder_attrs = ("qwen_vl_encoder", "text_encoder")

    @property
    def low_memory(self) -> bool:
        # The vision-language encoder can't be reloaded on its own, so keep it in memory.
        return False

    def build_model(self):
        from mflux.models.qwen.latent_creator.qwen_latent_creator import QwenLatentCreator
        from mflux.models.qwen.variants.edit.qwen_image_edit import QwenImageEdit

        self.latent_creator = QwenLatentCreator
        return QwenImageEdit(quantize=self.quantize)

    def run(self, req, hooks):
        return self.model.generate_image(
            seed=req.seed,
            prompt=req.prompt,
            image_paths=list(req.references),
            num_inference_steps=req.steps,
            width=req.width,
            height=req.height,
            guidance=req.guidance if req.guidance is not None else 2.5,
            image_path=req.references[0],
            negative_prompt=(req.negative_prompt or "").strip() or None,
        )
