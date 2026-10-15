# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Models the user adds from Hugging Face.

A custom model is just a "recipe" (repo, chosen file, family) stored in the engine's state file (`engine_state.py`). The matching
`ModelSpec` is rebuilt without network access, worker processes included. Only families the app knows
how to run are accepted:

    gguf-variant   another quantization (or fine-tune) of an already supported GGUF model: the reference
                   model's diffusion file is swapped, its other components (encoder, VAE) are kept
    sd-diffusers   Stable Diffusion 1.x or XL diffusers repo (PyTorch engine)
    sdxl-lora      LoRA for SDXL: one safetensors file loaded on top of the built-in SDXL base (shared download)
    qwen3-tts      Qwen3-TTS variant (preset voices, voice design or cloning)
    whisper-ct2    Whisper converted for faster-whisper (transcription)
    video-diffusers  Wan 2.x / CogVideoX / HunyuanVideo 1.5 / LTX-2 diffusers repo: runs with the settings of the
                   matching built-in model (same pipeline family)
    video-gguf     another GGUF of the Wan 2.2 TI2V 5B transformer (text encoder and VAE are kept), run by
                   stable-diffusion.cpp; recipes saved before that ran it with diffusers and still do
    llm-gguf       a language model in GGUF (one file or split in shards, optionally with its multimodal projector),
                   chatted with through llama.cpp
"""

from __future__ import annotations

import copy
import dataclasses
import re
from typing import Any

from .. import engine_state
from ..config import DATA_DIR
from . import audio_specs, gguf_models, llm_models, torch_models, video_gguf, video_specs
from .base import AudioCaps, HfSource, LlmCaps, ModelSpec, ParamSpec, PresetVoice

SETTINGS_KEY = "custom_models"

# Reference GGUF models: Hugging Face base_model -> id of the model whose spec is copied.
GGUF_TEMPLATES = {
    "Tongyi-MAI/Z-Image-Turbo": "z-image-turbo-gguf",
    "Qwen/Qwen-Image-2.1": "qwen-image-2.1-gguf",
    "Qwen/Qwen-Image-Edit-2511": "qwen-image-edit-gguf",
}

# Hugging Face base model of the LoRAs the app can load (on the built-in SDXL).
SDXL_BASE = "stabilityai/stable-diffusion-xl-base-1.0"

SD_PIPELINES = {
    "StableDiffusionXLPipeline": ("StableDiffusionXLImg2ImgPipeline", True),
    "StableDiffusionPipeline": ("StableDiffusionImg2ImgPipeline", False),
}


# Video: diffusers pipeline class -> id of the built-in model whose settings are copied.
VIDEO_TEMPLATES = {
    "WanPipeline": "wan-2.2-ti2v-5b",
    "WanImageToVideoPipeline": "wan-2.2-ti2v-5b",
    "CogVideoXPipeline": "cogvideox-2b",
    "CogVideoXImageToVideoPipeline": "cogvideox-5b-i2v",
    "HunyuanVideo15Pipeline": "hunyuan-video-1.5-t2v",
    "HunyuanVideo15ImageToVideoPipeline": "hunyuan-video-1.5-i2v",
    "LTX2Pipeline": "ltx-2.3-distilled",
    "LTX2ImageToVideoPipeline": "ltx-2.3-distilled",
}
# Wan 2.2 A14B repos (two experts) have their own settings.
WAN_A14B_TEMPLATES = {"WanPipeline": "wan-2.2-t2v-a14b", "WanImageToVideoPipeline": "wan-2.2-i2v-a14b"}
# GGUF repos of a reference video model: Hugging Face base_model -> id of the model whose spec is copied.
VIDEO_GGUF_TEMPLATES = {"Wan-AI/Wan2.2-TI2V-5B": "wan-2.2-ti2v-5b-gguf"}
I2V_PIPELINES = {"WanImageToVideoPipeline", "CogVideoXImageToVideoPipeline", "HunyuanVideo15ImageToVideoPipeline",
                 "LTX2ImageToVideoPipeline"}


def video_template_id(pipeline: str, files: list[str] | set[str]) -> str:
    if pipeline in WAN_A14B_TEMPLATES and any(f.startswith("transformer_2/") for f in files):
        return WAN_A14B_TEMPLATES[pipeline]
    return VIDEO_TEMPLATES[pipeline]


def slug(repo: str, extra: str = "") -> str:
    return "custom-" + re.sub(r"[^a-z0-9]+", "-", f"{repo}-{extra}".lower()).strip("-")


def _title(repo: str) -> str:
    return repo.split("/", 1)[-1].replace("_", " ").replace("-", " ").strip()


# Recipes -> specs

def _gguf_variant(r: dict[str, Any]) -> ModelSpec:
    base = next(s for s in gguf_models.SPECS if s.id == r["template"])
    spec = copy.deepcopy(base)
    spec.variants, spec.default_variant, spec.variant = [], "", ""  # a recipe is one specific file
    repo, file, size = r["repo"], r["file"], float(r["size_gb"])
    old_repo, old_file = base.options["files"]["diffusion-model"]
    i = next(i for i, s in enumerate(base.sources) if s.repo == old_repo and old_file in (s.patterns or []))
    old_src = base.sources[i]
    spec.sources[i] = HfSource(repo, [file], [file], size)
    spec.options["files"]["diffusion-model"] = (repo, file)
    delta = size - (old_src.size_gb or 0)
    spec.download_size_gb = round((base.download_size_gb or 0) + delta, 2)
    spec.weights_gb = round((base.weights_gb or 0) + delta, 2)
    spec.largest_component_gb = max(base.largest_component_gb or 0, size)
    spec.id, spec.custom, spec.precision = r["id"], True, r["precision"]
    spec.name = f"{base.name} · {r['name']}"
    spec.description = (f"Variante {r['precision']} du dépôt {repo}, exécutée comme {base.name} (mêmes encodeur de texte "
                        f"et VAE). Plus la quantification est basse, plus le fichier est léger et la qualité dégradée.")
    spec.license = r.get("license") or "voir le dépôt"
    spec.memory_hint = f"≈ {spec.weights_gb:.0f} Go de poids ({r['precision']})."
    spec.tags = [t for t in base.tags if t not in ("Apache 2.0",)] + ["Hugging Face"]
    return spec


def _sd_diffusers(r: dict[str, Any]) -> ModelSpec:
    pipeline = r["pipeline"]
    img2img, xl = SD_PIPELINES[pipeline]
    files = list(r["files"])
    load_kwargs: dict[str, Any] = {"use_safetensors": True}
    if r.get("fp16"):
        load_kwargs["variant"] = "fp16"
    if not xl:
        load_kwargs.update(safety_checker=None, requires_safety_checker=False)
    size = float(r["size_gb"])
    return ModelSpec(
        id=r["id"], name=r["name"], family="Stable Diffusion", custom=True,
        description=f"Modèle Stable Diffusion {'XL ' if xl else '1.x '}du dépôt {r['repo']} (format diffusers, "
                    f"PyTorch). Texte → image et image → image.",
        engine="app.engines.diffusers_engine:DiffusersEngine", backend="torch",
        default_quantize=None, quantize_options=[], reference_mode="init", max_references=1,
        params=[
            ParamSpec("steps", "Étapes", "int", r.get("steps", 30), 1, 60, 1,
                      "25 à 35 étapes suffisent en général ; 1 à 8 pour les modèles « turbo » / « lightning »."),
            ParamSpec("guidance", "Guidance", "float", r.get("guidance", 6.0 if xl else 7.5), 0.0, 14.0, 0.5,
                      "Fidélité au prompt (5–8 conseillé ; 0–1 pour les modèles « turbo » / « lightning »)."),
            ParamSpec("strength", "Influence de l'image", "float", 0.6, 0.1, 0.95, 0.05,
                      "Part de l'image de départ transformée. Bas = proche de l'original.", requires_references=True),
            ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
        ],
        size_multiple=64, min_side=512 if xl else 256, max_side=1536 if xl else 1024,
        default_megapixels=1.0 if xl else 0.25,
        hf_repo=r["repo"],  # read by the diffusers engine (files to download are in `sources`)
        sources=[HfSource(r["repo"], files, [f for f in files if f.endswith(".safetensors")] + ["model_index.json"], size)],
        download_size_gb=size, license=r.get("license") or "voir le dépôt",
        weights_gb=float(r["weights_gb"]), largest_component_gb=float(r["largest_gb"]),
        memory_hint=f"≈ {r['weights_gb']:.0f} Go en {r['precision']}.", precision=r["precision"],
        tags=["texte→image", "img2img", "Hugging Face"],
        options={"pipeline": pipeline, "img2img": img2img, "guidance_arg": "guidance_scale", "load_kwargs": load_kwargs},
    )


def _sdxl_lora(r: dict[str, Any]) -> ModelSpec:
    trigger = r.get("trigger") or ""
    return torch_models.sdxl_lora(
        id=r["id"], name=f"SDXL · {r['name']}", repo=r["repo"], file=r["file"], size_gb=float(r["size_gb"]),
        description=f"LoRA du dépôt {r['repo']} appliquée à Stable Diffusion XL"
                    + (f" ; mots déclencheurs ajoutés au prompt : « {trigger} »." if trigger else "."),
        license=r.get("license") or "voir le dépôt", trigger=trigger, tags=["Hugging Face"], custom=True,
    )


def _qwen3_tts(r: dict[str, Any]) -> ModelSpec:
    kind = r["variant"]  # custom_voice | voice_design | base
    langs = audio_specs.QWEN_LANGS
    known = {v.id.lower(): v for v in audio_specs._QWEN_SPEAKERS}
    voices = []
    for spk in r.get("speakers", []):
        v = known.get(spk.lower())
        voices.append(v or PresetVoice(spk, spk.replace("_", " ").title(), "*", "n", "Voix du modèle"))
    caps = AudioCaps(
        languages=langs, max_chars=400,
        voices=voices if kind == "custom_voice" else [],
        clone="optional" if kind == "base" else "none",
        instruct=kind != "base", design=kind == "voice_design",
        instruct_help=("Décrivez la voix : « femme de 30 ans, voix grave et rassurante »…" if kind == "voice_design"
                       else audio_specs._QWEN_STYLE),
    )
    label = {"custom_voice": "Voix & style", "voice_design": "Création de voix", "base": "Clonage"}[kind]
    return ModelSpec(
        id=r["id"], name=f"Qwen3-TTS · {label} · {r['name']}", family="Qwen3-TTS", kind="audio", custom=True,
        description=f"Variante de Qwen3-TTS ({label.lower()}) du dépôt {r['repo']}.",
        engine="qwen3_engine:Qwen3Engine", backend="pack",
        options={"pack": "qwen3", "variant": kind, "repo": r["repo"]},
        text_to_image=False, params=[audio_specs._QWEN_TEMPERATURE],
        sources=[HfSource(r["repo"], None, ["config.json", "model.safetensors", "speech_tokenizer/model.safetensors"],
                          float(r["size_gb"]))],
        download_size_gb=float(r["size_gb"]), weights_gb=float(r["size_gb"]), license=r.get("license") or "voir le dépôt",
        tags=["multilingue", "Hugging Face"], audio=caps, precision=r["precision"],
    )


def _whisper(r: dict[str, Any]) -> ModelSpec:
    size = float(r["size_gb"])
    return ModelSpec(
        id=r["id"], name=f"Whisper · {r['name']}", family="Whisper", kind="audio", custom=True,
        description=f"Transcription (faster-whisper) du dépôt {r['repo']}.",
        engine="", backend="pack", options={"pack": "speech", "repo": r["repo"]}, text_to_image=False,
        sources=[HfSource(r["repo"], None, ["model.bin", "config.json", "tokenizer.json"], size)],
        download_size_gb=size, weights_gb=size, license=r.get("license") or "voir le dépôt",
        tags=["transcription", "Hugging Face"], audio=AudioCaps(task="stt", languages=[]), precision=r["precision"],
    )


def _video_diffusers(r: dict[str, Any]) -> ModelSpec:
    base = next(m for m in video_specs.SPECS if m.id == r["template"])
    spec = copy.deepcopy(base)
    spec.variants, spec.default_variant, spec.variant = [], "", ""  # a recipe is one specific set of files
    pipeline, files, size = r["pipeline"], list(r["files"]), float(r["size_gb"])
    i2v = pipeline in I2V_PIPELINES
    caps = spec.video
    spec.options = {k: v for k, v in base.options.items() if k not in ("gguf", "text_encoder_repo")}
    spec.options["pipeline"] = pipeline
    if i2v:  # an image → video repo: the start image is mandatory
        caps.tasks, caps.image_input, caps.video_input = ["i2v"], "required", "none"
        spec.options.update(i2v_pipeline=None, v2v_pipeline=None)
    else:
        animates = bool(spec.options.get("i2v_pipeline"))  # can the template turn a start image into a video?
        caps.tasks = [t for t in caps.tasks if t != "i2v" or animates] or ["t2v"]
        caps.image_input = caps.image_input if animates else "none"
        caps.last_frame = caps.last_frame and animates
    spec.id, spec.custom, spec.precision = r["id"], True, r["precision"]
    spec.name = f"{base.family} · {r['name']}"
    spec.description = (f"Modèle du dépôt {r['repo']} (format diffusers, PyTorch), exécuté avec les réglages de "
                        f"« {base.name} ». {base.description}")
    spec.hf_repo = r["repo"]
    spec.sources = [HfSource(r["repo"], files, [f for f in files if f.endswith(".safetensors")] + ["model_index.json"], size)]
    spec.download_size_gb = size
    spec.weights_gb, spec.largest_component_gb = float(r["weights_gb"]), float(r["largest_gb"])
    spec.license = r.get("license") or "voir le dépôt"
    spec.memory_hint = f"≈ {spec.weights_gb:.0f} Go de poids ({r['precision']}), {size:.0f} Go à télécharger."
    spec.tags = [t for t in base.tags if t not in ("Apache 2.0", "licence restreinte")] + ["Hugging Face"]
    return spec


def _video_sdcpp_gguf(r: dict[str, Any], base: ModelSpec) -> ModelSpec:
    """Same swap as `_gguf_variant`, for a video model: the diffusion file changes, everything else is kept."""
    spec = copy.deepcopy(base)
    spec.variants, spec.default_variant, spec.variant = [], "", ""
    repo, file, size = r["repo"], r["file"], float(r["size_gb"])
    old_repo, old_file = base.options["files"]["diffusion-model"]
    old_gb = base.options["diffusion_gb"]
    sources = []
    for s in base.sources:
        if s.repo == old_repo and old_file in (s.patterns or []):
            rest = [p for p in s.patterns if p != old_file]  # e.g. the VAE next to the GGUF files of Wan 2.2 5B
            if rest:
                sources.append(HfSource(s.repo, rest, rest, round((s.size_gb or 0) - old_gb, 2)))
            sources.insert(0, HfSource(repo, [file], [file], size))
        else:
            sources.append(s)
    spec.sources = sources
    spec.options["files"]["diffusion-model"] = (repo, file)
    delta = size - old_gb
    spec.download_size_gb = round((base.download_size_gb or 0) + delta, 2)
    spec.weights_gb = round((base.weights_gb or 0) + delta, 2)
    spec.largest_component_gb = max(base.largest_component_gb or 0, size)
    spec.id, spec.custom, spec.precision = r["id"], True, r["precision"]
    spec.name = f"{base.name} · {r['name']}"
    spec.description = (f"Variante {r['precision']} du dépôt {repo}, exécutée comme {base.name} (mêmes encodeur de texte "
                        f"et VAE). Plus la quantification est basse, plus le fichier est léger et la qualité dégradée.")
    spec.license = r.get("license") or "voir le dépôt"
    spec.memory_hint = f"≈ {spec.weights_gb:.0f} Go de poids ({r['precision']})."
    spec.tags = [t for t in base.tags if t not in ("Apache 2.0",)] + ["Hugging Face"]
    return spec


def _video_gguf(r: dict[str, Any]) -> ModelSpec:
    base = next(m for m in [*video_specs.SPECS, *video_gguf.SPECS] if m.id == r["template"])
    if base.backend == "sdcpp":
        return _video_sdcpp_gguf(r, base)
    variant = next(v for v in base.variants if v.options.get("gguf"))  # any 4-bit variant: same diffusers repo
    spec = copy.deepcopy(base)
    spec.variants, spec.default_variant, spec.variant = [], "", ""
    repo, file, size = r["repo"], r["file"], float(r["size_gb"])
    spec.options = {**base.options, **variant.options}
    spec.options["gguf"] = {"transformer": (repo, file)}
    spec.sources = [*variant.sources[:-1], HfSource(repo, [file], [file], size)]
    spec.download_size_gb = round(sum(s.size_gb or 0 for s in spec.sources), 2)
    spec.weights_gb = round((variant.weights_gb or 0) - (variant.sources[-1].size_gb or 0) + size, 1)
    spec.largest_component_gb = variant.largest_component_gb
    spec.id, spec.custom, spec.precision = r["id"], True, r["precision"]
    spec.name = f"{base.name} · {r['name']}"
    spec.description = (f"Variante {r['precision']} du dépôt {repo}, exécutée comme {base.name} (mêmes encodeur de texte "
                        f"et VAE). {base.description}")
    spec.license = r.get("license") or "voir le dépôt"
    spec.memory_hint = f"≈ {spec.weights_gb:.0f} Go de poids ({r['precision']})."
    spec.tags = [t for t in base.tags if t != "Apache 2.0"] + ["Hugging Face"]
    return spec


# Names of models that think before answering: their recipe gets a reasoning switch (an unknown model gets none).
_REASONING_NAME = re.compile(r"think|reason|qwq|-r1|magistral", re.I)
LLM_CONTEXT_CAP = 131072  # the most a custom model is offered, whatever its card says


def _llm_gguf(r: dict[str, Any]) -> ModelSpec:
    """A language model of the Hub: its architecture is unknown, so the KV cache is guessed from the weights
    (`llm_models.kv_cache_gb`) and every capability that cannot be read from the repo is left off, except function calls
    (llama.cpp has a generic format for models whose template it does not know)."""
    repo, primary, size = r["repo"], r["file"], float(r["size_gb"])
    files, mmproj, mm_gb = list(r.get("files") or [primary]), r.get("mmproj"), float(r.get("mmproj_gb") or 0)
    model_gb = round(size - mm_gb, 2)
    sources = [HfSource(repo, files, files, model_gb)]
    paths = {"model": (repo, primary)}
    if mmproj:
        sources.append(HfSource(repo, [mmproj], [mmproj], mm_gb))
        paths["mmproj"] = (repo, mmproj)
    ctx_max = min(int(r.get("context_max") or 32768), LLM_CONTEXT_CAP)
    caps = LlmCaps(context_default=min(16384, ctx_max), context_max=ctx_max, vision=bool(mmproj), tools=True,
                   reasoning="toggle" if _REASONING_NAME.search(repo) else "none")
    spec = ModelSpec(
        id=r["id"], name=r["name"], family="Chat", custom=True, engine="", backend="llamacpp", kind="llm",
        description=f"Modèle de conversation du dépôt {repo} ({r['precision']}), exécuté par llama.cpp. Ses capacités "
                    "exactes ne sont pas connues : le cache de contexte est estimé largement.",
        text_to_image=False, default_quantize=None, quantize_options=[], sources=sources, download_size_gb=size,
        weights_gb=size, largest_component_gb=model_gb, license=r.get("license") or "voir le dépôt",
        tags=["Hugging Face", "GGUF"] + (["vision"] if mmproj else []), precision=r["precision"], llm=caps,
        options={"files": paths, "repo": repo})
    spec.options["overhead_gb"] = round(llm_models.kv_cache_gb(None, caps.context_default, size) + llm_models.COMPUTE_BUFFER_GB, 2)
    spec.memory_hint = f"≈ {size:.1f} Go de poids ({r['precision']}) et ≈ {spec.options['overhead_gb']:.1f} Go de cache et de tampons."
    return spec


BUILDERS = {"gguf-variant": _gguf_variant, "sd-diffusers": _sd_diffusers, "sdxl-lora": _sdxl_lora, "qwen3-tts": _qwen3_tts, "whisper-ct2": _whisper,
            "video-diffusers": _video_diffusers, "video-gguf": _video_gguf, "llm-gguf": _llm_gguf}


def build(recipe: dict[str, Any]) -> ModelSpec:
    return BUILDERS[recipe["family"]](recipe)


# Persistence and registration

def load_recipes() -> list[dict[str, Any]]:
    return list(engine_state.load(DATA_DIR).get(SETTINGS_KEY, []))


def register_all(models: dict[str, ModelSpec]) -> None:
    for r in load_recipes():
        try:
            models[r["id"]] = build(r)
        except Exception as exc:  # stale recipe: skip it rather than block startup
            print(f"[custom] skipping recipe ({r.get('id')}): {exc}", flush=True)


def add(models: dict[str, ModelSpec], recipe: dict[str, Any]) -> ModelSpec:
    spec = build(recipe)
    recipes = [r for r in load_recipes() if r["id"] != recipe["id"]] + [recipe]
    engine_state.update(DATA_DIR, **{SETTINGS_KEY: recipes})
    models[spec.id] = spec
    return spec


def remove(models: dict[str, ModelSpec], model_id: str) -> None:
    engine_state.update(DATA_DIR, **{SETTINGS_KEY: [r for r in load_recipes() if r["id"] != model_id]})
    models.pop(model_id, None)
