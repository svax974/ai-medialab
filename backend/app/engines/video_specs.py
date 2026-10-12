# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video models (generation and editing) run by the PyTorch + diffusers engine.

Entries are pure data; see `video_engine.py` for what `options` mean. Sizes come from the Hugging Face API
(per-file sizes, checked 2026-10). The lightest working form is the default: the diffusion transformer is a
4-bit GGUF file (diffusers loads it with `from_single_file`) while text encoder and VAE come from the official
diffusers repo; the full-precision repo stays available as a "reference" variant when it exists.

Two more models (Kiwi-Edit, Bernini-R) cannot run in the main process: they pin their own dependencies and use
the authors' code. They are `backend="pack"` specs (see `PACK_SPECS`), run by `video_runtime/` in an isolated
Python environment installed on demand (`audio_packs.py`), and only on NVIDIA (CUDA) or AMD (ROCm) GPUs.

Not available as GGUF in diffusers 0.41 (no single-file loader for these transformers): CogVideoX and
HunyuanVideo 1.5, which are offered in their original bf16 only.
"""

from __future__ import annotations

from .base import HfSource, ModelSpec, ParamSpec, Variant, VideoCaps, VideoResolution

ENGINE = "app.engines.video_engine:VideoDiffusersEngine"

NEGATIVE = ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que la vidéo doit éviter.", advanced=True)
STRENGTH = ParamSpec("strength", "Influence de la vidéo", "float", 0.8, 0.3, 1.0, 0.05,
                     "Part de la vidéo source transformée. Bas = proche de l'original.", requires_references=True)

TENCENT_WARNING = "Licence Tencent Hunyuan : l'utilisation est exclue dans l'Union européenne, au Royaume-Uni et en Corée du Sud."


def _steps(default: int, lo: int = 4, hi: int = 80) -> ParamSpec:
    return ParamSpec("steps", "Étapes", "int", default, lo, hi, 1, "Plus d'étapes = plus de détails, plus lent.")


def _guidance(default: float, hi: float = 12.0) -> ParamSpec:
    return ParamSpec("guidance", "Guidance", "float", default, 1.0, hi, 0.5, "Fidélité au prompt.")


def _res(rid: str, short: int, long: int) -> VideoResolution:
    return VideoResolution(rid, rid, short, long)


def _src(repo: str, patterns: list[str], check: list[str], size: float) -> HfSource:
    return HfSource(repo, patterns, check, size)


# Wan 2.2 -----------------------------------------------------------------------------------------------

WAN_5B_REPO = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
WAN_BASE = ["model_index.json", "scheduler/*", "tokenizer/*", "text_encoder/*", "vae/*"]
WAN_BASE_CHECK = ["model_index.json", "text_encoder/*.safetensors", "vae/*.safetensors"]


def _wan5_gguf(quant: str, size: float) -> Variant:
    gguf = f"Wan2.2-TI2V-5B-{quant}.gguf"
    return Variant(
        quant, quant, round(14.2 + size, 2),
        [_src(WAN_5B_REPO, WAN_BASE + ["transformer/config.json"], WAN_BASE_CHECK + ["transformer/config.json"], 14.2),
         _src("QuantStack/Wan2.2-TI2V-5B-GGUF", [gguf], [gguf], size)],
        options={"gguf": {"transformer": ("QuantStack/Wan2.2-TI2V-5B-GGUF", gguf)}},
        weights_gb=round(14.2 + size, 1), largest_component_gb=11.4,
    )


WAN_TI2V_5B = ModelSpec(
    id="wan-2.2-ti2v-5b",
    name="Wan 2.2 TI2V 5B",
    family="Wan",
    description="Polyvalent, meilleure qualité ouverte en texte → vidéo et image → vidéo.",
    engine=ENGINE, backend="torch", kind="video", text_to_image=False,
    default_quantize=None, quantize_options=[],
    params=[_steps(50, 10, 60), _guidance(5.0), NEGATIVE],
    size_multiple=32,
    video=VideoCaps(
        tasks=["t2v", "i2v"], fps=24, frame_step=4, default_seconds=5.0, min_seconds=1.0, max_seconds=8.0,
        resolutions=[_res("480p", 480, 832), _res("720p", 704, 1280)], default_resolution="720p",
        image_input="optional",
    ),
    hf_repo=WAN_5B_REPO,
    sources=[],
    license="Apache 2.0",
    weights_gb=17.6, largest_component_gb=11.4, download_size_gb=17.7,
    memory_hint="Q4_K_M : ≈ 18 Go de poids, 17,7 Go à télécharger. Mac Apple Silicon avec 32 Go de mémoire minimum "
    "(720p, 5 s : plusieurs dizaines de minutes) ; GPU 16 Go+ avec 32 Go de RAM. La variante bf16 (34 Go à télécharger) "
    "demande 36 Go de mémoire unifiée.",
    tags=["texte→vidéo", "image→vidéo", "24 ips", "Apache 2.0"],
    options={"pipeline": "WanPipeline", "i2v_pipeline": "WanImageToVideoPipeline", "family": "wan",
             "transformer_class": "WanTransformer3DModel"},
    variants=[
        _wan5_gguf("Q4_K_M", 3.43),
        _wan5_gguf("Q8_0", 5.4),
        Variant("bf16", "bf16", 34.2,
                [_src(WAN_5B_REPO, WAN_BASE + ["transformer/*"], WAN_BASE_CHECK + ["transformer/*.safetensors"], 34.2)],
                options={"gguf": None}, weights_gb=24.2, largest_component_gb=11.4),
    ],
    default_variant="Q4_K_M",
)


def _wan14_variant(kind: str, quant: str, expert_gb: float) -> Variant:
    """Two experts (high noise = `transformer`, low noise = `transformer_2`), one GGUF file each."""
    repo = f"QuantStack/Wan2.2-{kind}-A14B-GGUF"
    high = f"HighNoise/Wan2.2-{kind}-A14B-HighNoise-{quant}.gguf"
    low = f"LowNoise/Wan2.2-{kind}-A14B-LowNoise-{quant}.gguf"
    base = f"Wan-AI/Wan2.2-{kind}-A14B-Diffusers"
    cfg = ["transformer/config.json", "transformer_2/config.json"]
    return Variant(
        quant, quant, round(11.9 + 2 * expert_gb, 2),
        [_src(base, WAN_BASE + cfg, WAN_BASE_CHECK + cfg, 11.9), _src(repo, [high, low], [high, low], 2 * expert_gb)],
        options={"gguf": {"transformer": (repo, high), "transformer_2": (repo, low)}},
        weights_gb=round(11.9 + 2 * expert_gb, 1), largest_component_gb=11.4,
    )


def _wan14(kind: str, task: str, guidance: tuple[float, float], desc: str) -> ModelSpec:
    t2v = task == "t2v"
    return ModelSpec(
        id=f"wan-2.2-{task}-a14b",
        name=f"Wan 2.2 {kind} 14B",
        family="Wan",
        description=desc,
        engine=ENGINE, backend="torch", kind="video", text_to_image=False,
        default_quantize=None, quantize_options=[],
        params=[_steps(40, 10, 60), _guidance(guidance[0]), NEGATIVE],
        size_multiple=16,
        video=VideoCaps(
            tasks=["t2v"] if t2v else ["i2v"], fps=16, frame_step=4, default_seconds=5.0, min_seconds=1.0,
            max_seconds=5.0, resolutions=[_res("480p", 480, 832), _res("720p", 720, 1280)], default_resolution="480p",
            image_input="none" if t2v else "required", last_frame=not t2v,
        ),
        hf_repo=f"Wan-AI/Wan2.2-{kind}-A14B-Diffusers",
        license="Apache 2.0",
        weights_gb=29.4, largest_component_gb=11.4, download_size_gb=29.4,
        memory_hint="Deux experts de 14 Md de paramètres en Q4 : ≈ 29 Go de poids et de téléchargement. Mac avec 48 Go "
        "de mémoire minimum (très lent) ; GPU 24 Go+ avec 48 Go de RAM. Uniquement en GGUF 4 bits : la version "
        "complète pèserait 126 Go.",
        tags=["texte→vidéo" if t2v else "image→vidéo", "16 ips", "14 Md", "Apache 2.0"],
        options={"pipeline": "WanPipeline" if t2v else "WanImageToVideoPipeline", "family": "wan",
                 "transformer_class": "WanTransformer3DModel", "guidance_2": guidance[1]},
        variants=[_wan14_variant(kind, "Q4_K_S", 8.75), _wan14_variant(kind, "Q4_K_M", 9.65)],
        default_variant="Q4_K_S",
    )


WAN_T2V_A14B = _wan14("T2V", "t2v", (4.0, 3.0), "Qualité maximale en texte → vidéo, plus lourd que la version 5B.")
WAN_I2V_A14B = _wan14("I2V", "i2v", (3.5, 3.5), "Anime une image avec un rendu de très haute qualité, début et fin au choix.")


# LTX-2.3 ------------------------------------------------------------------------------------------------

LTX_REPO = "diffusers/LTX-2.3-Distilled-Diffusers"
LTX_GEMMA = "Lightricks/gemma-3-12b-it-qat-q4_0-unquantized"  # bf16 copy of the text encoder (the diffusers repo stores fp32)
LTX_BASE = ["model_index.json", "scheduler/*", "tokenizer/*", "processor/*", "connectors/*", "vae/*", "audio_vae/*",
            "vocoder/*"]
LTX_CHECK = ["model_index.json", "connectors/*.safetensors", "vae/*.safetensors", "vocoder/*.safetensors"]
LTX_GEMMA_SRC = _src(LTX_GEMMA, ["config.json", "generation_config.json", "model*.safetensors*"],
                     ["config.json", "model*.safetensors"], 24.4)


def _ltx_gguf(quant: str, size: float) -> Variant:
    gguf = f"distilled/ltx-2.3-22b-distilled-{quant}.gguf"
    return Variant(
        quant, quant, round(8.3 + 24.4 + size, 2),
        [_src(LTX_REPO, LTX_BASE + ["transformer/config.json"], LTX_CHECK + ["transformer/config.json"], 8.3), LTX_GEMMA_SRC,
         _src("unsloth/LTX-2.3-GGUF", [gguf], [gguf], size)],
        options={"gguf": {"transformer": ("unsloth/LTX-2.3-GGUF", gguf)}},
        weights_gb=round(8.3 + 24.4 + size, 1), largest_component_gb=24.4,
    )


LTX_23 = ModelSpec(
    id="ltx-2.3-distilled",
    name="LTX-2.3 Distilled",
    family="LTX",
    description="Rapide et haute définition, génère aussi le son synchronisé.",
    engine=ENGINE, backend="torch", kind="video", text_to_image=False,
    default_quantize=None, quantize_options=[],
    params=[_steps(8, 8, 8), NEGATIVE],
    size_multiple=32,
    video=VideoCaps(
        tasks=["t2v", "i2v"], fps=24, frame_step=8, default_seconds=5.0, min_seconds=1.0, max_seconds=8.0,
        resolutions=[_res("512p", 512, 768), _res("720p", 704, 1280)], default_resolution="512p",
        image_input="optional", audio_out=True, english_only=True,
    ),
    hf_repo=LTX_REPO,
    license="LTX-2 Community License (usage libre sous un certain chiffre d'affaires)",
    weights_gb=45.5, largest_component_gb=24.4, download_size_gb=45.8,
    memory_hint="Modèle de 22 Md de paramètres : Q4 ≈ 46 Go de poids et de téléchargement (encodeur de texte Gemma 3 de "
    "24 Go compris). Mac avec 64 Go de mémoire minimum ; GPU 24 Go+ avec 64 Go de RAM. Version distillée : 8 étapes, "
    "sans guidance. Prompts en anglais.",
    tags=["texte→vidéo", "image→vidéo", "son", "24 ips", "rapide"],
    options={"pipeline": "LTX2Pipeline", "i2v_pipeline": "LTX2ImageToVideoPipeline", "family": "ltx2",
             "transformer_class": "LTX2VideoTransformer3DModel", "text_encoder_repo": LTX_GEMMA, "distilled": True},
    variants=[
        _ltx_gguf("Q4_K_S", 13.12),
        _ltx_gguf("Q4_K_M", 14.33),
        Variant("bf16", "bf16", round(8.3 + 24.4 + 38.0, 2),
                [_src(LTX_REPO, LTX_BASE + ["transformer/*"], LTX_CHECK + ["transformer/*.safetensors"], 46.3),
                 LTX_GEMMA_SRC],
                options={"gguf": None}, weights_gb=70.7, largest_component_gb=24.4),
    ],
    default_variant="Q4_K_S",
)


# CogVideoX ----------------------------------------------------------------------------------------------

COG_FILES = ["model_index.json", "scheduler/*", "tokenizer/*", "text_encoder/*", "transformer/*", "vae/*"]
COG_CHECK = ["model_index.json", "text_encoder/*.safetensors", "transformer/*.safetensors", "vae/*.safetensors"]


def _cog(mid: str, name: str, repo: str, i2v: bool, size: float, weights: float, license_: str, hint: str,
         desc: str, tags: list[str], dtype: str = "bfloat16") -> ModelSpec:
    return ModelSpec(
        id=mid, name=name, family="CogVideoX", description=desc,
        engine=ENGINE, backend="torch", kind="video", text_to_image=False,
        default_quantize=None, quantize_options=[],
        params=[_steps(50, 10, 80), _guidance(6.0), NEGATIVE] + ([] if i2v else [STRENGTH]),
        size_multiple=16,
        video=VideoCaps(
            tasks=["i2v"] if i2v else ["t2v", "v2v"], fps=8, frame_step=4, default_seconds=6.0, min_seconds=2.0,
            max_seconds=6.0, resolutions=[_res("480p", 480, 720)], default_resolution="480p",
            image_input="required" if i2v else "none", video_input="none" if i2v else "optional", english_only=True,
        ),
        hf_repo=repo,
        sources=[_src(repo, COG_FILES, COG_CHECK, size)],
        license=license_, weights_gb=weights, largest_component_gb=9.5, download_size_gb=size,
        memory_hint=hint, tags=tags,
        options={"pipeline": "CogVideoXImageToVideoPipeline" if i2v else "CogVideoXPipeline",
                 "v2v_pipeline": None if i2v else "CogVideoXVideoToVideoPipeline",
                 "i2v_pipeline": None, "family": "cog", "dtype": dtype},
    )


COGVIDEOX_2B = _cog(
    "cogvideox-2b", "CogVideoX 2B", "zai-org/CogVideoX-2b", False, 14.2, 13.8, "Apache 2.0",
    "≈ 14 Go de poids (fp16), 14 Go à télécharger (dont 9,5 Go d'encodeur de texte). Le plus accessible : Mac avec 24 Go "
    "de mémoire minimum, GPU 12 Go+. Pas de version GGUF utilisable avec diffusers.",
    "Léger et peu gourmand en mémoire, clips courts 480p.",
    ["texte→vidéo", "édition vidéo", "8 ips", "léger", "Apache 2.0"], dtype="float16",
)
COGVIDEOX_5B = _cog(
    "cogvideox-5b", "CogVideoX 5B", "zai-org/CogVideoX-5b", False, 21.6, 21.6, "CogVideoX License (usage commercial limité)",
    "≈ 22 Go de poids (bf16), 22 Go à télécharger. Mac avec 32 Go de mémoire minimum, GPU 16 Go+ avec 32 Go de RAM. "
    "Pas de version GGUF utilisable avec diffusers.",
    "Meilleure qualité que la version 2B pour les clips courts 480p, texte → vidéo et édition.",
    ["texte→vidéo", "édition vidéo", "8 ips"],
)
COGVIDEOX_5B_I2V = _cog(
    "cogvideox-5b-i2v", "CogVideoX 5B I2V", "zai-org/CogVideoX-5b-I2V", True, 21.7, 21.7,
    "CogVideoX License (usage commercial limité)",
    "≈ 22 Go de poids (bf16), 22 Go à télécharger. Mac avec 32 Go de mémoire minimum, GPU 16 Go+ avec 32 Go de RAM. "
    "Pas de version GGUF utilisable avec diffusers.",
    "Anime une image en clip court 480p.",
    ["image→vidéo", "8 ips"],
)


# HunyuanVideo 1.5 ---------------------------------------------------------------------------------------

HY_FILES = ["model_index.json", "scheduler/*", "guider/*", "tokenizer/*", "tokenizer_2/*", "feature_extractor/*",
            "text_encoder/*", "text_encoder_2/*", "image_encoder/*", "transformer/*", "vae/*"]
HY_CHECK = ["model_index.json", "text_encoder/*.safetensors", "transformer/*.safetensors", "vae/*.safetensors"]


def _hunyuan(mid: str, name: str, repo: str, i2v: bool, size: float, weights: float, desc: str, steps: tuple[int, int],
             guidance: float) -> ModelSpec:
    return ModelSpec(
        id=mid, name=name, family="HunyuanVideo", description=desc,
        engine=ENGINE, backend="torch", kind="video", text_to_image=False,
        default_quantize=None, quantize_options=[],
        params=[_steps(steps[0], steps[1], 60)] + ([] if i2v else [_guidance(guidance)]) + [NEGATIVE],
        size_multiple=16,
        video=VideoCaps(
            tasks=["i2v"] if i2v else ["t2v"], fps=24, frame_step=4, default_seconds=5.0, min_seconds=1.0, max_seconds=5.0,
            resolutions=[_res("480p", 480, 848)], default_resolution="480p",
            image_input="required" if i2v else "none", license_warning=TENCENT_WARNING,
        ),
        hf_repo=repo,
        sources=[_src(repo, HY_FILES, HY_CHECK, size)],
        license="Tencent Hunyuan Community License (exclue UE, Royaume-Uni, Corée du Sud)",
        weights_gb=weights, largest_component_gb=16.7, download_size_gb=size,
        memory_hint=f"≈ {weights:.0f} Go de poids (bf16), {size:.0f} Go à télécharger. Mac avec 64 Go de mémoire minimum "
        "(très lent) ; GPU 24 Go+ avec 48 Go de RAM. Pas de version GGUF utilisable avec diffusers.",
        tags=["image→vidéo" if i2v else "texte→vidéo", "24 ips", "licence restreinte"],
        options={"pipeline": "HunyuanVideo15ImageToVideoPipeline" if i2v else "HunyuanVideo15Pipeline",
                 "family": "hunyuan", "guider": not i2v, "i2v_pipeline": None},
    )


HUNYUAN_T2V = _hunyuan("hunyuan-video-1.5-t2v", "HunyuanVideo 1.5 T2V 480p", "hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-480p_t2v",
                       False, 53.4, 33.8, "Réalisme et mouvement soignés, clips en 480p.", (50, 20), 6.0)
HUNYUAN_I2V = _hunyuan("hunyuan-video-1.5-i2v", "HunyuanVideo 1.5 I2V 480p (distillé)",
                       "hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-480p_i2v_step_distilled",
                       True, 34.6, 34.6, "Anime une image avec un mouvement soigné, rapide grâce à la distillation.", (12, 4), 1.0)

# Pack models ---------------------------------------------------------------------------------------------

# 20.38 GB: transformer 10.0, mllm_encoder 7.6, vae 2.8, rest < 1. The repo carries its own pipeline code, which diffusers
# runs with trust_remote_code (checked against revision 2760d81, 2026-10).
KIWI_REPO = "linyq/kiwi-edit-5b-instruct-reference-diffusers"

KIWI_EDIT = ModelSpec(
    id="kiwi-edit-5b",
    name="Kiwi-Edit 5B",
    family="Kiwi-Edit",
    description="Édition de vidéo par instruction, avec image de référence optionnelle.",
    engine="kiwi_engine:KiwiEngine", backend="pack", kind="video", text_to_image=False,
    default_quantize=None, quantize_options=[],
    params=[_steps(50, 10, 60)],  # the pipeline runs without classifier-free guidance: no guidance, no negative prompt
    size_multiple=32,
    video=VideoCaps(
        tasks=["v2v"], fps=15, frame_step=4, default_seconds=4.0, min_seconds=1.0, max_seconds=5.4,
        resolutions=[_res("480p", 480, 832), _res("720p", 704, 1280)], default_resolution="480p",
        image_input="optional", image_role="reference", video_input="required", english_only=True,
        license_warning="Licence non précisée sur les poids Hugging Face (le code GitHub est sous MIT) ; l'encodeur dérive de "
        "Qwen2.5-VL-3B, sous licence de recherche Qwen (usage non commercial). Vérifiez avant tout usage commercial.",
    ),
    hf_repo=KIWI_REPO,
    sources=[_src(KIWI_REPO, None, ["model_index.json", "pipeline_kiwi_edit.py", "mllm_encoder.py", "wan_video_vae.py",
                                     "transformer/*.safetensors", "mllm_encoder/model-*.safetensors", "vae/*.safetensors"], 20.4)],
    license="Non précisée (poids) · MIT (code) · encodeur Qwen2.5-VL-3B : licence de recherche Qwen",
    weights_gb=20.4, largest_component_gb=10.0, download_size_gb=20.4,
    memory_hint="Poids bf16 de 20,4 Go (transformeur 10 Go, encodeur Qwen2.5-VL 7,6 Go, VAE 2,8 Go) chargés en entier sur la "
    "carte graphique : NVIDIA avec 24 Go de mémoire minimum et 32 Go de RAM (estimation d'après les poids, non mesurée ; "
    "le dépôt officiel cible CUDA 12.8). Sources limitées à 81 images (≈ 5 s). Pas de version quantifiée. Ne tourne ni sur "
    "Mac ni sur processeur.",
    tags=["montage vidéo", "image de référence", "15 ips", "NVIDIA"],
    options={"pack": "kiwi", "min_vram_gb": 24, "min_ram_gb": 32},
)

# 28.9 GB on disk (fp32): UMT5 text encoder 22.7, transformer 5.7, vae 0.5 (checked against revision ff4c5d4, 2026-10).
BERNINI_R_REPO = "ByteDance/Bernini-R-1.3B-Diffusers"

BERNINI_R_13B = ModelSpec(
    id="bernini-r-1.3b",
    name="Bernini-R 1.3B",
    family="Bernini",
    description="Génération et édition de vidéo guidées par un planificateur multimodal.",
    engine="bernini_engine:BerniniEngine", backend="pack", kind="video", text_to_image=False,
    default_quantize=None, quantize_options=[],
    params=[_steps(40, 10, 60), NEGATIVE],
    size_multiple=16,
    video=VideoCaps(
        tasks=["t2v", "i2v", "v2v"], fps=16, frame_step=4, default_seconds=5.0, min_seconds=1.0, max_seconds=5.0,
        resolutions=[_res("480p", 480, 848)], default_resolution="480p",
        image_input="optional", image_role="reference", video_input="optional",
    ),
    hf_repo=BERNINI_R_REPO,
    sources=[_src(BERNINI_R_REPO, ["config.json", "scheduler/*", "tokenizer/*", "text_encoder/*", "transformer/*", "vae/*"],
                  ["config.json", "text_encoder/*.safetensors", "transformer/*.safetensors", "vae/*.safetensors"], 28.9)],
    license="Apache 2.0",
    weights_gb=28.9, largest_component_gb=22.7, download_size_gb=28.9,
    memory_hint="Version légère de Bernini : le moteur de rendu seul (Wan 2.1 1,3 Md), sans le planificateur multimodal "
    "(le planificateur complet pèse 192 Go). 28,9 Go à télécharger (poids fp32). Le code charge les composants sur la carte "
    "graphique à tour de rôle (≈ 14 Go en bf16 au total) : NVIDIA avec 16 Go minimum et 32 Go de RAM (estimation d'après "
    "le code, non mesurée). Le guide officiel lance la vidéo sur 8 GPU ; le mode 1 GPU est celui de la démo Gradio. "
    "Proche de la version 14 Md sur les tâches simples (style, retrait de sous-titres, retouche locale), moins bon sur "
    "les scènes complexes et les personnes. Ne tourne ni sur Mac ni sur processeur.",
    tags=["texte→vidéo", "montage vidéo", "image de référence", "16 ips", "Apache 2.0", "NVIDIA"],
    options={"pack": "bernini", "min_vram_gb": 16, "min_ram_gb": 32},
)

PACK_SPECS = [KIWI_EDIT, BERNINI_R_13B]

SPECS = [COGVIDEOX_2B, WAN_TI2V_5B, COGVIDEOX_5B, COGVIDEOX_5B_I2V, WAN_T2V_A14B, WAN_I2V_A14B, LTX_23, HUNYUAN_T2V, HUNYUAN_I2V]
