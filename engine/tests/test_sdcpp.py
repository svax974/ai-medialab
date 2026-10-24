# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Effective GGUF engine settings (default steps and guidance when editing)."""

import os

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app.engines import MODELS  # noqa: E402
from app.engines.sdcpp_engine import effective_settings  # noqa: E402

QWEN = MODELS["qwen-image-2.1-gguf"]
ZIMG = MODELS["z-image-turbo-gguf"]
KLEIN = MODELS["flux-3-image-klein-gguf"]


def req(steps, guidance):
    return steps, guidance


def test_creation_keeps_the_defaults():
    assert effective_settings(QWEN, *req(20, 1.0), editing=False) == (20, 1.0)


def test_editing_with_defaults_uses_12_steps_and_guidance_4():
    assert effective_settings(QWEN, *req(20, 1.0), editing=True) == (12, 4.0)


def test_explicit_user_values_are_never_overridden_in_editing():
    assert effective_settings(QWEN, *req(30, 2.5), editing=True) == (30, 2.5)
    assert effective_settings(QWEN, *req(16, 1.0), editing=True) == (16, 4.0)


def test_models_without_edit_options_are_untouched():
    assert effective_settings(ZIMG, *req(8, 1.0), editing=True) == (8, 1.0)


class TestPromptArguments:
    """`prompt_args`: the prompt stays off the command line (readable by other processes) in a private session."""

    @staticmethod
    def binary(tmp_path, tag):
        import json

        folder = tmp_path / "metal"
        folder.mkdir(exist_ok=True)
        if tag:
            (folder / "VERSION.json").write_text(json.dumps({"tag": tag}))
        return folder / "sd-cli"

    def test_a_private_run_hands_the_prompts_over_in_files(self, tmp_path):
        from app.sdcpp import prompt_args

        work = tmp_path / "work"
        work.mkdir()
        text = "un chat — « test »\nligne 2"
        args = prompt_args(self.binary(tmp_path, "master-956-1b0ba10"), text, "  flou  ", work)
        assert args[0] == "--prompt-file" and args[2] == "--negative-prompt-file" and text not in args
        assert (work / "prompt.txt").read_text(encoding="utf-8") == text and (work / "negative.txt").read_text() == "flou"
        assert oct((work / "prompt.txt").stat().st_mode & 0o777) == "0o600"

    def test_no_negative_prompt_means_no_negative_file(self, tmp_path):
        from app.sdcpp import prompt_args

        work = tmp_path / "work"
        work.mkdir()
        assert prompt_args(self.binary(tmp_path, "master-956-1b0ba10"), "p", "  ", work) == ["--prompt-file", str(work / "prompt.txt")]
        assert not (work / "negative.txt").exists()

    def test_without_a_folder_or_with_an_old_or_unknown_build_the_command_line_is_used(self, tmp_path):
        from app.sdcpp import PROMPT_FILE_MIN_BUILD, prompt_args

        work = tmp_path / "work"
        work.mkdir()
        assert prompt_args(self.binary(tmp_path, "master-956-1b0ba10"), "p", "n", None) == ["-p", "p", "-n", "n"]
        assert prompt_args(self.binary(tmp_path, f"master-{PROMPT_FILE_MIN_BUILD - 1}-abc"), "p", "", work) == ["-p", "p"]
        other = tmp_path / "unknown"
        other.mkdir()
        assert prompt_args(other / "sd-cli", "p", "n", work) == ["-p", "p", "-n", "n"]  # no VERSION.json: benefit of the doubt is NOT given
        assert not list(work.iterdir())  # nothing was written


STUB_IMAGE = '''#!{python}
import json, os, sys
from PIL import Image
a = sys.argv[1:]
log = os.environ["STUB_ARGV"]
open(log, "w").write(json.dumps(a))
if "--prompt-file" in a:
    open(log + ".prompt", "w").write(open(a[a.index("--prompt-file") + 1], encoding="utf-8").read())
Image.new("RGB", (8, 8), "red").save(a[a.index("-o") + 1])
'''


def test_the_image_engine_keeps_a_private_prompt_off_the_command_line(tmp_path, monkeypatch):
    import json
    import stat
    import sys

    from app.engines.base import GenerationRequest, Hooks
    from app.engines.sdcpp_engine import SdcppEngine

    folder = tmp_path / "metal"
    folder.mkdir()
    binary = folder / "sd-cli"
    binary.write_text(STUB_IMAGE.format(python=sys.executable))
    binary.chmod(binary.stat().st_mode | stat.S_IEXEC)
    (folder / "VERSION.json").write_text(json.dumps({"tag": "master-956-1b0ba10"}))
    monkeypatch.setattr("app.system.get_system", lambda refresh=False: {"engines": {"sdcpp": {"available": True, "binary": str(binary), "variant": "metal"}}})
    monkeypatch.setattr("huggingface_hub.hf_hub_download", lambda repo, filename, **kw: f"/cache/{repo}/{filename}")
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    monkeypatch.setenv("STUB_ARGV", str(tmp_path / "argv.json"))
    engine = SdcppEngine(ZIMG, None)
    engine.load()
    hooks = Hooks(on_step=lambda s, t: None, on_preview=lambda im: None, is_cancelled=lambda: False)
    sentinel = "PHRASE-TEMOIN-9c2b"

    def run(private):
        req = GenerationRequest(prompt=f"un chat {sentinel}", width=64, height=64, steps=2, seed=1, guidance=1.0, negative_prompt="flou",
                                extra={"private": True} if private else {})
        engine.generate(req, hooks).close()
        return json.loads((tmp_path / "argv.json").read_text())

    argv = run(True)
    assert "-p" not in argv and "-n" not in argv and sentinel not in json.dumps(argv)
    assert (tmp_path / "argv.json.prompt").read_text() == f"un chat {sentinel}"
    assert not list(tmp_path.glob("sdcpp-*"))  # the run folder, prompt files included, is gone
    normal = run(False)
    assert normal[normal.index("-p") + 1] == f"un chat {sentinel}" and normal[normal.index("-n") + 1] == "flou"


class TestFlux3Klein:
    """FLUX 3 Image Klein: measured settings, and refusal of a stable-diffusion.cpp build that predates the architecture."""

    def test_defaults_are_the_distilled_ones_and_editing_keeps_them(self):
        assert KLEIN.default_params()["steps"] == 16 and KLEIN.default_params()["guidance"] == 1.0
        assert effective_settings(KLEIN, 16, 1.0, editing=True) == (16, 1.0)
        assert KLEIN.reference_mode == "multi" and KLEIN.max_references == 4 and KLEIN.text_to_image

    def test_variants_are_the_published_files_with_the_tested_default(self):
        assert [v.key for v in KLEIN.variants] == ["AD-Q4_K", "AD-Q5_K", "Q8_0"] and KLEIN.default_variant == "AD-Q5_K"
        assert KLEIN.options["files"]["diffusion-model"][1] == "FLUX-3-Image-Klein-AD-Q5_K.gguf"
        q8 = next(v for v in KLEIN.variants if v.key == "Q8_0")
        assert q8.options["files"]["diffusion-model"][1] == "FLUX-3-Image-Klein-Q8_0.gguf"
        assert q8.size_gb == round(KLEIN.download_size_gb - 4.44 + 5.99, 2)

    def test_a_build_older_than_968_is_refused_with_the_reinstall_hint(self, tmp_path):
        import json

        from app.sdcpp import model_unsupported

        binary = tmp_path / "sd-cli"
        assert model_unsupported(binary, 968) is None  # unknown version: benefit of the doubt
        for tag, refused in (("master-956-1b0ba10", True), ("master-967-abc", True), ("master-968-8cd731e", False),
                             ("master-999-e0ed724", False)):
            (tmp_path / "VERSION.json").write_text(json.dumps({"tag": tag}))
            assert bool(model_unsupported(binary, KLEIN.options["min_build"])) is refused
        assert model_unsupported(binary, None) is None
        (tmp_path / "VERSION.json").write_text(json.dumps({"tag": "master-956-1b0ba10"}))
        assert "968" in model_unsupported(binary, 968) and "Réinstallez" in model_unsupported(binary, 968)

    def test_the_engine_refuses_to_load_on_an_old_build(self, tmp_path, monkeypatch):
        import json
        import pytest

        from app.engines.sdcpp_engine import SdcppEngine

        (tmp_path / "VERSION.json").write_text(json.dumps({"tag": "master-956-1b0ba10"}))
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: {"engines": {"sdcpp": {
            "available": True, "binary": str(tmp_path / "sd-cli"), "variant": "metal"}}})
        with pytest.raises(RuntimeError, match="trop ancien"):
            SdcppEngine(KLEIN, None).load()
