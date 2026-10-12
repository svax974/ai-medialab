"""Qwen Image 2.1 (Qwen/Qwen-Image-2.1) via mflux : texte → image, et img2img avec une image de départ."""

from __future__ import annotations

import dataclasses

from .base import HfSource, ModelSpec, ParamSpec, Variant
from .mflux_common import MfluxEngine

# Poids déjà quantifiés (format mflux) : on ne télécharge jamais les 33 Go de la version bf16.
_CHECK = ["transformer/*.safetensors", "text_encoder/*.safetensors", "vae/*.safetensors", "processor/tokenizer.json"]
Q4_REPO = "mlx-community/Qwen-Image-2.1-mflux-q4"
Q8_REPO = "JoyFusionAI/Qwen-Image-2.1-MLX-8bit"
_Q4 = Variant("q4", "4 bits", 9.6, [HfSource(Q4_REPO, None, _CHECK, 9.6)], {"model_path": Q4_REPO},
              weights_gb=9.6, largest_component_gb=4.3)
_Q8 = Variant("q8", "8 bits", 24.0, [HfSource(Q8_REPO, None, _CHECK, 24.0)], {"model_path": Q8_REPO},
              weights_gb=24.0, largest_component_gb=15.1)

SPEC = ModelSpec(
    id="qwen-image-2.1",
    name="Qwen Image 2.1",
    family="Qwen",
    description="Texte → image de haute qualité, excellent rendu du texte dans l'image ; rapide sur Mac. "
    "Une image jointe sert seulement de point de départ (img2img) : pour éditer avec une ou plusieurs "
    "références, utilisez la version GGUF.",
    engine="app.engines.qwen21:Qwen21Engine",
    backend="mlx",
    reference_mode="init",
    max_references=1,
    params=[
        ParamSpec("steps", "Étapes", "int", 40, 4, 80, 1, "Plus d'étapes = plus de détails, plus lent."),
        ParamSpec(
            "strength", "Influence de l'image", "float", 0.4, 0.05, 0.95, 0.05,
            "Part de l'image de départ conservée (img2img). Haut = proche de l'original.",
            requires_references=True,
        ),
        ParamSpec(
            "guidance", "Guidance", "float", 1.0, 1.0, 10.0, 0.5,
            "Actif seulement avec un prompt négatif (CFG réel). 1 = désactivé (recommandé).",
            advanced=True,
        ),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
    ],
    size_multiple=16,
    max_side=2048,
    default_quantize=None,  # poids déjà quantifiés : rien à quantifier au chargement
    quantize_options=[],
    sources=_Q4.sources,
    variants=[_Q4, _Q8],
    default_variant="q4",
    download_size_gb=9.6,
    license="Qwen Research License (recherche, usage non commercial)",
    weights_gb=9.6,
    largest_component_gb=4.3,
    memory_hint="Poids quantifiés (transformeur et encodeur de texte) : ≈ 10 Go en 4 bits.",
    options={"model_path": Q4_REPO},
    tags=["texte→image", "img2img", "Metal natif"],
)


class Qwen21Engine(MfluxEngine):
    def build_model(self):
        """Construit le modèle SANS l'encodeur de texte (17 Go en bf16).

        Charger les trois composants d'un coup demande ≈ 31 Go au pic, ce qui fait swapper une machine de
        36 Go. Ici le transformeur est quantifié dès son chargement, et l'encodeur n'est chargé que le temps
        d'encoder le prompt (voir `reload_encoders`) : les deux ne cohabitent jamais en pleine précision.
        """
        from mlx import nn

        from mflux.models.common.config import ModelConfig
        from mflux.models.common.weights.loading.weight_applier import WeightApplier
        from mflux.models.common.weights.loading.weight_loader import WeightLoader
        from mflux.models.qwen21.latent_creator.qwen21_latent_creator import Qwen21LatentCreator
        from mflux.models.qwen21.model.qwen21_transformer.qwen21_transformer import Qwen21Transformer
        from mflux.models.qwen21.model.qwen21_vae.qwen21_vae import Qwen21VAE
        from mflux.models.qwen21.qwen21_initializer import Qwen21Initializer
        from mflux.models.qwen21.variants.txt2img.qwen_image_21 import QwenImage21
        from mflux.models.qwen21.weights.qwen21_weight_definition import Qwen21WeightDefinition

        class WithoutTextEncoder(Qwen21WeightDefinition):
            @staticmethod
            def get_components():
                return [c for c in Qwen21WeightDefinition.get_components() if c.name != "text_encoder"]

            @staticmethod
            def get_download_patterns():
                return ["vae/*.safetensors", "vae/*.json", "transformer/*.safetensors", "transformer/*.json"]

        self.latent_creator = Qwen21LatentCreator
        config = ModelConfig.qwen_image_21()
        self.model_path = self.spec.options.get("model_path") or config.model_name
        model = QwenImage21.__new__(QwenImage21)
        nn.Module.__init__(model)
        Qwen21Initializer._init_config(model, config)
        weights = WeightLoader.load(weight_definition=WithoutTextEncoder, model_path=self.model_path)
        Qwen21Initializer._init_tokenizers(model, self.model_path)
        model.vae = Qwen21VAE()
        model.transformer = Qwen21Transformer()
        model.text_encoder = None
        model.bits = WeightApplier.apply_and_quantize(
            weights=weights,
            quantize_arg=self.quantize,
            weight_definition=WithoutTextEncoder,
            models={"vae": model.vae, "transformer": model.transformer},
        )
        del weights
        return model

    def needs_encoders(self, req) -> bool:
        cache = self.model.prompt_cache
        negative = (req.negative_prompt or "").strip()
        needs_negative = (req.guidance or 1.0) > 1.0 and bool(negative)
        return req.prompt not in cache or (needs_negative and negative not in cache)

    def reload_encoders(self) -> bool:
        """Recharge seulement l'encodeur de texte (17 Go) sans toucher au transformeur quantifié."""
        from mflux.models.common.weights.loading.weight_applier import WeightApplier
        from mflux.models.common.weights.loading.weight_loader import WeightLoader
        from mflux.models.qwen21.model.qwen21_text_encoder.qwen21_text_encoder import Qwen21TextEncoder
        from mflux.models.qwen21.weights.qwen21_weight_definition import Qwen21WeightDefinition

        class TextEncoderOnly(Qwen21WeightDefinition):
            @staticmethod
            def get_components():
                # mflux n'applique jamais de quantification à l'encodeur (« dégradation sémantique »), mais certains
                # dépôts déjà quantifiés (4 bits) l'ont quantifié : il faut alors le structurer comme tel. Pour un
                # encodeur bf16, rien n'est quantifié (aucun niveau enregistré dans ses fichiers).
                return [dataclasses.replace(c, skip_quantization=False)
                        for c in Qwen21WeightDefinition.get_components() if c.name == "text_encoder"]

            @staticmethod
            def get_download_patterns():
                return ["text_encoder/*.safetensors", "text_encoder/*.json"]

        weights = WeightLoader.load(weight_definition=TextEncoderOnly, model_path=self.model_path)
        encoder = Qwen21TextEncoder()
        WeightApplier.apply_and_quantize(
            weights=weights, models={"text_encoder": encoder}, quantize_arg=None, weight_definition=TextEncoderOnly
        )
        self.model.text_encoder = encoder
        return True

    def run(self, req, hooks):
        init = req.references[0] if req.references else None
        negative = (req.negative_prompt or "").strip() or None
        return self.model.generate_image(
            seed=req.seed,
            prompt=req.prompt,
            num_inference_steps=req.steps,
            width=req.width,
            height=req.height,
            guidance=req.guidance if req.guidance is not None else 1.0,
            image_path=init,
            image_strength=req.strength if init else None,
            negative_prompt=negative,
        )
