# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Models of the OCR tab: vision models that read the text of an image or a page, run by llama.cpp like the chat models
(`llm.py`, a server of their own so they can stay loaded next to the chat model, see `memory_budget.py`).

Every entry is a GGUF repo of the model's own organisation (Baidu, ggml-org for the others) with its multimodal projector,
sizes and licences read from the Hub on 2026-10-24. The architecture numbers (`kv`) come from each model's `config.json`.
The prompts are the ones each model card documents; a model not listed here can be added from Hugging Face (`custom.py`).

Scores quoted in the cards are OmniDocBench (page parsing: text, formulas, tables, reading order): they compare models on
the same pages, not on yours. Nothing here has been run against a real model: see `docs/guide.md`, section OCR.
"""

from __future__ import annotations

import dataclasses

from .base import LlmCaps, ModelSpec, OcrCaps
from .llm_models import llm_spec


def _ocr(*, caps: OcrCaps, context: int = 16384, context_max: int = 32768, params_b: float | None = None, **kwargs) -> ModelSpec:
    spec = llm_spec(caps=LlmCaps(context_default=context, context_max=context_max, vision=True, params_b=params_b), **kwargs)
    return dataclasses.replace(spec, kind="ocr", ocr=caps)


GLM_OCR = _ocr(
    id="ocr-glm-ocr", name="GLM-OCR", family="Z.ai",
    description="Le plus léger des modèles de lecture de documents : 0,9 milliard de paramètres, environ 95 sur OmniDocBench, "
    "un texte, un tableau ou une formule par passe. Licence MIT.",
    repo="ggml-org/GLM-OCR-GGUF", default="Q8_0", mmproj=("mmproj-GLM-OCR-Q8_0.gguf", 0.45),
    files={"Q8_0": ("GLM-OCR-Q8_0.gguf", 0.89), "F16": ("GLM-OCR-f16.gguf", 1.66)},
    params_b=1.3, context_max=131072, kv={"full": 16, "heads": 8, "dim": 128}, license="MIT",
    tags=["léger", "tableaux", "formules", "MIT", "GGUF"],
    caps=OcrCaps(
        tasks={"text": "Text Recognition:", "table": "Table Recognition:", "formula": "Formula Recognition:"},
        default_task="text", languages="zh, en, fr, es, ru, de, ja, ko",
        strengths=["Tableaux, formules, code et tampons", "Très léger et rapide (≈ 1,3 Go)", "Excellent score sur les pages de documents (≈ 95 sur OmniDocBench)"],
        weaknesses=["8 langues seulement", "Pas de sortie Markdown de la page : texte, tableau ou formule, une passe à la fois"]),
)

PADDLE_OCR_VL = _ocr(
    id="ocr-paddleocr-vl-1.6", name="PaddleOCR-VL 1.6", family="Baidu",
    description="Le meilleur score ouvert sur OmniDocBench v1.6 (≈ 96) avec moins d'un milliard de paramètres, 109 langues, "
    "tableaux, formules, graphiques et tampons. Licence Apache 2.0.",
    repo="PaddlePaddle/PaddleOCR-VL-1.6-GGUF", default="BF16", mmproj=("PaddleOCR-VL-1.6-GGUF-mmproj.gguf", 0.82),
    files={"BF16": ("PaddleOCR-VL-1.6-GGUF.gguf", 0.87)},
    params_b=0.96, context_max=131072, kv={"full": 18, "heads": 2, "dim": 128}, license="Apache 2.0",
    tags=["léger", "multilingue", "tableaux", "formules", "Apache 2.0", "GGUF"],
    caps=OcrCaps(
        tasks={"text": "OCR:", "table": "Table Recognition:", "formula": "Formula Recognition:", "chart": "Chart Recognition:"},
        default_task="text", languages="109 langues",
        strengths=["109 langues, dont le français", "Tableaux, formules, graphiques", "Photos de travers ou mal éclairées mieux gérées que la première version"],
        weaknesses=["Conçu pour lire des zones d'une page, après une détection de mise en page : sur une page entière dense, l'ordre de lecture est moins sûr",
                    "Le support de llama.cpp est signalé comme pouvant dégrader un peu les résultats"]),
)

LIGHTON_OCR = _ocr(
    id="ocr-lightonocr-2-1b", name="LightOnOCR 2 1B", family="LightOn",
    description="Lit une page entière en une passe, dans l'ordre de lecture : tableaux, formulaires, reçus, colonnes et "
    "formules. Entraîné sur davantage de français. Licence Apache 2.0.",
    repo="ggml-org/LightOnOCR-2-1B-GGUF", default="Q8_0", mmproj=("mmproj-LightOnOCR-2-1B-Q8_0.gguf", 0.42),
    files={"Q8_0": ("LightOnOCR-2-1B-Q8_0.gguf", 0.60), "F16": ("LightOnOCR-2-1B-f16.gguf", 1.12)},
    params_b=1.0, context_max=16384, kv={"full": 28, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["léger", "français", "pages entières", "Apache 2.0", "GGUF"],
    caps=OcrCaps(
        tasks={"text": ""}, default_task="text", languages="en, fr, de, es, it, nl, pt, sv, da, zh, ja",
        strengths=["Page entière en une passe, dans l'ordre de lecture", "Renforcé en français et en langues européennes", "Reçus, formulaires, colonnes, formules"],
        weaknesses=["11 langues", "Aucun choix de tâche : il lit toujours la page entière", "Contexte limité à 16 k tokens"]),
    context=16384,
)

DEEPSEEK_OCR = _ocr(
    id="ocr-deepseek-ocr", name="DeepSeek-OCR", family="DeepSeek",
    description="Compresse la page en peu de jetons visuels : bon sur les pages denses et les documents longs, multilingue. "
    "Environ 3 milliards de paramètres. Licence MIT.",
    repo="ggml-org/DeepSeek-OCR-GGUF", default="Q8_0", mmproj=("mmproj-DeepSeek-OCR-Q8_0.gguf", 0.42),
    files={"Q8_0": ("DeepSeek-OCR-Q8_0.gguf", 2.91)},
    params_b=3.3, context=8192, context_max=8192, kv={"full": 12, "heads": 10, "dim": 128}, license="MIT",
    tags=["pages denses", "multilingue", "MIT", "GGUF"],
    caps=OcrCaps(
        tasks={"text": "Free OCR.", "markdown": "<|grounding|>Convert the document to markdown."}, default_task="markdown",
        languages="multilingue", max_tokens=6144,
        strengths=["Pages denses et documents longs", "Sortie Markdown avec la structure du document", "Multilingue"],
        weaknesses=["Contexte de 8 k tokens seulement", "Les versions GGUF ont longtemps demandé un llama.cpp récent : vérifiez le moteur de chat", "Plus lourd que les modèles de ≈ 1 milliard"],
        strip=[r"<\|ref\|>.*?<\|/ref\|>\s*<\|det\|>.*?<\|/det\|>\s*"]),
)

DOTS_OCR = _ocr(
    id="ocr-dots-ocr", name="dots.ocr", family="Rednote",
    description="Lecture de documents multilingue de 3 milliards de paramètres : tableaux, formules et mise en page complexe. "
    "Licence MIT.",
    repo="ggml-org/dots.ocr-GGUF", default="Q8_0", mmproj=("mmproj-dots.ocr-Q8_0.gguf", 1.25),
    files={"Q8_0": ("dots.ocr-Q8_0.gguf", 1.76), "F16": ("dots.ocr-f16.gguf", 3.32)},
    params_b=3.0, context_max=131072, kv={"full": 28, "heads": 2, "dim": 128}, license="MIT",
    tags=["multilingue", "tableaux", "formules", "MIT", "GGUF"],
    caps=OcrCaps(
        tasks={"text": "Extract the text content from this image."}, default_task="text", languages="plus de 100 langues",
        strengths=["Plus de 100 langues", "Tableaux, formules, graphiques", "Mise en page complexe"],
        weaknesses=["Seule la lecture du texte est proposée ici : pas la sortie avec boîtes et catégories de l'outil d'origine", "Pas de score OmniDocBench publié dans les sources consultées"]),
)

QIANFAN_OCR = _ocr(
    id="ocr-qianfan-ocr", name="Qianfan-OCR", family="Baidu",
    description="Le plus capable de la liste : 4,7 milliards de paramètres, du document au Markdown, mais aussi extraction "
    "d'informations (factures, reçus, pièces d'identité) et lecture de graphiques, par instruction. Licence Apache 2.0.",
    repo="ggml-org/Qianfan-OCR-GGUF", default="Q8_0", mmproj=("mmproj-Qianfan-OCR-Q8_0.gguf", 0.32),
    files={"Q8_0": ("Qianfan-OCR-Q8_0.gguf", 4.38), "F16": ("Qianfan-OCR-f16.gguf", 8.24)},
    params_b=4.7, context_max=32768, kv={"full": 36, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["costaud", "extraction", "graphiques", "Apache 2.0", "GGUF"],
    caps=OcrCaps(
        tasks={"markdown": "Parse this document to Markdown."}, default_task="markdown", free_prompt=True, languages="multilingue",
        strengths=["Document vers Markdown en une passe", "Extraction d'informations (factures, reçus, pièces d'identité) par instruction", "Lecture de graphiques"],
        weaknesses=["4,7 milliards de paramètres : le plus lourd et le plus lent de la liste", "Il suit les instructions libres : à guider pour qu'il n'invente pas"]),
)

QWEN3_VL_2B = _ocr(
    id="ocr-qwen3-vl-2b", name="Qwen3-VL 2B", family="Qwen",
    description="Un modèle généraliste qui lit les images : moins précis qu'un modèle dédié sur les pages denses, mais il "
    "répond à une consigne libre (« résume ce reçu », « liste les montants »). Licence Apache 2.0.",
    repo="ggml-org/Qwen3-VL-2B-Instruct-GGUF", default="Q8_0", mmproj=("mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf", 0.41),
    files={"Q8_0": ("Qwen3-VL-2B-Instruct-Q8_0.gguf", 1.71)},
    params_b=2.1, context_max=65536, kv={"full": 28, "heads": 8, "dim": 128}, license="Apache 2.0",
    tags=["généraliste", "consigne libre", "Apache 2.0", "GGUF"],
    caps=OcrCaps(
        tasks={"text": "Read all the text in this image and write it out exactly, keeping the line breaks. Answer with the text only.",
               "markdown": "Convert this document image to Markdown. Keep headings, lists and tables (as Markdown tables). "
                           "Answer with the Markdown only, without comments.",
               "table": "Extract the table or tables of this image as Markdown tables. Answer with the tables only."},
        default_task="markdown", free_prompt=True, languages="multilingue",
        strengths=["Répond à une consigne libre sur le document", "Écriture manuscrite et scènes (panneaux, étiquettes) mieux tolérées", "Aussi utile hors OCR (description d'image)"],
        weaknesses=["Moins précis qu'un modèle dédié sur les pages denses et les tableaux", "Peut paraphraser ou compléter au lieu de recopier : vérifiez le résultat"]),
)

SPECS = [GLM_OCR, PADDLE_OCR_VL, LIGHTON_OCR, DEEPSEEK_OCR, DOTS_OCR, QIANFAN_OCR, QWEN3_VL_2B]
