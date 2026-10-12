# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Custom Hugging Face models: classification, recipes, precision (no network)."""

import pytest

from app import hf_search
from app.catalog import precision_of, quant_from_name
from app.engines import MODELS, custom
from app.engines.base import installation_status


def test_quant_from_name():
    assert quant_from_name("z-image-turbo-Q4_K_M.gguf") == "Q4_K_M"
    assert quant_from_name("qwen_image_2.1-Q8_0.gguf") == "Q8_0"
    assert quant_from_name("sub/dir/model-BF16.gguf") == "BF16"
    assert quant_from_name("model.safetensors") == ""


def test_classify_supported_formats():
    c = hf_search.classify
    assert c("a/sdxl", ["diffusers", "diffusers:StableDiffusionXLPipeline"])[0] == "sd-diffusers"
    assert c("a/q", ["gguf", "base_model:quantized:Qwen/Qwen-Image-2.1"])[1]["template"] == "qwen-image-2.1-gguf"
    assert c("a/tts", ["safetensors", "qwen3_tts"])[0] == "qwen3-tts"
    assert c("a/faster-whisper-x", ["ctranslate2"])[0] == "whisper-ct2"


@pytest.mark.parametrize("repo,tags", [
    ("a/flux", ["gguf", "base_model:quantized:black-forest-labs/FLUX.1-dev"]),   # unsupported architecture
    ("a/tts-gguf", ["gguf", "qwen3_tts"]),                                          # quantized: can't be loaded
    ("a/tts-mlx", ["qwen3_tts", "mlx"]),
    ("a/ct2", ["ctranslate2"]),                                                     # not a Whisper
    ("a/flux", ["diffusers", "diffusers:FluxPipeline"]),
])
def test_classify_rejects_unsupported(repo, tags):
    assert hf_search.classify(repo, tags) is None


GGUF = {"family": "gguf-variant", "id": "custom-x", "repo": "u/Z-Image-Turbo-GGUF", "template": "z-image-turbo-gguf",
        "file": "z-image-turbo-Q5_K_M.gguf", "size_gb": 5.57, "precision": "Q5_K_M", "name": "u Q5_K_M", "license": "apache-2.0"}


def test_gguf_variant_replaces_only_the_diffusion_file():
    spec = custom.build(GGUF)
    base = MODELS["z-image-turbo-gguf"]
    assert spec.options["files"]["diffusion-model"] == ("u/Z-Image-Turbo-GGUF", "z-image-turbo-Q5_K_M.gguf")
    assert spec.options["files"]["llm"] == base.options["files"]["llm"]
    assert spec.sources[0].repo == "u/Z-Image-Turbo-GGUF" and spec.sources[1:] == base.sources[1:]
    assert base.options["files"]["diffusion-model"][0] == "leejet/Z-Image-Turbo-GGUF"  # the original model is untouched
    assert spec.custom and precision_of(spec, None) == "Q5_K_M"
    assert installation_status(spec)["state"] in ("missing", "partial")


def test_sd_diffusers_recipe():
    spec = custom.build({"family": "sd-diffusers", "id": "custom-sd", "repo": "u/sd", "name": "sd", "pipeline":
                         "StableDiffusionPipeline", "files": ["model_index.json", "unet/x.fp16.safetensors"], "fp16": True,
                         "size_gb": 2.0, "weights_gb": 2.0, "largest_gb": 1.7, "precision": "fp16"})
    assert spec.backend == "torch" and spec.options["load_kwargs"]["variant"] == "fp16"
    assert spec.options["load_kwargs"]["safety_checker"] is None and spec.min_side == 256
    assert precision_of(spec, None) == "fp16"


def test_qwen_tts_and_whisper_recipes():
    q = custom.build({"family": "qwen3-tts", "id": "custom-q", "repo": "u/q", "name": "q", "variant": "custom_voice",
                      "speakers": ["vivian", "my_voice"], "size_gb": 2.3, "precision": "bf16"})
    assert [v.id for v in q.audio.voices] == ["Vivian", "my_voice"] and q.audio.instruct and not q.audio.design
    d = custom.build({"family": "qwen3-tts", "id": "custom-d", "repo": "u/d", "name": "d", "variant": "voice_design",
                      "size_gb": 4.2, "precision": "bf16"})
    assert d.audio.design and not d.audio.voices
    w = custom.build({"family": "whisper-ct2", "id": "custom-w", "repo": "u/faster-whisper-x", "name": "x",
                      "size_gb": 0.1, "precision": "int8"})
    assert w.audio.task == "stt" and w.options["pack"] == "speech"


def test_builtin_precisions():
    assert precision_of(MODELS["z-image-turbo-gguf"], None) == "Q4_K"
    assert precision_of(MODELS["qwen-image-edit-gguf"], None) == "Q4_K_M"
    assert precision_of(MODELS["kokoro-82m"], None) == "fp32"


def test_variants_replace_only_the_weights():
    from app.engines.base import with_variant

    base = MODELS["z-image-turbo-gguf"]
    q8 = with_variant(base, "Q8_0")
    assert q8.variant == "Q8_0" and q8.precision == "Q8_0"
    assert q8.options["files"]["diffusion-model"][1] == "z_image_turbo-Q8_0.gguf"
    assert q8.options["files"]["llm"] == base.options["files"]["llm"]  # encoder and VAE are shared
    assert q8.download_size_gb > base.download_size_gb
    assert with_variant(base, "inconnue").variant == "Q4_K"  # falls back to the default quantization
    assert base.variant == ""  # the original spec is not modified


def test_mlx_qwen_has_no_bf16_download():
    from app.engines.base import with_variant

    spec = MODELS["qwen-image-2.1"]
    assert spec.hf_repo is None and spec.default_variant == "q4"
    assert {v.key for v in spec.variants} == {"q4", "q8"}
    assert all(s.repo != "Qwen/Qwen-Image-2.1" for v in spec.variants for s in v.sources)
    assert with_variant(spec, None).options["model_path"] == "mlx-community/Qwen-Image-2.1-mflux-q4"
    assert spec.default_quantize is None
