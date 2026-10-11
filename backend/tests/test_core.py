"""Tests de la logique pure : mémoire, installation des modèles, dimensions."""

import os
from pathlib import Path

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/chambre-noire-tests")

from app.engines.base import ModelSpec, installation_status  # noqa: E402
from app.media import resolve_size  # noqa: E402
from app.system import memory_plan  # noqa: E402


def machine(vram=None, ram=32.0, unified=False, backend="cuda"):
    accel = [] if vram is None and not unified else [
        {"vendor": "x", "backend": backend, "name": "gpu", "memory_gb": vram if not unified else ram, "unified": unified}
    ]
    return {"ram_gb": ram, "accelerators": accel}


class TestMemoryPlan:
    def test_everything_fits_on_big_gpu(self):
        assert memory_plan(32, 17.5, machine(vram=48, ram=64), "torch")["strategy"] == "full"

    def test_offload_when_vram_between_largest_component_and_total(self):
        p = memory_plan(32, 17.5, machine(vram=24, ram=64), "torch")
        assert p["fits"] and p["strategy"] == "model_offload"

    def test_sequential_for_small_gpu_with_enough_ram(self):
        p = memory_plan(32, 17.5, machine(vram=12, ram=64), "torch")
        assert p["fits"] and p["strategy"] == "sequential"

    def test_rejects_when_ram_too_small_for_offload(self):
        assert not memory_plan(32, 17.5, machine(vram=24, ram=16), "torch")["fits"]

    def test_no_gpu(self):
        assert not memory_plan(7, 5, machine(), "torch")["fits"]

    def test_unified_memory_needs_headroom(self):
        assert not memory_plan(31.8, 17.5, machine(ram=36, unified=True, backend="metal"), "torch")["fits"]
        assert memory_plan(7, 5.1, machine(ram=36, unified=True, backend="metal"), "torch")["fits"]

    def test_mlx_quantized_fits_36gb(self):
        assert memory_plan(31.8, 17.5, machine(ram=36, unified=True, backend="metal"), "mlx")["fits"]


class TestInstallation:
    @pytest.fixture
    def cache(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path))
        from huggingface_hub import constants

        monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path))
        return tmp_path

    def spec(self):
        return ModelSpec(
            id="t", name="t", family="t", description="", engine="x:y", hf_repo="o/m",
            hf_patterns=["model_index.json", "unet/*"], check_files=["model_index.json", "unet/*.safetensors"],
        )

    def make(self, cache: Path, files: dict[str, int]):
        snap = cache / "models--o--m" / "snapshots" / "abc"
        blobs = cache / "models--o--m" / "blobs"
        blobs.mkdir(parents=True, exist_ok=True)
        for i, (rel, size) in enumerate(files.items()):
            blob = blobs / f"blob{i}"
            blob.write_bytes(b"0" * size)
            target = snap / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(blob)

    def test_missing(self, cache):
        assert installation_status(self.spec())["state"] == "missing"

    def test_partial_when_required_files_absent(self, cache):
        self.make(cache, {"unet/w.safetensors": 10})
        assert installation_status(self.spec())["state"] == "partial"

    def test_installed(self, cache):
        self.make(cache, {"unet/w.safetensors": 10, "model_index.json": 2})
        assert installation_status(self.spec())["state"] == "installed"

    def test_stale_incomplete_files_do_not_hide_a_complete_install(self, cache):
        self.make(cache, {"unet/w.safetensors": 10, "model_index.json": 2})
        (cache / "models--o--m" / "blobs" / "xyz.incomplete").write_bytes(b"0")
        assert installation_status(self.spec())["state"] == "installed"

    def test_interrupted_download_is_partial(self, cache):
        (cache / "models--o--m" / "blobs").mkdir(parents=True)
        (cache / "models--o--m" / "blobs" / "xyz.incomplete").write_bytes(b"0")
        assert installation_status(self.spec())["state"] == "partial"


class TestSizes:
    M = dict(multiple=16, min_side=256, max_side=2048, default_megapixels=1.0, reference=None)

    def test_square_default(self):
        assert resolve_size({"aspect": "1:1"}, **self.M) == (1024, 1024)

    def test_ratio_is_kept_and_snapped(self):
        w, h = resolve_size({"aspect": "16:9", "megapixels": 1.0}, **self.M)
        assert w % 16 == 0 and h % 16 == 0 and abs(w / h - 16 / 9) < 0.03

    def test_custom_is_clamped(self):
        assert resolve_size({"aspect": "custom", "width": 9000, "height": 10}, **self.M) == (2048, 256)

    def test_max_side_respected(self):
        w, h = resolve_size({"aspect": "21:9", "megapixels": 4.0}, **self.M)
        assert max(w, h) <= 2048
