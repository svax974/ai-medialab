# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Adapter contract tests with fake upstream modules; never loads torch or model weights."""

import contextlib
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

RUNTIME = Path(__file__).resolve().parents[1] / "mesh_runtime"


@pytest.fixture
def modules(monkeypatch, tmp_path):
    """Install a fake worker package and upstream dependencies."""
    monkeypatch.syspath_prepend(str(RUNTIME))
    common = types.ModuleType("common")
    common.Cancelled = type("Cancelled", (Exception,), {})
    common.local_snapshot = lambda source: "/local/model"
    monkeypatch.setitem(sys.modules, "common", common)
    for name in ("engines", "engines.triposr", "engines.sf3d"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    torch.no_grad = contextlib.nullcontext
    torch.autocast = lambda **kwargs: contextlib.nullcontext()
    torch.bfloat16 = object()
    monkeypatch.setitem(sys.modules, "torch", torch)
    rembg = types.ModuleType("rembg")
    rembg.new_session = lambda: "session"
    monkeypatch.setitem(sys.modules, "rembg", rembg)
    image = MagicMock()
    pil = types.ModuleType("PIL")
    pil.Image = types.SimpleNamespace(open=lambda path: image, fromarray=lambda data: image)
    monkeypatch.setitem(sys.modules, "PIL", pil)
    u2net = tmp_path / "u2net.onnx"
    u2net.write_bytes(b"fixture")
    monkeypatch.setenv("U2NET_HOME", str(tmp_path))
    return image


def fake_upstream(monkeypatch, package, model_name, model):
    parent = types.ModuleType(package)
    parent.__path__ = []
    system = types.ModuleType(f"{package}.system")
    setattr(system, model_name, types.SimpleNamespace(from_pretrained=MagicMock(return_value=model)))
    utils = types.ModuleType(f"{package}.utils")
    utils.remove_background = lambda image, session: image
    utils.resize_foreground = lambda image, ratio: image
    utils.get_device = lambda: "cpu"
    monkeypatch.setitem(sys.modules, package, parent)
    monkeypatch.setitem(sys.modules, system.__name__, system)
    monkeypatch.setitem(sys.modules, utils.__name__, utils)
    return system


def test_sf3d_local_load_and_glb_export(monkeypatch, modules, tmp_path):
    model = MagicMock()
    mesh = MagicMock()
    model.run_image.return_value = (mesh, {})
    system = fake_upstream(monkeypatch, "sf3d", "SF3D", model)
    from engines.sf3d import SF3DEngine

    engine = SF3DEngine({"sources": [{"repo": "example"}]})
    engine.load()
    engine.generate({"references": ["input.png"]}, str(tmp_path / "out.glb"))
    system.SF3D.from_pretrained.assert_called_once_with("/local/model", config_name="config.yaml", weight_name="model.safetensors")
    model.run_image.assert_called_once_with([modules.convert.return_value], bake_resolution=1024, remesh="none", vertex_count=-1)
    mesh.export.assert_called_once_with(str(tmp_path / "out.glb"), file_type="glb", include_normals=True)


def test_triposr_local_load_and_vertex_colour_glb(monkeypatch, modules, tmp_path):
    model = MagicMock()
    mesh = MagicMock()
    model.extract_mesh.return_value = [mesh]
    system = fake_upstream(monkeypatch, "tsr", "TSR", model)
    numpy = types.ModuleType("numpy")
    numpy.float32, numpy.uint8 = object(), object()
    array = MagicMock()
    numpy.asarray = lambda image: array
    monkeypatch.setitem(sys.modules, "numpy", numpy)
    from engines.triposr import TripoSREngine

    engine = TripoSREngine({"sources": [{"repo": "example"}]})
    engine.load()
    engine.generate({"references": ["input.png"]}, str(tmp_path / "out.glb"))
    system.TSR.from_pretrained.assert_called_once_with("/local/model", config_name="config.yaml", weight_name="model.ckpt")
    model.extract_mesh.assert_called_once_with(model.return_value, True, resolution=256)
    mesh.export.assert_called_once_with(str(tmp_path / "out.glb"), file_type="glb")


def test_missing_u2net_refuses_without_downloading(monkeypatch, modules, tmp_path):
    fake_upstream(monkeypatch, "sf3d", "SF3D", MagicMock())
    from engines.sf3d import SF3DEngine
    monkeypatch.setenv("U2NET_HOME", str(tmp_path / "missing"))
    with pytest.raises(RuntimeError, match="u2net"):
        SF3DEngine({}).generate({"references": ["input.png"]}, str(tmp_path / "out.glb"))
