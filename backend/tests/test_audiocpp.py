# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""audio.cpp integration: build selection, safe extraction, command line, catalog entries (no network, no model)."""

import io
import re
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "audio_runtime"))

from app import audio_packs, audiocpp, catalog, transcription  # noqa: E402
from app import engine_install as ei  # noqa: E402
from app.engines import MODELS, audiocpp_specs  # noqa: E402
from engines import audiocpp_engine as eng  # noqa: E402

# Asset names of release v0.9.1 (the pinned one).
RELEASE_ASSETS = [
    "audio-v0.9.1-bin-macos-arm64-metal.tar.gz", "audio-v0.9.1-bin-macos-x64-metal.tar.gz",
    "audio-v0.9.1-bin-ubuntu-x64-cpu-portable.tar.gz", "audio-v0.9.1-bin-ubuntu-x64-cpu.tar.gz",
    "audio-v0.9.1-bin-ubuntu-x64-cuda12.8-colab.tar.gz", "audio-v0.9.1-bin-ubuntu-x64-vulkan-portable.tar.gz",
    "audio-v0.9.1-bin-ubuntu-x64-vulkan.tar.gz", "audio-v0.9.1-bin-windows-x64-cpu-portable.zip",
    "audio-v0.9.1-bin-windows-x64-cpu.zip", "audio-v0.9.1-bin-windows-x64-cuda12.4.zip",
    "audio-v0.9.1-bin-windows-x64-cuda13.3.zip", "audio-v0.9.1-bin-windows-x64-vulkan-portable.zip",
    "audio-v0.9.1-bin-windows-x64-vulkan.zip", "audio-v0.9.1-cudart-windows-x64-cuda12.4.zip",
    "audio-v0.9.1-cudart-windows-x64-cuda13.3.zip",
]


class TestBuildSelection:
    def test_every_asset_pattern_matches_exactly_one_file(self):
        for key, patterns in audiocpp.ASSETS.items():
            for pat in patterns:
                assert len([a for a in RELEASE_ASSETS if re.search(pat, a)]) == 1, (key, pat)

    @pytest.mark.parametrize("vendors,os_name,arch,expected", [
        (["apple"], "macos", "arm64", ["metal"]),
        (["nvidia"], "windows", "x86_64", ["cuda", "vulkan", "cpu"]),
        (["nvidia"], "linux", "x86_64", ["vulkan", "cpu"]),
        (["amd"], "windows", "x86_64", ["vulkan", "cpu"]),  # no ROCm build upstream
        (["other"], "linux", "x86_64", ["vulkan", "cpu"]),
        ([], "windows", "x86_64", ["vulkan", "cpu"]),
    ])
    def test_candidates_follow_the_gpu_and_end_on_a_fallback(self, vendors, os_name, arch, expected):
        assert audiocpp.candidate_variants(vendors, os_name, arch) == expected

    def test_gpu_devices_parse_the_cli_listing(self, monkeypatch, tmp_path):
        class Out:
            stdout = ('available_devices=3\nMTL:0 "Apple M3 Max" [GPU]\nBLAS:0 "Accelerate" [ACCEL]\n'
                      'CPU:0 "Apple M3 Max" [CPU]\nselect with: --backend <cuda|hip|vulkan|metal|cpu>\n')

        monkeypatch.setattr(audiocpp.subprocess, "run", lambda *a, **k: Out())
        assert audiocpp.gpu_devices(tmp_path / "audiocpp_cli") == [("MTL:0", "Apple M3 Max", "GPU")]


class TestSafeExtraction:
    def _tar(self, name: str, kind=tarfile.REGTYPE) -> tarfile.TarFile:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tf:
            info = tarfile.TarInfo(name)
            info.type = kind
            if kind == tarfile.SYMTYPE:
                info.linkname = "/etc/passwd"
            data = b"x"
            info.size = len(data) if kind == tarfile.REGTYPE else 0
            tf.addfile(info, io.BytesIO(data) if kind == tarfile.REGTYPE else None)
        buf.seek(0)
        return tarfile.open(fileobj=buf)

    def test_regular_file_is_extracted(self, tmp_path):
        ei.safe_extract_tar(self._tar("audiocpp_cli"), tmp_path)
        assert (tmp_path / "audiocpp_cli").read_bytes() == b"x"

    def test_path_escape_is_refused(self, tmp_path):
        with pytest.raises(RuntimeError, match="hors du dossier"):
            ei.safe_extract_tar(self._tar("../evil"), tmp_path)

    def test_symlink_is_refused(self, tmp_path):
        with pytest.raises(RuntimeError, match="non ordinaire"):
            ei.safe_extract_tar(self._tar("link", tarfile.SYMTYPE), tmp_path)


class TestPack:
    def test_native_pack_needs_no_python_environment(self, monkeypatch, tmp_path):
        monkeypatch.setenv("IMAGEGEN_AUDIOCPP_DIR", str(tmp_path))
        pack = audio_packs.PACKS["audiocpp"]
        assert pack.native and not pack.requirements
        assert audio_packs.venv_python("audiocpp") == Path(sys.executable)
        info = audio_packs.engine_info("audiocpp")
        assert not info["available"] and info["installable"]  # offered even without uv

    def test_installed_build_is_found_and_exported_to_the_worker(self, monkeypatch, tmp_path):
        monkeypatch.setenv("IMAGEGEN_AUDIOCPP_DIR", str(tmp_path))
        binary = tmp_path / "metal" / audiocpp.binary_name()
        binary.parent.mkdir()
        binary.write_text("")
        assert audio_packs.is_installed("audiocpp")
        env = audio_packs.pack_env("audiocpp")
        assert env["AUDIOCPP_VARIANT"] == "metal" and env["AUDIOCPP_BIN"] == str(binary)


class TestCatalog:
    def test_models_are_registered_on_the_native_pack(self):
        assert audiocpp_specs.SPECS
        for spec in audiocpp_specs.SPECS:
            assert MODELS[spec.id] is spec
            assert spec.backend == "pack" and spec.options["pack"] == "audiocpp"
            files = list(spec.options.get("files", {}).values()) or [spec.options["file"]]
            assert all(f.endswith(".gguf") and f in spec.sources[0].patterns for f in files)
            assert spec.license in ("Apache-2.0", "MIT", "CC-BY-4.0")
            if spec.audio.task == "tts":
                assert spec.options["mode"] in ("preset", "clone", "design")


class TestCommand:
    BASE = {"family": "qwen3_tts", "model_path": "/m.gguf", "language": "names", "request": ["seed", "temperature"]}

    def cmd(self, mode, voice, ctx=None, **extra):
        return eng.build_command("/bin/cli", "vulkan", {**self.BASE, "mode": mode, **extra}, "Bonjour", voice,
                                 ctx or {}, "/o.wav", 4)

    def test_clone_passes_the_reference_and_its_transcript(self):
        c = self.cmd("clone", {"kind": "clone", "ref_audio": "/r.wav", "ref_text": " salut "},
                     {"language": "fr-FR", "seed": 7, "params": {"temperature": 0.8}})
        assert c[c.index("--voice-ref") + 1] == "/r.wav" and c[c.index("--reference-text") + 1] == "salut"
        assert c[c.index("--language") + 1] == "french"
        assert c[c.index("--backend") + 1] == "vulkan"
        assert "seed=7" in c and "temperature=0.8" in c

    def test_clone_without_reference_is_an_error(self):
        with pytest.raises(ValueError, match="voix de référence"):
            self.cmd("clone", {"kind": "preset"})

    def test_design_needs_a_description(self):
        with pytest.raises(ValueError, match="Décrivez"):
            self.cmd("design", {})
        c = self.cmd("design", {"description": "voix grave"})
        assert c[c.index("--instruct") + 1] == "voix grave"

    def test_preset_voice_and_style(self):
        c = self.cmd("preset", {"kind": "preset", "id": "Ryan"}, {"instruct": "chuchoté"})
        assert c[c.index("--voice-id") + 1] == "Ryan" and c[c.index("--instruct") + 1] == "chuchoté"

    def test_unsupported_request_options_are_never_sent(self):
        c = self.cmd("preset", {"id": "x"}, {"seed": 1, "speed": 1.3}, request=["seed"])
        assert "seed=1" in c and not any(a.startswith("speed=") for a in c)


class TestChatterbox:
    spec = MODELS["chatterbox-gguf"]

    def test_language_is_chosen_at_generation(self):
        codes = [l.code for l in self.spec.audio.languages]
        assert "fr" in codes and "en" in codes and len(codes) == len(set(codes))
        assert self.spec.audio.clone == "required"

    def test_command_uses_the_cloning_task_and_the_sliders(self):
        o = {**self.spec.options, "model_path": "/m.gguf"}
        voice = {"kind": "clone", "ref_audio": "/r.wav"}
        ctx = {"language": "de", "seed": 5, "params": {"exaggeration": 0.7, "guidance_scale": 0.0, "temperature": 0.9}}
        c = eng.build_command("/bin/cli", "vulkan", o, "Hallo", voice, ctx, "/o.wav", 4)
        assert c[c.index("--task") + 1] == "clon" and c[c.index("--family") + 1] == "chatterbox"
        assert c[c.index("--language") + 1] == "de"  # a code, not a name
        assert {"exaggeration=0.7", "guidance_scale=0.0", "temperature=0.9", "seed=5"} <= set(c)

    def test_every_slider_is_a_declared_request_option(self):
        assert {p.key for p in self.spec.params} <= set(self.spec.options["request"])

    def test_reference_voice_is_mandatory(self):
        o = {**self.spec.options, "model_path": "/m.gguf"}
        with pytest.raises(ValueError, match="voix de référence"):
            eng.build_command("/bin/cli", "vulkan", o, "Salut", {"kind": "preset"}, {}, "/o.wav", 4)


def _machine(os_name, *accelerators, unusable=()):
    return {"os": os_name, "arch": "x86_64", "ram_gb": 32, "accelerators": list(accelerators), "unusable_gpus": list(unusable),
            "engines": {}, "disk": {"free_gb": 100}}


NVIDIA = {"vendor": "nvidia", "backend": "cuda", "name": "RTX", "memory_gb": 12}
APPLE = {"vendor": "apple", "backend": "metal", "name": "M3", "memory_gb": 36, "unified": True}
AMD_VULKAN = {"vendor": "amd", "backend": "vulkan", "name": "RX 6800", "memory_gb": None}
INTEL_VULKAN = {"vendor": "other", "backend": "vulkan", "name": "Intel Arc", "memory_gb": None}


class TestDegradedMarker:
    @pytest.mark.parametrize("system,expected", [
        (_machine("Windows", NVIDIA), False),
        (_machine("Linux", NVIDIA), False),
        (_machine("Darwin", APPLE), False),
        (_machine("Linux", {**AMD_VULKAN, "backend": "rocm"}), False),
        (_machine("Windows", AMD_VULKAN), True),        # ROCm on Windows is a preview, not used by the packs
        (_machine("Windows", INTEL_VULKAN), True),      # Intel XPU not wired in the engines
        (_machine("Windows"), True),                    # no GPU at all
        (_machine("Windows", AMD_VULKAN, unusable=[{"vendor": "nvidia"}]), False),  # NVIDIA the OS sees: the pack brings CUDA
    ])
    def test_pytorch_models_are_degraded_without_a_gpu_they_can_drive(self, system, expected):
        plan = catalog._pack_plan(MODELS["qwen3-tts-clone-small"], system)
        assert plan.get("degraded", False) is expected and plan["fits"]

    def test_the_gguf_twin_is_named(self):
        plan = catalog._pack_plan(MODELS["qwen3-tts-clone"], _machine("Windows", AMD_VULKAN))
        assert plan["alternative"] == {"id": "qwen3-tts-gguf-clone", "name": MODELS["qwen3-tts-gguf-clone"].name}
        assert "Alternative" in plan["note"] and MODELS["qwen3-tts-gguf-clone"].name in plan["note"]

    def test_every_declared_twin_exists_and_is_native(self):
        for spec in MODELS.values():
            if twin := spec.options.get("twin"):
                assert MODELS[twin].options["pack"] == "audiocpp"

    @pytest.mark.parametrize("model_id", ["pocket-tts", "kokoro-82m", "qwen3-tts-gguf-clone", "chatterbox-gguf", "pocket-tts-gguf"])
    def test_cpu_models_and_native_engines_are_never_degraded(self, model_id):
        plan = catalog._pack_plan(MODELS[model_id], _machine("Windows", INTEL_VULKAN))
        assert "degraded" not in plan


class TestPocketGguf:
    spec = MODELS["pocket-tts-gguf"]

    def test_one_model_per_language_with_the_voices_downloaded_alongside(self):
        files = self.spec.options["files"]
        assert set(files) == {"fr", "en"} == {l.code for l in self.spec.audio.languages}
        patterns = self.spec.sources[0].patterns
        assert all(f in patterns for f in files.values())
        assert any(p.endswith("french/embeddings/estelle.safetensors") for p in patterns)

    def test_voice_is_passed_as_a_path_inside_the_snapshot(self):
        o = {**self.spec.options, "model_path": "/cache/snap/PocketTTS-GGUF/french/pocket-tts-french-q8_0.gguf"}
        c = eng.build_command("/bin/cli", "cpu", o, "Salut", {"kind": "preset", "id": "estelle"}, {"language": "fr"}, "/o.wav", 2)
        assert "--voice-id" not in c
        assert "voice_embedding_path=/cache/snap/PocketTTS-GGUF/french/embeddings/estelle.safetensors" in c

    def test_cloning_uses_the_reference_sample(self):
        o = {**self.spec.options, "model_path": "/m.gguf"}
        c = eng.build_command("/bin/cli", "cpu", o, "Salut", {"kind": "clone", "ref_audio": "/r.wav"}, {}, "/o.wav", 2)
        assert c[c.index("--voice-ref") + 1] == "/r.wav"

    def test_model_follows_the_generation_language(self):
        e = eng.AudioCppEngine({})
        e.model_paths = {"fr": "/fr.gguf", "en": "/en.gguf"}
        assert e.model_for({"language": "en-GB"}) == "/en.gguf" and e.model_for({"language": "fr"}) == "/fr.gguf"
        assert e.model_for({}) == "/fr.gguf"  # default: the first one


class TestTranscription:
    def test_command_passes_the_language_hint_as_a_request_option(self):
        c = audiocpp.transcribe_command("/bin/cli", "vulkan", "qwen3_asr", "/m.gguf", "/a.wav", "/o.txt", "fr-FR", 4, True)
        assert c[c.index("--task") + 1] == "asr" and c[c.index("--text-out") + 1] == "/o.txt"
        assert "language=fr" in c and "--language" not in c  # the ASR CLI has no --language flag

    @pytest.mark.parametrize("language,option", [(None, True), ("auto", True), ("fr", False)])
    def test_no_hint_when_automatic_or_unsupported(self, language, option):
        c = audiocpp.transcribe_command("/bin/cli", "cpu", "qwen3_asr", "/m.gguf", "/a.wav", "/o.txt", language, 2, option)
        assert not any(a.startswith("language=") for a in c)

    def test_run_returns_the_text_and_never_hands_the_cli_a_non_wav(self, monkeypatch, tmp_path):
        import numpy as np
        import soundfile as sf

        src = tmp_path / "voice.flac"
        sf.write(str(src), np.zeros((16000, 2), dtype="float32"), 16000)  # stereo FLAC, 1 s
        monkeypatch.setattr(audiocpp, "installed_binary", lambda: ("cpu", tmp_path / "audiocpp_cli"))
        seen = {}

        def fake_run(cmd, **kw):
            seen["audio"] = cmd[cmd.index("--audio") + 1]
            info = sf.info(seen["audio"])
            seen["format"] = (info.format, info.channels)
            Path(cmd[cmd.index("--text-out") + 1]).write_text(" Bonjour tout le monde. \n", encoding="utf-8")
            return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

        monkeypatch.setattr(audiocpp.subprocess, "run", fake_run)
        r = audiocpp.run_transcribe("qwen3_asr", "/m.gguf", str(src), "fr")
        assert r == {"text": "Bonjour tout le monde.", "language": "fr", "duration": 1.0}
        assert seen["format"] == ("WAV", 1)

    def test_a_failed_run_explains_itself(self, monkeypatch, tmp_path):
        import numpy as np
        import soundfile as sf

        src = tmp_path / "v.wav"
        sf.write(str(src), np.zeros(1600, dtype="float32"), 16000)
        monkeypatch.setattr(audiocpp, "installed_binary", lambda: ("cpu", tmp_path / "audiocpp_cli"))
        monkeypatch.setattr(audiocpp.subprocess, "run", lambda *a, **k: type(
            "R", (), {"returncode": 1, "stdout": "ggml_metal_init: x\naudiocpp_cli failed: bad model", "stderr": ""})())
        with pytest.raises(RuntimeError, match="bad model"):
            audiocpp.run_transcribe("qwen3_asr", "/m.gguf", str(src), None)

    def test_models_are_registered_as_transcription(self):
        for model_id in ("qwen3-asr-gguf-small", "qwen3-asr-gguf"):
            spec = MODELS[model_id]
            assert spec.audio.task == "stt" and spec.options["pack"] == "audiocpp" and spec.license == "Apache-2.0"

    def test_order_prefers_whisper_then_the_light_native_model(self):
        ids = [m.id for m in transcription.ordered(MODELS)]
        assert ids[:2] == ["whisper-small", "whisper-large-v3-turbo"]
        assert ids.index("qwen3-asr-gguf-small") < ids.index("qwen3-asr-gguf")
        assert [m.id for m in transcription.ordered(MODELS, "qwen3-asr-gguf")] == ["qwen3-asr-gguf"]

    def test_choice_needs_the_weights_and_the_engine(self):
        cands = transcription.ordered(MODELS)
        whisper, native = "whisper-small", "qwen3-asr-gguf-small"
        # Whisper downloaded but its pack missing: fall through to the native model instead of failing
        spec, _ = transcription.choose(cands, lambda m: m.id in (whisper, native), lambda m: m.id == native)
        assert spec.id == native
        spec, _ = transcription.choose(cands, lambda m: m.id in (whisper, native), lambda m: True)
        assert spec.id == whisper
        spec, why = transcription.choose(cands, lambda m: False, lambda m: True)
        assert spec is None and "téléchargé" in why
        spec, why = transcription.choose(cands, lambda m: m.id == whisper, lambda m: False)
        assert spec is None and "moteur" in why


class TestTranscribeRoute:
    """The HTTP handler itself, called directly: no server, no model."""

    def _call(self, monkeypatch, *, downloaded, packs, body=None, fails=False):
        import asyncio

        from fastapi import HTTPException

        from app import voices
        from app.api import routes
        from app.downloads import downloads

        monkeypatch.setattr(voices, "get_voice", lambda _id: {"url": "/media/uploads/v.wav", "language": "fr"})
        monkeypatch.setattr(voices, "voice_path", lambda name: Path("/tmp") / name)
        monkeypatch.setattr(downloads, "status", lambda spec: {"state": "installed" if spec.id in downloaded else "missing"})
        monkeypatch.setattr(audio_packs, "is_installed", lambda pack: pack in packs)

        def fake(spec, audio, language):
            if fails:
                raise RuntimeError("boom")
            return {"text": "Bonjour.", "language": language, "duration": 1.0, "model": spec.id}

        monkeypatch.setattr(transcription, "transcribe", fake)
        try:
            return asyncio.run(routes.transcribe_voice("v1", body or routes.TranscribeBody()))
        except HTTPException as exc:
            return exc

    def test_falls_back_to_the_native_model_when_the_whisper_pack_is_missing(self, monkeypatch):
        r = self._call(monkeypatch, downloaded={"whisper-small", "qwen3-asr-gguf-small"}, packs={"audiocpp"})
        assert r["model"] == "qwen3-asr-gguf-small" and r["language"] == "fr"

    def test_whisper_is_still_the_default(self, monkeypatch):
        r = self._call(monkeypatch, downloaded={"whisper-small", "qwen3-asr-gguf-small"}, packs={"speech", "audiocpp"})
        assert r["model"] == "whisper-small"

    def test_nothing_downloaded_is_a_clear_409(self, monkeypatch):
        r = self._call(monkeypatch, downloaded=set(), packs={"speech"})
        assert r.status_code == 409 and "Qwen3-ASR" in r.detail

    def test_engine_errors_become_a_500_with_the_reason(self, monkeypatch):
        r = self._call(monkeypatch, downloaded={"qwen3-asr-gguf-small"}, packs={"audiocpp"}, fails=True)
        assert r.status_code == 500 and r.detail == "boom"
