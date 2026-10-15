# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Hugging Face model search, limited to the formats the app can run.

`search` only returns repos that fall in a supported family (see `engines/custom.py`); `inspect` checks the
actual repo contents (files, config) and lists the downloadable variants; `make_recipe` builds the recipe
that gets saved when the user adds the model.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import runtime_settings
from .catalog import engine_compat, plan_for, quant_from_name
from .engines import MODELS
from .engines.base import remaining_download_gb
from .engines.custom import (GGUF_TEMPLATES, SD_PIPELINES, SDXL_BASE, VIDEO_GGUF_TEMPLATES, VIDEO_TEMPLATES, _title, build, slug,
                             video_template_id)
from .system import get_system

FAMILY_LABEL = {
    "gguf-variant": "GGUF",
    "sd-diffusers": "Stable Diffusion",
    "sdxl-lora": "LoRA SDXL",
    "qwen3-tts": "Qwen3-TTS",
    "whisper-ct2": "Whisper",
    "video-diffusers": "Vidéo",
    "video-gguf": "Vidéo GGUF",
    "llm-gguf": "Chat (GGUF)",
}
TASK = {"gguf-variant": "image", "sd-diffusers": "image", "sdxl-lora": "image", "qwen3-tts": "tts", "whisper-ct2": "stt",
        "video-diffusers": "video", "video-gguf": "video", "llm-gguf": "llm"}
# Engine (backend, audio pack) that runs each family, as the presets declare it.
FAMILY_ENGINE: dict[str, tuple[str, str | None]] = {
    "gguf-variant": ("sdcpp", None), "video-gguf": ("sdcpp", None), "sd-diffusers": ("torch", None),
    "sdxl-lora": ("torch", None),
    "video-diffusers": ("torch", None), "qwen3-tts": ("pack", "qwen3"), "whisper-ct2": ("pack", "speech"),
    "llm-gguf": ("llamacpp", None),
}
# Repos quantized in a format the Python Qwen3-TTS engine can't load.
_NOT_TORCH = re.compile(r"gguf|mlx|onnx|gptq|awq|bnb|[-_ ](?:4|8)-?bit|int[48]|fp8", re.I)


# Hub tasks of a repo a chat can run (every one is also tagged `gguf`), and the tasks that exclude it.
LLM_TASKS = {"text-generation", "image-text-to-text", "any-to-any"}
NOT_LLM_TASKS = {"text-to-image", "text-to-video", "image-to-video", "image-to-image", "feature-extraction",
                 "sentence-similarity", "text-to-speech", "text-to-audio", "automatic-speech-recognition",
                 "audio-to-audio", "fill-mask", "token-classification", "zero-shot-classification"}
_NOT_A_CHAT = re.compile(r"embed|rerank", re.I)
# Auxiliary files of an LLM repo that are not the model: drafts for speculative decoding.
_AUX_GGUF = re.compile(r"(^|/)(mtp|dflash|eagle\d*)[-_]|/MTP/", re.I)
_SHARD = re.compile(r"-0*\d+-of-0*\d+(?=\.gguf$)", re.I)
_MMPROJ_PREFERENCE = ("bf16", "f16", "q8_0")


class HubError(RuntimeError):
    pass


def _api():
    from huggingface_hub import HfApi

    return HfApi(token=runtime_settings.get_settings().get("hf_token") or None)


def _tag_values(tags: list[str], prefix: str) -> list[str]:
    return [t[len(prefix):] for t in tags if t.startswith(prefix)]


def classify(repo: str, tags: list[str]) -> tuple[str, dict[str, Any]] | None:
    """(family, details) if the repo is a supported format, else None. No network access."""
    ts = set(tags)
    if f"base_model:adapter:{SDXL_BASE}" in ts:
        return "sdxl-lora", {"base": SDXL_BASE}
    for pipe in SD_PIPELINES:
        if f"diffusers:{pipe}" in ts:
            return "sd-diffusers", {"pipeline": pipe}
    for pipe in VIDEO_TEMPLATES:
        if f"diffusers:{pipe}" in ts:
            return "video-diffusers", {"pipeline": pipe}
    if "gguf" in ts:
        bases = _tag_values(tags, "base_model:quantized:") or _tag_values(tags, "base_model:")
        for b in bases:
            if b in GGUF_TEMPLATES:
                return "gguf-variant", {"template": GGUF_TEMPLATES[b], "base": b}
            if b in VIDEO_GGUF_TEMPLATES:
                return "video-gguf", {"template": VIDEO_GGUF_TEMPLATES[b], "base": b}
    if "qwen3_tts" in ts and not _NOT_TORCH.search(repo) and not (ts & {"gguf", "mlx", "onnx"}):
        return "qwen3-tts", {}
    if "ctranslate2" in ts and "whisper" in repo.lower() and not _NOT_TORCH.search(repo):
        return "whisper-ct2", {}
    if "gguf" in ts and ts & LLM_TASKS and not ts & NOT_LLM_TASKS and not _NOT_A_CHAT.search(repo):
        return "llm-gguf", {"base": next(iter(_tag_values(tags, "base_model:quantized:")), "")}
    return None


def _existing_for(repo: str) -> str | None:
    for m in MODELS.values():
        sources = [*m.all_sources(), *(s for v in m.variants for s in v.sources)]
        if any(s.repo == repo for s in sources):
            return m.id
    return None


def _ct2_precision(repo: str) -> str:
    name = repo.lower()
    return "int8" if "int8" in name else "fp32" if ("float32" in name or "fp32" in name) else "fp16"


def _quant_rank(q: str) -> tuple[int, str]:
    bits = re.search(r"\d+", q)
    return (int(bits.group()) if bits else 99, q)


def listing_precisions(family: str, repo: str, filenames: list[str], params: dict[str, int] | None) -> list[str]:
    """Quantizations / precisions a search result offers, from the listing alone (file names and the dtype count
    of the repo metadata, no extra request). Fewest bits first. The exact choice and sizes come from `inspect`."""
    if family in ("gguf-variant", "video-gguf"):
        ggufs = [f for f in filenames if f.endswith(".gguf") and "mmproj" not in f.lower()
                 and (family == "gguf-variant" or "/" not in f)]
        return sorted({quant_from_name(f) or "GGUF" for f in ggufs}, key=_quant_rank)
    if family == "llm-gguf":
        groups = group_gguf_files({f: 0 for f in filenames})
        return sorted({g["label"] for g in groups}, key=_quant_rank)
    if family == "whisper-ct2":
        return [_ct2_precision(repo)]
    if family == "sdxl-lora":
        return ["LoRA"]
    if family in ("sd-diffusers", "video-diffusers") and any(".fp16." in f for f in filenames):
        return ["fp16"]
    if params:
        dt = max(params, key=params.get)
        return [_DTYPE_NAMES.get(dt, dt.lower())]
    return ["bf16"] if family == "qwen3-tts" else []


def _queries(kind: str, q: str) -> list[dict[str, Any]]:
    q = q.strip()
    # `expand` brings the file names and the dtype count in the listing (quantizations shown per result).
    base: dict[str, Any] = {"sort": "downloads", "gated": False, "limit": 30,
                            "expand": ["downloads", "likes", "tags", "siblings", "safetensors"]}
    if q:
        base["search"] = q
    if kind == "llm":
        qs = [{**base, "filter": "gguf", "pipeline_tag": task} for task in sorted(LLM_TASKS)]
    elif kind == "image":
        qs = [{**base, "filter": f"diffusers:{p}", "pipeline_tag": "text-to-image"} for p in SD_PIPELINES]
        qs += [{**base, "filter": ["gguf", f"base_model:quantized:{b}"], "pipeline_tag": "text-to-image"}
                for b in GGUF_TEMPLATES]
        qs.append({**base, "filter": f"base_model:adapter:{SDXL_BASE}"})
    elif kind == "video":
        qs = [{**base, "filter": f"diffusers:{p}"} for p in VIDEO_TEMPLATES]
        qs += [{**base, "filter": ["gguf", f"base_model:quantized:{b}"], "pipeline_tag": tag}
               for b in VIDEO_GGUF_TEMPLATES for tag in ("text-to-video", "image-to-video")]
    else:
        qs = [{**base, "filter": "qwen3_tts"},
              {**base, "filter": "ctranslate2", "search": f"{q} whisper".strip()}]
    return qs


def search(kind: str, q: str, limit: int = 24) -> list[dict[str, Any]]:
    if kind not in ("image", "audio", "video", "llm"):
        raise HubError("Type de modèle inconnu.")
    api = _api()

    def run(kwargs: dict[str, Any]) -> list[Any]:
        return list(api.list_models(**kwargs))

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = list(pool.map(run, _queries(kind, q)))
    except Exception as exc:  # noqa: BLE001
        raise HubError(f"Hugging Face est injoignable ({type(exc).__name__}). Vérifiez la connexion.") from None
    seen: dict[str, dict[str, Any]] = {}
    system = get_system()
    for m in (m for b in batches for m in b):
        if m.id in seen or "not-for-all-audiences" in (m.tags or []):
            continue
        cls = classify(m.id, m.tags or [])
        if cls is None:
            continue
        family, details = cls
        seen[m.id] = {
            "repo": m.id, "family": family, "family_label": FAMILY_LABEL[family], "task": TASK[family],
            "downloads": m.downloads or 0, "likes": m.likes or 0,
            "base": details.get("base") or details.get("pipeline") or "",
            "already": _existing_for(m.id),
            "precisions": listing_precisions(family, m.id, [x.rfilename for x in m.siblings or []],
                                             getattr(m.safetensors, "parameters", None)),
            **engine_compat(*FAMILY_ENGINE[family], system),
        }
    # Models this machine can run first, then by popularity.
    return sorted(seen.values(), key=lambda r: (not r["compatible"], -r["downloads"]))[:limit]


def group_gguf_files(files: dict[str, int]) -> list[dict[str, Any]]:
    """The models of a GGUF repo: one per quantization, the shards of a split file grouped (`x-00001-of-00003.gguf`), the
    multimodal projectors and the speculative-decoding drafts left out. {label, primary, files, size}, smallest first."""
    groups: dict[str, dict[str, Any]] = {}
    for name, size in files.items():
        if not name.endswith(".gguf") or "mmproj" in name.lower() or _AUX_GGUF.search(name):
            continue
        key = _SHARD.sub("", name)
        g = groups.setdefault(key, {"label": quant_from_name(key) or "GGUF", "files": [], "size": 0})
        g["files"].append(name)
        g["size"] += size
    for g in groups.values():
        g["files"].sort()
        g["primary"] = g["files"][0]
    return sorted(groups.values(), key=lambda g: (g["size"], g["primary"]))


def pick_mmproj(files: dict[str, int]) -> tuple[str, int] | None:
    """The multimodal projector to use, if the repo has any: bf16, then f16, then q8_0, else the first."""
    projectors = sorted((n, s) for n, s in files.items() if n.endswith(".gguf") and "mmproj" in n.lower())
    for wanted in _MMPROJ_PREFERENCE:
        for name, size in projectors:
            if wanted in name.lower():
                return name, size
    return projectors[0] if projectors else None


def _size_gb(n: int | None) -> float:
    return round((n or 0) / 1024**3, 2)


def _json(repo: str, name: str) -> dict[str, Any]:
    from huggingface_hub import hf_hub_download

    return json.loads(open(hf_hub_download(repo, name, token=runtime_settings.get_settings().get("hf_token") or None)).read())


def _license(tags: list[str]) -> str:
    return next(iter(_tag_values(tags, "license:")), "")


_DTYPE_NAMES = {"BF16": "bf16", "F16": "fp16", "F32": "fp32", "F8_E4M3": "fp8", "F8_E5M2": "fp8"}


def file_dtype(repo: str, filename: str) -> str:
    """Dominant precision of a safetensors file, read from its header (partial request, no full download)."""
    from collections import Counter

    try:
        meta = _api().parse_safetensors_file_metadata(repo, filename)
    except Exception:  # noqa: BLE001
        return ""
    count: Counter[str] = Counter()
    for t in meta.tensors.values():
        n = 1
        for d in t.shape:
            n *= d
        count[t.dtype] += n
    return _DTYPE_NAMES.get(dt := count.most_common(1)[0][0], dt.lower()) if count else ""


def _dominant_dtype(info, repo: str = "", filename: str = "") -> str:
    """Weight precision: repo metadata when present, else the file header."""
    params = getattr(getattr(info, "safetensors", None), "parameters", None) or {}
    if params:
        dt = max(params, key=params.get)
        return _DTYPE_NAMES.get(dt, dt.lower())
    return file_dtype(repo, filename) if repo and filename else ""


def inspect(repo: str) -> dict[str, Any]:
    """What the repo offers, with for each variant whether this machine can run it (`fits`, `fit_note`)."""
    out = _inspect(repo)
    system = get_system()
    for opt in out["options"]:
        opt.update(_fit(out["family"], repo, out["license"], opt, opt.pop("_r", {}), system))
    return out


def _fit(family: str, repo: str, license_: str, opt: dict[str, Any], extra: dict[str, Any],
         system: dict[str, Any]) -> dict[str, Any]:
    """Memory verdict and size to download for one variant, from the very spec the model would get if added (same rule as the model list).
    Best effort: an unexpected repo layout yields no verdict rather than breaking the inspection."""
    recipe = {"family": family, "id": "custom-preview", "repo": repo, "name": _title(repo), "license": license_,
              "precision": opt["precision"], "size_gb": opt["size_gb"], **extra}
    try:
        spec = build(recipe)
        verdict = plan_for(spec, system)
    except Exception:  # noqa: BLE001
        return {}
    # What "add and download" fetches: this file plus the shared files of the reference model still missing.
    return {"fits": verdict["compatible"], "fit_note": verdict["note"], "download_gb": remaining_download_gb(spec)}


def _inspect(repo: str) -> dict[str, Any]:
    try:
        info = _api().model_info(repo, files_metadata=True)
    except Exception as exc:  # noqa: BLE001
        raise HubError(f"Dépôt introuvable ou inaccessible : {repo} ({type(exc).__name__}).") from None
    if info.gated:
        raise HubError("Ce dépôt est à accès restreint (il faut accepter ses conditions sur Hugging Face) : "
                       "non pris en charge ici.")
    tags = info.tags or []
    cls = classify(repo, tags)
    if cls is None:
        raise HubError("Format non pris en charge : seuls les modèles Stable Diffusion/SDXL (diffusers), les LoRA SDXL, les "
                       "quantifications GGUF de Z-Image / Qwen Image, les modèles vidéo diffusers (Wan, CogVideoX, HunyuanVideo 1.5, "
                       "LTX-2) et GGUF de Wan 2.2 TI2V 5B, Qwen3-TTS et Whisper (faster-whisper) peuvent être ajoutés.")
    family, details = cls
    files = {s.rfilename: (s.size or 0) for s in info.siblings or []}
    license_ = _license(tags)
    out: dict[str, Any] = {"repo": repo, "family": family, "family_label": FAMILY_LABEL[family], "license": license_,
                           "notes": [], "options": [], **engine_compat(*FAMILY_ENGINE[family])}

    if family == "llm-gguf":
        return _inspect_llm(info, files, out)

    if family == "gguf-variant":
        template = next(m for m in MODELS.values() if m.id == details["template"])
        out["template"] = {"id": template.id, "name": template.name}
        if info.pipeline_tag != "text-to-image":
            raise HubError("Ce dépôt n'est pas un modèle de diffusion (encodeur de texte ou autre composant).")
        ggufs = {f: n for f, n in files.items() if f.endswith(".gguf") and "mmproj" not in f.lower()}
        if not ggufs:
            raise HubError("Aucun fichier GGUF de diffusion dans ce dépôt.")
        for f, n in sorted(ggufs.items(), key=lambda kv: kv[1]):
            q = quant_from_name(f) or "GGUF"
            out["options"].append({"key": f, "label": q, "precision": q, "file": f, "size_gb": _size_gb(n),
                                   "_r": {"template": template.id, "file": f}})
        out["notes"].append(f"Exécuté comme « {template.name} » : l'encodeur de texte et le VAE du modèle de référence "
                            "sont réutilisés.")
        return out

    if family == "sdxl-lora":
        loras = {f: n for f, n in files.items() if f.endswith(".safetensors") and 0 < n <= LORA_MAX_BYTES}
        if not loras:
            raise HubError("Aucun fichier LoRA au format safetensors dans ce dépôt.")
        for f, n in sorted(loras.items()):
            out["options"].append({"key": f, "label": f.rsplit("/", 1)[-1].removesuffix(".safetensors"), "precision": "LoRA",
                                   "file": f, "size_gb": _size_gb(n), "_r": {"file": f}})
        trigger = lora_trigger(getattr(info, "card_data", None))
        out["notes"].append("Appliquée à Stable Diffusion XL (téléchargé une fois pour toutes les LoRA)"
                            + (f" ; mots déclencheurs ajoutés au prompt : « {trigger} »." if trigger else "."))
        return out

    if family == "sd-diffusers":
        sel = _select_diffusers(repo, files, details["pipeline"])
        out["options"].append({"key": "default", "label": sel["precision"], "precision": sel["precision"],
                               "size_gb": sel["size_gb"],
                               "_r": {"pipeline": details["pipeline"], "files": sel["files"], "fp16": sel["fp16"],
                                      "weights_gb": sel["weights_gb"], "largest_gb": sel["largest_gb"]}})
        out["notes"].append("Format diffusers (PyTorch) : nécessite le moteur PyTorch et un GPU.")
        return out

    if family == "video-diffusers":
        pipeline = details["pipeline"]
        tpl = video_template_id(pipeline, files)
        sel = _select_diffusers(repo, files, pipeline, VIDEO_TEMPLATES)
        template = next(m for m in MODELS.values() if m.id == tpl)
        out["template"] = {"id": tpl, "name": template.name}
        out["options"].append({"key": "default", "label": sel["precision"], "precision": sel["precision"],
                               "size_gb": sel["size_gb"],
                               "_r": {"pipeline": pipeline, "template": tpl, "files": sel["files"],
                                      "weights_gb": sel["weights_gb"], "largest_gb": sel["largest_gb"]}})
        out["notes"].append(f"Format diffusers (PyTorch) : exécuté avec les réglages de « {template.name} », nécessite "
                            "le moteur PyTorch, un GPU et beaucoup de mémoire.")
        return out

    if family == "video-gguf":
        template = next(m for m in MODELS.values() if m.id == details["template"])
        out["template"] = {"id": template.id, "name": template.name}
        if info.pipeline_tag not in ("text-to-video", "image-to-video"):
            raise HubError("Ce dépôt n'est pas un modèle de vidéo (encodeur de texte, VAE ou autre composant).")
        ggufs = {f: n for f, n in files.items() if f.endswith(".gguf") and "/" not in f and "mmproj" not in f.lower()}
        if not ggufs:
            raise HubError("Aucun fichier GGUF de diffusion à la racine de ce dépôt.")
        for f, n in sorted(ggufs.items(), key=lambda kv: kv[1]):
            q = quant_from_name(f) or "GGUF"
            out["options"].append({"key": f, "label": q, "precision": q, "file": f, "size_gb": _size_gb(n),
                                   "_r": {"template": template.id, "file": f}})
        out["notes"].append(f"Exécuté comme « {template.name} » : l'encodeur de texte et le VAE du modèle de référence "
                            "sont réutilisés.")
        return out

    if family == "qwen3-tts":
        need = ["config.json", "model.safetensors", "speech_tokenizer/model.safetensors"]
        missing = [f for f in need if f not in files]
        if missing:
            raise HubError(f"Fichiers manquants dans le dépôt : {', '.join(missing)}.")
        cfg = _json(repo, "config.json")
        if cfg.get("quantization_config"):
            raise HubError("Modèle quantifié : seul le format bf16 d'origine est pris en charge.")
        variant = cfg.get("tts_model_type")
        if variant not in ("custom_voice", "voice_design", "base"):
            raise HubError("Variante Qwen3-TTS non reconnue (tts_model_type absent).")
        size = _size_gb(files["model.safetensors"] + files["speech_tokenizer/model.safetensors"])
        out["options"].append({"key": "default", "label": {"custom_voice": "voix & style", "voice_design": "création de voix",
                                                           "base": "clonage"}[variant],
                               "precision": _dominant_dtype(info, repo, "model.safetensors") or "bf16", "size_gb": size,
                               "_r": {"variant": variant, "speakers": []}})
        return out

    # whisper-ct2
    need = ["model.bin", "config.json", "tokenizer.json"]
    missing = [f for f in need if f not in files]
    if missing:
        raise HubError(f"Fichiers manquants dans le dépôt : {', '.join(missing)}.")
    precision = _ct2_precision(repo)
    out["options"].append({"key": "default", "label": precision, "precision": precision,
                           "size_gb": _size_gb(files["model.bin"])})
    return out


def _inspect_llm(info: Any, files: dict[str, int], out: dict[str, Any]) -> dict[str, Any]:
    groups = group_gguf_files(files)
    if not groups:
        raise HubError("Aucun fichier GGUF de modèle dans ce dépôt.")
    mm = pick_mmproj(files)
    gguf = getattr(info, "gguf", None) or {}
    context = int(gguf.get("context_length") or 0) or None
    for g in groups:
        total = g["size"] + (mm[1] if mm else 0)
        extra = {"file": g["primary"], "files": g["files"], "mmproj": mm[0] if mm else None,
                 "mmproj_gb": _size_gb(mm[1]) if mm else 0, "context_max": context}
        out["options"].append({"key": g["primary"], "label": g["label"], "precision": g["label"], "size_gb": _size_gb(total),
                               **extra, "_r": dict(extra)})
    out["notes"].append("Exécuté par llama.cpp : appels de fonctions pris en charge"
                        + (", lit les images (projecteur du dépôt)" if mm else "")
                        + ". Les capacités exactes du modèle ne sont pas connues : le cache de contexte est estimé largement.")
    return out


def _select_diffusers(repo: str, files: dict[str, int], pipeline: str, allowed=SD_PIPELINES) -> dict[str, Any]:
    index = _json(repo, "model_index.json")
    if index.get("_class_name") not in allowed:
        raise HubError(f"Pipeline non pris en charge : {index.get('_class_name')}.")
    comps = [k for k, v in index.items()
             if not k.startswith("_") and isinstance(v, list) and v and v[0] and k != "safety_checker"]
    chosen: list[str] = ["model_index.json"]
    weights: dict[str, list[str]] = {}
    for c in comps:
        for f in files:
            if f.startswith(c + "/") and f.count("/") == 1 and f.endswith((".json", ".txt", ".model")):
                chosen.append(f)
            elif f.startswith(c + "/") and f.endswith(".safetensors"):
                weights.setdefault(c, []).append(f)
    # Use fp16 when every heavy component ships one (half the download).
    fp16 = bool(weights) and all(any(".fp16." in f for f in fs) for fs in weights.values())
    total, largest = 0, 0
    for c, fs in weights.items():
        mine = [f for f in fs if (".fp16." in f) == fp16]
        if not mine:
            raise HubError(f"Poids safetensors introuvables pour « {c} » (formats .bin/.ckpt non pris en charge).")
        chosen += mine
        part = sum(files[f] for f in mine)
        total += part
        largest = max(largest, part)
    if not weights:
        raise HubError("Aucun poids au format safetensors.")
    main = max((f for fs in weights.values() for f in fs if f in chosen), key=lambda f: files[f])
    precision = file_dtype(repo, main) or ("fp16" if fp16 else "fp32")
    return {"files": sorted(set(chosen)), "fp16": fp16, "precision": precision,
            "size_gb": _size_gb(total + sum(files[f] for f in chosen if f.endswith((".json", ".txt", ".model")))),
            "weights_gb": _size_gb(total), "largest_gb": _size_gb(largest)}


# Above this size a safetensors file is a full checkpoint, not a LoRA.
LORA_MAX_BYTES = 2 * 1024**3


def lora_trigger(card: Any) -> str:
    """Trigger words of a LoRA, from its model card (`instance_prompt`, written by the diffusers training scripts)."""
    value = card.get("instance_prompt") if card is not None and hasattr(card, "get") else None
    return value.strip() if isinstance(value, str) else ""


def make_recipe(repo: str, key: str) -> dict[str, Any]:
    """Final recipe for a model. Re-reads the repo over the network rather than trusting what the UI sent."""
    info = inspect(repo)
    opt = next((o for o in info["options"] if o["key"] == key), None)
    if opt is None:
        raise HubError("Variante inconnue pour ce dépôt.")
    # The UI already disables the button; this is the check that counts (a direct call must not get around it).
    if not info["compatible"]:
        raise HubError(info["reason"] or "Ce modèle ne peut pas tourner sur cette machine.")
    if opt.get("fits") is False:
        raise HubError(opt.get("fit_note") or "Pas assez de mémoire pour cette variante.")
    family = info["family"]
    base = {"family": family, "repo": repo, "license": info["license"], "precision": opt["precision"],
            "size_gb": opt["size_gb"], "name": _title(repo)}
    if family in ("gguf-variant", "video-gguf"):
        tpl = info["template"]["name"].lower().replace("-", " ").split()
        words = [w for w in _title(repo).split() if w.lower() not in tpl and w.lower() not in ("gguf", "image", "turbo")]
        who = " ".join(words) or repo.split("/")[0]
        return {**base, "id": slug(repo, opt["label"]), "template": info["template"]["id"], "file": opt["file"],
                "name": f"{who} {opt['label']}"}
    if family == "llm-gguf":
        return {**base, "id": slug(repo, opt["label"]), "name": f"{_title(repo)} {opt['label']}".strip(),
                "file": opt["file"], "files": opt["files"], "mmproj": opt.get("mmproj"), "mmproj_gb": opt.get("mmproj_gb", 0),
                "context_max": opt.get("context_max")}
    api_info = _api().model_info(repo, files_metadata=True)
    files = {s.rfilename: (s.size or 0) for s in api_info.siblings or []}
    if family == "sdxl-lora":
        stem = opt["label"] if len(info["options"]) > 1 else ""
        return {**base, "id": slug(repo, stem), "file": opt["file"], "trigger": lora_trigger(api_info.card_data),
                "name": f"{base['name']} {stem}".strip()}
    if family == "sd-diffusers":
        pipe = classify(repo, api_info.tags or [])[1]["pipeline"]  # type: ignore[index]
        sel = _select_diffusers(repo, files, pipe)
        low = repo.lower()
        fast = any(w in low for w in ("turbo", "lightning", "lcm", "hyper"))
        return {**base, "id": slug(repo), "pipeline": pipe, "files": sel["files"], "fp16": sel["fp16"],
                "weights_gb": sel["weights_gb"], "largest_gb": sel["largest_gb"],
                "steps": 4 if fast else 30, "guidance": 0.0 if fast else (6.0 if pipe.endswith("XLPipeline") else 7.5)}
    if family == "video-diffusers":
        pipe = classify(repo, api_info.tags or [])[1]["pipeline"]  # type: ignore[index]
        sel = _select_diffusers(repo, files, pipe, VIDEO_TEMPLATES)
        return {**base, "id": slug(repo), "pipeline": pipe, "template": info["template"]["id"], "files": sel["files"],
                "weights_gb": sel["weights_gb"], "largest_gb": sel["largest_gb"]}
    if family == "qwen3-tts":
        cfg = _json(repo, "config.json")
        return {**base, "id": slug(repo), "variant": cfg["tts_model_type"],
                "speakers": list((cfg.get("talker_config") or {}).get("spk_id", {}).keys())}
    return {**base, "id": slug(repo)}
