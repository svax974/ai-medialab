# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Models for the "Diagrams" tab (organization charts, flowcharts, schemas): reruns of the chat language models
(`llm_models.py`) under `kind="diagram"`, for structured-JSON generation (`response_format: json_schema`, converted
to Mermaid by the back) rather than conversation. Each entry shares the exact same GGUF file(s) as its chat
counterpart (`dataclasses.replace`, same `sources`): installing one installs the other, nothing to download twice.
"""

from __future__ import annotations

import dataclasses

from . import llm_models
from .base import ModelSpec


def _diagram_variant(llm: ModelSpec, description: str) -> ModelSpec:
    return dataclasses.replace(llm, id=f"diagram-{llm.id.removeprefix('llm-')}", kind="diagram", description=description)


QWEN3_4B = _diagram_variant(
    llm_models.QWEN3_4B,
    "Rapide et léger, bon en suivi d'instructions : le choix par défaut pour un organigramme ou un schéma simple.",
)
QWEN3_8B = _diagram_variant(
    llm_models.QWEN3_8B,
    "Un peu plus capable que le 4B, avec un mode de réflexion activable, pour des diagrammes avec plus de nœuds.",
)
GEMMA_12B = _diagram_variant(
    llm_models.GEMMA_12B,
    "Diagrammes plus complexes ou plus fidèles au prompt, au prix de plus de mémoire.",
)
GPT_OSS_20B = _diagram_variant(
    llm_models.GPT_OSS_20B,
    "Le plus capable des quatre : pour des diagrammes riches en nœuds et relations, sur une machine avec beaucoup de mémoire.",
)

SPECS = [QWEN3_4B, QWEN3_8B, GEMMA_12B, GPT_OSS_20B]
