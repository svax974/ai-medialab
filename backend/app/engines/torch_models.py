# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Open models run by the PyTorch + diffusers engine (NVIDIA CUDA, AMD ROCm, Apple MPS).

Entries are pure data; see `diffusers_engine.py` for what `options` mean. Only ungated repos are
offered, so no Hugging Face account is needed.
"""

from __future__ import annotations

from .base import ModelSpec, ParamSpec

ENGINE = "app.engines.diffusers_engine:DiffusersEngine"

QWEN21_TORCH = ModelSpec(
    id="qwen-image-2.1-torch",
    name="Qwen Image 2.1",
    family="Qwen",
    description="Texte → image de haute qualité, très bon rendu du texte, sortie transparente (RGBA) possible. "
    "Édite aussi des images : jusqu'à 10 références (personnes, objets, décors) à combiner par instruction.",
    engine=ENGINE,
    backend="torch",
    default_quantize=None,  # MLX quantization doesn't apply to PyTorch
    quantize_options=[],
    reference_mode="multi",
    max_references=10,
    params=[
        ParamSpec("steps", "Étapes", "int", 40, 4, 80, 1, "Plus d'étapes = plus de détails, plus lent."),
        ParamSpec(
            "guidance", "Guidance (CFG réel)", "float", 1.0, 1.0, 10.0, 0.5,
            "1 = désactivé (recommandé). Au-delà, nécessite un prompt négatif et double le temps de calcul.",
            advanced=True,
        ),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
    ],
    size_multiple=16,
    max_side=2752,
    hf_repo="Qwen/Qwen-Image-2.1",
    hf_patterns=["model_index.json", "scheduler/*", "transformer/*", "text_encoder/*", "vae/*", "processor/*", "LICENSE"],
    check_files=["model_index.json", "scheduler/*.json", "transformer/*.safetensors", "text_encoder/*.safetensors",
                 "vae/*.safetensors"],
    download_size_gb=33.1,
    license="Qwen Research License (recherche, usage non commercial)",
    weights_gb=31.8,
    largest_component_gb=17.5,
    memory_hint="Poids bf16 de 32 Go. Carte 40 Go+ : tout sur le GPU ; 24 Go : composants chargés un à un "
    "(plus lent, 32 Go de RAM requis).",
    tags=["texte→image", "édition", "multi-références", "RGBA"],
    precision="bf16",
    options={"pipeline": "QwenImage21Pipeline", "guidance_arg": "true_cfg_scale", "image_arg": "image"},
)

Z_IMAGE_TURBO = ModelSpec(
    id="z-image-turbo",
    name="Z-Image Turbo",
    family="Tongyi",
    description="Génération très rapide (8 étapes) d'images photoréalistes, bon rendu du texte bilingue. "
    "Licence Apache 2.0 (usage commercial permis).",
    engine=ENGINE,
    backend="torch",
    default_quantize=None,  # MLX quantization doesn't apply to PyTorch
    quantize_options=[],
    reference_mode="none",
    params=[
        ParamSpec("steps", "Étapes", "int", 9, 4, 20, 1, "Le modèle est distillé pour ≈ 9 étapes."),
    ],
    size_multiple=16,
    max_side=2048,
    hf_repo="Tongyi-MAI/Z-Image-Turbo",
    hf_patterns=["model_index.json", "scheduler/*", "transformer/*", "text_encoder/*", "tokenizer/*", "vae/*"],
    check_files=["model_index.json", "transformer/*.safetensors", "text_encoder/*.safetensors", "vae/*.safetensors"],
    download_size_gb=32.9,
    license="Apache 2.0",
    weights_gb=20.5,
    largest_component_gb=12.3,
    memory_hint="Environ 21 Go une fois chargé en bf16 (le dépôt stocke les poids en fp32 : 33 Go à télécharger).",
    tags=["texte→image", "rapide", "Apache 2.0"],
    precision="bf16",
    options={"pipeline": "ZImagePipeline", "guidance_arg": "guidance_scale", "call_kwargs": {"guidance_scale": 0.0}},
)

SDXL = ModelSpec(
    id="sdxl-base",
    name="Stable Diffusion XL",
    family="Stability",
    description="Modèle classique et léger : tient sur une carte de 8 Go. Texte → image et image → image "
    "(une image de départ, influence réglable). Pas de rendu fiable du texte dans l'image.",
    engine=ENGINE,
    backend="torch",
    default_quantize=None,  # MLX quantization doesn't apply to PyTorch
    quantize_options=[],
    reference_mode="init",
    max_references=1,
    params=[
        ParamSpec("steps", "Étapes", "int", 30, 10, 60, 1),
        ParamSpec("guidance", "Guidance", "float", 6.0, 1.0, 14.0, 0.5, "Fidélité au prompt (5–8 conseillé)."),
        ParamSpec("strength", "Influence de l'image", "float", 0.6, 0.1, 0.95, 0.05,
                  "Part de l'image de départ transformée. Bas = proche de l'original.", requires_references=True),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
    ],
    size_multiple=64,  # the UNet halves 3 times on top of the /8 latent; any other multiple produces stripes
    min_side=512,
    max_side=1536,
    hf_repo="stabilityai/stable-diffusion-xl-base-1.0",
    hf_patterns=[
        "model_index.json", "scheduler/*", "tokenizer/*", "tokenizer_2/*",
        "text_encoder/config.json", "text_encoder/*.fp16.safetensors",
        "text_encoder_2/config.json", "text_encoder_2/*.fp16.safetensors",
        "unet/config.json", "unet/*.fp16.safetensors",
        "vae/config.json", "vae/*.fp16.safetensors",
    ],
    check_files=["model_index.json", "unet/*.fp16.safetensors", "text_encoder/*.fp16.safetensors",
                 "text_encoder_2/*.fp16.safetensors", "vae/*.fp16.safetensors"],
    download_size_gb=7.1,
    license="CreativeML Open RAIL++-M",
    weights_gb=7.0,
    largest_component_gb=5.1,
    memory_hint="≈ 8 Go de VRAM en fp16.",
    tags=["texte→image", "img2img", "léger"],
    precision="fp16",
    options={
        "pipeline": "StableDiffusionXLPipeline",
        "img2img": "StableDiffusionXLImg2ImgPipeline",
        "guidance_arg": "guidance_scale",
        "load_kwargs": {"variant": "fp16", "use_safetensors": True},
    },
)

SPECS = [QWEN21_TORCH, Z_IMAGE_TURBO, SDXL]
