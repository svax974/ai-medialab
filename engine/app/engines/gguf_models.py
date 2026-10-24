# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Quantized GGUF models run by stable-diffusion.cpp (Metal, CUDA, ROCm, Vulkan).

Small: 5 to 11 GB instead of 20 to 33 GB at full precision, so 8 to 12 GB cards are enough. Each
model is assembled from files in several repos (diffusion, text encoder, VAE). These image models use
ungated repos only; the one exception in the app is LTX-2.5 (`video_gguf.py`, `gated=True`).
"""

from __future__ import annotations

from .base import HfSource, ModelSpec, ParamSpec, Variant

ENGINE = "app.engines.sdcpp_engine:SdcppEngine"

Z_GGUF = ("leejet/Z-Image-Turbo-GGUF", "z_image_turbo-Q4_K.gguf")
Z_LLM = ("unsloth/Qwen3-4B-Instruct-2507-GGUF", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf")
Z_VAE = ("Comfy-Org/z_image_turbo", "split_files/vae/ae.safetensors")


def src(repo_file: tuple[str, str], size_gb: float, *more: str) -> HfSource:
    files = [repo_file[1], *more]
    return HfSource(repo_file[0], files, list(files), size_gb)


Z_IMAGE_GGUF = ModelSpec(
    id="z-image-turbo-gguf",
    name="Z-Image Turbo",
    family="Tongyi",
    description="Texte → image très rapide (8 étapes), photoréalisme et texte bilingue. Version quantifiée : "
    "7 Go au lieu de 33 Go, tient sur une carte de 6 à 8 Go. Licence Apache 2.0.",
    engine=ENGINE,
    backend="sdcpp",
    reference_mode="none",
    params=[
        ParamSpec("steps", "Étapes", "int", 8, 4, 20, 1, "Le modèle est distillé pour 8 étapes."),
        ParamSpec("guidance", "Guidance (CFG)", "float", 1.0, 1.0, 8.0, 0.5,
                  "1 = désactivé (recommandé pour ce modèle distillé).", advanced=True),
    ],
    size_multiple=16,
    min_side=256,
    max_side=2048,
    default_quantize=None,
    quantize_options=[],
    sources=[src(Z_GGUF, 3.86), src(Z_LLM, 2.5), src(Z_VAE, 0.34)],
    download_size_gb=6.7,
    license="Apache 2.0",
    weights_gb=6.7,
    largest_component_gb=3.9,
    memory_hint="≈ 7 Go de poids (Q4_K). Les poids sont placés automatiquement sur le GPU, sinon en RAM.",
    tags=["texte→image", "rapide", "GGUF", "Apache 2.0"],
    options={
        "files": {"diffusion-model": Z_GGUF, "llm": Z_LLM, "vae": Z_VAE},
        "cli_args": ["--sampling-method", "euler"],
        "fa_variants": ["metal", "cuda", "rocm"],
        "guidance_arg": "--cfg-scale",
    },
)

Q_GGUF = ("leejet/Qwen-Image-2.1-GGUF", "qwen_image_2.1-Q4_K.gguf")
Q_LLM = ("Qwen/Qwen3-VL-8B-Instruct-GGUF", "Qwen3VL-8B-Instruct-Q4_K_M.gguf")
Q_VISION = ("Qwen/Qwen3-VL-8B-Instruct-GGUF", "mmproj-Qwen3VL-8B-Instruct-F16.gguf")
Q_VAE = ("Comfy-Org/Qwen-Image-2.1", "vae/qwen_image_2.1_vae_bf16.safetensors")

QWEN21_GGUF = ModelSpec(
    id="qwen-image-2.1-gguf",
    name="Qwen Image 2.1",
    family="Qwen",
    description="Texte → image de haute qualité, très bon rendu du texte, et édition d'images par instruction avec "
    "plusieurs références. Version quantifiée (Q4_K) : ≈ 11 Go au lieu de 33 Go, sans PyTorch.",
    engine=ENGINE,
    backend="sdcpp",
    reference_mode="multi",
    max_references=4,
    params=[
        ParamSpec("steps", "Étapes", "int", 20, 8, 50, 1,
                  "Plus d'étapes = plus de détails, plus lent. Valeur par défaut (20) : remplacée par 12 en édition "
                  "avec des références, qui donne le même résultat en deux fois moins de temps."),
        ParamSpec("guidance", "Guidance (CFG)", "float", 1.0, 1.0, 10.0, 0.5,
                  "1 = automatique : désactivée pour créer une image, 4 pour éditer avec des références "
                  "(la guidance double le temps de calcul).", advanced=True),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
    ],
    size_multiple=32,  # required by stable-diffusion.cpp for this model
    min_side=256,
    max_side=2048,
    default_quantize=None,
    quantize_options=[],
    sources=[src(Q_GGUF, 4.2), src(Q_LLM, 5.03), src(Q_VISION, 1.16),
             src(Q_VAE, 0.68)],
    download_size_gb=11.1,
    license="Qwen Research License (recherche, usage non commercial)",
    weights_gb=11.1,
    largest_component_gb=5.0,
    memory_hint="≈ 11 Go de poids (Q4_K) ; l'encodeur de texte reste en mémoire pendant le calcul.",
    tags=["texte→image", "édition", "multi-références", "GGUF"],
    options={
        "files": {"diffusion-model": Q_GGUF, "llm": Q_LLM, "vae": Q_VAE, "llm_vision": Q_VISION},
        "vision_for_refs": ["llm_vision"],
        "cli_args": ["--sampling-method", "euler"],
        "fa_variants": ["metal", "cuda", "rocm"],
        "guidance_arg": "--cfg-scale",
        "edit_guidance": 4.0,
        "edit_steps": 12,
    },
)

E_GGUF = ("unsloth/Qwen-Image-Edit-2511-GGUF", "qwen-image-edit-2511-Q4_K_M.gguf")
E_LLM = ("mradermacher/Qwen2.5-VL-7B-Instruct-GGUF", "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf")
E_VISION = ("mradermacher/Qwen2.5-VL-7B-Instruct-GGUF", "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf")
E_VAE = ("Comfy-Org/Qwen-Image_ComfyUI", "split_files/vae/qwen_image_vae.safetensors")

QWEN_EDIT_GGUF = ModelSpec(
    id="qwen-image-edit-gguf",
    name="Qwen Image Edit",
    family="Qwen",
    description="Édition d'images par instruction (« remplace le texte », « mets-lui un chapeau ») et composition de "
    "plusieurs images (jusqu'à 3). Modèle dédié à l'édition, licence Apache 2.0 (usage commercial permis). "
    "Version quantifiée (Q4_K_M) : ≈ 19 Go au lieu de 58 Go.",
    engine=ENGINE,
    backend="sdcpp",
    reference_mode="multi",
    max_references=3,
    requires_references=True,
    text_to_image=False,
    params=[
        ParamSpec("steps", "Étapes", "int", 12, 8, 50, 1,
                  "12 suffisent (mesuré : même résultat qu'à 20, en deux fois moins de temps). Plus lent que Qwen Image 2.1."),
        ParamSpec("guidance", "Guidance (CFG)", "float", 2.5, 1.0, 10.0, 0.5, "Fidélité à l'instruction.", advanced=True),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
    ],
    size_multiple=16,
    min_side=256,
    max_side=2048,
    default_quantize=None,
    quantize_options=[],
    sources=[src(E_GGUF, 13.24), src(E_LLM, 4.68), src(E_VISION, 0.85), src(E_VAE, 0.25)],
    download_size_gb=19.0,
    license="Apache 2.0",
    weights_gb=19.0,
    largest_component_gb=13.2,
    memory_hint="≈ 19 Go de poids (Q4_K_M) ; plus lourd et plus lent que Qwen Image 2.1 (20 milliards de paramètres).",
    tags=["édition", "multi-images", "GGUF", "Apache 2.0"],
    options={
        "files": {"diffusion-model": E_GGUF, "llm": E_LLM, "vae": E_VAE, "llm_vision": E_VISION},
        "vision_for_refs": ["llm_vision"],
        # Settings from the stable-diffusion.cpp guide; zero_cond_t is required for the 2511 release. The references
        # are numbered by the "qwen" preset sd-cli picks for every Qwen Image model (the old --increase-ref-index flag
        # is deprecated since then).
        "cli_args": ["--sampling-method", "euler", "--flow-shift", "3", "--model-args", "qwen_image_zero_cond_t=true"],
        "fa_variants": ["metal", "cuda", "rocm"],
        "guidance_arg": "--cfg-scale",
    },
)

K_GGUF = ("AtomicChat/FLUX-3-Image-Klein-GGUF", "FLUX-3-Image-Klein-AD-Q5_K.gguf")
K_LLM = ("AtomicChat/FLUX-3-Image-Klein-GGUF", "text_encoders/Qwen3-VL-4B-Instruct-AD-Q4_K.gguf")
K_VAE = ("AtomicChat/FLUX-3-Image-Klein-GGUF", "vae/ae.safetensors")  # Black Forest Labs' file, unchanged

KLEIN_GGUF = ModelSpec(
    id="flux-3-image-klein-gguf",
    name="FLUX 3 Image Klein",
    family="FLUX",
    description="Texte → image et édition d'images avec références (5,6 milliards de paramètres, distillé en 16 étapes), "
    "de Black Forest Labs. Rédigez le prompt comme une description de scène complète (le bouton ✨ le fait pour vous) : "
    "un prompt court donne une image générique. Version quantifiée (Q5) : ≈ 7 Go, sans PyTorch. Licence FLUX Kommunity "
    "(usage commercial réservé aux structures sous 5 M$ de chiffre d'affaires annuel, qui doivent filtrer ou relire les images).",
    engine=ENGINE,
    backend="sdcpp",
    reference_mode="multi",
    max_references=4,
    params=[
        ParamSpec("steps", "Étapes", "int", 16, 4, 50, 1, "Le modèle est distillé pour 16 étapes."),
        ParamSpec("guidance", "Guidance (CFG)", "float", 1.0, 1.0, 8.0, 0.5,
                  "1 = désactivé (recommandé pour ce modèle distillé).", advanced=True),
    ],
    size_multiple=16,
    min_side=256,
    max_side=2048,
    default_quantize=None,
    quantize_options=[],
    sources=[src(K_GGUF, 4.44), src(K_LLM, 2.49), src(K_VAE, 0.34)],
    download_size_gb=7.27,
    license="FLUX Kommunity (non commercial, ou commercial sous 5 M$ de chiffre d'affaires annuel)",  # Qualifying Users must filter or review outputs (§2.e)
    weights_gb=7.27,
    largest_component_gb=4.44,
    memory_hint="≈ 7,3 Go de poids (Q5), pic mesuré ≈ 8 Go à 512×512 (avec une référence) sur un Mac Apple Silicon de 36 Go "
    "(non mesuré sur moins de mémoire). Environ 3 s par étape à 512×512, 6 à 11 s avec une référence.",
    tags=["texte→image", "édition", "multi-références", "GGUF", "FLUX Kommunity"],
    options={
        "files": {"diffusion-model": K_GGUF, "llm": K_LLM, "vae": K_VAE},
        "min_build": 968,  # first stable-diffusion.cpp release with FLUX 3 (leejet/stable-diffusion.cpp#2143)
        "cli_args": ["--sampling-method", "euler"],
        "fa_variants": [],  # FlashAttention not measured on this architecture
        "guidance_arg": "--cfg-scale",
    },
)

# Offered quantizations (diffusion file sizes, in GB). Only the chosen one is downloaded; the text
# encoder and VAE are shared by all of them.

def _gguf_variants(spec: ModelSpec, repo: str, name: str, table: list[tuple[str, float]], default: str) -> None:
    old_repo, old_file = spec.options["files"]["diffusion-model"]
    idx = next(i for i, s in enumerate(spec.sources) if s.repo == old_repo and old_file in (s.patterns or []))
    old_size = spec.sources[idx].size_gb or 0
    for label, size in table:
        file = name.format(label)
        sources = list(spec.sources)
        sources[idx] = src((repo, file), size)
        delta = size - old_size
        spec.variants.append(Variant(
            key=label, label=label, size_gb=round((spec.download_size_gb or 0) + delta, 2), sources=sources,
            options={"files": {**spec.options["files"], "diffusion-model": (repo, file)}},
            weights_gb=round((spec.weights_gb or 0) + delta, 2), largest_component_gb=max(spec.largest_component_gb or 0, size),
        ))
    spec.default_variant = default
    chosen = next(v for v in spec.variants if v.key == default)
    spec.sources, spec.options = chosen.sources, {**spec.options, **chosen.options}


_gguf_variants(Z_IMAGE_GGUF, "leejet/Z-Image-Turbo-GGUF", "z_image_turbo-{}.gguf",
               [("Q2_K", 2.59), ("Q3_K", 3.14), ("Q4_0", 3.68), ("Q4_K", 3.86), ("Q5_0", 4.54), ("Q6_K", 5.26), ("Q8_0", 6.58)],
               "Q4_K")
_gguf_variants(QWEN21_GGUF, "leejet/Qwen-Image-2.1-GGUF", "qwen_image_2.1-{}.gguf",
               [("Q2_K", 2.56), ("Q3_K", 3.27), ("Q4_0", 4.2), ("Q4_K", 4.2), ("Q5_0", 5.07), ("Q6_K", 6.0), ("Q8_0", 7.69)],
               "Q4_K")
_gguf_variants(QWEN_EDIT_GGUF, "unsloth/Qwen-Image-Edit-2511-GGUF", "qwen-image-edit-2511-{}.gguf",
               [("Q2_K", 7.47), ("Q3_K_S", 9.22), ("Q3_K_M", 9.92), ("Q3_K_L", 10.58), ("Q4_0", 11.85), ("Q4_K_S", 12.41),
                ("Q4_1", 12.84), ("Q4_K_M", 13.24), ("Q5_0", 14.4), ("Q5_K_S", 14.33), ("Q5_K_M", 15.03), ("Q5_1", 15.39),
                ("Q6_K", 16.85), ("Q8_0", 21.76)],
               "Q4_K_M")

_gguf_variants(KLEIN_GGUF, "AtomicChat/FLUX-3-Image-Klein-GGUF", "FLUX-3-Image-Klein-{}.gguf",
               [("AD-Q4_K", 3.65), ("AD-Q5_K", 4.44), ("Q8_0", 5.99)], "AD-Q5_K")

SPECS = [Z_IMAGE_GGUF, QWEN21_GGUF, QWEN_EDIT_GGUF, KLEIN_GGUF]
