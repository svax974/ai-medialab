# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""GGUF engine install: build selection, asset patterns, checksum verification and safe extraction."""

import hashlib
import io
import os
import re
import zipfile

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import engine_install as ei  # noqa: E402

# Real asset names from the master-956 release (taken from GitHub).
REAL_ASSETS = [
    "cudart-sd-bin-win-cu12-x64.zip",
    "sd-master-1b0ba10-bin-Darwin-macOS-26.6.2-arm64.zip",
    "sd-master-1b0ba10-bin-Linux-Ubuntu-24.04-x86_64-rocm-10.1.0.zip",
    "sd-master-1b0ba10-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip",
    "sd-master-1b0ba10-bin-Linux-Ubuntu-24.04-x86_64.zip",
    "sd-master-1b0ba10-bin-win-cpu-x64.zip",
    "sd-master-1b0ba10-bin-win-cuda12-x64.zip",
    "sd-master-1b0ba10-bin-win-rocm-10.1.0-x64.zip",
    "sd-master-1b0ba10-bin-win-vulkan-x64.zip",
]


class TestChoice:
    def test_nvidia_on_windows_prefers_cuda_then_vulkan(self):
        assert ei.candidate_variants(["nvidia"], "windows") == ["cuda", "vulkan"]

    def test_amd_on_windows_prefers_rocm_then_vulkan(self):
        assert ei.candidate_variants(["amd"], "windows") == ["rocm", "vulkan"]

    def test_apple_gets_metal_only(self):
        assert ei.candidate_variants(["apple"], "macos") == ["metal"]

    def test_unknown_gpu_gets_vulkan(self):
        assert ei.candidate_variants([], "windows") == ["vulkan"]
        assert ei.candidate_variants(["other"], "linux") == ["vulkan"]

    def test_nvidia_on_linux_falls_back_to_vulkan_since_no_cuda_build_is_published(self):
        assert ei.candidate_variants(["nvidia"], "linux") == ["vulkan"]

    def test_every_variant_pattern_matches_exactly_one_real_asset(self):
        for (os_name, variant), patterns in ei.ASSETS.items():
            for pat in patterns:
                hits = [a for a in REAL_ASSETS if re.search(pat, a)]
                assert len(hits) == 1, (os_name, variant, pat, hits)


def make_zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def fake_release(monkeypatch):
    """Fake the network: a release whose only asset is a small archive."""

    def setup(archive: bytes, digest: str | None, name="sd-master-x-bin-win-vulkan-x64.zip"):
        monkeypatch.setattr(ei, "_http_json", lambda url: {"tag_name": "master-1", "assets": [{
            "name": name, "size": len(archive), "digest": digest,
            "browser_download_url": ei.DOWNLOAD_PREFIX + "master-1/" + name}]})

        def fake_download(url, dest, on_bytes, cancel):
            if cancel is not None and cancel.is_set():
                raise ei.InstallCancelled()
            dest.write_bytes(archive)
            on_bytes(len(archive))
            return hashlib.sha256(archive).hexdigest()

        monkeypatch.setattr(ei, "_download", fake_download)
        return archive

    return setup


def test_install_verifies_extracts_and_marks_executable(tmp_path, fake_release):
    archive = fake_release(make_zip({"sd-cli": b"binaire", "lib.dll": b"x"}), None)
    digest = "sha256:" + hashlib.sha256(archive).hexdigest()
    fake_release(archive, digest)
    meta = ei.install_variant("windows", "vulkan", tmp_path)
    assert meta["tag"] == "master-1"
    assert (tmp_path / "vulkan" / "sd-cli").read_bytes() == b"binaire"
    assert os.access(tmp_path / "vulkan" / "sd-cli", os.X_OK)
    assert (tmp_path / "vulkan" / "VERSION.json").is_file()
    assert [p.name for p in tmp_path.iterdir()] == ["vulkan"]  # no download leftovers


def test_install_refuses_a_wrong_checksum(tmp_path, fake_release):
    fake_release(make_zip({"sd-cli": b"x"}), "sha256:" + "0" * 64)
    with pytest.raises(RuntimeError, match="Somme de contrôle invalide"):
        ei.install_variant("windows", "vulkan", tmp_path)
    assert not (tmp_path / "vulkan").exists()


def test_install_refuses_an_archive_without_published_checksum(tmp_path, fake_release):
    fake_release(make_zip({"sd-cli": b"x"}), None)
    with pytest.raises(RuntimeError, match="Aucune somme de contrôle"):
        ei.install_variant("windows", "vulkan", tmp_path)


def test_install_refuses_an_unexpected_download_host(tmp_path, monkeypatch):
    with pytest.raises(RuntimeError, match="inattendue"):
        ei._download("https://example.com/x.zip", tmp_path / "x.zip", lambda n: None, None)


def test_zip_slip_is_rejected(tmp_path):
    evil = make_zip({"../evil.txt": b"x"})
    with zipfile.ZipFile(io.BytesIO(evil)) as zf, pytest.raises(RuntimeError, match="hors du dossier"):
        ei.safe_extract(zf, tmp_path / "out")
    assert not (tmp_path / "evil.txt").exists()


def test_cancel_stops_and_leaves_nothing_behind(tmp_path, fake_release):
    import threading

    archive = fake_release(make_zip({"sd-cli": b"x"}), None)
    fake_release(archive, "sha256:" + hashlib.sha256(archive).hexdigest())
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(ei.InstallCancelled):
        ei.install_variant("windows", "vulkan", tmp_path, cancel=cancel)
    assert list(tmp_path.iterdir()) == []
