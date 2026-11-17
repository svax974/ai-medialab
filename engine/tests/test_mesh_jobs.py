# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Mesh planning and output contract without loading model runtimes."""
import pytest

from app.job_checks import check_generation
from app.job_outputs import describe_output
from app.job_plans import JobRequest, build_plan


def test_text_mesh_plan_and_output(tmp_path):
    job = JobRequest(job_id="m1", model_id="shap-e-text", prompt="a chair", params={"seeds": [42]},
                     output_dir=str(tmp_path))
    assert check_generation(job.model_id, [], job.prompt)["max_count"] == 1
    plan = build_plan(job)
    assert plan["items"][0]["output"].endswith("m1_0.glb")
    assert plan["params"]["task"] == "t2m"
    import json
    import struct

    data = json.dumps({"asset": {"version": "2.0"}}).encode()
    data += b" " * (-len(data) % 4)
    path = tmp_path / "m1_0.glb"
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(data)) + struct.pack("<I4s", len(data), b"JSON") + data)
    output = describe_output(plan, {"type": "mesh", "path": plan["items"][0]["output"], "index": 0, "seed": 42})
    assert output["media"] == "mesh"
    assert output["thumb"] is None
    assert output["meta"]["task"] == "t2m"


def test_image_mesh_requires_one_reference(tmp_path):
    with pytest.raises(ValueError):
        check_generation("shap-e-image", [], "")
    source = tmp_path / "image.png"
    source.write_bytes(b"test")
    job = JobRequest(job_id="m2", model_id="shap-e-image", prompt="", params={}, inputs=[str(source)],
                     output_dir=str(tmp_path))
    plan = build_plan(job)
    assert plan["params"]["task"] == "i2m"
    assert plan["items"][0]["request"]["references"] == [str(source)]
    with pytest.raises(ValueError):
        check_generation("shap-e-text", ["image"], "chair")


def test_glb_rejects_external_resources(tmp_path):
    import json
    import struct
    from app.mesh_validation import validate_glb

    data = json.dumps({"asset": {"version": "2.0"}, "images": [{"uri": "https://example.org/x"}]}).encode()
    data += b" " * (-len(data) % 4)
    path = tmp_path / "bad.glb"
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(data)) + struct.pack("<I4s", len(data), b"JSON") + data)
    with pytest.raises(ValueError):
        validate_glb(path)


def test_shap_e_pipeline_receives_text_and_seed(monkeypatch):
    import sys
    import types
    from app.engines.mesh_engine import ShapEEngine
    from app.engines.mesh_specs import SPECS
    from app.engines.base import GenerationRequest, Hooks

    calls = {}

    class Generator:
        def __init__(self, device):
            calls["generator_device"] = device

        def manual_seed(self, seed):
            calls["seed"] = seed
            return self

    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(Generator=Generator))
    engine = ShapEEngine(SPECS[0], None)

    def pipe(condition, **kwargs):
        calls["condition"] = condition
        calls.update(kwargs)
        return types.SimpleNamespace(images=["mesh"])

    engine.pipe = pipe
    req = GenerationRequest(prompt="a chair", width=256, height=256, steps=10, seed=123, guidance=15)
    hooks = Hooks(lambda *_: None, lambda *_: None, lambda: False)
    assert engine.generate(req, hooks) == "mesh"
    assert calls["condition"] == "a chair"
    assert calls["output_type"] == "mesh"
    assert calls["seed"] == 123


@pytest.mark.parametrize("contents", [b"", b"not a glb", b"glTF" + b"\0" * 16])
def test_glb_rejects_invalid_headers(tmp_path, contents):
    from app.mesh_validation import validate_glb

    path = tmp_path / "invalid.glb"
    path.write_bytes(contents)
    with pytest.raises(ValueError):
        validate_glb(path)


def test_shap_e_save_uses_glb_export(monkeypatch, tmp_path):
    import sys
    import types
    from app.engines.mesh_engine import ShapEEngine
    from app.engines.mesh_specs import SPECS

    calls = {}
    diffusers = types.ModuleType("diffusers")
    utils = types.ModuleType("diffusers.utils")
    utils.export_to_ply = lambda result, path: calls.update(result=result, ply=path)
    diffusers.utils = utils
    monkeypatch.setitem(sys.modules, "diffusers", diffusers)
    monkeypatch.setitem(sys.modules, "diffusers.utils", utils)
    mesh = types.SimpleNamespace(export=lambda path, file_type: calls.update(path=path, file_type=file_type))
    monkeypatch.setitem(sys.modules, "trimesh", types.SimpleNamespace(load=lambda path: mesh))
    ShapEEngine(SPECS[0], None).save("mesh", tmp_path / "result.glb")
    assert calls["result"] == "mesh"
    assert calls["file_type"] == "glb"
    assert calls["path"].endswith("result.glb")


def test_mesh_pack_sources_are_fixed_and_offline(monkeypatch, tmp_path):
    from app import audio_packs

    monkeypatch.setattr(audio_packs, "FAMILY_DIRS", {**audio_packs.FAMILY_DIRS, "mesh": tmp_path})
    for name in ("triposr", "sf3d"):
        pack = audio_packs.PACKS[name]
        assert pack.family == "mesh"
        assert all("/main/" not in archive.url for archive in pack.archives)
        assert audio_packs.pack_env(name)["HF_HUB_OFFLINE"] == "1"
        assert audio_packs.pack_env(name)["U2NET_HOME"] == str(tmp_path / name / "u2net")
        assert pack.auxiliary_files[0][2] == "60024c5c889badc19c04ad937298a77b"
