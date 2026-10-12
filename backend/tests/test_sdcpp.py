# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Effective GGUF engine settings (default steps and guidance when editing)."""

import os

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app.engines import MODELS  # noqa: E402
from app.engines.base import GenerationRequest  # noqa: E402
from app.engines.sdcpp_engine import effective_settings  # noqa: E402

QWEN = MODELS["qwen-image-2.1-gguf"]
ZIMG = MODELS["z-image-turbo-gguf"]


def req(steps, guidance):
    return GenerationRequest(prompt="p", width=512, height=512, steps=steps, seed=1, guidance=guidance)


def test_creation_keeps_the_defaults():
    assert effective_settings(QWEN, req(20, 1.0), editing=False) == (20, 1.0)


def test_editing_with_defaults_uses_12_steps_and_guidance_4():
    assert effective_settings(QWEN, req(20, 1.0), editing=True) == (12, 4.0)


def test_explicit_user_values_are_never_overridden_in_editing():
    assert effective_settings(QWEN, req(30, 2.5), editing=True) == (30, 2.5)
    assert effective_settings(QWEN, req(16, 1.0), editing=True) == (16, 4.0)


def test_models_without_edit_options_are_untouched():
    assert effective_settings(ZIMG, req(8, 1.0), editing=True) == (8, 1.0)
