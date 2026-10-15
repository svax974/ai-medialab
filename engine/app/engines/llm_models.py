# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Language models for the chat, quantized (GGUF) and run by llama.cpp (`llama-server`, see `llm.py`).

Every model is an ungated Hugging Face repo, taken from the model's own organisation when it publishes GGUF files (Qwen,
Google, Mistral AI, Liquid AI, ggml-org for gpt-oss and Qwen3.8), else from unsloth. Sizes are the exact ones of the Hub
(`?blobs=true`, in GiB like the rest of the app) and were checked on 2026-10-15; licences are the ones the repos declare.
Single-file repos only: split GGUF files are handled by the Hugging Face search (`custom.py`), not by these presets.

A model that reads images has a second file, the multimodal projector (`mmproj`), downloaded with it and loaded with
`--mmproj`. The KV cache grows with the context asked for: `kv_cache_gb` estimates it from the architecture
(`options["kv"]`, read from each model's `config.json`) and `memory_need_gb` adds the weights, so the planner, the
pre-load check and the context offered all use one rule.
"""

from __future__ import annotations

from typing import Any

from .base import HfSource, LlmCaps, ModelSpec, Variant

# Fixed memory on top of weights and KV cache: llama.cpp's compute buffers (batch 2048, micro-batch 512) and the runtime.
COMPUTE_BUFFER_GB = 0.6
# The cache of a sliding-window layer keeps its window plus a micro-batch.
SWA_SLACK_TOKENS = 512
# KV cache of a model whose architecture is unknown (a Hugging Face model added by the user), per token and per GB of
# weights: calibrated on Qwen3-8B (0.14 MB per token for 4.7 GB of weights), which is on the high side for most.
GENERIC_KV_MB_PER_TOKEN_PER_WEIGHT_GB = 0.03


def kv_cache_gb(kv: dict[str, Any] | None, ctx: int, weights_gb: float = 0.0) -> float:
    """KV cache (f16) for `ctx` tokens, conservative: every layer of a full-attention model counts, a sliding-window
    layer counts its window, a layer without a cache (convolution, linear attention) counts nothing, +10 %.

    `kv`: {full, swa, window, heads, dim} (layers with a full cache, with a window cache, that window, KV heads, head
    size). Without it the cache is guessed from the weights (`GENERIC_KV_MB_PER_TOKEN_PER_WEIGHT_GB`)."""
    if not kv:
        return round(ctx * max(0.05, GENERIC_KV_MB_PER_TOKEN_PER_WEIGHT_GB * weights_gb) / 1024, 2)
    tokens = kv["full"] * ctx + kv.get("swa", 0) * min(ctx, kv.get("window", ctx) + SWA_SLACK_TOKENS)
    per_token_per_layer = 2 * kv["heads"] * kv["dim"] * 2  # K and V, 2 bytes each (f16)
    return round(tokens * per_token_per_layer * 1.1 / 1024**3, 2)


def memory_need_gb(spec: ModelSpec, ctx: int) -> float:
    """Memory a chat with `ctx` tokens of context needs: the weights (model and projector), the KV cache, the buffers."""
    return round((spec.weights_gb or 0) + kv_cache_gb(spec.options.get("kv"), ctx, spec.weights_gb or 0)
                 + COMPUTE_BUFFER_GB, 2)


def _source(repo: str, file: str, size_gb: float) -> HfSource:
    return HfSource(repo, [file], [file], size_gb)


def llm_spec(*, id: str, name: str, family: str, description: str, repo: str, files: dict[str, tuple[str, float]],
             default: str, caps: LlmCaps, kv: dict[str, Any], license: str, tags: list[str],
             mmproj: tuple[str, float] | None = None, memory_hint: str = "") -> ModelSpec:
    """A chat model: `files` maps a quantization label to (GGUF file, size in GiB); `mmproj` is the projector file."""
    variants: list[Variant] = []
    for label, (file, size) in files.items():
        sources = [_source(repo, file, size)]
        paths = {"model": (repo, file)}
        if mmproj:
            sources.append(_source(repo, mmproj[0], mmproj[1]))
            paths["mmproj"] = (repo, mmproj[0])
        total = round(size + (mmproj[1] if mmproj else 0), 2)
        variants.append(Variant(key=label, label=label, size_gb=total, sources=sources, options={"files": paths},
                                weights_gb=total, largest_component_gb=size))
    chosen = next(v for v in variants if v.key == default)
    spec = ModelSpec(
        id=id, name=name, family=family, description=description, engine="", backend="llamacpp", kind="llm",
        text_to_image=False, default_quantize=None, quantize_options=[], sources=list(chosen.sources),
        download_size_gb=chosen.size_gb, weights_gb=chosen.weights_gb, largest_component_gb=chosen.largest_component_gb,
        license=license, tags=tags, llm=caps, variants=variants, default_variant=default,
        options={**chosen.options, "kv": kv, "repo": repo},
    )
    spec.memory_hint = memory_hint or (
        f"≈ {chosen.weights_gb:.1f} Go de poids ({default}) et ≈ {kv_cache_gb(kv, caps.context_default):.1f} Go de cache "
        f"pour {caps.context_default // 1024} k tokens de contexte.")
    spec.options["overhead_gb"] = round(kv_cache_gb(kv, caps.context_default) + COMPUTE_BUFFER_GB, 2)
    return spec


LFM_1B = llm_spec(
    id="llm-lfm2.5-1.2b", name="LFM 2.5 1.2B", family="Liquid",
    description="Le plus léger : un modèle de 1,2 milliard de paramètres, rapide même sans carte graphique, pour les "
    "tâches courtes (résumés, reformulation, prompts, avis de mise à jour). Multilingue, appels de fonctions.",
    repo="LiquidAI/LFM2.5-1.2B-Instruct-GGUF", default="Q4_K_M",
    files={"Q4_K_M": ("LFM2.5-1.2B-Instruct-Q4_K_M.gguf", 0.68), "Q5_K_M": ("LFM2.5-1.2B-Instruct-Q5_K_M.gguf", 0.79),
           "Q6_K": ("LFM2.5-1.2B-Instruct-Q6_K.gguf", 0.90), "Q8_0": ("LFM2.5-1.2B-Instruct-Q8_0.gguf", 1.16)},
    caps=LlmCaps(context_default=16384, context_max=32768, tools=True, params_b=1.2),
    kv={"full": 6, "heads": 8, "dim": 64},
    license="LFM Open License v1.0 (usage commercial libre sous 10 M$ de chiffre d'affaires annuel)",
    tags=["léger", "multilingue", "outils", "GGUF"],
)

QWEN3_1B = llm_spec(
    id="llm-qwen3-1.7b", name="Qwen3 1.7B", family="Qwen",
    description="Petit et polyvalent : peut réfléchir avant de répondre (mode « raisonnement » activable) et appeler des "
    "fonctions. Une seule quantification (Q8_0) est publiée par Qwen. Licence Apache 2.0.",
    repo="Qwen/Qwen3-1.7B-GGUF", default="Q8_0", files={"Q8_0": ("Qwen3-1.7B-Q8_0.gguf", 1.71)},
    caps=LlmCaps(context_default=16384, context_max=32768, tools=True, reasoning="toggle", params_b=1.7),
    kv={"full": 28, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["léger", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

QWEN3_4B = llm_spec(
    id="llm-qwen3-4b-instruct-2507", name="Qwen3 4B Instruct 2507", family="Qwen",
    description="Le bon compromis pour commencer : réponses directes (sans réflexion visible), très bon en français, en "
    "code et en suivi d'instructions, contexte jusqu'à 262 144 tokens (64 k proposés ici). Licence Apache 2.0.",
    repo="unsloth/Qwen3-4B-Instruct-2507-GGUF", default="Q4_K_M",
    files={"Q4_K_M": ("Qwen3-4B-Instruct-2507-Q4_K_M.gguf", 2.33), "Q5_K_M": ("Qwen3-4B-Instruct-2507-Q5_K_M.gguf", 2.69),
           "Q6_K": ("Qwen3-4B-Instruct-2507-Q6_K.gguf", 3.08), "Q8_0": ("Qwen3-4B-Instruct-2507-Q8_0.gguf", 3.99)},
    caps=LlmCaps(context_default=16384, context_max=65536, tools=True, params_b=4.0),
    kv={"full": 36, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["standard", "outils", "long contexte", "Apache 2.0", "GGUF"],
)

QWEN3_8B = llm_spec(
    id="llm-qwen3-8b", name="Qwen3 8B", family="Qwen",
    description="Un modèle de réflexion : il raisonne avant de répondre (activable ou non) et appelle des fonctions. "
    "Bon en maths, code et analyse. Licence Apache 2.0.",
    repo="Qwen/Qwen3-8B-GGUF", default="Q4_K_M",
    files={"Q4_K_M": ("Qwen3-8B-Q4_K_M.gguf", 4.68), "Q5_K_M": ("Qwen3-8B-Q5_K_M.gguf", 5.45),
           "Q6_K": ("Qwen3-8B-Q6_K.gguf", 6.26), "Q8_0": ("Qwen3-8B-Q8_0.gguf", 8.11)},
    caps=LlmCaps(context_default=16384, context_max=32768, tools=True, reasoning="toggle", params_b=8.2),
    kv={"full": 36, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["standard", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

LFM_8B_MOE = llm_spec(
    id="llm-lfm2.5-8b-a1b", name="LFM 2.5 8B A1B", family="Liquid",
    description="Mélange d'experts : 8 milliards de paramètres en mémoire mais environ 1 milliard actif par mot, donc "
    "très rapide pour sa taille. Multilingue, appels de fonctions.",
    repo="LiquidAI/LFM2.5-8B-A1B-GGUF", default="Q4_K_M",
    files={"Q4_K_M": ("LFM2.5-8B-A1B-Q4_K_M.gguf", 4.80), "Q5_K_M": ("LFM2.5-8B-A1B-Q5_K_M.gguf", 5.62),
           "Q6_K": ("LFM2.5-8B-A1B-Q6_K.gguf", 6.48), "Q8_0": ("LFM2.5-8B-A1B-Q8_0.gguf", 8.39)},
    caps=LlmCaps(context_default=16384, context_max=65536, tools=True, moe=True, params_b=8.0, active_params_b=1.0),
    kv={"full": 6, "heads": 8, "dim": 64},
    license="LFM Open License v1.0 (usage commercial libre sous 10 M$ de chiffre d'affaires annuel)",
    tags=["standard", "MoE", "rapide", "outils", "GGUF"],
)

MINISTRAL_8B = llm_spec(
    id="llm-ministral-3-8b", name="Ministral 3 8B Instruct", family="Mistral",
    description="Le modèle de Mistral AI, à l'aise en français, qui lit aussi les images (photos, captures d'écran, "
    "documents) et appelle des fonctions. Contexte jusqu'à 256 k tokens (64 k proposés ici). Licence Apache 2.0.",
    repo="mistralai/Ministral-3-8B-Instruct-2512-GGUF", default="Q4_K_M", mmproj=("Ministral-3-8B-Instruct-2512-BF16-mmproj.gguf", 0.80),
    files={"Q4_K_M": ("Ministral-3-8B-Instruct-2512-Q4_K_M.gguf", 4.84), "Q5_K_M": ("Ministral-3-8B-Instruct-2512-Q5_K_M.gguf", 5.64),
           "Q8_0": ("Ministral-3-8B-Instruct-2512-Q8_0.gguf", 8.41)},
    caps=LlmCaps(context_default=16384, context_max=65536, vision=True, tools=True, params_b=8.0),
    kv={"full": 34, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["standard", "vision", "français", "outils", "Apache 2.0", "GGUF"],
)

GEMMA_E4B = llm_spec(
    id="llm-gemma-4-e4b", name="Gemma 4 E4B", family="Gemma",
    description="Le petit Gemma 4 de Google (4,5 milliards de paramètres effectifs), quantifié par Google avec "
    "entraînement conscient de la quantification : très bonne qualité pour sa taille. Lit les images, réfléchit à la "
    "demande, appelle des fonctions. Licence Apache 2.0.",
    repo="google/gemma-4-E4B-it-qat-q4_0-gguf", default="QAT Q4_0", mmproj=("gemma-4-E4B-it-mmproj.gguf", 0.92),
    files={"QAT Q4_0": ("gemma-4-E4B_q4_0-it.gguf", 4.80)},
    caps=LlmCaps(context_default=16384, context_max=65536, vision=True, tools=True, reasoning="toggle"),
    kv={"full": 7, "swa": 35, "window": 512, "heads": 2, "dim": 256}, license="Apache 2.0",
    tags=["standard", "vision", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

GEMMA_12B = llm_spec(
    id="llm-gemma-4-12b", name="Gemma 4 12B", family="Gemma",
    description="Gemma 4 de 12 milliards de paramètres (quantification QAT de Google) : le meilleur équilibre qualité / "
    "poids de la famille. Lit les images, réfléchit à la demande, appelle des fonctions. Licence Apache 2.0.",
    repo="google/gemma-4-12B-it-qat-q4_0-gguf", default="QAT Q4_0", mmproj=("mmproj-gemma-4-12b-it-qat-q4_0.gguf", 0.16),
    files={"QAT Q4_0": ("gemma-4-12b-it-qat-q4_0.gguf", 6.50)},
    caps=LlmCaps(context_default=16384, context_max=65536, vision=True, tools=True, reasoning="toggle", params_b=11.95),
    kv={"full": 8, "swa": 40, "window": 1024, "heads": 8, "dim": 256}, license="Apache 2.0",
    tags=["costaud", "vision", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

GPT_OSS_20B = llm_spec(
    id="llm-gpt-oss-20b", name="gpt-oss 20B", family="OpenAI",
    description="Le modèle ouvert d'OpenAI : mélange d'experts de 21 milliards de paramètres dont 3,6 actifs, donc rapide. "
    "Raisonnement réglable (faible, moyen, élevé), appels de fonctions. Licence Apache 2.0.",
    repo="ggml-org/gpt-oss-20b-GGUF", default="MXFP4", files={"MXFP4": ("gpt-oss-20b-MXFP4.gguf", 11.28)},
    caps=LlmCaps(context_default=16384, context_max=65536, tools=True, reasoning="levels", moe=True, params_b=21.0,
                 active_params_b=3.6),
    kv={"full": 12, "swa": 12, "window": 128, "heads": 8, "dim": 64}, license="Apache 2.0",
    tags=["costaud", "MoE", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

GEMMA_26B_MOE = llm_spec(
    id="llm-gemma-4-26b-a4b", name="Gemma 4 26B A4B", family="Gemma",
    description="Gemma 4 en mélange d'experts : 25 milliards de paramètres dont 3,8 actifs, donc rapide pour sa qualité. "
    "Lit les images, réfléchit à la demande, appelle des fonctions. Licence Apache 2.0.",
    repo="google/gemma-4-26B-A4B-it-qat-q4_0-gguf", default="QAT Q4_0", mmproj=("gemma-4-26B-it-mmproj.gguf", 1.11),
    files={"QAT Q4_0": ("gemma-4-26B_q4_0-it.gguf", 13.45)},
    caps=LlmCaps(context_default=16384, context_max=65536, vision=True, tools=True, reasoning="toggle", moe=True,
                 params_b=25.2, active_params_b=3.8),
    kv={"full": 5, "swa": 25, "window": 1024, "heads": 8, "dim": 256}, license="Apache 2.0",
    tags=["costaud", "MoE", "vision", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

QWEN38_27B = llm_spec(
    id="llm-qwen3.8-27b", name="Qwen3.8 27B", family="Qwen",
    description="Le plus capable de la liste : 27 milliards de paramètres denses, raisonnement activé par défaut (désactivable "
    "par requête), appels de fonctions, lit les images, contexte jusqu'à 262 k tokens (64 k proposés ici). Lourd : "
    "réservé aux machines avec beaucoup de mémoire. Licence Apache 2.0.",
    repo="ggml-org/Qwen3.8-27B-GGUF", default="Q4_K_M", mmproj=("mmproj-Qwen3.8-27B-Q8_0.gguf", 0.59),
    files={"Q4_K_M": ("Qwen3.8-27B-Q4_K_M.gguf", 17.67)},
    caps=LlmCaps(context_default=16384, context_max=65536, vision=True, tools=True, reasoning="toggle", params_b=27.0),
    kv={"full": 16, "heads": 4, "dim": 256}, license="Apache 2.0",
    tags=["costaud", "vision", "raisonnement", "outils", "Apache 2.0", "GGUF"],
)

SPECS = [LFM_1B, QWEN3_1B, QWEN3_4B, QWEN3_8B, LFM_8B_MOE, MINISTRAL_8B, GEMMA_E4B, GEMMA_12B, GPT_OSS_20B, GEMMA_26B_MOE,
         QWEN38_27B]
