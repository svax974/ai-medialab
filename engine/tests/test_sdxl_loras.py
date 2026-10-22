# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""SDXL fine-tunes and LoRAs: catalog entries, Hub family, prompt triggers, pixel post-processing (no torch, no network)."""

from fnmatch import fnmatch

from PIL import Image

from app import hf_search
from app.engines import MODELS, custom
from app.engines.diffusers_engine import pixelate, with_triggers
from app.engines.torch_models import SDXL


def matches(spec, filename):
    return any(fnmatch(filename, p) for p in spec.hf_patterns)


def test_a_lora_model_shares_the_sdxl_download_and_adds_its_file():
    spec = MODELS["pixel-art-xl"]
    base, lora = spec.all_sources()
    assert (base.repo, base.patterns, base.check_files) == (SDXL.hf_repo, SDXL.hf_patterns, SDXL.check_files)
    assert (lora.repo, lora.patterns) == ("nerijs/pixel-art-xl", ["pixel-art-xl.safetensors"])
    assert spec.hf_repo == SDXL.hf_repo and spec.options["loras"][0]["trigger"] == "pixel art"
    keys = [p.key for p in spec.params]
    assert keys == ["steps", "guidance", "strength", "lora_scale", "pixel_perfect", "negative_prompt"]
    assert spec.options["pixelate"] == 8 and spec.reference_mode == "init"
    assert SDXL.params[3].default == ""  # the base model is not modified by its derivatives


def test_a_fine_tune_downloads_only_its_diffusers_components():
    spec = MODELS["realvis-xl-5"]
    assert matches(spec, "unet/diffusion_pytorch_model.fp16.safetensors")
    assert not matches(spec, "unet/diffusion_pytorch_model-00001-of-00002.safetensors")  # fp32 shards
    assert not matches(spec, "RealVisXL_V5.0_fp16.safetensors")  # single-file checkpoint at the root
    assert spec.options["scheduler"]["class"] == "DPMSolverMultistepScheduler"
    assert spec.options["load_kwargs"]["variant"] == "fp16"
    anime = MODELS["animagine-xl-4"]  # ships no fp16 variant
    assert matches(anime, "unet/diffusion_pytorch_model.safetensors") and "variant" not in anime.options["load_kwargs"]


def test_a_turbo_fine_tune_accepts_few_steps():
    steps = MODELS["dreamshaper-xl-turbo"].params[0]
    assert (steps.default, steps.min) == (6, 4)
    assert SDXL.params[0].min == 10


def test_triggers_are_added_once():
    assert with_triggers("a knight", ["pixel art"]) == "pixel art, a knight"
    assert with_triggers("Pixel Art knight", ["pixel art"]) == "Pixel Art knight"
    assert with_triggers("a knight", ["", "PixArFK"]) == "PixArFK, a knight"


def test_pixelate_puts_the_image_on_a_grid():
    img = Image.new("RGB", (64, 64))
    for x in range(64):
        for y in range(64):
            img.putpixel((x, y), (x * 4, y * 4, 0))
    out = pixelate(img, 8)
    assert out.size == (64, 64)
    block = {out.getpixel((x, y)) for x in range(8, 16) for y in range(16, 24)}
    assert len(block) == 1  # one colour per 8 × 8 block


def test_hub_classifies_sdxl_loras():
    tags = ["diffusers", "lora", "base_model:adapter:stabilityai/stable-diffusion-xl-base-1.0"]
    assert hf_search.classify("u/my-lora", tags) == ("sdxl-lora", {"base": "stabilityai/stable-diffusion-xl-base-1.0"})
    assert hf_search.classify("u/flux-lora", ["lora", "base_model:adapter:black-forest-labs/FLUX.1-dev"]) is None
    assert hf_search.listing_precisions("sdxl-lora", "u/my-lora", ["x.safetensors"], None) == ["LoRA"]


def test_lora_trigger_comes_from_the_model_card():
    assert hf_search.lora_trigger({"instance_prompt": " pixel art "}) == "pixel art"
    assert hf_search.lora_trigger({"instance_prompt": ["a", "b"]}) == ""
    assert hf_search.lora_trigger(None) == ""


def test_custom_sdxl_lora_recipe():
    spec = custom.build({"family": "sdxl-lora", "id": "custom-u-style", "repo": "u/style", "name": "style",
                         "file": "style.safetensors", "size_gb": 0.2, "trigger": "in style X", "license": "mit"})
    assert spec.custom and spec.name == "SDXL · style" and "in style X" in spec.description
    assert spec.all_sources()[0].repo == SDXL.hf_repo and spec.all_sources()[1].patterns == ["style.safetensors"]
    assert "pixel_perfect" not in [p.key for p in spec.params]


def test_a_lora_needs_only_its_file_once_sdxl_is_there(monkeypatch):
    from app.engines import base

    monkeypatch.setattr(base, "_source_status", lambda src: {"state": "installed" if src.repo == SDXL.hf_repo else "missing",
                                                             "size": 0})
    assert base.remaining_download_gb(MODELS["pixel-art-xl"]) == 0.16
    assert MODELS["pixel-art-xl"].download_size_gb == 6.62  # the first one also brings SDXL


def test_the_face_model_adds_the_ip_adapter_to_pixel_art_xl():
    from app.engines.torch_models import IP_ADAPTER_SOURCE

    spec = MODELS["pixel-art-xl-face"]
    assert (spec.reference_mode, spec.max_references, spec.requires_references) == ("face", 2, True)
    assert [s.repo for s in spec.all_sources()] == [SDXL.hf_repo, "nerijs/pixel-art-xl", "h94/IP-Adapter"]
    assert all(p.endswith((".safetensors", ".json")) for p in IP_ADAPTER_SOURCE.patterns)  # never the .bin pickles
    assert spec.options["ip_adapter"]["encoder"] == "models/image_encoder"
    assert [p.key for p in spec.params][3:6] == ["face_scale", "lora_scale", "pixel_perfect"]
    assert spec.download_size_gb == 9.71
    assert MODELS["pixel-art-xl"].reference_mode == "init"  # the plain model is unchanged


def test_reference_roles_per_mode():
    from app.engines.base import size_reference_index
    from app.engines.diffusers_engine import reference_roles

    assert reference_roles("init", ["a", "b"]) == ("a", None, [])
    assert reference_roles("face", ["face"]) == (None, "face", [])
    assert reference_roles("face", ["face", "start"]) == ("start", "face", [])
    assert reference_roles("multi", ["a", "b"]) == (None, None, ["a", "b"])
    assert reference_roles("none", ["a"]) == (None, None, [])
    assert [size_reference_index("face", n) for n in (1, 2)] == [0, 1]
    assert size_reference_index("init", 2) == 0
