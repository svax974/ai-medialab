# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""TRELLIS offline image conditioning without a model or GPU."""
import importlib.util
import sys
import types
from pathlib import Path

import pytest


def test_local_snapshot_passes_revision_and_stays_offline(monkeypatch):
    runtime = Path(__file__).resolve().parents[1] / "mesh_runtime"
    spec = importlib.util.spec_from_file_location("mesh_common_test", runtime / "common.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = {}
    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(
        snapshot_download=lambda repo, **kwargs: (calls.update(repo=repo, **kwargs) or "snapshot")))
    assert module.local_snapshot({"repo": "bria/model", "revision": "fixed"}) == "snapshot"
    assert calls["revision"] == "fixed" and calls["local_files_only"] is True


def test_dino_load_is_local_and_rejects_unexpected_model(monkeypatch, tmp_path):
    runtime = Path(__file__).resolve().parents[1] / "mesh_runtime"
    monkeypatch.syspath_prepend(str(runtime))
    for name in ("engines", "engines.trellis_engine", "common"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    spec = importlib.util.spec_from_file_location("engines.trellis_engine", runtime / "engines" / "trellis_engine.py")
    import engines
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = {}
    model = types.SimpleNamespace(load_state_dict=lambda state: calls.update(state=state), eval=lambda: "ready")
    backbones = types.ModuleType("dinov2.hub.backbones")
    backbones.dinov2_vitl14_reg = lambda pretrained: (calls.update(pretrained=pretrained) or model)
    monkeypatch.setitem(sys.modules, "dinov2", types.ModuleType("dinov2"))
    monkeypatch.setitem(sys.modules, "dinov2.hub", types.ModuleType("dinov2.hub"))
    monkeypatch.setitem(sys.modules, "dinov2.hub.backbones", backbones)
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(load=lambda path, **kw: (calls.update(path=path, **kw) or "weights")))
    transforms = types.SimpleNamespace(Compose=lambda value: value, Normalize=lambda **kw: kw)
    monkeypatch.setitem(sys.modules, "torchvision", types.SimpleNamespace(transforms=transforms))
    monkeypatch.setenv("MESH_PACK_DIR", str(tmp_path))
    cls = type("Pipeline", (), {})
    module.TrellisEngine._offline_dino(cls)
    pipeline = cls()
    pipeline.models = {}
    pipeline._init_image_cond_model("dinov2_vitl14_reg")
    assert calls["path"] == tmp_path / "dinov2_vitl14_reg4_pretrain.pth"
    assert calls["weights_only"] is True
    assert calls["pretrained"] is False
    assert pipeline.models["image_cond_model"] == "ready"
    with pytest.raises(ValueError):
        pipeline._init_image_cond_model("unrecognised")


def test_trellis2_exports_with_bounded_settings(monkeypatch, tmp_path):
    runtime = Path(__file__).resolve().parents[1] / "mesh_runtime"
    monkeypatch.syspath_prepend(str(runtime))
    for name in ("engines", "engines.trellis_engine", "common"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    spec = importlib.util.spec_from_file_location("engines.trellis_engine", runtime / "engines" / "trellis_engine.py")
    import engines
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = {}
    mesh = types.SimpleNamespace(vertices=1, faces=2, attrs=3, coords=4, layout=5, voxel_size=6,
                                 simplify=lambda n: calls.update(simplify=n))
    class Pipeline:
        def run(self, image, **kwargs):
            calls.update(image_mode=image.mode, **kwargs)
            return [mesh]
    result = types.SimpleNamespace(export=lambda path, **kw: calls.update(path=path, **kw))
    monkeypatch.setitem(sys.modules, "o_voxel", types.SimpleNamespace(
        postprocess=types.SimpleNamespace(to_glb=lambda **kwargs: (calls.update(kwargs) or result))))
    from PIL import Image
    source = tmp_path / "in.png"
    Image.new("RGBA", (2, 2)).save(source)
    engine = module.Trellis2Engine({})
    engine.pipeline = Pipeline()
    assert engine.generate({"references": [str(source)], "seed": 9}, str(tmp_path / "x.glb")) == {}
    assert calls["pipeline_type"] == "512" and calls["seed"] == 9
    assert calls["image_mode"] == "RGBA"
    assert calls["texture_size"] == 1024 and calls["path"].endswith("x.glb")


def test_trellis_image_preserves_alpha(monkeypatch, tmp_path):
    runtime = Path(__file__).resolve().parents[1] / "mesh_runtime"
    monkeypatch.syspath_prepend(str(runtime))
    for name in ("engines", "engines.trellis_engine", "common"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    spec = importlib.util.spec_from_file_location("engines.trellis_engine", runtime / "engines" / "trellis_engine.py")
    import engines
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = {}
    class Pipeline:
        def run(self, image, **kwargs):
            calls["mode"] = image.mode
            return {"gaussian": [1], "mesh": [2]}
    result = types.SimpleNamespace(export=lambda path: None)
    utils = types.ModuleType("trellis.utils")
    utils.postprocessing_utils = types.SimpleNamespace(to_glb=lambda *args, **kwargs: result)
    monkeypatch.setitem(sys.modules, "trellis", types.ModuleType("trellis"))
    monkeypatch.setitem(sys.modules, "trellis.utils", utils)
    from PIL import Image
    source = tmp_path / "in.png"
    Image.new("RGBA", (2, 2)).save(source)
    engine = module.TrellisEngine({"image": True})
    engine.pipeline = Pipeline()
    engine.generate({"references": [str(source)], "seed": 9}, str(tmp_path / "x.glb"))
    assert calls["mode"] == "RGBA"


def test_trellis2_loads_background_from_pinned_snapshot(monkeypatch):
    runtime = Path(__file__).resolve().parents[1] / "mesh_runtime"
    monkeypatch.syspath_prepend(str(runtime))
    for name in ("engines", "engines.trellis_engine", "common"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    spec = importlib.util.spec_from_file_location("engines.trellis_engine", runtime / "engines" / "trellis_engine.py")
    import engines
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = {}
    class Background:
        def __init__(self, model_name):
            calls["background"] = model_name
    original = Background.__init__
    class Pipeline:
        @classmethod
        def from_pretrained(cls, path):
            Background("briaai/RMBG-2.0")
            calls["pipeline"] = path
            return cls()
        def cuda(self):
            pass
    pipelines = types.ModuleType("trellis2.pipelines")
    pipelines.Trellis2ImageTo3DPipeline = Pipeline
    rembg = types.ModuleType("trellis2.pipelines.rembg")
    rembg.BiRefNet = Background
    monkeypatch.setitem(sys.modules, "trellis2", types.ModuleType("trellis2"))
    monkeypatch.setitem(sys.modules, "trellis2.pipelines", pipelines)
    monkeypatch.setitem(sys.modules, "trellis2.pipelines.rembg", rembg)
    monkeypatch.setattr(module, "require_cuda", lambda: None)
    monkeypatch.setattr(module, "local_snapshot", lambda source: source["path"])
    engine = module.Trellis2Engine({"sources": [{"path": "pipeline"}, {}, {}, {"path": "pinned"}]})
    engine.load()
    assert calls == {"background": "pinned", "pipeline": "pipeline"}
    assert Background.__init__ is original


def test_triposg_uses_staged_sources_and_image(monkeypatch, tmp_path):
    import numpy as np
    runtime = Path(__file__).resolve().parents[1] / "mesh_runtime"
    monkeypatch.syspath_prepend(str(runtime))
    for name in ("engines", "engines.triposg_engine", "common"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    spec = importlib.util.spec_from_file_location("engines.triposg_engine", runtime / "engines" / "triposg_engine.py")
    import engines
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = {}
    class Pipeline:
        device = "cuda:0"
        @classmethod
        def from_pretrained(cls, path):
            calls["pipeline_path"] = path
            return cls()
        def to(self, *args):
            return self
        def __call__(self, **kwargs):
            calls.update(kwargs)
            return types.SimpleNamespace(samples=[(np.array([[1., 2., 3.]]), np.array([[0, 0, 0]]))])
    class Background:
        @classmethod
        def from_pretrained(cls, path):
            calls["background_path"] = path
            return cls()
        def to(self, device):
            return self
        def eval(self):
            return self
    class Generator:
        def __init__(self, device):
            pass
        def manual_seed(self, seed):
            calls["seed"] = seed
            return self
    from contextlib import nullcontext
    fake_torch = types.SimpleNamespace(float16="fp16", Generator=Generator, no_grad=nullcontext)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "triposg", types.ModuleType("triposg"))
    monkeypatch.setitem(sys.modules, "triposg.pipelines", types.ModuleType("triposg.pipelines"))
    pipeline_module = types.ModuleType("triposg.pipelines.pipeline_triposg")
    pipeline_module.TripoSGPipeline = Pipeline
    monkeypatch.setitem(sys.modules, pipeline_module.__name__, pipeline_module)
    monkeypatch.setitem(sys.modules, "briarmbg", types.SimpleNamespace(BriaRMBG=Background))
    monkeypatch.setitem(sys.modules, "image_process", types.SimpleNamespace(prepare_image=lambda path, **kw: "prepared"))
    monkeypatch.setitem(sys.modules, "trimesh", types.SimpleNamespace(Trimesh=lambda *a: types.SimpleNamespace(
        export=lambda path: calls.update(output=path))))
    monkeypatch.setattr(module, "require_cuda", lambda: "cuda:0")
    monkeypatch.setattr(module, "local_snapshot", lambda source: source["repo"])
    engine = module.TripoSGEngine({"sources": [{"repo": "model"}, {"repo": "background"}]})
    engine.load()
    engine.generate({"references": ["image.png"], "seed": 7, "steps": 50, "guidance": 7}, str(tmp_path / "x.glb"))
    assert (calls["pipeline_path"], calls["background_path"]) == ("model", "background")
    assert calls["image"] == "prepared" and calls["seed"] == 7 and calls["output"].endswith("x.glb")
