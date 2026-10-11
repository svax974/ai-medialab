"""Suppression de modèles dans le cache Hugging Face (magasin global dédupliqué de huggingface_hub ≥ 1.0)."""

import os
from pathlib import Path

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/chambre-noire-tests")

from app.downloads import _delete_source  # noqa: E402
from app.engines.base import HfSource, ModelSpec, installation_status  # noqa: E402


@pytest.fixture
def hub(tmp_path, monkeypatch):
    from huggingface_hub import constants

    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path))
    return tmp_path


def make_repo(hub: Path, repo: str, files: dict[str, bytes]) -> None:
    """Disposition réelle : hub/blobs/<xx>/<hash> (données) <- repo/blobs/<hash> <- repo/snapshots/<rev>/<fichier>."""
    root = hub / f"models--{repo.replace('/', '--')}"
    snap = root / "snapshots" / "rev"
    (root / "blobs").mkdir(parents=True, exist_ok=True)
    for i, (name, data) in enumerate(files.items()):
        digest = f"{i:02d}{abs(hash((repo, name))):038d}"
        store = hub / "blobs" / digest[:2]
        store.mkdir(parents=True, exist_ok=True)
        (store / digest).write_bytes(data)
        link = root / "blobs" / digest
        os.symlink(os.path.relpath(store / digest, link.parent), link)
        target = snap / name
        target.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(os.path.relpath(link, target.parent), target)


def spec_of(*sources: HfSource) -> ModelSpec:
    return ModelSpec(id="m", name="m", family="f", description="", engine="x:y", sources=list(sources))


def stored_files(hub: Path) -> list[str]:
    return sorted(p.name for p in (hub / "blobs").rglob("*") if p.is_file())


def test_deleting_a_whole_repo_frees_the_shared_store(hub):
    make_repo(hub, "a/one", {"x.gguf": b"0" * 1000, "y.gguf": b"1" * 2000})
    freed = _delete_source(HfSource("a/one", ["*.gguf"], ["x.gguf"]), keep=[])
    assert freed == 3000
    assert stored_files(hub) == []
    assert installation_status(spec_of(HfSource("a/one", ["x.gguf"], ["x.gguf"])))["state"] == "missing"


def test_files_needed_by_another_model_are_kept(hub):
    make_repo(hub, "a/one", {"x.gguf": b"0" * 1000, "y.gguf": b"1" * 2000})
    x, y = HfSource("a/one", ["x.gguf"], ["x.gguf"]), HfSource("a/one", ["y.gguf"], ["y.gguf"])
    assert _delete_source(x, keep=[y]) == 1000
    assert installation_status(spec_of(y))["state"] == "installed"
    assert installation_status(spec_of(x))["state"] == "missing"
    assert len(stored_files(hub)) == 1


def test_data_still_linked_from_another_repo_is_not_deleted(hub):
    make_repo(hub, "a/one", {"x.gguf": b"0" * 1000})
    # même contenu référencé depuis un autre dépôt (déduplication)
    other = hub / "models--b--two" / "snapshots" / "rev"
    other.mkdir(parents=True)
    shared = next(p for p in (hub / "blobs").rglob("*") if p.is_file())
    os.symlink(os.path.relpath(shared, other), other / "copy.gguf")
    _delete_source(HfSource("a/one", ["x.gguf"], ["x.gguf"]), keep=[])
    assert len(stored_files(hub)) == 1


def test_multi_source_model_needs_every_source(hub):
    make_repo(hub, "a/one", {"x.gguf": b"0"})
    a, b = HfSource("a/one", ["x.gguf"], ["x.gguf"]), HfSource("b/two", ["v.safetensors"], ["v.safetensors"])
    assert installation_status(spec_of(a, b))["state"] == "partial"
    make_repo(hub, "b/two", {"v.safetensors": b"1"})
    assert installation_status(spec_of(a, b))["state"] == "installed"
