"""Modèles ajoutés par l'utilisateur depuis Hugging Face.

Un modèle personnalisé n'est qu'une « recette » (dépôt, fichier choisi, famille) enregistrée dans les réglages ;
la `ModelSpec` correspondante se reconstruit sans réseau, y compris dans les processus worker. Seules des
familles que l'application sait exécuter sont acceptées :

    gguf-variant   autre quantification (ou fine-tune) d'un modèle GGUF déjà géré : on remplace le fichier de
                   diffusion du modèle de référence, ses autres composants (encodeur, VAE) restent les siens
    sd-diffusers   dépôt diffusers Stable Diffusion 1.x ou XL (moteur PyTorch)
    qwen3-tts      variante de Qwen3-TTS (voix intégrées, création de voix ou clonage)
    whisper-ct2    modèle Whisper converti pour faster-whisper (transcription)
"""

from __future__ import annotations

import copy
import dataclasses
import re
from typing import Any

from .. import db
from . import audio_specs, gguf_models
from .base import AudioCaps, HfSource, ModelSpec, ParamSpec, PresetVoice

SETTINGS_KEY = "custom_models"

# Modèles GGUF de référence : base_model Hugging Face -> id du modèle dont on copie la recette.
GGUF_TEMPLATES = {
    "Tongyi-MAI/Z-Image-Turbo": "z-image-turbo-gguf",
    "Qwen/Qwen-Image-2.1": "qwen-image-2.1-gguf",
    "Qwen/Qwen-Image-Edit-2511": "qwen-image-edit-gguf",
}

SD_PIPELINES = {
    "StableDiffusionXLPipeline": ("StableDiffusionXLImg2ImgPipeline", True),
    "StableDiffusionPipeline": ("StableDiffusionImg2ImgPipeline", False),
}


def slug(repo: str, extra: str = "") -> str:
    return "custom-" + re.sub(r"[^a-z0-9]+", "-", f"{repo}-{extra}".lower()).strip("-")


def _title(repo: str) -> str:
    return repo.split("/", 1)[-1].replace("_", " ").replace("-", " ").strip()


# --- Recettes -> spécifications ------------------------------------------------------------------------------

def _gguf_variant(r: dict[str, Any]) -> ModelSpec:
    base = next(s for s in gguf_models.SPECS if s.id == r["template"])
    spec = copy.deepcopy(base)
    spec.variants, spec.default_variant, spec.variant = [], "", ""  # une recette = un fichier précis
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
            ParamSpec("steps", "Étapes", "int", r.get("steps", 30), 1, 60, 1),
            ParamSpec("guidance", "Guidance", "float", r.get("guidance", 6.0 if xl else 7.5), 0.0, 14.0, 0.5,
                      "Fidélité au prompt (5–8 conseillé ; 0–1 pour les modèles « turbo » / « lightning »)."),
            ParamSpec("strength", "Influence de l'image", "float", 0.6, 0.1, 0.95, 0.05,
                      "Part de l'image de départ transformée. Bas = proche de l'original.", requires_references=True),
            ParamSpec("negative_prompt", "Prompt négatif", "text", "", help="Ce que l'image doit éviter.", advanced=True),
        ],
        size_multiple=64, min_side=512 if xl else 256, max_side=1536 if xl else 1024,
        default_megapixels=1.0 if xl else 0.25,
        hf_repo=r["repo"],  # lu par le moteur diffusers (les fichiers à télécharger sont dans `sources`)
        sources=[HfSource(r["repo"], files, [f for f in files if f.endswith(".safetensors")] + ["model_index.json"], size)],
        download_size_gb=size, license=r.get("license") or "voir le dépôt",
        weights_gb=float(r["weights_gb"]), largest_component_gb=float(r["largest_gb"]),
        memory_hint=f"≈ {r['weights_gb']:.0f} Go en {r['precision']}.", precision=r["precision"],
        tags=["texte→image", "img2img", "Hugging Face"],
        options={"pipeline": pipeline, "img2img": img2img, "guidance_arg": "guidance_scale", "load_kwargs": load_kwargs},
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


BUILDERS = {"gguf-variant": _gguf_variant, "sd-diffusers": _sd_diffusers, "qwen3-tts": _qwen3_tts, "whisper-ct2": _whisper}


def build(recipe: dict[str, Any]) -> ModelSpec:
    return BUILDERS[recipe["family"]](recipe)


# --- Persistance et enregistrement ---------------------------------------------------------------------------

def load_recipes() -> list[dict[str, Any]]:
    try:
        return list(db.get_settings().get(SETTINGS_KEY, []))
    except Exception:  # base absente ou illisible : aucun modèle personnalisé
        return []


def register_all(models: dict[str, ModelSpec]) -> None:
    for r in load_recipes():
        try:
            models[r["id"]] = build(r)
        except Exception as exc:  # recette obsolète : on l'ignore plutôt que de bloquer le démarrage
            print(f"[custom] recette ignorée ({r.get('id')}): {exc}", flush=True)


def add(models: dict[str, ModelSpec], recipe: dict[str, Any]) -> ModelSpec:
    spec = build(recipe)
    recipes = [r for r in load_recipes() if r["id"] != recipe["id"]] + [recipe]
    db.put_settings({SETTINGS_KEY: recipes})
    models[spec.id] = spec
    return spec


def remove(models: dict[str, ModelSpec], model_id: str) -> None:
    db.put_settings({SETTINGS_KEY: [r for r in load_recipes() if r["id"] != model_id]})
    models.pop(model_id, None)
