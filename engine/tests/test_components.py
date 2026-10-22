# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Components (base data, engines), the install plan of a model, the run that installs it, and the "ffmpeg" pack.

Nothing here installs, downloads, imports PyAV or PyTorch, or probes the hardware: installers are replaced by fakes and the
hardware report is a dict."""

import asyncio
import json
import os
import sys

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import audio_packs, components, media, setup_runner as sr  # noqa: E402
from app.engines import get_spec  # noqa: E402

SYSTEM = {"os": "Windows", "arch": "AMD64", "engines": {"sdcpp": {"install_size_mb": 30}, "llamacpp": {"install_size_mb": 20}},
          "accelerators": [{"vendor": "nvidia", "backend": "vulkan", "memory_gb": 12.0, "unified": False}], "unusable_gpus": []}
NO_GPU = {**SYSTEM, "accelerators": []}


def ids(model_id):
    return components.components_of(get_spec(model_id))


class TestComponentsOfAModel:
    def test_a_torch_image_model_needs_the_pytorch_base_only(self):
        assert ids("z-image-turbo") == ["torch"]

    def test_a_mlx_model_shares_the_same_base(self):
        assert ids("qwen-image-2.1") == ["torch"]

    def test_a_gguf_image_model_needs_the_sdcpp_engine(self):
        assert ids("z-image-turbo-gguf") == ["sdcpp"]

    def test_every_video_model_needs_ffmpeg_first(self):
        assert ids("wan-2.2-ti2v-5b-gguf") == ["ffmpeg", "sdcpp"]
        assert ids("wan-2.2-ti2v-5b") == ["torch", "ffmpeg"] or ids("wan-2.2-ti2v-5b") == ["ffmpeg", "torch"]
        assert ids("kiwi-edit-5b") == ["ffmpeg", "kiwi"]

    def test_base_comes_before_engines(self):
        for model in ("wan-2.2-ti2v-5b-gguf", "kiwi-edit-5b", "wan-2.2-ti2v-5b"):
            kinds = [components.kind_of(c) for c in ids(model)]
            assert kinds == sorted(kinds, key=lambda k: k != components.BASE)

    def test_a_chat_model_needs_llamacpp_and_an_audio_model_its_pack(self):
        assert ids("llm-qwen3-1.7b") == ["llamacpp"]
        assert ids("kokoro-82m") == ["speech"]

    def test_every_registered_model_names_known_components(self):
        from app.engines import all_specs

        for spec in all_specs():
            assert set(components.components_of(spec)) <= set(components.ORDER), spec.id


class TestPlan:
    @pytest.fixture
    def nothing_installed(self, monkeypatch):
        monkeypatch.setattr(components, "is_installed", lambda cid: False)
        from app.downloads import downloads

        monkeypatch.setattr(downloads, "status", lambda spec: {"state": "missing", "size_gb": 0.0})

    def test_lists_base_engine_and_model_with_the_total(self, nothing_installed):
        plan = sr.plan_for_model("wan-2.2-ti2v-5b-gguf", SYSTEM)
        assert [(s["kind"], s["id"]) for s in plan["steps"]] == [("base", "ffmpeg"), ("engine", "sdcpp"), ("model", "wan-2.2-ti2v-5b-gguf")]
        assert plan["total_mb"] == sum(s["size_mb"] for s in plan["steps"]) > 0
        assert not plan["ready"] and plan["blocked"] is None

    def test_an_installed_component_is_not_downloaded_again(self, monkeypatch, nothing_installed):
        monkeypatch.setattr(components, "is_installed", lambda cid: cid == "ffmpeg")
        plan = sr.plan_for_model("wan-2.2-ti2v-5b-gguf", SYSTEM)
        ffmpeg = plan["steps"][0]
        assert ffmpeg["installed"] and ffmpeg["size_mb"] == 0
        assert plan["total_mb"] == sum(s["size_mb"] for s in plan["steps"][1:])

    def test_everything_installed_is_ready(self, monkeypatch):
        from app.downloads import downloads

        monkeypatch.setattr(components, "is_installed", lambda cid: True)
        monkeypatch.setattr(downloads, "status", lambda spec: {"state": "installed", "size_gb": spec.download_size_gb or 0})
        plan = sr.plan_for_model("z-image-turbo-gguf", SYSTEM)
        assert plan["ready"] and plan["total_mb"] == 0

    def test_a_machine_that_cannot_run_the_engine_is_blocked_with_the_reason(self, nothing_installed):
        plan = sr.plan_for_model("kiwi-edit-5b", NO_GPU)
        assert plan["blocked"] and "NVIDIA" in plan["blocked"]

    def test_unknown_model(self):
        with pytest.raises(KeyError):
            sr.plan_for_model("nope", SYSTEM)


class FakeInstaller:
    """Stands for an installer: running for `ticks` polls, then `final`."""

    def __init__(self, final="done", ticks=2, error=None, start_error=None):
        self.final, self.ticks, self.error, self.start_error = final, ticks, error, start_error
        self.polls, self.cancelled, self.started = 0, False, False

    async def start(self):
        if self.start_error:
            raise RuntimeError(self.start_error)
        self.started = True

    def read(self):
        self.polls += 1
        if self.cancelled:
            return {"state": "cancelled"}
        if self.polls <= self.ticks:
            return {"state": "running", "message": "en cours", "done": self.polls, "total": 10}
        return {"state": self.final, "error": self.error}

    def cancel(self):
        self.cancelled = True
        return True


@pytest.fixture
def runner(monkeypatch):
    monkeypatch.setattr(sr, "POLL_SECONDS", 0.005)
    monkeypatch.setattr(sr.bus, "publish", lambda *a, **k: None)
    monkeypatch.setattr(components, "is_installed", lambda cid: False)
    from app.downloads import downloads

    monkeypatch.setattr(downloads, "status", lambda spec: {"state": "missing", "size_gb": 0.0})
    return sr.SetupRunner()


def install_fakes(monkeypatch, fakes):
    monkeypatch.setattr(sr, "_adapter", lambda step, model_id: sr._Adapter(fakes[step["id"]].start, fakes[step["id"]].read, fakes[step["id"]].cancel))


async def finish(runner):
    while runner.running:
        await asyncio.sleep(0.005)


class TestRun:
    def test_installs_every_missing_step_in_order(self, runner, monkeypatch):
        fakes = {"ffmpeg": FakeInstaller(), "sdcpp": FakeInstaller(), "wan-2.2-ti2v-5b-gguf": FakeInstaller()}
        install_fakes(monkeypatch, fakes)

        async def go():
            await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            await finish(runner)

        asyncio.run(go())
        assert runner.state["state"] == "done"
        assert [s["state"] for s in runner.state["steps"]] == ["done"] * 3
        assert all(f.started for f in fakes.values())

    def test_only_the_missing_steps_run(self, runner, monkeypatch):
        monkeypatch.setattr(components, "is_installed", lambda cid: cid == "ffmpeg")
        fakes = {"sdcpp": FakeInstaller(), "wan-2.2-ti2v-5b-gguf": FakeInstaller()}
        install_fakes(monkeypatch, fakes)

        async def go():
            await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            await finish(runner)

        asyncio.run(go())
        assert [s["id"] for s in runner.state["steps"]] == ["sdcpp", "wan-2.2-ti2v-5b-gguf"]

    def test_a_failed_step_stops_the_run_with_its_message(self, runner, monkeypatch):
        fakes = {"ffmpeg": FakeInstaller(final="error", error="réseau coupé"), "sdcpp": FakeInstaller(), "wan-2.2-ti2v-5b-gguf": FakeInstaller()}
        install_fakes(monkeypatch, fakes)

        async def go():
            await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            await finish(runner)

        asyncio.run(go())
        assert runner.state["state"] == "error" and "réseau coupé" in runner.state["error"]
        assert [s["state"] for s in runner.state["steps"]] == ["error", "pending", "pending"]
        assert not fakes["sdcpp"].started

    def test_a_refused_start_is_an_error_of_that_step(self, runner, monkeypatch):
        fakes = {"ffmpeg": FakeInstaller(start_error="Espace disque insuffisant"), "sdcpp": FakeInstaller(), "wan-2.2-ti2v-5b-gguf": FakeInstaller()}
        install_fakes(monkeypatch, fakes)

        async def go():
            await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            await finish(runner)

        asyncio.run(go())
        assert runner.state["state"] == "error" and "disque" in runner.state["error"]

    def test_cancel_stops_the_current_step_and_leaves_the_next_ones_alone(self, runner, monkeypatch):
        fakes = {"ffmpeg": FakeInstaller(), "sdcpp": FakeInstaller(ticks=1000), "wan-2.2-ti2v-5b-gguf": FakeInstaller()}
        install_fakes(monkeypatch, fakes)

        async def go():
            await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            while runner.state["steps"][1]["state"] != "running":
                await asyncio.sleep(0.005)
            assert await runner.cancel()
            await finish(runner)

        asyncio.run(go())
        assert runner.state["state"] == "cancelled"
        states = [s["state"] for s in runner.state["steps"]]
        assert states[0] == "done" and states[1] == "cancelled" and states[2] == "pending"
        assert fakes["sdcpp"].cancelled and not fakes["wan-2.2-ti2v-5b-gguf"].started

    def test_nothing_to_install_is_done_at_once(self, runner, monkeypatch):
        from app.downloads import downloads

        monkeypatch.setattr(components, "is_installed", lambda cid: True)
        monkeypatch.setattr(downloads, "status", lambda spec: {"state": "installed", "size_gb": spec.download_size_gb or 0})
        state = asyncio.run(runner.start("z-image-turbo-gguf", SYSTEM))
        assert state["state"] == "done" and state["steps"] == []

    def test_a_blocked_machine_is_refused(self, runner):
        with pytest.raises(RuntimeError, match="NVIDIA"):
            asyncio.run(runner.start("kiwi-edit-5b", NO_GPU))

    def test_a_second_setup_is_refused_while_one_runs(self, runner, monkeypatch):
        install_fakes(monkeypatch, {"ffmpeg": FakeInstaller(ticks=1000), "sdcpp": FakeInstaller(), "wan-2.2-ti2v-5b-gguf": FakeInstaller(),
                                    "z-image-turbo-gguf": FakeInstaller()})

        async def go():
            await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            same = await runner.start("wan-2.2-ti2v-5b-gguf", SYSTEM)
            assert same["state"] == "running"
            with pytest.raises(RuntimeError):
                await runner.start("z-image-turbo-gguf", SYSTEM)
            await runner.cancel()
            await finish(runner)

        asyncio.run(go())

    def test_cancel_without_a_run(self, runner):
        assert asyncio.run(runner.cancel()) is False


class TestUninstall:
    @pytest.fixture
    def env(self, monkeypatch):
        from app.downloads import downloads

        calls = {"deleted": [], "removed": []}
        monkeypatch.setattr(components, "in_use", lambda cid: None)
        monkeypatch.setattr(components, "removable", lambda cid: True)
        monkeypatch.setattr(components, "dependants", lambda cid: [{"id": "m1", "name": "M1", "kind": "video"}])
        monkeypatch.setattr(components, "remove_files", lambda cid: calls["removed"].append(cid))
        monkeypatch.setattr(downloads, "delete", lambda mid: calls["deleted"].append(mid) or {})
        monkeypatch.setattr(components.bus, "publish", lambda *a, **k: None)
        return calls

    def test_removes_the_dependent_models_then_the_component(self, env):
        result = asyncio.run(components.uninstall("ffmpeg"))
        assert env == {"deleted": ["m1"], "removed": ["ffmpeg"]}
        assert result["removed_models"][0]["id"] == "m1"

    def test_refuses_a_component_in_use(self, env, monkeypatch):
        monkeypatch.setattr(components, "in_use", lambda cid: "Ce moteur est en cours d'utilisation")
        with pytest.raises(RuntimeError, match="utilisation"):
            asyncio.run(components.uninstall("sdcpp"))
        assert env == {"deleted": [], "removed": []}

    def test_refuses_a_build_shipped_with_the_app(self, env, monkeypatch):
        monkeypatch.setattr(components, "removable", lambda cid: False)
        with pytest.raises(RuntimeError, match="intégré"):
            asyncio.run(components.uninstall("sdcpp"))

    def test_unknown_component(self, env):
        with pytest.raises(KeyError):
            asyncio.run(components.uninstall("nope"))


class TestFfmpegPack:
    def test_it_is_a_small_base_add_on_without_pytorch(self):
        pack = audio_packs.PACKS["ffmpeg"]
        assert pack.overlay and pack.family == "runtime" and not pack.torch_packages and not pack.reprobe
        assert pack.imports == ("av",) and pack.size_mb < 200

    def test_any_machine_can_install_it(self):
        assert audio_packs.unsupported_reason(audio_packs.PACKS["ffmpeg"], NO_GPU) is None

    def test_pytorch_still_needs_a_gpu(self):
        assert audio_packs.unsupported_reason(audio_packs.PACKS["torch"], NO_GPU)

    def test_only_the_torch_pack_triggers_the_probe(self):
        assert audio_packs.PACKS["torch"].reprobe

    def test_activating_an_absent_add_on_does_nothing(self, tmp_path, monkeypatch):
        monkeypatch.setitem(audio_packs.FAMILY_DIRS, "runtime", tmp_path)
        before = list(sys.path)
        assert audio_packs.activate_overlay("ffmpeg") is False
        assert sys.path == before

    def test_activating_an_installed_add_on_puts_it_first_once(self, tmp_path, monkeypatch):
        monkeypatch.setitem(audio_packs.FAMILY_DIRS, "runtime", tmp_path)
        root = tmp_path / "ffmpeg"
        site = root / "venv" / "lib" / "python3.12" / "site-packages"
        site.mkdir(parents=True)
        (root / "venv" / "bin").mkdir(parents=True)
        (root / "venv" / "bin" / "python").write_text("")
        (root / "ready.json").write_text(json.dumps({"hash": audio_packs._requirements_hash(audio_packs.PACKS["ffmpeg"])}))
        monkeypatch.setattr(sys, "path", list(sys.path))
        assert audio_packs.activate_overlay("ffmpeg") and audio_packs.activate_overlay("ffmpeg")
        assert sys.path[0] == str(site) and sys.path.count(str(site)) == 1

    def test_a_cancelled_install_removes_the_venv_and_the_source_code(self, tmp_path, monkeypatch):
        monkeypatch.setitem(audio_packs.FAMILY_DIRS, "video", tmp_path)
        pack = audio_packs.PACKS["bernini"]
        (tmp_path / "bernini" / "venv").mkdir(parents=True)
        (tmp_path / "bernini" / "src" / "bernini").mkdir(parents=True)
        audio_packs.PackInstaller._discard(pack)
        assert not (tmp_path / "bernini" / "venv").exists() and not (tmp_path / "bernini" / "src").exists()


class TestMediaWithoutFfmpeg:
    def test_a_missing_pyav_gives_a_clear_message(self, monkeypatch):
        monkeypatch.setattr(audio_packs, "activate_overlay", lambda pack_id: False)
        monkeypatch.setitem(sys.modules, "av", None)  # `import av` raises ImportError
        with pytest.raises(media.FfmpegMissing, match="FFmpeg"):
            media.load_av()
