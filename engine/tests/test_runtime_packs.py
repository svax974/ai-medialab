# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Add-on of the main runtime (PyTorch + diffusers, MLX): the "torch" pack, installed on demand into a venv whose
site-packages joins the import path of the image worker only.

Nothing here installs a pack, imports torch or touches a GPU."""

import json
import os
import sys
import types

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import audio_packs, system  # noqa: E402
from app.engines import MODELS, get_spec  # noqa: E402

NVIDIA = {"os": "Windows", "arch": "AMD64", "accelerators": [{"vendor": "nvidia", "backend": "vulkan", "memory_gb": 12.0, "unified": False}],
          "unusable_gpus": []}
MAC = {"os": "Darwin", "arch": "arm64", "accelerators": [{"vendor": "apple", "backend": "metal", "memory_gb": 36.0, "unified": True}],
       "unusable_gpus": []}
NO_GPU = {"os": "Windows", "arch": "AMD64", "accelerators": [], "unusable_gpus": []}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """Pack folders under a temporary directory."""
    monkeypatch.setitem(audio_packs.FAMILY_DIRS, "runtime", tmp_path / "runtime")
    return tmp_path / "runtime"


def fake_install(data_dir, site_rel="venv/lib/python3.12/site-packages"):
    pack = audio_packs.PACKS["torch"]
    root = data_dir / "torch"
    (root / site_rel).mkdir(parents=True)
    (root / "venv" / "bin").mkdir(parents=True, exist_ok=True)
    (root / "venv" / "bin" / "python").write_text("")
    (root / "ready.json").write_text(json.dumps({"hash": audio_packs._requirements_hash(pack)}))
    return root / site_rel


class TestDefinition:
    def test_it_is_an_add_on_of_the_runtime_family(self):
        pack = audio_packs.PACKS["torch"]
        assert pack.overlay and pack.family == "runtime" and not pack.native
        assert audio_packs.pack_dir("torch").parent.name == "runtime"
        assert {"torch", "diffusers", "transformers"} <= set(pack.imports)

    def test_it_is_built_on_the_servers_own_interpreter(self):
        assert audio_packs.python_of(audio_packs.PACKS["torch"]) == f"{sys.version_info.major}.{sys.version_info.minor}"

    def test_mflux_only_comes_with_apple_silicon(self, monkeypatch):
        pack = audio_packs.PACKS["torch"]
        monkeypatch.setattr(audio_packs, "is_apple_silicon", lambda: False)
        assert not any(r.startswith("mflux") for r in audio_packs.requirements_for(pack))
        monkeypatch.setattr(audio_packs, "is_apple_silicon", lambda: True)
        assert any(r.startswith("mflux") for r in audio_packs.requirements_for(pack))

    def test_announced_size_depends_on_the_machine(self, monkeypatch):
        pack = audio_packs.PACKS["torch"]
        monkeypatch.setattr(audio_packs, "is_apple_silicon", lambda: True)
        assert audio_packs.size_of(pack) == pack.size_mb_apple < pack.size_mb
        monkeypatch.setattr(audio_packs, "is_apple_silicon", lambda: False)
        assert audio_packs.size_of(pack) == pack.size_mb
        assert audio_packs.size_of(audio_packs.PACKS["speech"]) == audio_packs.PACKS["speech"].size_mb

    def test_torch_backed_models_name_the_pack(self):
        torch_models = [s for s in MODELS.values() if s.backend in ("torch", "mlx")]
        assert torch_models
        assert {audio_packs.pack_of(get_spec(s.id)) for s in torch_models} == {"torch"}
        assert audio_packs.pack_of(get_spec("qwen-image-2.1")) in (None, "torch")
        gguf = next(s for s in MODELS.values() if s.backend == "sdcpp")
        assert audio_packs.pack_of(gguf) is None


class TestInstalledState:
    def test_not_installed_by_default(self, data_dir):
        assert not audio_packs.is_installed("torch")
        assert audio_packs.overlay_paths() == []

    def test_installed_when_the_marker_matches(self, data_dir):
        site = fake_install(data_dir)
        assert audio_packs.is_installed("torch")
        assert audio_packs.overlay_site("torch") == site
        assert audio_packs.overlay_paths() == [str(site)]

    def test_windows_layout(self, data_dir):
        site = fake_install(data_dir, "venv/Lib/site-packages")
        (data_dir / "torch" / "venv" / "Scripts").mkdir(parents=True)
        (data_dir / "torch" / "venv" / "Scripts" / "python.exe").write_text("")
        (data_dir / "torch" / "venv" / "bin" / "python").unlink()
        assert audio_packs.overlay_site("torch") == site

    def test_a_changed_recipe_means_not_installed(self, data_dir):
        fake_install(data_dir)
        (data_dir / "torch" / "ready.json").write_text(json.dumps({"hash": "old"}))
        assert not audio_packs.is_installed("torch")

    def test_the_worker_puts_the_site_first_and_only_once(self, data_dir, monkeypatch):
        site = fake_install(data_dir)
        monkeypatch.setattr(sys, "path", ["/base"])
        audio_packs.activate_overlays()
        audio_packs.activate_overlays()
        assert sys.path == [str(site), "/base"]

    def test_nothing_to_activate_without_the_pack(self, data_dir, monkeypatch):
        monkeypatch.setattr(sys, "path", ["/base"])
        audio_packs.activate_overlays()
        assert sys.path == ["/base"]

    def test_the_venv_check_is_not_polluted_by_the_servers_packages(self):
        assert audio_packs.pack_env("torch")["PYTHONPATH"] == ""


class TestHardwareGate:
    def test_nvidia_apple_and_linux_amd_are_accepted(self):
        pack = audio_packs.PACKS["torch"]
        assert audio_packs.unsupported_reason(pack, NVIDIA) is None
        assert audio_packs.unsupported_reason(pack, MAC) is None
        assert audio_packs.unsupported_reason(pack, {**NVIDIA, "os": "Linux", "accelerators": [{"vendor": "amd"}]}) is None

    def test_a_machine_without_a_usable_gpu_is_refused_with_a_reason(self):
        pack = audio_packs.PACKS["torch"]
        reason = audio_packs.unsupported_reason(pack, NO_GPU)
        assert reason and "GPU" in reason
        assert audio_packs.unsupported_reason(pack, {**NVIDIA, "accelerators": [{"vendor": "amd"}]})  # AMD on Windows

    def test_engine_info_offers_the_install(self, data_dir, monkeypatch):
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")
        info = audio_packs.engine_info("torch", NVIDIA)
        assert info["available"] is False and info["installable"] is True
        assert info["pack"] == "torch" and info["install_size_mb"] == audio_packs.size_of(audio_packs.PACKS["torch"])

    def test_engine_info_without_a_gpu_offers_nothing(self, data_dir):
        info = audio_packs.engine_info("torch", NO_GPU)
        assert not info.get("installable") and info["reason"]

    def test_engine_info_when_installed(self, data_dir):
        fake_install(data_dir)
        assert audio_packs.engine_info("torch", NVIDIA)["available"] is True


class TestHardwareReport:
    """`system._compute` builds the engines itself: it must not call `get_system` again, and the add-on shows up as installable."""

    @pytest.fixture(autouse=True)
    def no_real_probe(self, monkeypatch):
        def no_get_system(*a, **k):
            raise AssertionError("get_system called while the report is being built")

        monkeypatch.setattr(system, "get_system", no_get_system)
        monkeypatch.setattr(system, "_gpu_names_fallback", lambda: [{"vendor": "nvidia", "name": "RTX 4070", "memory_gb": 12.0}])
        monkeypatch.setattr(system.platform, "system", lambda: "Windows")
        monkeypatch.setattr(system.platform, "machine", lambda: "AMD64")
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")

    def test_torch_missing_but_installable(self, data_dir):
        report = system._compute({"torch": None, "error": "PyTorch n'est pas installé dans ce runtime."})
        engine = report["engines"]["torch"]
        assert engine["available"] is False and engine["installable"] is True and engine["pack"] == "torch"
        assert report["accelerators"][0]["vendor"] == "nvidia"  # seen without PyTorch

    def test_torch_available_once_the_probe_sees_it(self, data_dir):
        info = {"torch": "2.11", "cuda": True, "hip": None, "mps": False, "diffusers": "0.41",
                "devices": [{"name": "RTX 4070", "memory_gb": 12.0}]}
        assert system._compute(info)["engines"]["torch"]["available"] is True

    def test_mlx_is_offered_on_a_mac_without_the_pack(self, data_dir, monkeypatch):
        monkeypatch.setattr(system.platform, "system", lambda: "Darwin")
        monkeypatch.setattr(system.platform, "machine", lambda: "arm64")
        monkeypatch.setattr(system, "_chip_name", lambda: "Apple M3 Max")
        monkeypatch.setattr(system.importlib.util, "find_spec", lambda name, *a: None)
        report = system._compute({"torch": None, "error": "absent"})
        assert report["engines"]["mlx"]["installable"] is True and report["engines"]["mlx"]["pack"] == "torch"

    def test_mlx_is_available_with_the_pack(self, data_dir, monkeypatch):
        monkeypatch.setattr(system.platform, "system", lambda: "Darwin")
        monkeypatch.setattr(system.platform, "machine", lambda: "arm64")
        fake_install(data_dir)  # after the platform: the recipe (and its hash) includes mflux on Apple Silicon
        monkeypatch.setattr(system, "_chip_name", lambda: "Apple M3 Max")
        assert system._compute({"torch": None, "error": "x"})["engines"]["mlx"]["available"] is True

    def test_the_probe_runs_with_the_add_on_on_its_path(self, data_dir, monkeypatch):
        site = fake_install(data_dir)
        seen = []
        monkeypatch.setattr(system, "_run", lambda cmd, timeout=6: seen.append(cmd) or '@@PROBE@@{"torch": "2.11"}')
        assert system._probe_torch()["torch"] == "2.11"
        assert repr([str(site)]) in seen[0][2]

    def test_no_probe_when_torch_is_nowhere(self, data_dir, monkeypatch):
        monkeypatch.setattr(system.importlib.util, "find_spec", lambda name, *a: None)
        monkeypatch.setattr(system, "_run", lambda *a, **k: pytest.fail("the probe must not run"))
        assert system._probe_torch()["torch"] is None

    def test_reprobe_forgets_the_previous_report(self, monkeypatch):
        calls = []
        monkeypatch.setattr(system, "_start_probe", lambda: calls.append(1))
        monkeypatch.setattr(system, "_cache", {"old": True})
        monkeypatch.setattr(system, "_torch_info", {"torch": None})
        monkeypatch.setattr(system, "_probe_started", True)
        system.reprobe()
        assert system._cache is None and system._torch_info is None and system._probe_started is False and calls == [1]


class TestInstall:
    def test_install_builds_a_venv_on_the_servers_interpreter(self, data_dir, monkeypatch):
        commands = []
        installer = audio_packs.PackInstaller()
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")
        monkeypatch.setattr(audio_packs.sys, "platform", "win32")  # the GPU index depends on the OS (none on macOS)
        monkeypatch.setattr(installer, "_exec", lambda cmd, message, env=None: commands.append(cmd))
        monkeypatch.setattr(audio_packs, "_reprobe", lambda: commands.append("reprobe"))
        monkeypatch.setattr(audio_packs, "bus", types.SimpleNamespace(publish=lambda *a, **k: None))
        installer._run(audio_packs.PACKS["torch"], NVIDIA["accelerators"])
        venv_cmd = commands[0]
        assert venv_cmd[:3] == ["/usr/bin/uv", "venv", "--python"] and venv_cmd[3] == sys.executable
        assert any("download.pytorch.org/whl/cu128" in " ".join(c) for c in commands if isinstance(c, list))
        assert commands[-1] == "reprobe" and installer.state["state"] == "done"
        assert (data_dir / "torch" / "ready.json").is_file()

    def test_torch_packages_still_install_on_macos_without_a_gpu_index(self, data_dir, monkeypatch):
        """`_torch_index` returns None on macOS (plain PyPI wheels already carry Metal): `torch_packages`
        (torch, torchvision) must still be installed, just without a `--index-url` flag — otherwise the later
        `import torchvision` verification fails (torchvision is pulled in by nothing else)."""
        commands = []
        installer = audio_packs.PackInstaller()
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")
        monkeypatch.setattr(audio_packs.sys, "platform", "darwin")
        monkeypatch.setattr(installer, "_exec", lambda cmd, message, env=None: commands.append(cmd))
        monkeypatch.setattr(audio_packs, "_reprobe", lambda: commands.append("reprobe"))
        monkeypatch.setattr(audio_packs, "bus", types.SimpleNamespace(publish=lambda *a, **k: None))
        installer._run(audio_packs.PACKS["torch"], MAC["accelerators"])
        torch_cmd = next(c for c in commands if isinstance(c, list) and "torchvision" in c)
        assert "--index-url" not in torch_cmd
        assert installer.state["state"] == "done"

    def test_a_failed_install_leaves_nothing_behind(self, data_dir, monkeypatch):
        installer = audio_packs.PackInstaller()
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")

        def boom(cmd, message, env=None):
            raise RuntimeError("réseau coupé")

        monkeypatch.setattr(installer, "_exec", boom)
        monkeypatch.setattr(audio_packs, "bus", types.SimpleNamespace(publish=lambda *a, **k: None))
        installer._run(audio_packs.PACKS["torch"], NVIDIA["accelerators"])
        assert installer.state["state"] == "error" and "réseau coupé" in installer.state["error"]
        assert not (data_dir / "torch" / "venv").exists()

    def test_uninstall_probes_again(self, data_dir, monkeypatch):
        fake_install(data_dir)
        calls = []
        monkeypatch.setattr(audio_packs, "_reprobe", lambda: calls.append(1))
        audio_packs.PackInstaller().uninstall("torch")
        assert not (data_dir / "torch").exists() and calls == [1]


class TestCatalog:
    def test_models_point_at_the_pack_and_the_install(self, data_dir, monkeypatch):
        from app import catalog

        report = {**MAC, "ram_gb": 36.0, "ram_free_gb": 20.0, "disk": {"free_gb": 500, "total_gb": 1000},
                  "paths": {"data": "/tmp", "models": "/tmp"}, "python": "3.12",
                  "engines": {"mlx": audio_packs.engine_info("torch", MAC), "torch": audio_packs.engine_info("torch", MAC),
                              "sdcpp": {"available": False, "reason": "x"}, "llamacpp": {"available": False, "reason": "x"}}}
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")
        report["engines"]["mlx"] = report["engines"]["torch"] = audio_packs.engine_info("torch", MAC)
        monkeypatch.setattr(catalog, "get_system", lambda refresh=False: report)
        models = {m["id"]: m for m in catalog.describe_models()["models"]}
        mlx = next(m for m in models.values() if m["backend"] == "mlx")
        assert mlx["engine_pack"] == "torch" and mlx["needs_engine_install"] is True and mlx["engine_install_size_mb"]
        assert "PyTorch" in mlx["engine_detail"]

    def test_the_job_is_refused_with_the_install_message(self, data_dir, monkeypatch):
        from app.jobs import jobs

        mlx_id = next(s.id for s in MODELS.values() if s.backend == "mlx")
        monkeypatch.setattr("app.jobs._runtime_has", lambda backend: False)
        message = jobs._availability_error(mlx_id)
        assert message and "PyTorch" in message and "Modèles" in message
        monkeypatch.setattr("app.jobs._runtime_has", lambda backend: True)
        assert "PyTorch" not in (jobs._availability_error(mlx_id) or "")
