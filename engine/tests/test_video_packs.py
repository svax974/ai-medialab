# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video packs (Kiwi-Edit, Bernini): specs, pack definitions, hardware gating, worker protocol with a stub engine.

Nothing here installs a pack, downloads weights or touches a GPU."""

import ast
import asyncio
import hashlib
import importlib.util
import io
import json
import os
import py_compile
import shutil
import subprocess
import sys
import tarfile
import types
from pathlib import Path

import numpy as np
import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import audio_packs  # noqa: E402
from app.audio_packs import PackArchive, PackInstaller  # noqa: E402
from app.engines import MODELS, get_spec, video_specs  # noqa: E402

RUNTIME = Path(__file__).resolve().parents[1] / "video_runtime"

MAC = {"os": "Darwin", "arch": "arm64", "ram_gb": 64.0, "accelerators": [{"vendor": "apple", "backend": "metal", "memory_gb": 64.0}],
       "unusable_gpus": [], "engines": {}}
NVIDIA = {"os": "Linux", "arch": "x86_64", "ram_gb": 64.0, "unusable_gpus": [],
          "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 24.0}], "engines": {}}


def _load(name: str, path: Path):
    """Import a video_runtime module under its own name (the audio runtime also has a `common.py`)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestSpecs:
    def test_pack_specs_are_consistent(self):
        assert [s.id for s in video_specs.PACK_SPECS] == ["kiwi-edit-5b", "bernini-r-1.3b"]
        for spec in video_specs.PACK_SPECS:
            assert MODELS[spec.id] is spec and spec.kind == "video" and spec.backend == "pack"
            pack = audio_packs.PACKS[spec.options["pack"]]
            assert pack.family == "video" and pack.gpu == "cuda" and pack.python in ("3.10", "3.11")
            module, cls = spec.engine.split(":")
            assert (RUNTIME / "engines" / f"{module}.py").is_file() and cls
            assert spec.weights_gb and spec.largest_component_gb and spec.download_size_gb and spec.memory_hint
            assert spec.license and spec.all_sources() and spec.sources[0].check_files
            assert spec.options["min_vram_gb"] and spec.options["min_ram_gb"]
            assert spec.description.endswith(".") and "\n" not in spec.description

    def test_descriptions_and_inputs(self):
        kiwi, bernini = get_spec("kiwi-edit-5b"), get_spec("bernini-r-1.3b")
        assert kiwi.description == "Édition de vidéo par instruction, avec image de référence optionnelle."
        assert "planificateur" not in bernini.description and bernini.description.endswith("(version légère).")
        assert kiwi.video.video_input == "required" and kiwi.video.tasks == ["v2v"]
        assert kiwi.video.image_input == "optional" and kiwi.video.image_role == "reference"
        assert kiwi.video.license_warning and "Qwen" in kiwi.video.license_warning
        assert "t2v" in bernini.video.tasks and bernini.video.video_input == "optional"
        assert round(kiwi.download_size_gb, 1) == 20.4 and round(bernini.download_size_gb, 1) == 28.9

    def test_public_serialization(self):
        d = get_spec("kiwi-edit-5b").to_public()
        assert d["video"]["image_role"] == "reference" and "options" not in d

    def test_runtime_files_compile(self, tmp_path):
        for f in [RUNTIME / "worker.py", RUNTIME / "common.py", *(RUNTIME / "engines").glob("*.py"), *(RUNTIME / "shims").rglob("*.py")]:
            py_compile.compile(str(f), cfile=str(tmp_path / (f.name + "c")), doraise=True)


class TestPackDefinitions:
    def test_pins(self):
        kiwi, bernini = audio_packs.PACKS["kiwi"], audio_packs.PACKS["bernini"]
        # 4.57.0 (the authors' pin) was yanked from PyPI; 4.57.1 is its fixed re-release.
        assert "transformers==4.57.1" in kiwi.requirements and "torch==2.7.0" in kiwi.torch_packages
        assert "transformers==4.57.3" in bernini.requirements and "diffusers==0.35.2" in bernini.requirements
        assert "torch==2.7.1" in bernini.torch_packages and "decord" in bernini.requirements
        bernini_repo, veomni = bernini.archives
        assert bernini_repo.url.endswith("e6c2cf11843470b08491745947abcba9c3c6b079.tar.gz") and bernini_repo.folders == ("bernini",)
        assert "ByteDance-Seed/VeOmni" in veomni.url and veomni.folders == ("veomni",)
        assert "veomni" in bernini.imports and "bernini.pipeline" in bernini.imports

    def test_nothing_that_needs_a_compiler_or_the_training_stack(self):
        for pid in ("kiwi", "bernini"):
            names = {r.split("==")[0].split(">")[0] for r in audio_packs.PACKS[pid].requirements}
            assert not names & {"flash-attn", "flash_attn", "deepspeed", "torchcodec", "datasets", "librosa", "mpi4py", "ninja"}

    def test_rocm_index_carries_the_pinned_torch(self, monkeypatch):
        # download.pytorch.org/whl/rocm6.4 starts at PyTorch 2.8: the 2.7 pins need the 6.3 index.
        monkeypatch.setattr(sys, "platform", "linux")
        amd, nvidia = [{"vendor": "amd"}], [{"vendor": "nvidia"}]
        assert audio_packs._torch_index(amd).endswith("/rocm6.4")  # audio packs keep the default
        for pid in ("kiwi", "bernini"):
            assert audio_packs._torch_index(amd, audio_packs.PACKS[pid].rocm).endswith("/rocm6.3")
            assert audio_packs._torch_index(nvidia, audio_packs.PACKS[pid].rocm).endswith("/cu128")

    def test_hash_depends_on_python_and_archive(self):
        import dataclasses

        bernini = audio_packs.PACKS["bernini"]
        base = audio_packs._requirements_hash(bernini)
        assert audio_packs._requirements_hash(dataclasses.replace(bernini, python="3.12")) != base
        assert audio_packs._requirements_hash(dataclasses.replace(bernini, archives=())) != base
        assert audio_packs._requirements_hash(audio_packs.PACKS["kiwi"]) != base

    def test_audio_pack_hash_is_unchanged(self):
        # Installed audio packs must stay valid: same formula as before the video packs existed.
        pack = audio_packs.PACKS["qwen3"]
        old = hashlib.sha256(json.dumps(["3.12", *audio_packs.requirements_for(pack), *pack.torch_packages]).encode()).hexdigest()[:16]
        assert audio_packs._requirements_hash(pack) == old

    def test_folders_follow_the_family(self):
        assert audio_packs.pack_dir("kiwi").parent.name == "video" and audio_packs.pack_dir("speech").parent.name == "audio"
        assert audio_packs.runtime_dir("kiwi").name == "video_runtime" and audio_packs.runtime_dir().name == "audio_runtime"
        assert audio_packs.runtime_dir("qwen3").name == "audio_runtime"

    def test_not_installed_here(self):
        assert not audio_packs.is_installed("kiwi") and not audio_packs.is_installed("bernini")


class TestHardwareGate:
    def test_mac_is_refused_with_a_french_reason(self):
        for pid in ("kiwi", "bernini"):
            reason = audio_packs.unsupported_reason(audio_packs.PACKS[pid], MAC)
            assert reason and "NVIDIA" in reason and "Mac" in reason

    def test_cuda_and_linux_rocm_are_accepted(self):
        kiwi = audio_packs.PACKS["kiwi"]
        assert audio_packs.unsupported_reason(kiwi, NVIDIA) is None
        assert audio_packs.unsupported_reason(kiwi, {**NVIDIA, "accelerators": [{"vendor": "amd", "backend": "rocm"}]}) is None
        assert audio_packs.unsupported_reason(kiwi, {**NVIDIA, "os": "Windows", "accelerators": [{"vendor": "amd", "backend": "cuda"}]})

    def test_gpu_the_main_runtime_cannot_use_still_counts(self):
        # The pack ships its own PyTorch: an NVIDIA card seen by the OS is enough.
        system = {**MAC, "os": "Windows", "accelerators": [], "unusable_gpus": [{"vendor": "nvidia", "name": "RTX"}]}
        assert audio_packs.unsupported_reason(audio_packs.PACKS["kiwi"], system) is None

    def test_audio_packs_have_no_gpu_requirement(self):
        assert audio_packs.unsupported_reason(audio_packs.PACKS["speech"], MAC) is None

    def test_engine_info_on_mac_offers_no_install(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC)
        info = audio_packs.engine_info("kiwi")
        assert info["available"] is False and not info.get("installable") and "NVIDIA" in info["reason"]
        assert info["pack_name"] and info["pack_contents"]

    def test_engine_info_on_nvidia_needs_uv_or_the_right_python(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: NVIDIA)
        monkeypatch.setattr(audio_packs, "find_uv", lambda: None)
        monkeypatch.setattr(sys, "version_info", types.SimpleNamespace(major=3, minor=14))
        info = audio_packs.engine_info("bernini")
        assert not info.get("installable") and "uv" in info["reason"] and "3.11" in info["reason"]
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")
        info = audio_packs.engine_info("bernini")
        assert info["installable"] is True and info["install_size_mb"] == audio_packs.PACKS["bernini"].size_mb

    def test_install_is_refused_on_mac(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC)
        with pytest.raises(RuntimeError, match="NVIDIA"):
            asyncio.run(PackInstaller().start("kiwi"))

    def test_catalog_marks_them_incompatible_but_lists_them(self, monkeypatch):
        from app import catalog

        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC)
        monkeypatch.setattr(catalog, "get_system", lambda refresh=False: MAC)
        models = {m["id"]: m for m in catalog.describe_models()["models"]}
        for mid in ("kiwi-edit-5b", "bernini-r-1.3b"):
            m = models[mid]
            assert m["compatible"] is False and m["ready"] is False and "NVIDIA" in m["engine_reason"]
            assert m["engine_pack"] in ("kiwi", "bernini") and m["description"]

    def test_video_plan_checks_memory(self):
        from app import catalog

        kiwi = get_spec("kiwi-edit-5b")
        small = {**NVIDIA, "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 12.0}]}
        assert catalog._pack_plan(kiwi, small)["fits"] is False
        assert catalog._pack_plan(kiwi, NVIDIA)["fits"] is True
        assert catalog._pack_plan(kiwi, {**NVIDIA, "ram_gb": 16.0})["fits"] is False
        unknown = {**NVIDIA, "accelerators": [{"vendor": "nvidia", "backend": "vulkan", "memory_gb": None}]}
        plan = catalog._pack_plan(kiwi, unknown)
        assert plan["fits"] is True and "non détectée" in plan["note"]


class TestArchive:
    def _tarball(self, tmp_path):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            def add(name, data=b"x"):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

            add("Bernini-abc/bernini/__init__.py", b"ok")
            add("Bernini-abc/bernini/models/m.py")
            add("Bernini-abc/assets/huge.png")
            add("Bernini-abc/bernini/../../escape.py")
            link = tarfile.TarInfo("Bernini-abc/bernini/link")
            link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tar.addfile(link)
        path = tmp_path / "src.tar.gz"
        path.write_bytes(buf.getvalue())
        return path

    def test_only_wanted_regular_files_are_extracted(self, tmp_path):
        tarball = self._tarball(tmp_path)
        dest = tmp_path / "src"
        PackInstaller()._fetch_archive(PackArchive(tarball.as_uri(), ("bernini",)), dest)
        found = sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file())
        assert found == ["bernini/__init__.py", "bernini/models/m.py"]
        assert not (tmp_path / "escape.py").exists()

    def test_missing_folder_is_an_error(self, tmp_path):
        with pytest.raises(RuntimeError, match="dossiers attendus"):
            PackInstaller()._fetch_archive(PackArchive(self._tarball(tmp_path).as_uri(), ("nothing",)), tmp_path / "d")

    def test_worker_env_exposes_the_extracted_code(self, tmp_path, monkeypatch):
        monkeypatch.setattr(audio_packs, "pack_dir", lambda pid: tmp_path / pid)
        # No extracted code yet: only the shims of the pack, and video workers never reach for the Hub.
        env = audio_packs.pack_env("bernini")
        assert env["PYTHONPATH"] == str(RUNTIME / "shims" / "bernini") and env["HF_HUB_OFFLINE"] == "1"
        (tmp_path / "bernini" / "src").mkdir(parents=True)
        env = audio_packs.pack_env("bernini")
        assert env["PYTHONPATH"].split(os.pathsep) == [str(tmp_path / "bernini" / "src"), str(RUNTIME / "shims" / "bernini")]
        assert audio_packs.pack_env("kiwi") == {"HF_HUB_OFFLINE": "1"}
        assert audio_packs.pack_env("speech") == {}  # audio packs are untouched

    def test_every_shim_folder_exists(self):
        for pack in audio_packs.PACKS.values():
            for name in pack.shims:
                assert (RUNTIME / "shims" / name).is_dir()


class TestFlashAttnShim:
    """`bernini.models` raises at import unless `flash_attn` is importable: the pack ships a torch-free stand-in."""

    def _run(self, code):
        shim = RUNTIME / "shims" / "bernini"
        return subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(shim)!r})\n{code}"],
                              capture_output=True, text=True, timeout=60)

    def test_the_names_bernini_imports_are_there(self):
        # Same lookups as bernini/models/modeling_qwen2_5_vl.py and bernini/attention.py.
        done = self._run("import importlib.util as u\n"
                         "assert u.find_spec('flash_attn') is not None and u.find_spec('flash_attn_interface') is None\n"
                         "from flash_attn import flash_attn_func, flash_attn_varlen_func\n"
                         "from flash_attn.bert_padding import unpad_input\n"
                         "assert 'torch' not in sys.modules")
        assert done.returncode == 0, done.stderr

    def test_no_package_metadata_so_transformers_ignores_it(self):
        done = self._run("import importlib.metadata as m\n"
                         "try:\n    m.version('flash_attn')\nexcept m.PackageNotFoundError:\n    pass\n"
                         "else:\n    raise SystemExit('metadata found')")
        assert done.returncode == 0, done.stderr

    def test_planner_only_functions_say_so(self):
        done = self._run("from flash_attn import flash_attn_func\n"
                         "try:\n    flash_attn_func()\nexcept NotImplementedError as e:\n    print(e)")
        assert "planificateur" in done.stdout


class TestUpstreamContracts:
    """The engines against the real signatures of the upstream code, recorded from the sources the pack installs
    (Kiwi-Edit weights repo rev 2760d81, Bernini commit e6c2cf1). Nothing here can run the models."""

    KIWI_CALL = {"prompt", "source_video", "source_input", "ref_image", "negative_prompt", "input_video", "height", "width",
                 "num_frames", "num_inference_steps", "guidance_scale", "sigma_shift", "denoising_strength", "seed", "tiled",
                 "tile_size", "tile_stride", "output_type", "progress_bar"}
    BERNINI_CALL = {"prompt", "neg_prompt", "num_frames", "max_image_size", "height", "width", "video", "image", "images",
                    "num_inference_steps", "guidance_mode", "omega_vid", "omega_img", "omega_txt", "omega_scale", "flow_shift",
                    "seed", "fps", "vae_fps", "vit_fps", "eta", "norm_threshold", "momentum", "system_prompt", "output_path",
                    "write_output"}
    BERNINI_FROM_PRETRAINED = {"config_dir", "high_noise_ckpt", "low_noise_ckpt", "device", "load_ckpt_weights",
                               "use_unipc", "shift", "use_src_id_rotary_emb", "interpolate_src_id", "max_trained_src_id"}
    # bernini/models/wan_diffusion.py: GEN_Wanx22.sample
    BERNINI_MODES = {"rv2v", "v2v", "v2v_chain", "t2v", "r2v_apg", "v2v_apg", "t2v_apg"}

    def _calls(self, filename, attr):
        tree = ast.parse((RUNTIME / "engines" / filename).read_text())
        found = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                 and n.func.attr == attr]
        assert found, attr
        return found

    def _pipe_call(self, filename):
        (call,) = [n for n in ast.walk(ast.parse((RUNTIME / "engines" / filename).read_text()))
                   if isinstance(n, ast.Call) and ast.unparse(n.func) == "self.pipe"]
        return call

    def test_kiwi_pipeline_call(self):
        call = self._pipe_call("kiwi_engine.py")
        names = {k.arg for k in call.keywords}
        assert names <= self.KIWI_CALL and {"prompt", "source_video", "ref_image", "height", "width", "num_frames", "seed"} <= names
        assert not call.args  # everything by keyword: the signature has many optional parameters in between

    def test_kiwi_loads_like_the_authors_demo(self):
        (load,) = self._calls("kiwi_engine.py", "from_pretrained")
        assert {k.arg for k in load.keywords} == {"trust_remote_code", "torch_dtype"}

    def test_bernini_pipeline_call(self):
        call = self._pipe_call("bernini_engine.py")
        assert {k.arg for k in call.keywords} <= self.BERNINI_CALL and len(call.args) == 1  # the prompt is positional
        (load,) = self._calls("bernini_engine.py", "from_pretrained")
        assert {k.arg for k in load.keywords} <= self.BERNINI_FROM_PRETRAINED

    @pytest.fixture
    def _engine(self, monkeypatch):
        """Import an engine module of the video runtime (it only needs numpy and Pillow until a model loads)."""
        def load(name):
            for mod in [m for m in sys.modules if m == "common" or m == "engines" or m.startswith("engines.")]:
                monkeypatch.delitem(sys.modules, mod)
            monkeypatch.syspath_prepend(str(RUNTIME))
            return importlib.import_module(f"engines.{name}")

        return load

    def test_bernini_routing_uses_modes_that_exist(self, _engine):
        engine = _engine("bernini_engine")
        modes = {engine.route(v, r)[1] for v in (None, "v.mp4") for r in ([], ["r.png"])}
        assert modes == {"t2v_apg", "r2v_apg", "v2v_apg", "rv2v"} and modes <= self.BERNINI_MODES
        assert engine.route(None, []) == ("t2v", "t2v_apg") and engine.route("v.mp4", ["r.png"]) == ("rv2v", "rv2v")
        assert engine.route("v.mp4", []) == ("v2v", "v2v_apg") and engine.route(None, ["r.png"]) == ("r2v", "r2v_apg")

    def test_bernini_progress_bar_reports_and_cancels(self, _engine):
        mod = _engine("bernini_engine")
        steps, cancel = [], []
        engine = mod.BerniniEngine({})
        engine.on_step = lambda step, total: steps.append((step, total))
        engine.cancelled = lambda: bool(cancel)
        mod._Bar.engine = engine
        bar = mod._Bar(list(range(4)))
        bar.update(1)
        bar.update(1)
        assert steps == [(1, 4), (2, 4)]
        cancel.append(True)
        with pytest.raises(sys.modules["common"].Cancelled):
            bar.update(1)

    def test_kiwi_progress_bar_reports_and_cancels(self, _engine):
        mod = _engine("kiwi_engine")
        steps, cancel = [], []
        engine = mod.KiwiEngine({})
        engine.on_step = lambda step, total: steps.append((step, total))
        engine.cancelled = lambda: bool(cancel)
        run = engine._bar()
        seen = []
        with pytest.raises(sys.modules["common"].Cancelled):
            for item in run(iter([10, 20, 30])):
                seen.append(item)
                if item == 20:
                    cancel.append(True)
        assert seen == [10, 20] and steps == [(1, 3), (2, 3)]

    def test_frame_counts_are_4n_plus_1(self):
        common = _load("video_runtime_common", RUNTIME / "common.py")
        assert [common.valid_frame_count(n) for n in (0, 1, 4, 5, 8, 9, 61, 64, 81)] == [0, 1, 1, 5, 5, 9, 61, 61, 81]


class TestHuggingFaceLayouts:
    """File lists of the weights repos (HF API, revisions pinned below): the download patterns must fetch everything
    the offline loaders read, the remote-code .py files included."""

    KIWI = {  # revision 2760d8197b6bdb49181bce8cceb2da781568b766
        "__init__.py", "conditional_embedder.py", "mllm_encoder.py", "model_index.json", "pipeline_kiwi_edit.py",
        "wan_video_vae.py", "README.md", "mllm_encoder/config.json", "mllm_encoder/generation_config.json",
        "mllm_encoder/mllm_encoder.py", "mllm_encoder/diffusion_pytorch_model.safetensors",
        "mllm_encoder/model-00001-of-00002.safetensors", "mllm_encoder/model-00002-of-00002.safetensors",
        "mllm_encoder/model.safetensors.index.json", "processor/added_tokens.json", "processor/chat_template.jinja",
        "processor/merges.txt", "processor/preprocessor_config.json", "processor/qwen_config.json",
        "processor/special_tokens_map.json", "processor/tokenizer.json", "processor/tokenizer_config.json",
        "processor/video_preprocessor_config.json", "processor/vocab.json", "ref_embedder/conditional_embedder.py",
        "ref_embedder/config.json", "ref_embedder/diffusion_pytorch_model.safetensors", "scheduler/scheduler_config.json",
        "source_embedder/conditional_embedder.py", "source_embedder/config.json",
        "source_embedder/diffusion_pytorch_model.safetensors", "transformer/config.json",
        "transformer/diffusion_pytorch_model.safetensors", "vae/config.json", "vae/diffusion_pytorch_model.safetensors",
        "vae/wan_video_vae.py",
    }
    BERNINI = {  # revision ff4c5d4d2d31365c2ffeb30e9753065ee18f58ce
        "README.md", "assets/arena.png", "assets/bernini-icon.png", "config.json", "scheduler/scheduler_config.json",
        "text_encoder/config.json", "text_encoder/model.safetensors.index.json",
        *(f"text_encoder/model-0000{i}-of-00005.safetensors" for i in range(1, 6)),
        "tokenizer/special_tokens_map.json", "tokenizer/spiece.model", "tokenizer/tokenizer.json",
        "tokenizer/tokenizer_config.json", "transformer/config.json", "transformer/diffusion_pytorch_model.safetensors.index.json",
        "transformer/diffusion_pytorch_model-00001-of-00002.safetensors",
        "transformer/diffusion_pytorch_model-00002-of-00002.safetensors", "vae/config.json",
        "vae/diffusion_pytorch_model.safetensors",
    }

    def _fetched(self, spec, files):
        (src,) = spec.sources
        return {f for f in files if src.patterns is None or audio_packs_matches(f, src.patterns)}, src

    def test_kiwi_downloads_the_whole_repo_with_its_remote_code(self):
        fetched, src = self._fetched(get_spec("kiwi-edit-5b"), self.KIWI)
        assert src.patterns is None and fetched == self.KIWI
        for pattern in src.check_files:
            assert any(audio_packs_matches(f, [pattern]) for f in self.KIWI), pattern

    def test_bernini_patterns_cover_everything_the_loader_reads(self):
        fetched, src = self._fetched(get_spec("bernini-r-1.3b"), self.BERNINI)
        assert fetched == {f for f in self.BERNINI if not f.startswith("assets/") and f != "README.md"}
        for pattern in src.check_files:
            assert any(audio_packs_matches(f, [pattern]) for f in self.BERNINI), pattern

    def test_bernini_config_names_its_own_repo_as_the_wan_base(self):
        # config.json says `"wan22_base": "ByteDance/Bernini-R-1.3B-Diffusers"`; `_prefer_local_dir` swaps it for the
        # snapshot folder because tokenizer/, text_encoder/ and vae/ are there (so no Hub access), hence these three.
        assert {"tokenizer", "text_encoder", "vae"} <= {f.split("/")[0] for f in self.BERNINI}
        assert get_spec("bernini-r-1.3b").hf_repo == "ByteDance/Bernini-R-1.3B-Diffusers"


def audio_packs_matches(rel, patterns):
    from app.engines.base import _matches

    return _matches(rel, patterns)


class TestPlans:
    def _plan(self, model_id, refs):
        from app.job_plans import build_plan
        from test_video import _request

        return build_plan(_request(model_id, {"seeds": [3]}, refs, "make it snow"))

    def test_kiwi_keeps_the_reference_image_next_to_the_video(self):
        from PIL import Image

        from app.config import UPLOADS_DIR, ensure_dirs
        from app.media import encode_mp4

        ensure_dirs()  # the folder only exists once the app has started: don't depend on another test having done it
        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, UPLOADS_DIR / "k_src.mp4")
        Image.new("RGB", (32, 32)).save(UPLOADS_DIR / "k_ref.png")
        plan = self._plan("kiwi-edit-5b", [("video", "k_src.mp4"), ("image", "k_ref.png")])
        req = plan["items"][0]["request"]
        assert plan["params"]["task"] == "v2v" and req["extra"]["video"].endswith("k_src.mp4")
        assert [Path(r).name for r in req["references"]] == ["k_ref.png"]
        assert plan["params"]["fps"] == 15 and (plan["params"]["frames"] - 1) % 4 == 0
        assert plan["params"]["width"] % 32 == 0 and plan["params"]["height"] % 32 == 0

    def test_kiwi_needs_a_source_video(self):
        with pytest.raises(ValueError, match="vidéo source"):
            self._plan("kiwi-edit-5b", [])

    def test_models_that_take_no_reference_still_drop_images_when_editing(self):
        from PIL import Image

        from app.config import UPLOADS_DIR
        from app.media import encode_mp4

        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, UPLOADS_DIR / "c_src.mp4")
        Image.new("RGB", (32, 32)).save(UPLOADS_DIR / "c_ref.png")
        plan = self._plan("cogvideox-2b", [("video", "c_src.mp4"), ("image", "c_ref.png")])
        assert plan["items"][0]["request"]["references"] == []


class TestVideoWorkerProtocol:
    """The real worker script and `AudioWorkerHandle`, with a stub engine instead of a model."""

    STUB = '''
import time
from . import Engine
from common import Cancelled, write_mp4
import numpy as np


class Stub(Engine):
    def load(self):
        if self.options.get("fail"):
            raise RuntimeError("Aucune carte graphique")

    def generate(self, req, output):
        total = int(req["steps"])
        for i in range(total):
            if self.cancelled():
                raise Cancelled()
            time.sleep(self.options.get("delay", 0))
            self.on_step(i + 1, total)
        if req["prompt"] == "boom":
            raise ValueError("kaboom")
        frames = np.full((5, 16, 32, 3), 40, np.uint8)
        return write_mp4(frames, 8, output)
'''

    @pytest.fixture
    def runtime(self, tmp_path, monkeypatch):
        rt = tmp_path / "video_runtime"
        (rt / "engines").mkdir(parents=True)
        for f in ("worker.py", "common.py"):
            shutil.copy(RUNTIME / f, rt / f)
        shutil.copy(RUNTIME / "engines" / "__init__.py", rt / "engines" / "__init__.py")
        (rt / "engines" / "stub.py").write_text(self.STUB)
        monkeypatch.setattr(audio_packs, "runtime_dir", lambda pack_id=None: rt)
        monkeypatch.setattr(audio_packs, "venv_python", lambda pack_id: Path(sys.executable))
        return rt

    def _run(self, options, items, cancel_after_steps=None):
        from app.audio_worker import AudioWorkerHandle

        cancel_at = cancel_after_steps

        async def go():
            nonlocal cancel_at
            handle = AudioWorkerHandle("m", "kiwi", "stub:Stub", options, asyncio.get_running_loop())
            events = []

            async def next_event():
                return await asyncio.wait_for(handle.events.get(), 60)

            try:
                while True:
                    evt = await next_event()
                    events.append(evt)
                    if evt["type"] in ("ready", "load_error", "exit"):
                        break
                if events[-1]["type"] == "ready":
                    handle.send({"type": "generate", "job_id": "j", "items": items})
                    steps = 0
                    while True:
                        evt = await next_event()
                        events.append(evt)
                        steps += evt["type"] == "step"
                        if cancel_at and steps == cancel_at:
                            handle.cancel_event.set()
                            cancel_at = None
                        if evt["type"] in ("done", "cancelled", "error", "exit"):
                            break
            finally:
                await handle.stop()
            return events

        return asyncio.run(go())

    def _item(self, tmp_path, name="a", prompt="hello", steps=3):
        req = {"prompt": prompt, "width": 32, "height": 16, "steps": steps, "seed": 7, "references": [],
               "extra": {"task": "t2v", "frames": 5, "fps": 8, "video": None}}
        return {"request": req, "output": str(tmp_path / f"{name}.mp4")}

    def test_round_trip(self, runtime, tmp_path):
        events = self._run({}, [self._item(tmp_path, "a"), self._item(tmp_path, "b", steps=2)])
        kinds = [e["type"] for e in events]
        assert kinds[:2] == ["loading", "ready"] and kinds[-1] == "done"
        assert kinds.count("item_start") == 2 and kinds.count("step") == 5 and kinds.count("video") == 2
        video = next(e for e in events if e["type"] == "video")
        assert video["index"] == 0 and video["seed"] == 7 and video["frames"] == 5 and video["fps"] == 8
        assert (video["width"], video["height"], video["has_audio"]) == (32, 16, False)
        assert Path(video["path"]).stat().st_size > 0
        step = next(e for e in events if e["type"] == "step")
        assert (step["step"], step["total"]) == (1, 3)

    def test_output_is_readable_by_the_app(self, runtime, tmp_path):
        from app.media import probe_video

        self._run({}, [self._item(tmp_path)])
        info = probe_video(tmp_path / "a.mp4")
        assert (info["width"], info["height"]) == (32, 16)

    def test_cancel_stops_between_steps(self, runtime, tmp_path):
        events = self._run({"delay": 0.2}, [self._item(tmp_path, steps=40)], cancel_after_steps=1)
        assert events[-1]["type"] == "cancelled"
        assert sum(e["type"] == "step" for e in events) < 10 and not any(e["type"] == "video" for e in events)

    def test_generation_error_is_reported(self, runtime, tmp_path):
        events = self._run({}, [self._item(tmp_path, prompt="boom")])
        assert events[-1]["type"] == "error" and events[-1]["error"] == "kaboom"

    def test_load_error_is_reported(self, runtime):
        events = self._run({"fail": True}, [])
        assert events[-1]["type"] == "load_error" and "carte graphique" in events[-1]["error"]


class TestRuntimeHelpers:
    @pytest.fixture
    def common(self):
        return _load("video_runtime_common", RUNTIME / "common.py")

    def test_write_probe_and_resample(self, common, tmp_path):
        frames = np.random.randint(0, 255, (17, 32, 48, 3), dtype=np.uint8)
        info = common.write_mp4(frames, 8, str(tmp_path / "s.mp4"))
        assert (info["width"], info["height"], info["frames"], info["duration"]) == (48, 32, 17, 2.125)
        assert common.probe(str(tmp_path / "s.mp4"))["frames"] == 17
        # 8 fps source read at 4 fps keeps motion speed: every other frame.
        got = common.read_frames_at(str(tmp_path / "s.mp4"), 4, 100, (24, 16))
        assert len(got) == 9 and got[0].size == (24, 16)
        assert len(common.read_frames_at(str(tmp_path / "s.mp4"), 8, 5)) == 5

    def test_unreadable_source(self, common, tmp_path):
        (tmp_path / "bad.mp4").write_bytes(b"nope")
        with pytest.raises(Exception):
            common.read_frames_at(str(tmp_path / "bad.mp4"), 8, 5)
