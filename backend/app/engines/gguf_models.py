"""Modèles quantifiés GGUF exécutés par stable-diffusion.cpp (Metal, CUDA, ROCm, Vulkan).

Léger : 5 à 11 Go au lieu de 20 à 33 Go en pleine précision, donc des cartes de 8 à 12 Go suffisent.
Chaque modèle se compose de plusieurs fichiers de dépôts différents (diffusion, encodeur de texte, VAE).
Seuls des dépôts sans accès restreint sont utilisés.
"""

from __future__ import annotations

from .base import HfSource, ModelSpec, ParamSpec

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
    size_multiple=32,  # exigé par stable-diffusion.cpp pour ce modèle
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

SPECS = [Z_IMAGE_GGUF, QWEN21_GGUF]
