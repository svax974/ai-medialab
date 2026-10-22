# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Video models run by stable-diffusion.cpp (`sd-cli -M vid_gen`: Metal, CUDA, ROCm, Vulkan).

Quantized GGUF transformers plus the text encoder and VAEs they need, no PyTorch. They sit next to the diffusers
versions in `video_specs.py` (same pattern as Z-Image Turbo: one GGUF entry, one PyTorch entry); the catalog recommends
these. See `sdcpp_video_engine.py` for what `options` mean. Sizes come from the Hugging Face API (checked 2026-10), and
the command lines follow the guides of stable-diffusion.cpp (docs/wan.md, ltx2.md, hunyuan_video.md at master-956).

Each model lists every file it needs by role (the sd-cli option that receives it). `overhead_gb` is the memory used while
computing, on top of the weights: an estimate that feeds the "does it fit" check, not a measurement.

LTX-2.5 is the only model with gated files (the VAEs and the Gemma 4 encoder): `gated=True`, a Hugging Face token is needed.
"""

from __future__ import annotations

import platform
import sys

from .base import HfSource, ModelSpec, ParamSpec, Variant, VideoCaps, VideoResolution
from .video_specs import NEGATIVE, TENCENT_WARNING

ENGINE = "app.engines.sdcpp_video_engine:SdcppVideoEngine"

# Component: (sd-cli role, (repo, file), size in GB).
Comp = tuple[str, tuple[str, str], float]

# Recommended negative prompt of the Wan guides (used when the user leaves the field empty).
WAN_NEGATIVE = ("色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，"
                "丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，"
                "杂乱的背景，三条腿，背景人很多，倒着走")
LTX_NEGATIVE = "worst quality, low quality, blurry, distorted, artifacts"
# Schedule of the distilled LTX models (8 steps, no guidance), as in diffusers' DISTILLED_SIGMA_VALUES plus the final 0.
LTX_SIGMAS = "1.0,0.99375,0.9875,0.98125,0.975,0.909375,0.725,0.421875,0.0"
LTX_LICENSE = "LTX-2 Community License (usage libre sous 10 M$ de chiffre d'affaires annuel) ; encodeur de texte sous licence Gemma"
GATED_NOTICE = ("Accès restreint : acceptez la licence sur Hugging Face (dépôts Lightricks/LTX-2.5 et "
                "elix3r/gemma4-12b-with-proj-ltx-2.5-GGUF), puis renseignez votre jeton dans Réglages → Modèles.")

UMT5 = ("city96/umt5-xxl-encoder-gguf", "umt5-xxl-encoder-Q4_K_M.gguf")
QWEN_VL = ("mradermacher/Qwen2.5-VL-7B-Instruct-GGUF", "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf")  # shared with Qwen Image Edit


# "Fast decode" (sd-cli --tae, see taehv.py). The full Wan VAE takes 150-170 s on Metal even at 384x256x9 (scalar 3D
# convolution, --vae-tiling changes nothing), TAEHV 0.7 s at 480x832x9 with a peak of 7.6 GB. On by default on Apple
# Silicon only: CUDA, ROCm and Vulkan decode the full VAE in reasonable time.
FAST_DECODE_DEFAULT = sys.platform == "darwin" and platform.machine() == "arm64"
FAST_DECODE = ParamSpec(
    "fast_decode", "Décodage rapide", "bool", FAST_DECODE_DEFAULT,
    help="Décode en moins d'une seconde au lieu de plusieurs minutes (Metal) ; légère perte de détail.")


def _res(rid: str, short: int, long: int) -> VideoResolution:
    return VideoResolution(rid, rid, short, long)


def _sources(comps: list[Comp]) -> list[HfSource]:
    """One source per repo (one download process each), in order of first appearance."""
    repos: dict[str, list[tuple[str, float]]] = {}
    for _, (repo, file), size in comps:
        repos.setdefault(repo, []).append((file, size))
    return [HfSource(repo, [f for f, _ in fs], [f for f, _ in fs], round(sum(s for _, s in fs), 2)) for repo, fs in repos.items()]


def _files(comps: list[Comp]) -> dict[str, tuple[str, str]]:
    return {role: file for role, file, _ in comps}


def _model(quants: list[tuple[str, float]], default: str, comps_for, **spec) -> ModelSpec:
    """A spec whose diffusion file(s) come in several quantizations. `comps_for(quant, size)` lists its components."""
    options = dict(spec.pop("options"))
    variants = []
    for label, size in quants:
        comps = comps_for(label, size)
        total = round(sum(c[2] for c in comps), 2)
        variants.append(Variant(label, label, total, _sources(comps), weights_gb=total,
                                options={"files": _files(comps), "diffusion_gb": size},
                                largest_component_gb=max(c[2] for c in comps)))
    chosen = next(v for v in variants if v.key == default)
    return ModelSpec(
        engine=ENGINE, backend="sdcpp", kind="video", text_to_image=False, default_quantize=None, quantize_options=[],
        sources=chosen.sources, options={**options, **chosen.options}, variants=variants, default_variant=default,
        weights_gb=chosen.weights_gb, largest_component_gb=chosen.largest_component_gb, download_size_gb=chosen.size_gb,
        **spec,
    )


def _steps(default: int, lo: int, hi: int, help_: str = "Plus d'étapes = plus de détails, plus lent.") -> ParamSpec:
    return ParamSpec("steps", "Étapes", "int", default, lo, hi, 1, help_)


def _guidance(default: float, hi: float = 12.0) -> ParamSpec:
    return ParamSpec("guidance", "Guidance", "float", default, 1.0, hi, 0.5, "Fidélité au prompt (1 = désactivée).")


# Wan 2.2 -------------------------------------------------------------------------------------------------

WAN_5B_REPO = "QuantStack/Wan2.2-TI2V-5B-GGUF"
WAN_CLI = ["--sampling-method", "euler", "--flow-shift", "3.0", "--vae-tiling"]


def _wan5(quant: str, size: float) -> list[Comp]:
    return [("diffusion-model", (WAN_5B_REPO, f"Wan2.2-TI2V-5B-{quant}.gguf"), size),
            ("vae", (WAN_5B_REPO, "VAE/Wan2.2_VAE.safetensors"), 1.41),  # the 5B has its own VAE: not Wan 2.1's
            ("t5xxl", UMT5, 3.66)]


WAN_TI2V_5B = _model(
    [("Q4_K_M", 3.43), ("Q5_K_M", 3.81), ("Q8_0", 5.4)], "Q4_K_M", _wan5,
    id="wan-2.2-ti2v-5b-gguf",
    name="Wan 2.2 TI2V 5B",
    family="Wan",
    description="Polyvalent, meilleure qualité ouverte en texte → vidéo et image → vidéo. Version quantifiée "
    "(GGUF) : ≈ 8,5 Go, sans PyTorch, sur Mac, NVIDIA, AMD et Intel.",
    params=[_steps(20, 10, 50), _guidance(6.0), FAST_DECODE, NEGATIVE],
    size_multiple=32,
    # Measured with the Q4_K_M on an M3 Max (36 GB): at 384x256 the 5B draws abstract noise whatever the step count (6 or
    # 20), so nothing below 480p is offered; native sizes are 480x832 and 704x1280. At 480x832, 20 steps: 9 frames take
    # about 6 s per step and ~7 GB; 33 frames about 20 s per step and push the whole machine to < 6 GB free, so one run
    # is kept short and 20 steps is the default. Clips up to 20 s are chained runs, each one starting from the last frame
    # of the previous; a run is as long as the memory measured on this machine allows, up to the model's 5 s clip
    # (121 frames at 24 fps), see SdcppVideoEngine._generate_chained and video_memory.py.
    video=VideoCaps(
        tasks=["t2v", "i2v"], fps=24, frame_step=4, default_seconds=1.0, min_seconds=1.0, max_seconds=20.0,
        segment_seconds=5.0,
        resolutions=[_res("480p", 480, 832), _res("720p", 704, 1280)], default_resolution="480p", image_input="optional",
    ),
    license="Apache 2.0",
    memory_hint="≈ 8,5 Go de poids (Q4_K_M : diffusion 3,4 + encodeur de texte 3,7 + VAE 1,4) et quelques Go de calcul. "
    "Mac Apple Silicon avec 24 Go de mémoire minimum. 480p recommandé : la 720p et le décodage du VAE sont très longs. "
    "Mesuré sur un M3 Max (36 Go) : clip d'une seconde en 480p, environ 7 Go ; au-delà de 1,5 s la mémoire devient juste, "
    "donc les clips plus longs (jusqu'à 20 s) sont faits par tranches enchaînées, chacune partant de la dernière image de la précédente ; la longueur d'une tranche suit la mémoire mesurée sur la machine (courte au premier essai, puis ajustée). Durée multipliée et mouvement qui peut changer d'une tranche à l'autre. "
    "La variante Q8_0 gagne en finesse. Le décodage rapide (TAEHV, 23 Mo téléchargés au premier usage) ramène le décodage de plusieurs minutes à une seconde sur Mac.",
    tags=["texte→vidéo", "image→vidéo", "24 ips", "GGUF", "Apache 2.0"],
    options={"files": {}, "cli_args": WAN_CLI, "offload_to_cpu": True, "default_negative": WAN_NEGATIVE, "overhead_gb": 5.0,
             "tae": "taew2_2"},
)


def _wan14(task: str, kind: str, desc: str) -> ModelSpec:
    repo = f"QuantStack/Wan2.2-{kind}-A14B-GGUF"

    def comps(quant: str, size: float) -> list[Comp]:
        return [("diffusion-model", (repo, f"LowNoise/Wan2.2-{kind}-A14B-LowNoise-{quant}.gguf"), size),
                ("high-noise-diffusion-model", (repo, f"HighNoise/Wan2.2-{kind}-A14B-HighNoise-{quant}.gguf"), size),
                ("vae", (repo, "VAE/Wan2.1_VAE.safetensors"), 0.25),  # every Wan but the 5B uses the 2.1 VAE
                ("t5xxl", UMT5, 3.66)]

    t2v = task == "t2v"
    return _model(
        [("Q4_K_S", 8.75), ("Q4_K_M", 9.65)], "Q4_K_S", comps,
        id=f"wan-2.2-{task}-a14b-gguf",
        name=f"Wan 2.2 {kind} 14B",
        family="Wan",
        description=desc,
        # Guides: 10 low-noise + 8 high-noise steps, guidance 3.5 on both experts.
        params=[_steps(18, 8, 40, "Réparties entre les deux experts (≈ 45 % pour celui du bruit fort)."), _guidance(3.5),
                FAST_DECODE, NEGATIVE],
        size_multiple=32,
        video=VideoCaps(
            tasks=["t2v"] if t2v else ["i2v"], fps=16, frame_step=4, default_seconds=3.0, min_seconds=1.0,
            max_seconds=5.0 if t2v else 20.0, segment_seconds=None if t2v else 5.0,  # i2v: chained runs, up to the model's 5 s clip
            resolutions=[_res("480p", 480, 832), _res("720p", 720, 1280)], default_resolution="480p",
            image_input="none" if t2v else "required", last_frame=not t2v,
        ),
        license="Apache 2.0",
        memory_hint="Deux experts de 14 Md de paramètres en Q4 : ≈ 21,5 Go de poids avec l'encodeur de texte, le tout en "
        "mémoire. Lent et réservé aux machines puissantes : Mac avec 48 Go de mémoire minimum ; carte graphique 24 Go+ "
        "avec 32 Go de RAM. Préférez la version 5B pour essayer.",
        tags=["texte→vidéo" if t2v else "image→vidéo", "16 ips", "14 Md", "GGUF", "Apache 2.0", "lent"],
        options={"files": {}, "cli_args": WAN_CLI, "offload_to_cpu": True, "default_negative": WAN_NEGATIVE, "overhead_gb": 8.0,
                 "tae": "taew2_1", "high_noise": {"steps_ratio": 8 / 18, "sampling": "euler"}},
    )


WAN_T2V_A14B = _wan14("t2v", "T2V", "Qualité maximale en texte → vidéo, plus lourd et plus lent que la version 5B.")
WAN_I2V_A14B = _wan14("i2v", "I2V", "Anime une image avec un rendu de très haute qualité, début et fin au choix.")


# LTX ------------------------------------------------------------------------------------------------------

LTX23 = "unsloth/LTX-2.3-GGUF"
GEMMA3 = ("unsloth/gemma-3-12b-it-qat-GGUF", "gemma-3-12b-it-qat-UD-Q4_K_XL.gguf")


def _ltx23(quant: str, size: float) -> list[Comp]:
    return [("diffusion-model", (LTX23, f"distilled-1.1/ltx-2.3-22b-distilled-1.1-{quant}.gguf"), size),
            ("vae", (LTX23, "vae/ltx-2.3-22b-distilled_video_vae.safetensors"), 1.45),
            ("audio-vae", (LTX23, "vae/ltx-2.3-22b-distilled_audio_vae.safetensors"), 0.36),
            ("embeddings-connectors", (LTX23, "text_encoders/ltx-2.3-22b-distilled_embeddings_connectors.safetensors"), 2.31),
            ("llm", GEMMA3, 7.43)]


def _ltx_caps() -> VideoCaps:
    return VideoCaps(
        tasks=["t2v", "i2v"], fps=24, frame_step=8, default_seconds=4.0, min_seconds=1.0, max_seconds=8.0,
        resolutions=[_res("512p", 512, 768), _res("720p", 704, 1280)], default_resolution="512p",
        image_input="optional", audio_out=True, english_only=True,
    )



LTX_CLI = ["--sampling-method", "euler", "--vae-tiling"]

LTX_23 = _model(
    [("Q3_K_M", 10.63), ("Q4_K_S", 12.96), ("Q4_K_M", 14.19)], "Q4_K_S", _ltx23,
    id="ltx-2.3-distilled-gguf",
    name="LTX-2.3 Distilled",
    family="LTX",
    description="Rapide et haute définition, génère aussi le son synchronisé. Version quantifiée (GGUF), sans compte "
    "Hugging Face.",
    params=[_steps(8, 8, 8, "Le modèle est distillé pour 8 étapes."), NEGATIVE],
    size_multiple=32,
    video=_ltx_caps(),
    license=LTX_LICENSE,
    memory_hint="Modèle de 22 Md de paramètres : ≈ 24,5 Go de poids en Q4_K_S (Q3_K_M : 22 Go) avec l'encodeur Gemma 3, "
    "tous en mémoire. Mac : 48 Go conseillés (la variante Q3_K_M tient sur 36 Go) ; carte graphique : 24 Go de VRAM + "
    "32 Go de RAM. Prompts en anglais. Version distillée 1.1 : 8 étapes, sans guidance.",
    tags=["texte→vidéo", "image→vidéo", "son", "24 ips", "rapide", "GGUF"],
    options={"files": {}, "cli_args": LTX_CLI, "offload_to_cpu": True, "sigmas": LTX_SIGMAS, "overhead_gb": 4.0},
)

LTX25 = "vantagewithai/LTX-2.5-GGUF"
LTX25_BASE = "Lightricks/LTX-2.5"
GEMMA4 = ("elix3r/gemma4-12b-with-proj-ltx-2.5-GGUF", "gemma4-12b-with-proj-ltx-2.5-Q4_K_M.gguf")


def _ltx25(quant: str, size: float) -> list[Comp]:
    return [("diffusion-model", (LTX25, f"distilled/ltx-2.5-22b-distilled-transformer-{quant}.gguf"), size),
            # The conv VAE: the default video VAE of the repo is a diffusion decoder, which sd.cpp does not implement.
            ("vae", (LTX25_BASE, "vae/ltx-2.5-video-vae-conv-bf16.safetensors"), 1.45),
            ("audio-vae", (LTX25_BASE, "vae/ltx-2.5-audio-vae-bf16.safetensors"), 0.36),
            ("llm", GEMMA4, 8.41)]  # text projection bundled: no --embeddings-connectors


LTX_25 = _model(
    [("Q3_K_M", 12.92), ("Q4_K_S", 15.33), ("Q4_K_M", 15.69)], "Q4_K_S", _ltx25,
    id="ltx-2.5-distilled-gguf",
    name="LTX-2.5 Distilled",
    family="LTX",
    description="Dernière version de LTX : image et son plus soignés. Version quantifiée (GGUF). Les fichiers sont à "
    "accès restreint : un compte Hugging Face est nécessaire.",
    params=[_steps(8, 8, 8, "Le modèle est distillé pour 8 étapes."), NEGATIVE],
    size_multiple=32,
    video=_ltx_caps(),
    license=LTX_LICENSE,
    gated=True,
    memory_hint="Modèle de 22 Md de paramètres : ≈ 25,5 Go de poids en Q4_K_S (Q3_K_M : 23 Go) avec l'encodeur Gemma 4, "
    "tous en mémoire. Mac : 48 Go conseillés ; carte graphique : 24 Go de VRAM + 32 Go de RAM. Prompts en anglais. "
    "Version distillée : 8 étapes, sans guidance. " + GATED_NOTICE,
    tags=["texte→vidéo", "image→vidéo", "son", "24 ips", "GGUF", "accès restreint"],
    options={"files": {}, "cli_args": LTX_CLI, "offload_to_cpu": True, "sigmas": LTX_SIGMAS, "overhead_gb": 4.0},
)


# HunyuanVideo 1.5 -----------------------------------------------------------------------------------------

HY_COMFY = "Comfy-Org/HunyuanVideo_1.5_repackaged"


def _hunyuan(task: str, desc: str) -> ModelSpec:
    t2v = task == "t2v"
    repo = f"jayn7/HunyuanVideo-1.5_{task.upper()}_480p-GGUF"

    def comps(quant: str, size: float) -> list[Comp]:
        return [("diffusion-model", (repo, f"480p/hunyuanvideo1.5_480p_{task}-{quant}.gguf"), size),
                ("vae", (HY_COMFY, "split_files/vae/hunyuanvideo15_vae_fp16.safetensors"), 2.52),
                ("llm", QWEN_VL, 4.68),
                ("t5xxl", (HY_COMFY, "split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors"), 0.44)]

    return _model(
        [("Q4_K_S", 4.92), ("Q4_K_M", 5.09), ("Q5_K_M", 6.12), ("Q8_0", 9.0)], "Q4_K_M", comps,
        id=f"hunyuan-video-1.5-{task}-gguf",
        name=f"HunyuanVideo 1.5 {task.upper()} 480p",
        family="HunyuanVideo",
        description=desc,
        params=[_steps(30, 15, 50), _guidance(6.0), NEGATIVE],
        size_multiple=32,
        video=VideoCaps(
            tasks=["t2v"] if t2v else ["i2v"], fps=24, frame_step=4, default_seconds=3.0, min_seconds=1.0,
            max_seconds=5.0 if t2v else 20.0, segment_seconds=None if t2v else 5.0,  # i2v: chained runs, up to the model's 5 s clip
            resolutions=[_res("480p", 480, 848)], default_resolution="480p",
            image_input="none" if t2v else "required", license_warning=TENCENT_WARNING,
        ),
        license="Tencent Hunyuan Community License (exclue UE, Royaume-Uni, Corée du Sud)",
        memory_hint="≈ 12,7 Go de poids en Q4_K_M (diffusion 5,1 + VAE 2,5 + encodeur Qwen2.5-VL 4,7 + ByT5 0,4) et quelques "
        "Go de calcul. Mac avec 24 Go de mémoire minimum ; carte graphique 12 Go+. "
        + ("" if t2v else "L'image → vidéo est prise en charge par stable-diffusion.cpp mais absente de son guide : à vérifier. "),
        tags=["texte→vidéo" if t2v else "image→vidéo", "24 ips", "GGUF", "licence restreinte"],
        options={"files": {}, "cli_args": ["--sampling-method", "euler", "--vae-tiling"], "offload_to_cpu": True,
                 "overhead_gb": 5.0},
    )


HUNYUAN_T2V = _hunyuan("t2v", "Réalisme et mouvement soignés, clips en 480p. Version quantifiée (GGUF).")
HUNYUAN_I2V = _hunyuan("i2v", "Anime une image avec un mouvement soigné, clips en 480p. Version quantifiée (GGUF).")

SPECS = [WAN_TI2V_5B, WAN_T2V_A14B, WAN_I2V_A14B, LTX_23, LTX_25, HUNYUAN_T2V, HUNYUAN_I2V]
