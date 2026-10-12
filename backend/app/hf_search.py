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

from . import db
from .catalog import quant_from_name
from .engines import MODELS
from .engines.custom import GGUF_TEMPLATES, SD_PIPELINES, _title, slug

FAMILY_LABEL = {
    "gguf-variant": "GGUF",
    "sd-diffusers": "Stable Diffusion",
    "qwen3-tts": "Qwen3-TTS",
    "whisper-ct2": "Whisper",
}
TASK = {"gguf-variant": "image", "sd-diffusers": "image", "qwen3-tts": "tts", "whisper-ct2": "stt"}
# Repos quantized in a format the Python Qwen3-TTS engine can't load.
_NOT_TORCH = re.compile(r"gguf|mlx|onnx|gptq|awq|bnb|[-_ ](?:4|8)-?bit|int[48]|fp8", re.I)


class HubError(RuntimeError):
    pass


def _api():
    from huggingface_hub import HfApi

    return HfApi(token=db.get_settings().get("hf_token") or None)


def _tag_values(tags: list[str], prefix: str) -> list[str]:
    return [t[len(prefix):] for t in tags if t.startswith(prefix)]


def classify(repo: str, tags: list[str]) -> tuple[str, dict[str, Any]] | None:
    """(family, details) if the repo is a supported format, else None. No network access."""
    ts = set(tags)
    for pipe in SD_PIPELINES:
        if f"diffusers:{pipe}" in ts:
            return "sd-diffusers", {"pipeline": pipe}
    if "gguf" in ts:
        bases = _tag_values(tags, "base_model:quantized:") or _tag_values(tags, "base_model:")
        for b in bases:
            if b in GGUF_TEMPLATES:
                return "gguf-variant", {"template": GGUF_TEMPLATES[b], "base": b}
    if "qwen3_tts" in ts and not _NOT_TORCH.search(repo) and not (ts & {"gguf", "mlx", "onnx"}):
        return "qwen3-tts", {}
    if "ctranslate2" in ts and "whisper" in repo.lower() and not _NOT_TORCH.search(repo):
        return "whisper-ct2", {}
    return None


def _existing_for(repo: str) -> str | None:
    for m in MODELS.values():
        sources = [*m.all_sources(), *(s for v in m.variants for s in v.sources)]
        if any(s.repo == repo for s in sources):
            return m.id
    return None


def _queries(kind: str, q: str) -> list[dict[str, Any]]:
    q = q.strip()
    base: dict[str, Any] = {"sort": "downloads", "gated": False, "limit": 30}
    if q:
        base["search"] = q
    if kind == "image":
        qs = [{**base, "filter": f"diffusers:{p}", "pipeline_tag": "text-to-image"} for p in SD_PIPELINES]
        qs += [{**base, "filter": ["gguf", f"base_model:quantized:{b}"], "pipeline_tag": "text-to-image"}
                for b in GGUF_TEMPLATES]
    else:
        qs = [{**base, "filter": "qwen3_tts"},
              {**base, "filter": "ctranslate2", "search": f"{q} whisper".strip()}]
    return qs


def search(kind: str, q: str, limit: int = 24) -> list[dict[str, Any]]:
    if kind not in ("image", "audio"):
        raise HubError("Type de modèle inconnu.")
    api = _api()

    def run(kwargs: dict[str, Any]) -> list[Any]:
        return list(api.list_models(**kwargs))

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            batches = list(pool.map(run, _queries(kind, q)))
    except Exception as exc:  # noqa: BLE001
        raise HubError(f"Hugging Face est injoignable ({type(exc).__name__}). Vérifiez la connexion.") from None
    seen: dict[str, dict[str, Any]] = {}
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
        }
    return sorted(seen.values(), key=lambda r: -r["downloads"])[:limit]


def _size_gb(n: int | None) -> float:
    return round((n or 0) / 1024**3, 2)


def _json(repo: str, name: str) -> dict[str, Any]:
    from huggingface_hub import hf_hub_download

    return json.loads(open(hf_hub_download(repo, name, token=db.get_settings().get("hf_token") or None)).read())


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
        raise HubError("Format non pris en charge : seuls les modèles Stable Diffusion/SDXL (diffusers), les "
                       "quantifications GGUF de Z-Image / Qwen Image, Qwen3-TTS et Whisper (faster-whisper) "
                       "peuvent être ajoutés.")
    family, details = cls
    files = {s.rfilename: (s.size or 0) for s in info.siblings or []}
    license_ = _license(tags)
    out: dict[str, Any] = {"repo": repo, "family": family, "family_label": FAMILY_LABEL[family], "license": license_,
                           "notes": [], "options": []}

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
            out["options"].append({"key": f, "label": q, "precision": q, "file": f, "size_gb": _size_gb(n)})
        out["notes"].append(f"Exécuté comme « {template.name} » : l'encodeur de texte et le VAE du modèle de référence "
                            "sont réutilisés.")
        return out

    if family == "sd-diffusers":
        sel = _select_diffusers(repo, files, details["pipeline"])
        out["options"].append({"key": "default", "label": sel["precision"], "precision": sel["precision"],
                               "size_gb": sel["size_gb"]})
        out["notes"].append("Format diffusers (PyTorch) : nécessite le moteur PyTorch et un GPU.")
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
                               "precision": _dominant_dtype(info, repo, "model.safetensors") or "bf16", "size_gb": size})
        return out

    # whisper-ct2
    need = ["model.bin", "config.json", "tokenizer.json"]
    missing = [f for f in need if f not in files]
    if missing:
        raise HubError(f"Fichiers manquants dans le dépôt : {', '.join(missing)}.")
    name = repo.lower()
    precision = "int8" if "int8" in name else "fp32" if ("float32" in name or "fp32" in name) else "fp16"
    out["options"].append({"key": "default", "label": precision, "precision": precision,
                           "size_gb": _size_gb(files["model.bin"])})
    return out


def _select_diffusers(repo: str, files: dict[str, int], pipeline: str) -> dict[str, Any]:
    index = _json(repo, "model_index.json")
    if index.get("_class_name") not in SD_PIPELINES:
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


def make_recipe(repo: str, key: str) -> dict[str, Any]:
    """Final recipe for a model. Re-reads the repo over the network rather than trusting what the UI sent."""
    info = inspect(repo)
    opt = next((o for o in info["options"] if o["key"] == key), None)
    if opt is None:
        raise HubError("Variante inconnue pour ce dépôt.")
    family = info["family"]
    base = {"family": family, "repo": repo, "license": info["license"], "precision": opt["precision"],
            "size_gb": opt["size_gb"], "name": _title(repo)}
    if family == "gguf-variant":
        tpl = info["template"]["name"].lower().replace("-", " ").split()
        words = [w for w in _title(repo).split() if w.lower() not in tpl and w.lower() not in ("gguf", "image", "turbo")]
        who = " ".join(words) or repo.split("/")[0]
        return {**base, "id": slug(repo, opt["label"]), "template": info["template"]["id"], "file": opt["file"],
                "name": f"{who} {opt['label']}"}
    api_info = _api().model_info(repo, files_metadata=True)
    files = {s.rfilename: (s.size or 0) for s in api_info.siblings or []}
    if family == "sd-diffusers":
        pipe = classify(repo, api_info.tags or [])[1]["pipeline"]  # type: ignore[index]
        sel = _select_diffusers(repo, files, pipe)
        low = repo.lower()
        fast = any(w in low for w in ("turbo", "lightning", "lcm", "hyper"))
        return {**base, "id": slug(repo), "pipeline": pipe, "files": sel["files"], "fp16": sel["fp16"],
                "weights_gb": sel["weights_gb"], "largest_gb": sel["largest_gb"],
                "steps": 4 if fast else 30, "guidance": 0.0 if fast else (6.0 if pipe.endswith("XLPipeline") else 7.5)}
    if family == "qwen3-tts":
        cfg = _json(repo, "config.json")
        return {**base, "id": slug(repo), "variant": cfg["tts_model_type"],
                "speakers": list((cfg.get("talker_config") or {}).get("spk_id", {}).keys())}
    return {**base, "id": slug(repo)}
