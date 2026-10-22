# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""llama.cpp installer: asset choice, checksums, safe extraction, layouts, build selection, engine status (no network:
the release and its archives are made up here; the real archives were never downloaded)."""

import hashlib
import io
import json
import os
import stat
import sys
import tarfile
import zipfile
from pathlib import Path

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402

from app import engine_install as ei, llamacpp, system  # noqa: E402

TAG = llamacpp.PINNED_TAG
REAL_DOWNLOAD = ei._download  # the fixtures replace it; one test needs the real prefix check
# The assets of the pinned release as the GitHub API lists them (names checked on 2026-10-15 on b11312, b11317 and b11320).
REAL_ASSETS = [
    f"cudart-llama-{TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz", "cudart-llama-bin-win-cuda-12.4-x64.zip",
    f"llama-{TAG}-bin-android-arm64.tar.gz", f"llama-{TAG}-bin-macos-arm64.tar.gz", f"llama-{TAG}-bin-macos-x64.tar.gz",
    f"llama-{TAG}-bin-ubuntu-arm64.tar.gz", f"llama-{TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz",
    f"llama-{TAG}-bin-ubuntu-cuda-13.4-x64.tar.gz", f"llama-{TAG}-bin-ubuntu-rocm-10.0-x64.tar.gz",
    f"llama-{TAG}-bin-ubuntu-vulkan-arm64.tar.gz", f"llama-{TAG}-bin-ubuntu-vulkan-x64.tar.gz",
    f"llama-{TAG}-bin-ubuntu-x64.tar.gz", f"llama-{TAG}-bin-win-cpu-arm64.zip", f"llama-{TAG}-bin-win-cpu-x64.zip",
    f"llama-{TAG}-bin-win-cuda-12.4-x64.zip", f"llama-{TAG}-bin-win-cuda-13.4-x64.zip",
    f"llama-{TAG}-bin-win-rocm-10.0-x64.zip", f"llama-{TAG}-bin-win-vulkan-x64.zip", f"llama-{TAG}-ui.tar.gz",
    f"llama-{TAG}-xcframework.zip",
]
DEVICES = "Available devices:\n  MTL0: Apple M3 Max (27648 MiB, 27647 MiB free)\n  CPU: Apple M3 Max (36864 MiB, 36864 MiB free)\n"


class TestAssets:
    def test_every_build_pattern_matches_exactly_one_real_asset(self):
        for key, patterns in llamacpp.ASSETS.items():
            for pattern in patterns:
                import re

                assert len([n for n in REAL_ASSETS if re.search(pattern, n)]) == 1, (key, pattern)

    def test_the_cuda_runtime_archives_never_match_a_build_pattern(self):
        import re

        build = llamacpp.ASSETS[("linux", "x86_64", "cuda")][0]
        assert not re.search(build, f"cudart-llama-{TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz")

    def test_every_variant_has_a_size_and_the_pinned_tag_is_a_release_number(self):
        assert set(llamacpp.ASSETS) == set(llamacpp.APPROX_MB)
        assert llamacpp.PINNED_TAG.startswith("b") and llamacpp.PINNED_TAG[1:].isdigit()

    def test_the_tag_can_be_overridden(self, monkeypatch):
        assert llamacpp.default_tag() == TAG
        monkeypatch.setenv("IMAGEGEN_LLAMACPP_TAG", "latest")
        assert llamacpp.default_tag() == "latest"

    @pytest.mark.parametrize("vendors,os_name,arch,expected", [
        (["apple"], "macos", "arm64", ["metal"]),
        (["nvidia"], "windows", "x86_64", ["cuda", "vulkan", "cpu"]),
        (["amd"], "linux", "x86_64", ["rocm", "vulkan", "cpu"]),
        (["amd"], "windows", "x86_64", ["rocm", "vulkan", "cpu"]),
        ([], "linux", "x86_64", ["vulkan", "cpu"]),
        (["other"], "windows", "arm64", ["cpu"]),
        (["nvidia", "amd"], "linux", "arm64", ["vulkan", "cpu"]),
        (["apple"], "macos", "x86_64", ["cpu"]),
    ])
    def test_builds_to_try_follow_the_gpu_and_end_on_the_cpu(self, vendors, os_name, arch, expected):
        assert llamacpp.candidate_variants(vendors, os_name, arch) == expected


def _tar(files: dict[str, bytes], wrap: str | None = None, modes: dict[str, int] | None = None) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(f"{wrap}/{name}" if wrap else name)
            info.size, info.mode = len(data), (modes or {}).get(name, 0o644)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def release(tmp_path, monkeypatch):
    """A made-up GitHub release whose archives `_download` copies out of memory, and an install folder under tmp."""
    monkeypatch.setenv("IMAGEGEN_LLAMACPP_DIR", str(tmp_path / "llamacpp"))
    state = {"archives": {}, "digests": {}, "requested": []}

    def add(name: str, data: bytes, digest: str | None = "ok") -> None:
        state["archives"][name] = data
        state["digests"][name] = hashlib.sha256(data).hexdigest() if digest == "ok" else digest

    def http_json(url):
        state["requested"].append(url)
        return {"tag_name": TAG, "assets": [
            {"name": n, "size": len(d), "digest": f"sha256:{state['digests'][n]}" if state["digests"][n] else None,
             "browser_download_url": f"{llamacpp.DOWNLOAD_PREFIX}{TAG}/{n}"} for n, d in state["archives"].items()]}

    def download(url, dest, on_bytes, cancel, prefix=ei.DOWNLOAD_PREFIX):
        assert url.startswith(prefix)
        data = state["archives"][url.rsplit("/", 1)[-1]]
        Path(dest).write_bytes(data)
        on_bytes(len(data))
        return hashlib.sha256(data).hexdigest()

    monkeypatch.setattr(ei, "_http_json", http_json)
    monkeypatch.setattr(ei, "_download", download)
    state["add"] = add
    return state


class TestInstall:
    ASSET = f"llama-{TAG}-bin-macos-arm64.tar.gz"

    def test_a_wrapped_archive_is_installed_with_its_libraries_and_a_version_file(self, release, tmp_path):
        release["add"](self.ASSET, _tar({"llama-server": b"#!bin", "libggml.dylib": b"lib", "llama-cli": b"cli"},
                                        wrap=f"llama-{TAG}", modes={"llama-server": 0o644}))
        progress = []
        meta = llamacpp.install_variant("macos", "arm64", "metal", progress=lambda d, t, m: progress.append((d, t, m)))
        target = tmp_path / "llamacpp" / "metal"
        assert (target / "llama-server").is_file() and (target / "libggml.dylib").is_file()
        assert (target / "llama-server").stat().st_mode & stat.S_IXUSR  # made executable whatever the archive said
        assert json.loads((target / "VERSION.json").read_text())["tag"] == TAG and meta["assets"][0]["name"] == self.ASSET
        assert progress[0][2].startswith("Téléchargement") and progress[-1][2] == "Installation"
        assert release["requested"][0].endswith(f"/repos/ggml-org/llama.cpp/releases/tags/{TAG}")
        assert not [p for p in (tmp_path / "llamacpp").iterdir() if p.name.startswith(".install-")]  # staging is gone

    def test_a_flat_archive_works_too(self, release, tmp_path):
        release["add"](self.ASSET, _tar({"llama-server": b"x", "libllama.dylib": b"y"}))
        llamacpp.install_variant("macos", "arm64", "metal")
        assert (tmp_path / "llamacpp" / "metal" / "llama-server").is_file()

    def test_the_cuda_runtime_travels_next_to_the_program(self, release, tmp_path, monkeypatch):
        monkeypatch.setattr(llamacpp, "binary_name", lambda tool=llamacpp.SERVER: f"{tool}.exe")  # a Windows install
        release["add"](f"llama-{TAG}-bin-win-cuda-12.4-x64.zip", _zip({"llama-server.exe": b"x", "ggml-cuda.dll": b"c"}))
        release["add"]("cudart-llama-bin-win-cuda-12.4-x64.zip", _zip({"cudart64_12.dll": b"r", "cublas64_12.dll": b"b",
                                                                        "README.txt": b"t"}))
        llamacpp.install_variant("windows", "x86_64", "cuda")
        target = tmp_path / "llamacpp" / "cuda"
        assert {p.name for p in target.iterdir()} == {"llama-server.exe", "ggml-cuda.dll", "cudart64_12.dll",
                                                      "cublas64_12.dll", "VERSION.json"}  # no stray files from the add-on

    def test_an_archive_without_the_program_is_refused(self, release):
        release["add"](self.ASSET, _tar({"other": b"x"}))
        with pytest.raises(RuntimeError, match="ne contient pas llama-server"):
            llamacpp.install_variant("macos", "arm64", "metal")

    def test_no_published_checksum_means_no_install(self, release, tmp_path):
        release["add"](self.ASSET, _tar({"llama-server": b"x"}), digest=None)
        with pytest.raises(RuntimeError, match="Aucune somme de contrôle"):
            llamacpp.install_variant("macos", "arm64", "metal")
        assert not (tmp_path / "llamacpp" / "metal").exists()

    def test_a_wrong_checksum_is_refused_and_leaves_what_was_installed(self, release, tmp_path):
        old = tmp_path / "llamacpp" / "metal"
        old.mkdir(parents=True)
        (old / "llama-server").write_text("old")
        release["add"](self.ASSET, _tar({"llama-server": b"x"}), digest="0" * 64)
        with pytest.raises(RuntimeError, match="Somme de contrôle invalide"):
            llamacpp.install_variant("macos", "arm64", "metal")
        assert (old / "llama-server").read_text() == "old"

    def test_an_archive_that_escapes_its_folder_is_refused(self, release, tmp_path):
        release["add"](self.ASSET, _tar({"../../evil": b"x", "llama-server": b"x"}))
        with pytest.raises(RuntimeError, match="hors du dossier cible"):
            llamacpp.install_variant("macos", "arm64", "metal")
        assert not (tmp_path / "evil").exists()

    def test_a_download_from_elsewhere_is_refused(self, release, monkeypatch):
        release["add"](self.ASSET, _tar({"llama-server": b"x"}))
        with pytest.raises(RuntimeError, match="Adresse de téléchargement inattendue"):
            REAL_DOWNLOAD("https://evil.example/x.tar.gz", Path("/tmp/never"), lambda n: None, None, llamacpp.DOWNLOAD_PREFIX)

    def test_a_pattern_that_matches_nothing_or_two_assets_is_an_error(self, release):
        release["add"](f"llama-{TAG}-bin-macos-arm64.tar.gz", _tar({"llama-server": b"x"}))
        with pytest.raises(RuntimeError, match="0 correspondance"):
            llamacpp.install_variant("windows", "x86_64", "cpu")
        with pytest.raises(RuntimeError, match="Pas de build"):
            llamacpp.install_variant("macos", "arm64", "cuda")

    def test_latest_is_asked_through_the_latest_endpoint(self, release):
        release["add"](self.ASSET, _tar({"llama-server": b"x"}))
        llamacpp.install_variant("macos", "arm64", "metal", tag="latest")
        assert release["requested"][0].endswith("/releases/latest")


def _fake_server(folder: Path, output: str = DEVICES, code: int = 0) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    binary = folder / "llama-server"
    binary.write_text(f"#!{sys.executable}\nimport sys\nif '--list-devices' in sys.argv:\n    print({output!r})\n    sys.exit({code})\n")
    binary.chmod(0o755)
    (folder / "VERSION.json").write_text(json.dumps({"tag": TAG}))
    return binary


@pytest.fixture
def machine(tmp_path, monkeypatch):
    monkeypatch.setenv("IMAGEGEN_LLAMACPP_DIR", str(tmp_path / "llamacpp"))
    monkeypatch.delenv("IMAGEGEN_LLAMACPP_VARIANT", raising=False)
    llamacpp._devices.cache_clear()
    return tmp_path / "llamacpp"


class TestEngineStatus:
    def test_nothing_installed_offers_the_install_of_the_best_build(self, machine, monkeypatch):
        monkeypatch.setattr(ei, "host_os", lambda: "macos")
        monkeypatch.setattr(llamacpp, "host_arch", lambda: "arm64")
        res = llamacpp.pick(["apple"])
        assert res["available"] is False and "pas installé" in res["reason"]
        assert res["installable"] is True and res["install_variant"] == "metal" and res["install_size_mb"] == 11

    def test_an_installed_build_is_available_with_its_devices_and_tag(self, machine):
        _fake_server(machine / "metal")
        res = llamacpp.pick(["apple"])
        assert res["available"] is True and res["variant"] == "metal" and res["tag"] == TAG
        assert res["devices"] == ["Apple M3 Max"] and res["binary"].endswith("metal/llama-server")
        assert llamacpp.build_number(Path(res["binary"])) == int(TAG[1:])

    def test_a_build_that_does_not_start_is_reported(self, machine):
        _fake_server(machine / "metal", code=3)
        res = llamacpp.pick(["apple"])
        assert res["available"] is False and "ne démarre pas" in res["reason"]

    def test_the_first_installed_build_in_preference_order_is_used_unless_one_is_forced(self, machine, monkeypatch):
        _fake_server(machine / "cpu")
        _fake_server(machine / "vulkan")
        assert llamacpp.installed_binary()[0] == "vulkan"
        monkeypatch.setenv("IMAGEGEN_LLAMACPP_VARIANT", "cpu")
        assert llamacpp.installed_binary()[0] == "cpu"

    def test_a_gpu_build_is_kept_only_if_it_sees_a_gpu(self, machine):
        cpu_only = _fake_server(machine / "cuda", output="Available devices:\n  CPU: Intel (16000 MiB, 9000 MiB free)\n")
        assert llamacpp.usable("cuda", cpu_only) is False and llamacpp.usable("cpu", cpu_only) is True
        assert llamacpp.usable("metal", _fake_server(machine / "metal")) is True
        unreadable = _fake_server(machine / "vulkan", output="something unexpected")
        assert llamacpp.usable("vulkan", unreadable) is True  # benefit of the doubt: llama.cpp falls back by itself

    def test_the_system_reports_the_engine_next_to_the_others(self, machine):
        _fake_server(machine / "metal")
        assert system._engine_llamacpp([{"vendor": "apple"}])["available"] is True


class TestInstaller:
    def test_the_first_candidate_that_works_is_kept_the_others_are_not_tried(self, machine, release, monkeypatch):
        monkeypatch.setattr(ei, "host_os", lambda: "linux")
        monkeypatch.setattr(llamacpp, "host_arch", lambda: "x86_64")
        tried = []

        def install_variant(os_name, arch, variant, **kw):
            tried.append(variant)
            _fake_server(machine / variant, output=DEVICES if variant == "vulkan" else "Available devices:\n  CPU: x (1 MiB, 1 MiB free)\n")

        monkeypatch.setattr(llamacpp, "install_variant", install_variant)
        res = llamacpp.install(["nvidia"])  # cuda sees no GPU: removed, vulkan works, cpu is never tried
        assert tried == ["cuda", "vulkan"] and res["variant"] == "vulkan"
        assert not (machine / "cuda").exists() and (machine / "vulkan" / "llama-server").is_file()
        assert any("cuda" in note for note in res["notes"])

    def test_every_failure_is_reported_when_no_build_works(self, machine, monkeypatch):
        monkeypatch.setattr(ei, "host_os", lambda: "linux")
        monkeypatch.setattr(llamacpp, "host_arch", lambda: "x86_64")
        monkeypatch.setattr(llamacpp, "install_variant", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("réseau")))
        with pytest.raises(RuntimeError, match="Aucune build de llama.cpp.*réseau"):
            llamacpp.install([])

    def test_a_cancelled_install_stops_everything(self, machine, monkeypatch):
        monkeypatch.setattr(ei, "host_os", lambda: "linux")
        monkeypatch.setattr(llamacpp, "host_arch", lambda: "x86_64")
        def cancelled(*a, **k):
            raise ei.InstallCancelled()

        monkeypatch.setattr(llamacpp, "install_variant", cancelled)
        with pytest.raises(ei.InstallCancelled):
            llamacpp.install([])

    def test_the_installer_reports_done_error_and_cancelled(self, machine, monkeypatch):
        inst = llamacpp.LlamacppInstaller()
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: {"accelerators": []})
        monkeypatch.setattr(llamacpp, "install", lambda vendors, **kw: {"variant": "metal", "notes": []})
        inst._run([], None)
        assert inst.public()["state"] == "done" and inst.public()["variant"] == "metal" and not inst.running
        monkeypatch.setattr(llamacpp, "install", lambda vendors, **kw: (_ for _ in ()).throw(RuntimeError("disque plein")))
        inst._run([], None)
        assert inst.public()["state"] == "error" and "disque plein" in inst.public()["error"]
        monkeypatch.setattr(llamacpp, "install", lambda vendors, **kw: (_ for _ in ()).throw(ei.InstallCancelled()))
        inst._run([], None)
        assert inst.public()["state"] == "cancelled"
        assert inst.cancel() is False  # nothing running

    def test_starting_refuses_a_full_disk_and_a_second_start_returns_the_running_one(self, monkeypatch):
        import asyncio

        inst = llamacpp.LlamacppInstaller()
        full = {"accelerators": [{"vendor": "apple"}], "disk": {"free_gb": 0.01}}
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: full)
        with pytest.raises(RuntimeError, match="Espace disque insuffisant"):
            asyncio.run(inst.start())
        inst.state = {"state": "running", "variant": "metal"}
        assert asyncio.run(inst.start())["state"] == "running"
