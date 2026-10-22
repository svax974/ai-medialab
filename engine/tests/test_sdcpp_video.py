# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Video on stable-diffusion.cpp: specs, command line, progress phases and the whole engine against a fake `sd-cli`.

No model is run: the stub below prints the log lines of the real program (checked against its source at master-956) and
writes a few tiny frames, or a tiny .webm with sound.
"""

import json
import os
import stat
import sys
import textwrap

import numpy as np
import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import sdcpp  # noqa: E402
from app.engines import MODELS, custom, get_spec, video_gguf  # noqa: E402
from app.engines.base import GenerationCancelled, GenerationRequest, Hooks, with_variant  # noqa: E402
from app.engines.sdcpp_video_engine import (ProgressTracker, SdcppVideoEngine, build_command, offload_enabled,  # noqa: E402
                                            split_steps)
from app import taehv  # noqa: E402
from app.media import probe_video, read_video_with_audio  # noqa: E402
from app.system import memory_plan  # noqa: E402

STUB = textwrap.dedent('''\
    #!{python}
    import sys, time
    import numpy as np
    from PIL import Image
    a = sys.argv[1:]
    import os, json
    if os.environ.get("STUB_ARGV"): open(os.environ["STUB_ARGV"], "w").write(json.dumps(a))
    if os.environ.get("STUB_ARGV") and "--prompt-file" in a:
        open(os.environ["STUB_ARGV"] + ".prompt", "w").write(open(a[a.index("--prompt-file") + 1], encoding="utf-8").read())
    def opt(name, default=None):
        return a[a.index(name) + 1] if name in a else default
    out, frames = opt("-o"), int(opt("--video-frames", "1"))
    w, h = int(opt("-W")), int(opt("-H"))
    steps, high = int(opt("--steps")), int(opt("--high-noise-steps", "0"))
    mode = opt("--stub-mode", "ok")
    def log(s):
        sys.stderr.write(s); sys.stderr.flush()
    def bar(k, n):
        log("\\r |" + "=" * k + ">" + " " * (n - k) + f"| {{k}}/{{n}} - 0.01s/it")
    log("[INFO ] get_learned_condition completed, taking 0.10s\\n")
    if "-i" in a:
        for k in range(1, 4): bar(k, 3)   # VAE tile bars while encoding the start image
        log("\\n[INFO ] encode_first_stage completed, taking 100 ms\\n")
    if mode == "oom":
        log("[ERROR] ggml_metal: failed to allocate buffer, cannot make enough memory available\\n"); sys.exit(1)
    log(f"[INFO ] generate_video {{w}}x{{h}}x{{frames}}\\n")
    if high:
        for k in range(1, high + 1): bar(k, high); time.sleep(0.01)
        log("\\n[INFO ] sampling(high noise) completed, taking 0.1s\\n")
    for k in range(1, steps + 1): bar(k, steps); time.sleep(0.01)
    log("\\n[INFO ] sampling completed, taking 0.1s\\n[INFO ] generating latent video completed, taking 0.2s\\n")
    for k in range(1, 5): bar(k, 4)       # VAE tile bars while decoding
    log("\\n[INFO ] decode_first_stage completed, taking 0.3s\\n[INFO ] generate_video completed in 1.0s\\n")
    if mode == "slow":
        time.sleep(30)
    real = frames - 1 if mode == "short" else frames
    if out.endswith(".webm"):
        import av
        c = av.open(out, "w", format="matroska")
        v = c.add_stream("libvpx", rate=int(opt("--fps", "8"))); v.width, v.height, v.pix_fmt = w, h, "yuv420p"
        s = c.add_stream("pcm_s16le", rate=24000); s.layout = "stereo"
        for i in range(real):
            for p in v.encode(av.VideoFrame.from_ndarray(np.full((h, w, 3), i * 10, np.uint8), format="rgb24")): c.mux(p)
        for p in v.encode(): c.mux(p)
        pcm = (np.random.uniform(-0.3, 0.3, (24000, 2)) * 32767).astype(np.int16).reshape(1, -1)
        af = av.AudioFrame.from_ndarray(np.ascontiguousarray(pcm), format="s16", layout="stereo"); af.sample_rate = 24000
        for p in s.encode(af): c.mux(p)
        for p in s.encode(): c.mux(p)
        c.close()
    else:
        for i in range(real):
            Image.fromarray(np.full((h, w, 3), i * 10 % 256, np.uint8)).save(out % i)
    log(f"[INFO ] save result video to '{{out}}'\\n")
''')


@pytest.fixture
def machine(tmp_path, monkeypatch):
    """A fake GGUF engine folder (stub binary + VERSION.json) and cached model files, as the engine sees them."""
    folder = tmp_path / "metal"
    folder.mkdir()
    binary = folder / "sd-cli"
    binary.write_text(STUB.format(python=sys.executable))
    binary.chmod(binary.stat().st_mode | stat.S_IEXEC)
    (folder / "VERSION.json").write_text(json.dumps({"tag": "master-956-1b0ba10"}))
    system = {"ram_gb": 64.0, "accelerators": [{"memory_gb": 64.0, "unified": True, "backend": "metal"}],
              "engines": {"sdcpp": {"available": True, "binary": str(binary), "variant": "metal"}}}
    monkeypatch.setattr("app.system.get_system", lambda refresh=False: system)
    monkeypatch.setattr(sys.modules[__name__], "SYSTEM", system, raising=False)
    monkeypatch.setattr("huggingface_hub.hf_hub_download", lambda repo, filename, **kw: f"/cache/{repo}/{filename}")
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    monkeypatch.setattr("app.config.ENGINES_DIR", tmp_path / "engines")
    monkeypatch.setattr("app.video_memory.store_path", lambda: tmp_path / "video-memory.json")
    monkeypatch.setenv("STUB_ARGV", str(tmp_path / "argv.json"))
    return binary


def request(**extra):
    return GenerationRequest(prompt="un chat", width=64, height=48, steps=3, seed=7, guidance=6.0,
                             extra={"task": "t2v", "frames": 9, "fps": 8, **extra})


class Recorder(Hooks):
    def __init__(self, cancel_after=None):
        self.events, self.cancel_after = [], cancel_after
        super().__init__(on_step=lambda s, t: self.events.append(("step", s, t)), on_preview=lambda im: None,
                         is_cancelled=lambda: self.cancel_after is not None and len(self.events) >= self.cancel_after,
                         on_phase=lambda p: self.events.append(("phase", p)))


def engine(model_id, quant=None):
    eng = SdcppVideoEngine(with_variant(MODELS[model_id], quant), None)
    eng.load()
    return eng


class TestSpecs:
    def test_every_spec_is_a_complete_sdcpp_video_model(self):
        assert len(video_gguf.SPECS) == 7
        for spec in video_gguf.SPECS:
            v = spec.video
            assert spec.kind == "video" and spec.backend == "sdcpp" and spec.engine.endswith("SdcppVideoEngine")
            assert spec.size_multiple == 32 and v.frame_step in (4, 8) and v.default_resolution in {r.id for r in v.resolutions}
            assert spec.description.endswith(".") and spec.memory_hint and spec.license
            assert "diffusion-model" in spec.options["files"] and spec.options["overhead_gb"] > 0
            assert spec.default_variant in {x.key for x in spec.variants}

    def test_files_are_downloaded_and_sizes_add_up(self):
        for spec in video_gguf.SPECS:
            for variant in spec.variants:
                resolved = with_variant(spec, variant.key)
                wanted = {pair for pair in resolved.options["files"].values()}
                patterns = {(s.repo, p) for s in resolved.sources for p in s.patterns}
                assert wanted == patterns, (spec.id, variant.key)
                assert sum(s.size_gb for s in resolved.sources) == pytest.approx(variant.size_gb, abs=0.02)
                assert resolved.weights_gb == variant.size_gb and resolved.precision == variant.key

    def test_wan_vae_matches_the_model_generation(self):
        files = lambda mid: MODELS[mid].options["files"]  # noqa: E731
        assert "Wan2.2_VAE" in files("wan-2.2-ti2v-5b-gguf")["vae"][1]
        for mid in ("wan-2.2-t2v-a14b-gguf", "wan-2.2-i2v-a14b-gguf"):
            assert "Wan2.1_VAE" in files(mid)["vae"][1]
            assert "LowNoise" in files(mid)["diffusion-model"][1] and "HighNoise" in files(mid)["high-noise-diffusion-model"][1]

    def test_ltx_files_and_gating(self):
        l23, l25 = MODELS["ltx-2.3-distilled-gguf"], MODELS["ltx-2.5-distilled-gguf"]
        assert "distilled-1.1/" in l23.options["files"]["diffusion-model"][1] and not l23.gated
        assert "embeddings-connectors" in l23.options["files"]
        assert "embeddings-connectors" not in l25.options["files"]  # bundled in the Gemma 4 file
        assert "conv" in l25.options["files"]["vae"][1] and l25.gated
        assert [s.id for s in video_gguf.SPECS if s.gated] == ["ltx-2.5-distilled-gguf"]
        assert l23.video.audio_out and l25.video.audio_out and "LTX-2" in l25.license

    def test_hunyuan_keeps_the_licence_warning(self):
        from app.catalog import VIDEO_STARTER_ORDER

        for mid in ("hunyuan-video-1.5-t2v-gguf", "hunyuan-video-1.5-i2v-gguf"):
            assert "Union européenne" in MODELS[mid].video.license_warning and mid not in VIDEO_STARTER_ORDER
        assert VIDEO_STARTER_ORDER[0] == "wan-2.2-ti2v-5b-gguf"
        assert "ltx-2.5-distilled-gguf" not in VIDEO_STARTER_ORDER

    def test_memory_plan_on_a_36_gb_mac(self):
        mac = {"ram_gb": 36.0, "accelerators": [{"memory_gb": 36.0, "unified": True, "backend": "metal"}]}
        fits = lambda mid, quant=None: memory_plan(  # noqa: E731
            (s := with_variant(MODELS[mid], quant)).weights_gb, s.largest_component_gb, mac, "sdcpp",
            s.options["overhead_gb"])["fits"]
        assert fits("wan-2.2-ti2v-5b-gguf") and fits("wan-2.2-ti2v-5b-gguf", "Q8_0")
        assert fits("hunyuan-video-1.5-t2v-gguf") and fits("ltx-2.3-distilled-gguf", "Q3_K_M")
        assert not fits("wan-2.2-t2v-a14b-gguf") and not fits("ltx-2.3-distilled-gguf")
        assert not fits("ltx-2.5-distilled-gguf")

    def test_overhead_counts_for_the_gguf_engine_only(self):
        mac = {"ram_gb": 20.0, "accelerators": [{"memory_gb": 20.0, "unified": True}]}
        assert memory_plan(14, 4, mac, "sdcpp")["fits"] and not memory_plan(14, 4, mac, "sdcpp", 5)["fits"]


class TestCommand:
    def command(self, model_id, req, refs=(), quant=None, variant="metal", offload=True):
        spec = with_variant(MODELS[model_id], quant)
        paths = {role: f"/m/{f}" for role, (_, f) in spec.options["files"].items()}
        return build_command("/b/sd-cli", variant, spec, paths, req, "/o/%05d.png", list(refs), offload)

    def test_wan_5b_text_to_video(self):
        cmd = self.command("wan-2.2-ti2v-5b-gguf", request())
        assert cmd[:3] == ["/b/sd-cli", "-M", "vid_gen"]
        assert cmd[cmd.index("--diffusion-model") + 1].endswith("Wan2.2-TI2V-5B-Q4_K_M.gguf")
        assert cmd[cmd.index("--vae") + 1].endswith("Wan2.2_VAE.safetensors") and "--t5xxl" in cmd
        assert cmd[cmd.index("--video-frames") + 1] == "9" and cmd[cmd.index("--fps") + 1] == "8"
        assert cmd[cmd.index("--flow-shift") + 1] == "3.0" and "--vae-tiling" in cmd and "--offload-to-cpu" in cmd
        assert "--diffusion-fa" in cmd and "-i" not in cmd and "--high-noise-diffusion-model" not in cmd
        assert cmd[cmd.index("--cfg-scale") + 1] == "6.0" and "-n" in cmd  # the guides' negative prompt
        assert "--preview" not in cmd

    def test_negative_prompt_of_the_user_wins_and_flash_attention_is_per_build(self):
        cmd = self.command("wan-2.2-ti2v-5b-gguf", GenerationRequest(prompt="p", width=64, height=48, steps=3, seed=1,
                           negative_prompt=" flou ", extra={"frames": 5}), variant="vulkan", offload=False)
        assert cmd[cmd.index("-n") + 1] == "flou" and "--diffusion-fa" not in cmd and "--offload-to-cpu" not in cmd

    def test_image_to_video_and_end_image(self):
        assert self.command("wan-2.2-ti2v-5b-gguf", request(), ["/s.png"])[-1:] != ["--end-img"]
        cmd = self.command("wan-2.2-i2v-a14b-gguf", request(), ["/s.png", "/e.png"])
        assert cmd[cmd.index("-i") + 1] == "/s.png" and cmd[cmd.index("--end-img") + 1] == "/e.png"

    def test_a14b_splits_the_steps_between_the_experts(self):
        opts = MODELS["wan-2.2-t2v-a14b-gguf"].options
        assert split_steps(opts, 18) == (10, 8) and split_steps(opts, 8)[1] >= 1 and sum(split_steps(opts, 30)) == 30
        cmd = self.command("wan-2.2-t2v-a14b-gguf", GenerationRequest(prompt="p", width=64, height=48, steps=18, seed=1,
                           guidance=3.5, extra={"frames": 5}))
        assert cmd[cmd.index("--steps") + 1] == "10" and cmd[cmd.index("--high-noise-steps") + 1] == "8"
        assert cmd[cmd.index("--high-noise-cfg-scale") + 1] == "3.5"
        assert cmd[cmd.index("--high-noise-diffusion-model") + 1].endswith("HighNoise-Q4_K_S.gguf")
        assert cmd[cmd.index("--diffusion-model") + 1].endswith("LowNoise-Q4_K_S.gguf")
        assert cmd[cmd.index("--vae") + 1].endswith("Wan2.1_VAE.safetensors")

    def test_distilled_ltx_runs_its_fixed_schedule(self):
        req = GenerationRequest(prompt="p", width=64, height=48, steps=8, seed=1, guidance=None, extra={"frames": 9})
        cmd = self.command("ltx-2.3-distilled-gguf", req)
        assert cmd[cmd.index("--sigmas") + 1].count(",") == 8 and cmd[cmd.index("--steps") + 1] == "8"
        assert "--cfg-scale" not in cmd and "-n" not in cmd
        for flag in ("--audio-vae", "--llm", "--embeddings-connectors"):
            assert flag in cmd
        assert "--embeddings-connectors" not in self.command("ltx-2.5-distilled-gguf", req)

    def test_offload_follows_the_spec_unless_overridden(self):
        o = {"offload_to_cpu": True}
        assert offload_enabled(o, {}) and not offload_enabled(o, {"IMAGEGEN_SDCPP_OFFLOAD": "off"})
        assert offload_enabled({}, {"IMAGEGEN_SDCPP_OFFLOAD": "on"}) and not offload_enabled({}, {})


class TestFastDecode:
    def command(self, tae):
        spec = MODELS["wan-2.2-ti2v-5b-gguf"]
        paths = {role: f"/m/{f}" for role, (_, f) in spec.options["files"].items()}
        return build_command("/b/sd-cli", "metal", spec, paths, request(), "/o/%05d.png", [], True, tae)

    def test_tae_replaces_the_vae_and_never_both(self):
        cmd = self.command("/t/taew2_2.safetensors")
        assert cmd[cmd.index("--tae") + 1] == "/t/taew2_2.safetensors" and "--vae" not in cmd
        assert "--vae" in self.command(None) and "--tae" not in self.command(None)

    def test_specs_pick_the_decoder_of_their_vae(self):
        assert MODELS["wan-2.2-ti2v-5b-gguf"].options["tae"] == "taew2_2"
        for mid in ("wan-2.2-t2v-a14b-gguf", "wan-2.2-i2v-a14b-gguf"):
            assert MODELS[mid].options["tae"] == "taew2_1"
        for mid in ("wan-2.2-ti2v-5b-gguf", "wan-2.2-t2v-a14b-gguf", "wan-2.2-i2v-a14b-gguf"):
            assert any(p.key == "fast_decode" and p.type == "bool" for p in MODELS[mid].params)
        assert not any(p.key == "fast_decode" for p in MODELS["ltx-2.3-distilled-gguf"].params)

    def test_wan_never_offers_a_size_the_model_cannot_draw(self):
        for mid in ("wan-2.2-ti2v-5b-gguf", "wan-2.2-t2v-a14b-gguf", "wan-2.2-i2v-a14b-gguf"):
            assert all(r.short_side >= 480 for r in MODELS[mid].video.resolutions)
            assert MODELS[mid].video.default_resolution == "480p"

    def run(self, machine, tmp_path, fetch, on=True):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        hooks = Recorder()
        orig = taehv.ensure_tae
        taehv.ensure_tae = lambda name, fetch_=None: orig(name, fetch)
        try:
            eng.save(eng.generate(request(fast_decode=on), hooks), tmp_path / "c.mp4")
        finally:
            taehv.ensure_tae = orig
        return json.loads((tmp_path / "argv.json").read_text()), [e[1] for e in hooks.events if e[0] == "phase"]

    @staticmethod
    def good(url, dest):
        assert url.endswith("/011dfc2112197741c540e0bdd5b7b67bcc930771/safetensors/taew2_2.safetensors")
        dest.write_bytes(b"x")

    def test_download_then_cached(self, machine, tmp_path, monkeypatch):
        data = b"tiny decoder"
        import hashlib

        monkeypatch.setitem(taehv.FILES, "taew2_2", (len(data), hashlib.sha256(data).hexdigest()))
        calls = []
        fetch = lambda url, dest: (calls.append(url), dest.write_bytes(data))  # noqa: E731
        argv, phases = self.run(machine, tmp_path, fetch)
        assert argv[argv.index("--tae") + 1] == str(tmp_path / "engines" / "taehv" / "taew2_2.safetensors") and "--vae" not in argv
        assert phases == ["fetch", "prepare", "sampling", "decode", "encode"] and len(calls) == 1
        assert [p.name for p in (tmp_path / "engines" / "taehv").iterdir()] == ["taew2_2.safetensors"]  # no .part left
        argv, phases = self.run(machine, tmp_path, fetch)  # second run: no download
        assert len(calls) == 1 and "fetch" not in phases and "--tae" in argv

    def test_off_uses_the_full_vae(self, machine, tmp_path):
        argv, phases = self.run(machine, tmp_path, self.good, on=False)
        assert "--vae" in argv and "--tae" not in argv and "fetch" not in phases

    def test_failed_download_falls_back_to_the_full_vae(self, machine, tmp_path):
        def offline(url, dest):
            dest.write_bytes(b"partial")
            raise OSError("no network")

        argv, _ = self.run(machine, tmp_path, offline)
        assert "--vae" in argv and "--tae" not in argv
        assert not list((tmp_path / "engines" / "taehv").iterdir())

    def test_wrong_checksum_is_rejected(self, machine, tmp_path):
        with pytest.raises(taehv.TaeUnavailable, match="corrompu"):
            taehv.ensure_tae("taew2_2", self.good)
        assert not list((tmp_path / "engines" / "taehv").iterdir())
        argv, _ = self.run(machine, tmp_path, self.good)  # the engine falls back instead of failing
        assert "--vae" in argv and "--tae" not in argv

    def test_default_follows_the_platform(self):
        assert video_gguf.FAST_DECODE.default is video_gguf.FAST_DECODE_DEFAULT


class TestProgress:
    def feed(self, tracker, lines):
        return [e for line in lines for e in tracker.feed(line)]

    def test_vae_bars_are_not_sampling_steps(self):
        t = ProgressTracker([3])
        events = self.feed(t, ["get_learned_condition completed, taking 1s", "|===>| 1/4 - 0.5s/it", "|===>| 4/4 - 0.5s/it",
                               "encode_first_stage completed, taking 100 ms", "generate_video 832x480x33",
                               "|=>  | 1/3 - 2.0s/it", "|==> | 2/3 - 2.0s/it", "|===>| 3/3 - 2.0s/it", "sampling completed, taking 6s",
                               "|=>  | 1/9 - 9.0s/it", "|===>| 9/9 - 9.0s/it", "decode_first_stage completed, taking 80s",
                               "generate_video completed in 100s"])
        assert events == [("phase", "sampling"), ("step", 1, 3), ("step", 2, 3), ("step", 3, 3), ("step", 3, 3),
                          ("phase", "decode"), ("phase", "encode")]

    def test_two_experts_accumulate_into_one_counter(self):
        t = ProgressTracker([8, 10])
        events = self.feed(t, ["generate_video 832x480x33", "|=>| 1/8 - 1s/it", "|=>| 8/8 - 1s/it",
                               "sampling(high noise) completed, taking 8s", "|=>| 1/10 - 1s/it", "|=>| 10/10 - 1s/it",
                               "sampling completed, taking 10s"])
        steps = [e for e in events if e[0] == "step"]
        assert steps[0] == ("step", 1, 18) and ("step", 8, 18) in steps and ("step", 9, 18) in steps
        assert steps[-2:] == [("step", 18, 18), ("step", 18, 18)] and events[-1] == ("phase", "decode")

    def test_tae_decode_bars_are_ignored_too(self):
        t = ProgressTracker([2])
        events = self.feed(t, ["generate_video 832x480x9", "|=>| 1/2 - 1s/it", "|=>| 2/2 - 1s/it", "sampling completed, taking 2s",
                               "|=>| 1/3 - 0.1s/it", "|=>| 3/3 - 0.1s/it", "decode_first_stage completed, taking 0.7s"])
        assert events == [("phase", "sampling"), ("step", 1, 2), ("step", 2, 2), ("step", 2, 2), ("phase", "decode")]

    def test_repeated_bar_is_reported_once(self):
        t = ProgressTracker([4])
        t.feed("generate_video 64x64x9")
        assert len(self.feed(t, ["|=>| 2/4 - 1s/it", "|=>| 2/4 - 1s/it"])) == 1


class TestChainedModels:
    def test_every_chained_model_is_image_capable_and_silent(self):
        for spec in video_gguf.SPECS:
            v = spec.video
            if v.segment_seconds:
                assert "i2v" in v.tasks and v.image_role == "start" and not v.audio_out
                assert v.segment_seconds <= v.max_seconds


class TestEngine:
    def test_wan_frames_become_an_mp4(self, machine, tmp_path):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        hooks = Recorder()
        result = eng.generate(request(), hooks)
        assert result.path is None and len(list((result.folder / "frames").glob("*.png"))) == 9
        info = eng.save(result, tmp_path / "clip.mp4")
        assert not result.folder.exists()  # temporary frames are gone
        assert (info["width"], info["height"], info["frames"], info["fps"], info["has_audio"]) == (64, 48, 9, 8, False)
        probe = probe_video(tmp_path / "clip.mp4")
        assert (probe["width"], probe["height"]) == (64, 48) and abs(probe["duration"] - 9 / 8) < 0.2
        phases = [e[1] for e in hooks.events if e[0] == "phase"]
        assert phases == ["prepare", "sampling", "decode", "encode"]
        assert [e for e in hooks.events if e[0] == "step"][-2:] == [("step", 3, 3), ("step", 3, 3)]

    def test_a_long_clip_is_chained_runs_from_the_last_frame(self, machine, tmp_path):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 24.0  # plenty free: only the growth limit shapes the runs
        hooks = Recorder()
        result = eng.generate(request(frames=49), hooks)
        assert len(list((result.folder / "frames").glob("*.png"))) == 49 and result.path is None
        argv = json.loads((tmp_path / "argv.json").read_text())
        assert "-i" in argv  # every run after the first starts from an image
        steps = [e for e in hooks.events if e[0] == "step"]
        assert steps[-1][1] == steps[-1][2]  # one progress bar over all runs
        assert eng.save(result, tmp_path / "long.mp4")["frames"] == 49
        assert not result.folder.exists() and not list(tmp_path.glob("sdcpp-video-*"))  # the runs' own folders are gone

    def test_the_first_runs_of_a_new_model_start_with_the_probe_then_grow_by_measure(self, machine, tmp_path):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 24.0
        counts = []
        original = eng._generate_clip

        def spy(req, hooks, budget_gb=None, meter=None):
            counts.append(int(req.extra["frames"]))
            return original(req, hooks, budget_gb, meter)

        eng._generate_clip = spy
        result = eng.generate(request(frames=49), Recorder())
        result.cleanup()
        assert counts == [9, 13, 17, 13]  # probe, then at most 1.6x the biggest measured run, then what is left
        measures = json.loads((tmp_path / "video-memory.json").read_text())
        assert len(next(iter(measures.values()))) == 3  # one measure per distinct size (9, 13, 17 frames)

    def test_measures_kept_from_a_previous_clip_skip_the_probe(self, machine, tmp_path):
        from app import video_memory as vm

        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 24.0
        mv = vm.mvox(25, 64, 48)
        vm.record(f"{eng.spec.id}|{eng.spec.variant}|1", vm.Sample(mv, 3.0))
        counts = []
        original = eng._generate_clip
        eng._generate_clip = lambda req, hooks, budget_gb=None, meter=None: (counts.append(int(req.extra["frames"])),
                                                                              original(req, hooks, budget_gb, meter))[1]
        eng.generate(request(frames=49, fast_decode=True), Recorder()).cleanup()
        assert counts[0] == 37  # 1.6 x 25 frames, not the 9-frame probe

    def test_a_machine_without_memory_for_the_shortest_run_is_told_so(self, machine, tmp_path):
        from app import video_memory as vm

        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 4.0  # below the reserve
        vm.record(f"{eng.spec.id}|{eng.spec.variant}|0", vm.Sample(vm.mvox(9, 64, 48), 6.0))
        with pytest.raises(RuntimeError, match="Mémoire insuffisante"):
            eng.generate(request(frames=25), Recorder())
        assert not list(tmp_path.glob("sdcpp-video-*"))

    def test_the_memory_budget_goes_to_sd_cli_when_the_build_knows_it(self, machine, tmp_path, monkeypatch):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 20.0
        eng.generate(request(frames=9), Recorder()).cleanup()
        argv = json.loads((tmp_path / "argv.json").read_text())
        assert "--max-vram" in argv and 1.0 <= float(argv[argv.index("--max-vram") + 1]) < 20.0
        monkeypatch.setenv("IMAGEGEN_SDCPP_MAX_VRAM", "off")
        eng.generate(request(frames=9), Recorder()).cleanup()
        assert "--max-vram" not in json.loads((tmp_path / "argv.json").read_text())
        (eng.binary.parent / "VERSION.json").write_text(json.dumps({"tag": "master-900-abcdef0"}))
        monkeypatch.delenv("IMAGEGEN_SDCPP_MAX_VRAM")
        eng.generate(request(frames=9), Recorder()).cleanup()
        assert "--max-vram" not in json.loads((tmp_path / "argv.json").read_text())  # build 900 does not know it

    def test_a_private_clip_keeps_its_prompt_off_the_command_line_and_records_no_measure(self, machine, tmp_path, capsys):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 24.0
        sentinel = "PHRASE-TEMOIN-5d1e"
        req = GenerationRequest(prompt=f"un chat {sentinel}", width=64, height=48, steps=3, seed=7, guidance=6.0,
                                negative_prompt="flou", extra={"task": "t2v", "frames": 25, "fps": 8, "private": True})
        eng.generate(req, Recorder()).cleanup()
        argv = json.loads((tmp_path / "argv.json").read_text())
        assert "-p" not in argv and "-n" not in argv and sentinel not in json.dumps(argv)
        assert (tmp_path / "argv.json.prompt").read_text() == f"un chat {sentinel}"  # the file held it while sd-cli ran
        assert not (tmp_path / "video-memory.json").exists() and "[video-memory]" not in capsys.readouterr().out
        assert not list(tmp_path.glob("sdcpp-video-*"))  # the prompt files went with the run folders

    def test_a_private_clip_on_an_old_build_keeps_the_command_line_and_a_normal_one_records(self, machine, tmp_path, capsys):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.read_available = lambda: 24.0
        (eng.binary.parent / "VERSION.json").write_text(json.dumps({"tag": "master-700-abcdef0"}))
        eng.generate(request(frames=9, private=True), Recorder()).cleanup()
        assert "-p" in json.loads((tmp_path / "argv.json").read_text())  # build 700: no prompt file to hand over
        (eng.binary.parent / "VERSION.json").write_text(json.dumps({"tag": "master-956-1b0ba10"}))
        eng.generate(request(frames=9), Recorder()).cleanup()
        assert (tmp_path / "video-memory.json").exists() and "[video-memory]" in capsys.readouterr().out
        argv = json.loads((tmp_path / "argv.json").read_text())
        assert "-p" in argv and "--prompt-file" not in argv  # a normal run is unchanged

    def test_a_model_that_cannot_chain_keeps_one_run(self, machine):
        eng = engine("wan-2.2-t2v-a14b-gguf")  # text-to-video only: no start image to chain from
        assert not eng._chained(request(frames=25))
        assert engine("wan-2.2-ti2v-5b-gguf")._chained(request(frames=25))

    def test_image_to_video_passes_a_fitted_start_image(self, machine, tmp_path):
        from PIL import Image

        Image.new("RGB", (200, 100), "red").save(tmp_path / "start.png")
        eng = engine("wan-2.2-ti2v-5b-gguf")
        hooks = Recorder()
        result = eng.generate(
            GenerationRequest(prompt="p", width=64, height=48, steps=3, seed=1, guidance=6.0,
                              references=[str(tmp_path / "start.png")], extra={"task": "i2v", "frames": 9, "fps": 8}), hooks)
        assert eng.save(result, tmp_path / "i2v.mp4")["frames"] == 9
        steps = [e for e in hooks.events if e[0] == "step"]
        assert steps[0] == ("step", 1, 3)  # the start image's VAE bars were not counted

    def test_real_frame_count_wins_over_the_request(self, machine, tmp_path):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.binary.write_text(eng.binary.read_text().replace('mode = opt("--stub-mode", "ok")', 'mode = "short"'))
        info = eng.save(eng.generate(request(), Recorder()), tmp_path / "s.mp4")
        assert info["frames"] == 8 and info["duration"] == 1.0

    def test_two_experts_progress(self, machine, tmp_path):
        eng = engine("wan-2.2-t2v-a14b-gguf")
        hooks = Recorder()
        req = GenerationRequest(prompt="p", width=64, height=48, steps=18, seed=1, guidance=3.5, extra={"frames": 5, "fps": 8})
        eng.save(eng.generate(req, hooks), tmp_path / "a.mp4")
        steps = [e[1:] for e in hooks.events if e[0] == "step"]
        assert steps[0] == (1, 18) and (18, 18) in steps and max(s[1] for s in steps) == 18

    def test_ltx_sound_survives_the_webm_round_trip(self, machine, tmp_path):
        eng = engine("ltx-2.3-distilled-gguf")
        req = GenerationRequest(prompt="p", width=64, height=48, steps=8, seed=1, extra={"task": "t2v", "frames": 9, "fps": 8})
        result = eng.generate(req, Recorder())
        assert result.path is not None and result.path.suffix == ".webm"
        info = eng.save(result, tmp_path / "ltx.mp4")
        assert info["has_audio"] and info["frames"] == 9
        assert probe_video(tmp_path / "ltx.mp4")["has_audio"]
        assert not result.folder.exists()

    def test_out_of_memory_is_explained_and_cleaned_up(self, machine, tmp_path):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.binary.write_text(eng.binary.read_text().replace('mode = opt("--stub-mode", "ok")', 'mode = "oom"'))
        before = set(tmp_path.glob("sdcpp-video-*"))
        with pytest.raises(RuntimeError, match="Mémoire insuffisante pour cette vidéo"):
            eng.generate(request(), Recorder())
        assert set(tmp_path.glob("sdcpp-video-*")) == before

    def test_cancelling_kills_sd_cli_and_removes_the_temporary_folder(self, machine, tmp_path):
        eng = engine("wan-2.2-ti2v-5b-gguf")
        eng.binary.write_text(eng.binary.read_text().replace('mode = opt("--stub-mode", "ok")', 'mode = "slow"'))
        hooks = Recorder(cancel_after=8)  # after the sampling steps, while the stub sleeps
        with pytest.raises(GenerationCancelled):
            eng.generate(request(), hooks)
        assert not list(tmp_path.glob("sdcpp-video-*"))

    def test_old_metal_build_is_refused_with_a_clear_message(self, machine):
        (machine.parent / "VERSION.json").write_text(json.dumps({"tag": "master-700-abcdef0"}))
        with pytest.raises(RuntimeError, match="trop ancien pour la vidéo sur Mac"):
            engine("wan-2.2-ti2v-5b-gguf")

    def test_a_model_that_does_not_fit_is_refused_before_loading(self, machine):
        SYSTEM["ram_gb"] = 20.0
        with pytest.raises(RuntimeError, match="ne tient pas sur cette machine"):
            engine("wan-2.2-t2v-a14b-gguf")

    def test_editing_a_video_is_not_supported(self, machine):
        with pytest.raises(RuntimeError, match="éditer"):
            engine("wan-2.2-ti2v-5b-gguf").generate(request(task="v2v"), Recorder())


class TestBuilds:
    def test_build_number_and_minimum(self, tmp_path):
        binary = tmp_path / "sd-cli"
        assert sdcpp.build_number(binary) is None and sdcpp.video_unsupported(binary, "metal") is None
        for tag, number, refused in (("master-956-1b0ba10", 956, False), ("master-745-7dab366", 745, False),
                                     ("master-744-abc", 744, True), ("weird", None, False)):
            (tmp_path / "VERSION.json").write_text(json.dumps({"tag": tag}))
            assert sdcpp.build_number(binary) == number
            assert bool(sdcpp.video_unsupported(binary, "metal")) is refused
            assert sdcpp.video_unsupported(binary, "vulkan") is None  # the limit is about Metal only

    def test_installs_are_pinned_to_a_checked_release(self, monkeypatch):
        from app import engine_install as ei

        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        assert ei.default_tag() == ei.PINNED_TAG == "master-956-1b0ba10"
        monkeypatch.setenv("IMAGEGEN_SDCPP_TAG", "latest")
        assert ei.default_tag() == "latest"


class TestMedia:
    def test_read_video_with_audio(self, machine, tmp_path):
        eng = engine("ltx-2.3-distilled-gguf")
        req = GenerationRequest(prompt="p", width=64, height=48, steps=8, seed=1, extra={"task": "t2v", "frames": 5, "fps": 8})
        result = eng.generate(req, Recorder())
        frames, audio, rate = read_video_with_audio(result.path)
        assert frames.shape == (5, 48, 64, 3) and audio.shape == (2, 24000) and rate == 24000
        assert audio.dtype == np.float32 and float(np.abs(audio).max()) <= 1.0
        result.cleanup()


class TestGating:
    def test_download_needs_a_token_for_gated_models(self, monkeypatch):
        import asyncio

        from app import runtime_settings
        from app.downloads import GATED_MESSAGE, downloads

        runtime_settings.reset()  # no token pushed
        assert get_spec("ltx-2.5-distilled-gguf").gated
        with pytest.raises(RuntimeError, match="accès restreint"):
            asyncio.run(downloads.start("ltx-2.5-distilled-gguf"))
        assert "Réglages" in GATED_MESSAGE
        assert to_public_gated("ltx-2.5-distilled-gguf") and not to_public_gated("ltx-2.3-distilled-gguf")

    def test_denied_access_message_explains_what_to_do(self):
        from app.download_worker import _describe

        class GatedRepoError(Exception):
            pass

        text = _describe(GatedRepoError("403 Client Error: gated repo"))
        assert "accès restreint" in text and "Réglages → Modèles" in text


def to_public_gated(model_id):
    return MODELS[model_id].to_public()["gated"]


class TestCustomGguf:
    def test_search_template_for_wan_5b_is_the_sdcpp_model(self):
        from app import hf_search

        found = hf_search.classify("a/g", ["gguf", "base_model:quantized:Wan-AI/Wan2.2-TI2V-5B"])
        assert found[0] == "video-gguf" and found[1]["template"] == "wan-2.2-ti2v-5b-gguf"

    def test_recipe_swaps_the_diffusion_file_and_keeps_the_vae_download(self):
        spec = custom.build({"family": "video-gguf", "id": "custom-w", "repo": "u/Wan-GGUF", "template": "wan-2.2-ti2v-5b-gguf",
                             "file": "wan-Q6_K.gguf", "size_gb": 4.21, "precision": "Q6_K", "name": "u Q6_K"})
        base = MODELS["wan-2.2-ti2v-5b-gguf"]
        assert spec.backend == "sdcpp" and spec.custom and spec.options["files"]["diffusion-model"] == ("u/Wan-GGUF", "wan-Q6_K.gguf")
        assert spec.options["files"]["vae"] == base.options["files"]["vae"]
        wanted = set(spec.options["files"].values())
        assert wanted == {(s.repo, p) for s in spec.sources for p in s.patterns}
        assert spec.download_size_gb == pytest.approx(base.download_size_gb - 3.43 + 4.21, abs=0.02)
        assert base.options["files"]["diffusion-model"][0] == "QuantStack/Wan2.2-TI2V-5B-GGUF"  # untouched
