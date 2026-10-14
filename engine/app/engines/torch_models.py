# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Open models run by the PyTorch + diffusers engine (NVIDIA CUDA, AMD ROCm, Apple MPS).

Entries are pure data; see `diffusers_engine.py` for what `options` mean. Only ungated repos are
offered, so no Hugging Face account is needed.
"""

from __future__ import annotations

import copy

from .base import HfSource, ModelSpec, ParamSpec

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
        ParamSpec("steps", "Étapes", "int", 30, 10, 60, 1, "25 à 35 étapes suffisent en général."),
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
    download_size_gb=6.46,  # fp16 components, measured on the repo (6.94 GB)
    license="CreativeML Open RAIL++-M",
    weights_gb=6.46,
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

# SDXL derivatives. They reuse the SDXL code path (pipeline, img2img, size rules); the fine-tunes ship their own
# weights in the same diffusers layout, the LoRAs add a small file on top of the SDXL base above (shared download).

_DPM_KARRAS = {"class": "DPMSolverMultistepScheduler", "config": {"use_karras_sigmas": True}}  # "DPM++ 2M Karras"


def _sdxl_params(steps: int, guidance: float, negative: str = "", extra: list[ParamSpec] | None = None) -> list[ParamSpec]:
    params = copy.deepcopy(SDXL.params)
    params[0].default, params[1].default, params[3].default = steps, guidance, negative
    if steps < params[0].min:  # distilled ("turbo") models
        params[0].min, params[0].help = 4, f"Le modèle est distillé pour ≈ {steps} étapes."
    return [*params[:3], *(extra or []), params[3]]


def sdxl_finetune(*, id: str, name: str, repo: str, description: str, license: str, tags: list[str], steps: int,
                  guidance: float, negative: str = "", fp16: bool = True, scheduler: dict | None = None) -> ModelSpec:
    """A full SDXL fine-tune in diffusers format: only its fp16 component weights are downloaded (≈ 7 Go), never the
    single-file checkpoints next to them."""
    weights = "*.fp16.safetensors" if fp16 else "*.safetensors"
    spec = copy.deepcopy(SDXL)
    spec.id, spec.name, spec.family, spec.description, spec.license = id, name, "Stable Diffusion XL", description, license
    spec.hf_repo = repo
    spec.hf_patterns = [p for p in SDXL.hf_patterns if not p.endswith(".fp16.safetensors")] + \
        [f"{c}/{weights}" for c in ("text_encoder", "text_encoder_2", "unet", "vae")]
    spec.check_files = ["model_index.json"] + [f"{c}/{weights}" for c in ("unet", "text_encoder", "text_encoder_2", "vae")]
    spec.params = _sdxl_params(steps, guidance, negative)
    spec.tags = ["texte→image", "img2img", *tags]
    spec.options = {**SDXL.options, "load_kwargs": {"use_safetensors": True, **({"variant": "fp16"} if fp16 else {})}}
    if scheduler:
        spec.options["scheduler"] = scheduler
    return spec


LORA_SCALE_HELP = "Intensité du style apporté par la LoRA : 0 = SDXL seul, 1 = valeur prévue par son auteur."
PIXEL_PERFECT = ParamSpec("pixel_perfect", "Pixels nets", "bool", True, help=(
    "Réduit l'image 8 fois puis l'agrandit sans lissage : chaque « pixel » devient un carré net, comme du vrai pixel "
    "art. Décochez pour garder l'image brute du modèle."))


# IP-Adapter "plus face" for SDXL (h94/IP-Adapter, Apache 2.0): follows the face of an image. Its ViT-H image encoder
# lives in another folder of the same repo.
IP_ADAPTER_REPO = "h94/IP-Adapter"
IP_ADAPTER_FACE = {"repo": IP_ADAPTER_REPO, "subfolder": "sdxl_models",
                   "file": "ip-adapter-plus-face_sdxl_vit-h.safetensors", "encoder": "models/image_encoder"}
IP_ADAPTER_SOURCE = HfSource(
    IP_ADAPTER_REPO,
    ["sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors", "models/image_encoder/config.json",
     "models/image_encoder/model.safetensors"],
    ["sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors", "models/image_encoder/model.safetensors"],
    3.09,  # adapter 0.74 + encoder 2.35, measured on the repo
)
FACE_SCALE = ParamSpec("face_scale", "Ressemblance du visage", "float", 0.6, 0.0, 1.0, 0.05, (
    "Poids du visage de l'image 1 : plus haut, il ressemble davantage à la photo mais le style et le prompt comptent "
    "moins (0,5 à 0,7 conseillé)."))


def sdxl_lora(*, id: str, name: str, repo: str, file: str, size_gb: float, description: str, license: str,
              trigger: str = "", tags: list[str] | None = None, scale: float = 1.0, steps: int = 30,
              guidance: float = 6.0, negative: str = "", pixelate: int = 0, face: bool = False,
              custom: bool = False) -> ModelSpec:
    """SDXL base + one LoRA (`file` of `repo`). The trigger words are added in front of the prompt when missing;
    `pixelate` (factor) offers the "Pixels nets" post-processing; `face` adds the IP-Adapter that follows the face of
    the first image ("face" reference mode, the second image being an optional start image)."""
    spec = copy.deepcopy(SDXL)
    spec.id, spec.name, spec.family, spec.custom = id, name, "Stable Diffusion XL", custom
    spec.description, spec.license = description, license
    extra = [ParamSpec("lora_scale", "Force du style", "float", scale, 0.0, 1.5, 0.05, LORA_SCALE_HELP)]
    if face:
        extra.insert(0, FACE_SCALE)
    if pixelate:
        extra.append(PIXEL_PERFECT)
    spec.params = _sdxl_params(steps, guidance, negative, extra)
    spec.sources = [HfSource(SDXL.hf_repo, SDXL.hf_patterns, SDXL.check_files, SDXL.download_size_gb),
                    HfSource(repo, [file], [file], size_gb)]
    spec.download_size_gb = round((SDXL.download_size_gb or 0) + size_gb, 2)
    spec.weights_gb = round((SDXL.weights_gb or 0) + size_gb, 2)
    spec.memory_hint = f"SDXL (≈ 8 Go en fp16) et une LoRA de {size_gb * 1024:.0f} Mo ; SDXL est partagé avec les autres LoRA."
    spec.tags = ["texte→image", "img2img", "LoRA", *(tags or [])]
    spec.options = {**SDXL.options, "loras": [{"repo": repo, "file": file, "trigger": trigger}]}
    if pixelate:
        spec.options["pixelate"] = pixelate
    if face:
        spec.reference_mode, spec.max_references, spec.requires_references = "face", 2, True
        spec.options["ip_adapter"] = IP_ADAPTER_FACE
        spec.sources.append(IP_ADAPTER_SOURCE)
        spec.download_size_gb = round(spec.download_size_gb + IP_ADAPTER_SOURCE.size_gb, 2)
        spec.weights_gb = round(spec.weights_gb + IP_ADAPTER_SOURCE.size_gb, 2)
        spec.memory_hint += " L'IP-Adapter et son encodeur d'image ajoutent ≈ 3 Go."
    return spec


PIXEL_NEGATIVE = "3d render, realistic"

PIXEL_ART_XL = sdxl_lora(
    id="pixel-art-xl", name="Pixel Art XL", repo="nerijs/pixel-art-xl", file="pixel-art-xl.safetensors", size_gb=0.16,
    description="Pixel art (personnages, décors, objets de jeu) : la LoRA la plus utilisée pour SDXL. « Pixels nets » "
    "aligne le résultat sur une vraie grille de pixels.",
    license="CreativeML Open RAIL-M", trigger="pixel art", tags=["pixel art"], negative=PIXEL_NEGATIVE, pixelate=8,
)

PIXEL_ART_REDMOND = sdxl_lora(
    id="pixel-art-redmond", name="Pixel Art Redmond", repo="artificialguybr/PixelArtRedmond",
    file="PixelArtRedmond-Lite64.safetensors", size_gb=0.16,
    description="Pixel art plus détaillé et coloré, style illustration de jeu rétro. « Pixels nets » aligne le "
    "résultat sur une vraie grille de pixels.",
    license="CreativeML Open RAIL-M", trigger="Pixel Art, PixArFK", tags=["pixel art"], negative=PIXEL_NEGATIVE,
    pixelate=8,
)

PIXEL_ART_XL_FACE = sdxl_lora(
    id="pixel-art-xl-face", name="Pixel Art XL · Visage", repo="nerijs/pixel-art-xl", file="pixel-art-xl.safetensors",
    size_gb=0.16,
    description="Portrait en pixel art d'après une photo : l'image 1 donne le visage à suivre (IP-Adapter), l'image 2, "
    "facultative, sert d'image de départ (cadre, composition). Ressemblance non garantie, surtout en très petite "
    "résolution.",
    license="CreativeML Open RAIL-M (LoRA), Apache 2.0 (IP-Adapter)", trigger="pixel art", tags=["pixel art", "visage"],
    negative=PIXEL_NEGATIVE, pixelate=8, face=True,
)

REALVIS_XL = sdxl_finetune(
    id="realvis-xl-5", name="RealVisXL V5", repo="SG161222/RealVisXL_V5.0",
    description="Photoréalisme (portraits, peau, lumière naturelle) : l'un des modèles SDXL les plus téléchargés.",
    license="CreativeML Open RAIL++-M", tags=["photo"], steps=30, guidance=5.0, scheduler=_DPM_KARRAS,
    negative="(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth",
)

JUGGERNAUT_XL = sdxl_finetune(
    id="juggernaut-xl-9", name="Juggernaut XL v9", repo="RunDiffusion/Juggernaut-XL-v9",
    description="Polyvalent à dominante photo (personnes, produits, paysages), très réputé. Ses auteurs conseillent de "
    "commencer sans prompt négatif.",
    license="CreativeML Open RAIL-M", tags=["photo"], steps=35, guidance=5.0, scheduler=_DPM_KARRAS,
)

DREAMSHAPER_XL_TURBO = sdxl_finetune(
    id="dreamshaper-xl-turbo", name="DreamShaper XL Turbo", repo="Lykon/dreamshaper-xl-v2-turbo",
    description="Illustration, fantasy et rendu « artistique », en 6 étapes seulement : rapide même sur une petite carte.",
    license="CreativeML Open RAIL++-M", tags=["illustration", "rapide"], steps=6, guidance=2.0,
    scheduler={"class": "DPMSolverMultistepScheduler", "config": {}},
)

ANIMAGINE_XL = sdxl_finetune(
    id="animagine-xl-4", name="Animagine XL 4.0", repo="cagliostrolab/animagine-xl-4.0",
    description="Anime et manga. Se pilote avec des étiquettes (« 1girl, solo, smile, masterpiece, high score »…) "
    "plutôt qu'avec des phrases.",
    license="CreativeML Open RAIL++-M", tags=["anime"], steps=28, guidance=5.0, fp16=False,
    scheduler={"class": "EulerAncestralDiscreteScheduler", "config": {}},
    negative="lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, "
    "worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry",
)

SPECS = [QWEN21_TORCH, Z_IMAGE_TURBO, SDXL, PIXEL_ART_XL, PIXEL_ART_XL_FACE, PIXEL_ART_REDMOND, REALVIS_XL, JUGGERNAUT_XL,
         DREAMSHAPER_XL_TURBO, ANIMAGINE_XL]
