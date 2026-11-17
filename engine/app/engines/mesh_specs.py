# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Shap-E Diffusers models; generation produces a GLB mesh."""
from .base import HfSource, ModelSpec, ParamSpec


def _shap_e(image: bool) -> ModelSpec:
    repo = "openai/shap-e-img2img" if image else "openai/shap-e"
    return ModelSpec(
        id="shap-e-image" if image else "shap-e-text", name="Shap-E · image" if image else "Shap-E · text",
        family="Shap-E", description="Image vers objet 3D." if image else "Texte vers objet 3D.",
        engine="app.engines.mesh_engine:ShapEEngine", backend="torch", kind="mesh",
        reference_mode="init" if image else "none", max_references=1 if image else 0,
        requires_references=image, text_to_image=False, default_quantize=None, quantize_options=[],
        params=[ParamSpec("steps", "Étapes", "int", 64, 1, 128, 1),
                ParamSpec("guidance", "Guidance", "float", 3.0 if image else 15.0, 1, 30, 0.5)],
        hf_repo=repo, hf_patterns=["model_index.json", "scheduler/*", "tokenizer/*", "image_processor/*",
                                   "prior/config.json", "prior/*.fp16.safetensors", "shap_e_renderer/*",
                                   "text_encoder/config.json", "text_encoder/*.fp16.safetensors",
                                   "image_encoder/config.json", "image_encoder/*.fp16.safetensors"],
        check_files=["model_index.json", "prior/*.fp16.safetensors", "shap_e_renderer/*.bin",
                     "image_encoder/*.fp16.safetensors" if image else "text_encoder/*.fp16.safetensors"],
        license="MIT", weights_gb=4.0, largest_component_gb=3.0,
        memory_hint="Estimation de mémoire non mesurée ; génération réelle non vérifiée.",
        tags=["image→3D" if image else "texte→3D"], options={"image": image},
    )


SPECS = [_shap_e(False), _shap_e(True)]

TRIPOSR = ModelSpec(
    id="triposr", name="TripoSR", family="TripoSR", description="Reconstruction 3D rapide depuis une image.",
    engine="triposr:TripoSREngine", backend="pack", kind="mesh", reference_mode="init", max_references=1,
    requires_references=True, text_to_image=False, default_quantize=None, quantize_options=[],
    hf_repo="stabilityai/TripoSR", sources=[HfSource("stabilityai/TripoSR", ["config.yaml", "model.ckpt"],
                                                       ["config.yaml", "model.ckpt"], 1.68),
                                               HfSource("facebook/dino-vitb16", ["config.json"], ["config.json"])],
    download_size_gb=1.68, weights_gb=1.68,
    license="MIT", memory_hint="Compilation native nécessaire ; CPU possible mais lent. Non mesuré.",
    tags=["image→3D"], options={"pack": "triposr"},
)
SF3D = ModelSpec(
    id="stable-fast-3d", name="Stable Fast 3D", family="Stable Fast 3D",
    description="Reconstruction 3D texturée depuis une image.", engine="sf3d:SF3DEngine", backend="pack",
    kind="mesh", reference_mode="init", max_references=1, requires_references=True, text_to_image=False,
    default_quantize=None, quantize_options=[], hf_repo="stabilityai/stable-fast-3d",
    sources=[HfSource("stabilityai/stable-fast-3d", ["config.yaml", "model.safetensors"],
                      ["config.yaml", "model.safetensors"], 4.02),
             HfSource("facebook/dinov2-large", ["config.json", "model.safetensors"],
                      ["config.json", "model.safetensors"], 1.22)],
    gated=True, license="Stability AI Community License; DINOv2 Apache 2.0",
    license_warning="Acceptez la licence Stability AI sur Hugging Face avant le téléchargement.", weights_gb=5.24, download_size_gb=5.24,
    memory_hint="Accès Hugging Face soumis à licence. Compilation native nécessaire ; MPS expérimental. Non mesuré.",
    tags=["image→3D", "licence restreinte"], options={"pack": "sf3d"},
)
SPECS += [TRIPOSR, SF3D]

TRIPOSG = ModelSpec(
    id="triposg", name="TripoSG", family="TripoSG", description="Maillage géométrique détaillé depuis une image.",
    engine="triposg_engine:TripoSGEngine", backend="pack", kind="mesh", reference_mode="init",
    max_references=1, requires_references=True, text_to_image=False, default_quantize=None, quantize_options=[],
    params=[ParamSpec("steps", "Étapes", "int", 50, 1, 128, 1),
            ParamSpec("guidance", "Guidance", "float", 7.0, 1, 30, 0.5)],
    hf_repo="VAST-AI/TripoSG", sources=[
        HfSource("VAST-AI/TripoSG", None, ["model_index.json", "transformer/*.safetensors",
                 "vae/*.safetensors", "image_encoder_dinov2/*.safetensors"], 7.95),
        HfSource("briaai/RMBG-1.4", ["config.json", "model.safetensors"],
                 ["config.json", "model.safetensors"], 0.18)],
    license="TripoSG MIT ; détourage BRIA RMBG 1.4 : utilisation non commerciale sans licence commerciale",
    license_warning="Le détourage BRIA RMBG 1.4 est réservé à l’usage non commercial sans licence commerciale.",
    weights_gb=8.13, largest_component_gb=5.76, download_size_gb=8.13,
    memory_hint="NVIDIA Linux x86-64 requis ; mémoire estimée non mesurée. Le détourage BRIA limite l’usage commercial.",
    tags=["image→3D", "usage commercial restreint"], options={"pack": "triposg", "min_vram_gb": 16, "min_ram_gb": 24},
)
SPECS.append(TRIPOSG)

_TRELLIS_DECODERS = ["ss_dec_conv3d_16l8_fp16", "slat_dec_gs_swin8_B_64l8gs32_fp16",
                     "slat_dec_rf_swin8_B_64l8r16_fp16", "slat_dec_mesh_swin8_B_64l8m256c_fp16"]


def _trellis(image: bool) -> ModelSpec:
    repo = "microsoft/TRELLIS-image-large" if image else "microsoft/TRELLIS-text-xlarge"
    required = _TRELLIS_DECODERS + (["ss_flow_img_dit_L_16l8_fp16", "slat_flow_img_dit_L_64l8p2_fp16"] if image
                                     else ["ss_flow_txt_dit_XL_16l8_fp16", "slat_flow_txt_dit_XL_64l8p2_fp16"])
    own = required if image else required[-2:]
    files = [f"ckpts/{name}.{ext}" for name in own for ext in ("json", "safetensors")]
    sources = [HfSource(repo, ["pipeline.json", *files], ["pipeline.json", *files], 3.3 if image else 4.13)]
    if not image:
        decoders = [f"ckpts/{name}.{ext}" for name in _TRELLIS_DECODERS for ext in ("json", "safetensors")]
        sources += [HfSource("JeffreyXiang/TRELLIS-image-large", decoders, decoders),
                    HfSource("openai/clip-vit-large-patch14", ["config.json", "model.safetensors", "tokenizer.json",
                             "tokenizer_config.json", "special_tokens_map.json", "vocab.json", "merges.txt"],
                             ["config.json", "model.safetensors", "vocab.json", "merges.txt"], 1.71)]
    return ModelSpec(
        id="trellis-image" if image else "trellis-text", name="TRELLIS · image" if image else "TRELLIS · text",
        family="TRELLIS", description="Génération 3D texturée depuis une image." if image else "Génération 3D texturée depuis du texte.",
        engine="trellis_engine:TrellisEngine", backend="pack", kind="mesh", reference_mode="init" if image else "none",
        max_references=1 if image else 0, requires_references=image, text_to_image=False,
        default_quantize=None, quantize_options=[], hf_repo=repo, sources=sources, license="MIT",
        weights_gb=5.0 if image else 7.0, largest_component_gb=4.0,
        memory_hint="Linux x86-64, NVIDIA 16 Go et compilation CUDA requis ; non mesuré.",
        tags=["image→3D" if image else "texte→3D", "NVIDIA"],
        options={"pack": "trellis", "image": image, "min_vram_gb": 16, "min_ram_gb": 24},
    )


SPECS += [_trellis(True), _trellis(False)]

_TRELLIS2_MODELS = ["ss_flow_img_dit_1_3B_64_bf16", "shape_dec_next_dc_f16c32_fp16",
                    "slat_flow_img2shape_dit_1_3B_512_bf16", "slat_flow_img2shape_dit_1_3B_1024_bf16",
                    "tex_dec_next_dc_f16c32_fp16", "slat_flow_imgshape2tex_dit_1_3B_512_bf16",
                    "slat_flow_imgshape2tex_dit_1_3B_1024_bf16"]
_TRELLIS2_FILES = [f"ckpts/{name}.{ext}" for name in _TRELLIS2_MODELS for ext in ("json", "safetensors")]
TRELLIS2 = ModelSpec(
    id="trellis-2", name="TRELLIS.2", family="TRELLIS.2", description="Objet 3D texturé depuis une image.",
    engine="trellis_engine:Trellis2Engine", backend="pack", kind="mesh", reference_mode="init", max_references=1,
    requires_references=True, text_to_image=False, default_quantize=None, quantize_options=[],
    hf_repo="microsoft/TRELLIS.2-4B", sources=[
        HfSource("microsoft/TRELLIS.2-4B", ["pipeline.json", *_TRELLIS2_FILES], ["pipeline.json", *_TRELLIS2_FILES], 16.25),
        HfSource("microsoft/TRELLIS-image-large", ["ckpts/ss_dec_conv3d_16l8_fp16.json", "ckpts/ss_dec_conv3d_16l8_fp16.safetensors"],
                 ["ckpts/ss_dec_conv3d_16l8_fp16.json", "ckpts/ss_dec_conv3d_16l8_fp16.safetensors"]),
        HfSource("facebook/dinov3-vitl16-pretrain-lvd1689m", ["config.json", "model.safetensors", "preprocessor_config.json"],
                 ["config.json", "model.safetensors"], 1.22),
        HfSource("briaai/RMBG-2.0", ["config.json", "model.safetensors", "*.py"],
                 ["config.json", "model.safetensors", "birefnet.py", "BiRefNet_config.py"],
                 revision="6a88d6a65119856a743be87ec1e6bee6f08e1f93")],
    gated=True, gated_repos=["facebook/dinov3-vitl16-pretrain-lvd1689m", "briaai/RMBG-2.0"],
    license="TRELLIS.2 MIT ; DINOv3 et BRIA RMBG 2.0 sous licences distinctes",
    license_warning="Accès séparé requis aux modèles DINOv3 et BRIA RMBG 2.0 sur Hugging Face ; BRIA limite l’usage commercial.",
    weights_gb=18.0, largest_component_gb=4.0, download_size_gb=18.0,
    memory_hint="Linux x86-64, NVIDIA 24 Go et compilation CUDA requis ; mémoire estimée, non mesurée.",
    tags=["image→3D", "NVIDIA", "accès restreint"],
    options={"pack": "trellis2", "min_vram_gb": 24, "min_ram_gb": 32},
)
SPECS.append(TRELLIS2)
