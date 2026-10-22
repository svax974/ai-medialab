# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Qwen Image Edit 2509 via mflux: instruction-based editing with 1 to 3 reference images.

Quantization is produced once and kept, never redone at load: picking a "q4"/"q6"/"q8" variant downloads
the official bf16 repo (needed once), then a local one-shot pass (`produce_quantized`, run by
`quantize_worker.py`) quantizes BOTH the transformer and the text/vision encoder (mflux's own policy
quantizes only the transformer; overridden here via `_encoder_quantized_definition()`, see `qwen21.py` for
the same trick) and saves the result under `DERIVED_DIR`. The bf16 source can then be freed (`downloads.free_bf16`)
without losing anything: `QwenEditEngine` reloads the saved checkpoint as already-quantized."""

from __future__ import annotations

import dataclasses

from ..config import DERIVED_DIR
from .base import HfSource, ModelSpec, ParamSpec, Variant
from .mflux_common import MfluxEngine

_BF16_PATTERNS = ["transformer/*", "text_encoder/*", "vae/*", "tokenizer/*", "processor/*", "scheduler/*"]
_BF16_CHECK = ["transformer/*.safetensors", "text_encoder/*.safetensors", "vae/*.safetensors"]
_BF16_REPO = "Qwen/Qwen-Image-Edit-2509"
_BF16 = HfSource(_BF16_REPO, _BF16_PATTERNS, _BF16_CHECK, 58)
_CHECK_DERIVED = ["transformer/*.safetensors", "transformer/model.safetensors.index.json",
                  "text_encoder/*.safetensors", "text_encoder/model.safetensors.index.json", "vae/*.safetensors"]


def _derived(key: str, label: str, bits: int, size_gb: float, largest_gb: float) -> Variant:
    """A quantization level produced once by `produce_quantized` and saved under `DERIVED_DIR`.

    Sizes are rough estimates until the first real production run, then hardcoded from what was
    actually written (same convention as the pre-quantized repos `qwen21.py` uses)."""
    local_dir = f"qwen-image-edit/{key}"
    return Variant(key, label, size_gb,
                   sources=[_BF16, HfSource(_BF16_REPO, kind="derived", local_dir=local_dir,
                                            check_files=_CHECK_DERIVED, size_gb=size_gb)],
                   options={"model_path": str(DERIVED_DIR / local_dir), "quantized_encoder": True,
                            "produce_quantize": bits, "local_dir": local_dir,
                            "quantize_entry": "app.engines.qwen_edit:produce_quantized"},
                   weights_gb=size_gb, largest_component_gb=largest_gb)


_Q4 = _derived("q4", "4 bits", 4, 16.0, 11.3)
_Q6 = _derived("q6", "6 bits", 6, 23.0, 16.3)
_Q8 = _derived("q8", "8 bits", 8, 30.0, 21.3)
_BF16_FULL = Variant("bf16", "bf16", 58.0, sources=[_BF16],
                     options={"model_path": _BF16_REPO, "quantized_encoder": False},
                     weights_gb=57, largest_component_gb=40)

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
    quantize_options=[],  # quantization happens once, at production time (see the variants below), never at load
    default_quantize=None,
    sources=_Q4.sources,
    variants=[_Q4, _Q6, _Q8, _BF16_FULL],
    default_variant="q4",
    download_size_gb=_Q4.size_gb,
    license="Apache 2.0",
    weights_gb=_Q4.weights_gb,
    largest_component_gb=_Q4.largest_component_gb,
    memory_hint="Modèle 20B : une première quantification télécharge temporairement le modèle complet (~58 Go), "
    "supprimable ensuite (seule la version quantifiée choisie est alors conservée).",
    options={**_Q4.options},
    tags=["édition", "multi-images", "Metal natif"],
)


def _build_edit(model_path, quantize_arg, weight_definition):
    """Build a `QwenImageEdit` the way `QwenImageInitializer.init_edit` does, but with a chosen
    `weight_definition` instead of mflux's hardcoded one (needed to also quantize the text encoder —
    mflux's own `QwenWeightDefinition` marks it `skip_quantization=True`). No LoRA support, same as
    the plain build this replaces and as `qwen21.py`'s own manual build."""
    from mlx import nn

    from mflux.models.common.config import ModelConfig
    from mflux.models.common.weights.loading.weight_applier import WeightApplier
    from mflux.models.common.weights.loading.weight_loader import WeightLoader
    from mflux.models.qwen.model.qwen_text_encoder.qwen_text_encoder import QwenTextEncoder
    from mflux.models.qwen.model.qwen_text_encoder.qwen_vision_language_encoder import QwenVisionLanguageEncoder
    from mflux.models.qwen.model.qwen_text_encoder.qwen_vision_transformer import VisionTransformer
    from mflux.models.qwen.model.qwen_transformer.qwen_transformer import QwenTransformer
    from mflux.models.qwen.model.qwen_vae.qwen_vae import QwenVAE
    from mflux.models.qwen.qwen_initializer import QwenImageInitializer
    from mflux.models.qwen.tokenizer.qwen_vision_language_processor import QwenVisionLanguageProcessor
    from mflux.models.qwen.tokenizer.qwen_vision_language_tokenizer import QwenVisionLanguageTokenizer
    from mflux.models.qwen.variants.edit.qwen_image_edit import QwenImageEdit

    config = ModelConfig.qwen_image_edit()
    path = model_path or config.model_name
    model = QwenImageEdit.__new__(QwenImageEdit)
    nn.Module.__init__(model)
    QwenImageInitializer._init_config(model, config)
    weights = WeightLoader.load(weight_definition=weight_definition, model_path=path)
    QwenImageInitializer._init_tokenizers(model, path)
    model.vae = QwenVAE()
    model.transformer = QwenTransformer()
    model.text_encoder = QwenTextEncoder()
    model.text_encoder.encoder.visual = VisionTransformer()
    model.bits = WeightApplier.apply_and_quantize(
        weights=weights, quantize_arg=quantize_arg, weight_definition=weight_definition,
        models={"vae": model.vae, "transformer": model.transformer, "text_encoder": model.text_encoder},
    )
    raw_tokenizer = model.tokenizers["qwen"].tokenizer
    processor = QwenVisionLanguageProcessor(tokenizer=raw_tokenizer)
    model.tokenizers["qwen_vl"] = QwenVisionLanguageTokenizer(processor=processor, max_length=1024,
                                                              use_picture_prefix=False)
    model.qwen_vl_encoder = QwenVisionLanguageEncoder(encoder=model.text_encoder.encoder)
    return model


def _encoder_quantized_definition():
    from mflux.models.qwen.weights.qwen_weight_definition import QwenWeightDefinition

    class _EncoderQuantized(QwenWeightDefinition):
        @staticmethod
        def get_components():
            return [dataclasses.replace(c, skip_quantization=False) if c.name == "text_encoder" else c
                    for c in QwenWeightDefinition.get_components()]

    return _EncoderQuantized


def produce_quantized(bits: int, dest) -> None:
    """Build Qwen Image Edit from its official bf16 repo (already cached locally — see the `_BF16` source) and
    save a `bits`-quantized checkpoint (transformer AND text/vision encoder) under `dest`. Run once, out of
    process, by `quantize_worker.py`; `QwenEditEngine.build_model()` then reloads the result as already
    quantized and never repeats this step."""
    from mflux.models.common.weights.saving.model_saver import ModelSaver

    weight_definition = _encoder_quantized_definition()
    model = _build_edit(model_path=None, quantize_arg=bits, weight_definition=weight_definition)
    ModelSaver.save_model(model=model, bits=model.bits, base_path=str(dest), weight_definition=weight_definition)


class QwenEditEngine(MfluxEngine):
    encoder_attrs = ("qwen_vl_encoder", "text_encoder")

    @property
    def low_memory(self) -> bool:
        # The vision-language encoder can't be reloaded on its own, so keep it in memory.
        return False

    def build_model(self):
        from mflux.models.qwen.latent_creator.qwen_latent_creator import QwenLatentCreator

        self.latent_creator = QwenLatentCreator
        model_path = self.spec.options.get("model_path")
        if self.spec.options.get("quantized_encoder"):
            # Already quantized on disk (both components): `quantize_arg=None` makes mflux read the stored
            # quantization metadata instead of requantizing.
            return _build_edit(model_path=model_path, quantize_arg=None, weight_definition=_encoder_quantized_definition())
        from mflux.models.qwen.variants.edit.qwen_image_edit import QwenImageEdit

        return QwenImageEdit(quantize=self.quantize, model_path=model_path)

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
