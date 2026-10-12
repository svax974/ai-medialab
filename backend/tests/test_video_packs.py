# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video packs (Kiwi-Edit, Bernini): specs, pack definitions, hardware gating, worker protocol with a stub engine.

Nothing here installs a pack, downloads weights or touches a GPU."""

import asyncio
import hashlib
import importlib.util
import io
import json
import os
import py_compile
import shutil
import sys
import tarfile
import types
from pathlib import Path

import numpy as np
import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import audio_packs, db  # noqa: E402
from app.audio_packs import PackArchive, PackInstaller  # noqa: E402
from app.engines import MODELS, get_spec, video_specs  # noqa: E402

RUNTIME = Path(__file__).resolve().parents[1] / "video_runtime"

MAC = {"os": "Darwin", "arch": "arm64", "ram_gb": 64.0, "accelerators": [{"vendor": "apple", "backend": "metal", "memory_gb": 64.0}],
       "unusable_gpus": [], "engines": {}}
NVIDIA = {"os": "Linux", "arch": "x86_64", "ram_gb": 64.0, "unusable_gpus": [],
          "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 24.0}], "engines": {}}


def _load(name: str, path: Path):
    """Import a video_runtime module under its own name (the audio runtime also has a `common.py`)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()


class TestSpecs:
    def test_pack_specs_are_consistent(self):
        assert [s.id for s in video_specs.PACK_SPECS] == ["kiwi-edit-5b", "bernini-r-1.3b"]
        for spec in video_specs.PACK_SPECS:
            assert MODELS[spec.id] is spec and spec.kind == "video" and spec.backend == "pack"
            pack = audio_packs.PACKS[spec.options["pack"]]
            assert pack.family == "video" and pack.gpu == "cuda" and pack.python in ("3.10", "3.11")
            module, cls = spec.engine.split(":")
            assert (RUNTIME / "engines" / f"{module}.py").is_file() and cls
            assert spec.weights_gb and spec.largest_component_gb and spec.download_size_gb and spec.memory_hint
            assert spec.license and spec.all_sources() and spec.sources[0].check_files
            assert spec.options["min_vram_gb"] and spec.options["min_ram_gb"]
            assert spec.description.endswith(".") and "\n" not in spec.description

    def test_descriptions_and_inputs(self):
        kiwi, bernini = get_spec("kiwi-edit-5b"), get_spec("bernini-r-1.3b")
        assert kiwi.description == "Édition de vidéo par instruction, avec image de référence optionnelle."
        assert bernini.description == "Génération et édition de vidéo guidées par un planificateur multimodal."
        assert kiwi.video.video_input == "required" and kiwi.video.tasks == ["v2v"]
        assert kiwi.video.image_input == "optional" and kiwi.video.image_role == "reference"
        assert kiwi.video.license_warning and "Qwen" in kiwi.video.license_warning
        assert "t2v" in bernini.video.tasks and bernini.video.video_input == "optional"
        assert round(kiwi.download_size_gb, 1) == 20.4 and round(bernini.download_size_gb, 1) == 28.9

    def test_public_serialization(self):
        d = get_spec("kiwi-edit-5b").to_public()
        assert d["video"]["image_role"] == "reference" and "options" not in d

    def test_runtime_files_compile(self, tmp_path):
        for f in [RUNTIME / "worker.py", RUNTIME / "common.py", *(RUNTIME / "engines").glob("*.py")]:
            py_compile.compile(str(f), cfile=str(tmp_path / (f.name + "c")), doraise=True)


class TestPackDefinitions:
    def test_pins(self):
        kiwi, bernini = audio_packs.PACKS["kiwi"], audio_packs.PACKS["bernini"]
        assert "transformers==4.57.0" in kiwi.requirements and "torch==2.7.0" in kiwi.torch_packages
        assert "transformers==4.57.3" in bernini.requirements and "diffusers==0.35.2" in bernini.requirements
        (archive,) = bernini.archives
        assert archive.url.endswith("e6c2cf11843470b08491745947abcba9c3c6b079.tar.gz") and archive.folders == ("bernini",)

    def test_hash_depends_on_python_and_archive(self):
        import dataclasses

        bernini = audio_packs.PACKS["bernini"]
        base = audio_packs._requirements_hash(bernini)
        assert audio_packs._requirements_hash(dataclasses.replace(bernini, python="3.12")) != base
        assert audio_packs._requirements_hash(dataclasses.replace(bernini, archives=())) != base
        assert audio_packs._requirements_hash(audio_packs.PACKS["kiwi"]) != base

    def test_audio_pack_hash_is_unchanged(self):
        # Installed audio packs must stay valid: same formula as before the video packs existed.
        pack = audio_packs.PACKS["qwen3"]
        old = hashlib.sha256(json.dumps(["3.12", *audio_packs.requirements_for(pack), *pack.torch_packages]).encode()).hexdigest()[:16]
        assert audio_packs._requirements_hash(pack) == old

    def test_folders_follow_the_family(self):
        assert audio_packs.pack_dir("kiwi").parent.name == "video" and audio_packs.pack_dir("speech").parent.name == "audio"
        assert audio_packs.runtime_dir("kiwi").name == "video_runtime" and audio_packs.runtime_dir().name == "audio_runtime"
        assert audio_packs.runtime_dir("qwen3").name == "audio_runtime"

    def test_not_installed_here(self):
        assert not audio_packs.is_installed("kiwi") and not audio_packs.is_installed("bernini")


class TestHardwareGate:
    def test_mac_is_refused_with_a_french_reason(self):
        for pid in ("kiwi", "bernini"):
            reason = audio_packs.unsupported_reason(audio_packs.PACKS[pid], MAC)
            assert reason and "NVIDIA" in reason and "Mac" in reason

    def test_cuda_and_linux_rocm_are_accepted(self):
        kiwi = audio_packs.PACKS["kiwi"]
        assert audio_packs.unsupported_reason(kiwi, NVIDIA) is None
        assert audio_packs.unsupported_reason(kiwi, {**NVIDIA, "accelerators": [{"vendor": "amd", "backend": "rocm"}]}) is None
        assert audio_packs.unsupported_reason(kiwi, {**NVIDIA, "os": "Windows", "accelerators": [{"vendor": "amd", "backend": "cuda"}]})

    def test_gpu_the_main_runtime_cannot_use_still_counts(self):
        # The pack ships its own PyTorch: an NVIDIA card seen by the OS is enough.
        system = {**MAC, "os": "Windows", "accelerators": [], "unusable_gpus": [{"vendor": "nvidia", "name": "RTX"}]}
        assert audio_packs.unsupported_reason(audio_packs.PACKS["kiwi"], system) is None

    def test_audio_packs_have_no_gpu_requirement(self):
        assert audio_packs.unsupported_reason(audio_packs.PACKS["speech"], MAC) is None

    def test_engine_info_on_mac_offers_no_install(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC)
        info = audio_packs.engine_info("kiwi")
        assert info["available"] is False and not info.get("installable") and "NVIDIA" in info["reason"]
        assert info["pack_name"] and info["pack_contents"]

    def test_engine_info_on_nvidia_needs_uv_or_the_right_python(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: NVIDIA)
        monkeypatch.setattr(audio_packs, "find_uv", lambda: None)
        monkeypatch.setattr(sys, "version_info", types.SimpleNamespace(major=3, minor=14))
        info = audio_packs.engine_info("bernini")
        assert not info.get("installable") and "uv" in info["reason"] and "3.11" in info["reason"]
        monkeypatch.setattr(audio_packs, "find_uv", lambda: "/usr/bin/uv")
        info = audio_packs.engine_info("bernini")
        assert info["installable"] is True and info["install_size_mb"] == audio_packs.PACKS["bernini"].size_mb

    def test_install_is_refused_on_mac(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC)
        with pytest.raises(RuntimeError, match="NVIDIA"):
            asyncio.run(PackInstaller().start("kiwi"))

    def test_catalog_marks_them_incompatible_but_lists_them(self, monkeypatch, database):
        from app import catalog

        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC)
        monkeypatch.setattr(catalog, "get_system", lambda refresh=False: MAC)
        models = {m["id"]: m for m in catalog.describe_models()["models"]}
        for mid in ("kiwi-edit-5b", "bernini-r-1.3b"):
            m = models[mid]
            assert m["compatible"] is False and m["ready"] is False and "NVIDIA" in m["engine_reason"]
            assert m["engine_pack"] in ("kiwi", "bernini") and m["description"]

    def test_video_plan_checks_memory(self):
        from app import catalog

        kiwi = get_spec("kiwi-edit-5b")
        small = {**NVIDIA, "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 12.0}]}
        assert catalog._pack_plan(kiwi, small)["fits"] is False
        assert catalog._pack_plan(kiwi, NVIDIA)["fits"] is True
        assert catalog._pack_plan(kiwi, {**NVIDIA, "ram_gb": 16.0})["fits"] is False
        unknown = {**NVIDIA, "accelerators": [{"vendor": "nvidia", "backend": "vulkan", "memory_gb": None}]}
        plan = catalog._pack_plan(kiwi, unknown)
        assert plan["fits"] is True and "non détectée" in plan["note"]


class TestArchive:
    def _tarball(self, tmp_path):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            def add(name, data=b"x"):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

            add("Bernini-abc/bernini/__init__.py", b"ok")
            add("Bernini-abc/bernini/models/m.py")
            add("Bernini-abc/assets/huge.png")
            add("Bernini-abc/bernini/../../escape.py")
            link = tarfile.TarInfo("Bernini-abc/bernini/link")
            link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tar.addfile(link)
        path = tmp_path / "src.tar.gz"
        path.write_bytes(buf.getvalue())
        return path

    def test_only_wanted_regular_files_are_extracted(self, tmp_path):
        tarball = self._tarball(tmp_path)
        dest = tmp_path / "src"
        PackInstaller()._fetch_archive(PackArchive(tarball.as_uri(), ("bernini",)), dest)
        found = sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file())
        assert found == ["bernini/__init__.py", "bernini/models/m.py"]
        assert not (tmp_path / "escape.py").exists()

    def test_missing_folder_is_an_error(self, tmp_path):
        with pytest.raises(RuntimeError, match="dossiers attendus"):
            PackInstaller()._fetch_archive(PackArchive(self._tarball(tmp_path).as_uri(), ("nothing",)), tmp_path / "d")

    def test_worker_env_exposes_the_extracted_code(self, tmp_path, monkeypatch):
        monkeypatch.setattr(audio_packs, "pack_dir", lambda pid: tmp_path / pid)
        assert audio_packs.pack_env("bernini") == {}
        (tmp_path / "bernini" / "src").mkdir(parents=True)
        assert audio_packs.pack_env("bernini") == {"PYTHONPATH": str(tmp_path / "bernini" / "src")}


class TestPlans:
    def _plan(self, model_id, refs):
        from app.config import UPLOADS_DIR
        from app.jobs import JobManager

        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        with db.connect() as conn:
            conn.execute("INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES ('c', 't', 'video', 0, 0)")
            conn.execute("INSERT INTO messages (id, conversation_id, role, prompt, created_at) VALUES ('u', 'c', 'user', 'p', 0)")
            for pos, (media, name) in enumerate(refs):
                aid = db.new_id()
                conn.execute("INSERT INTO assets (id, kind, media, filename, created_at) VALUES (?, 'upload', ?, ?, ?)",
                             (aid, media, name, db.now()))
                conn.execute("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('u', ?, ?)", (aid, pos))
        msg = {"id": "m", "conversation_id": "c", "parent_id": "u", "prompt": "make it snow", "model_id": model_id,
               "params": {"seeds": [3]}}
        return JobManager()._build_video_plan(msg, get_spec(model_id))

    def test_kiwi_keeps_the_reference_image_next_to_the_video(self, database):
        from PIL import Image

        from app.config import UPLOADS_DIR
        from app.media import encode_mp4

        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, UPLOADS_DIR / "k_src.mp4")
        Image.new("RGB", (32, 32)).save(UPLOADS_DIR / "k_ref.png")
        plan = self._plan("kiwi-edit-5b", [("video", "k_src.mp4"), ("image", "k_ref.png")])
        req = plan["items"][0]["request"]
        assert plan["params"]["task"] == "v2v" and req["extra"]["video"].endswith("k_src.mp4")
        assert [Path(r).name for r in req["references"]] == ["k_ref.png"]
        assert plan["params"]["fps"] == 15 and (plan["params"]["frames"] - 1) % 4 == 0
        assert plan["params"]["width"] % 32 == 0 and plan["params"]["height"] % 32 == 0

    def test_kiwi_needs_a_source_video(self, database):
        with pytest.raises(ValueError, match="vidéo source"):
            self._plan("kiwi-edit-5b", [])

    def test_models_that_take_no_reference_still_drop_images_when_editing(self, database):
        from PIL import Image

        from app.config import UPLOADS_DIR
        from app.media import encode_mp4

        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, UPLOADS_DIR / "c_src.mp4")
        Image.new("RGB", (32, 32)).save(UPLOADS_DIR / "c_ref.png")
        plan = self._plan("cogvideox-2b", [("video", "c_src.mp4"), ("image", "c_ref.png")])
        assert plan["items"][0]["request"]["references"] == []


class TestVideoWorkerProtocol:
    """The real worker script and `AudioWorkerHandle`, with a stub engine instead of a model."""

    STUB = '''
import time
from . import Engine
from common import Cancelled, write_mp4
import numpy as np


class Stub(Engine):
    def load(self):
        if self.options.get("fail"):
            raise RuntimeError("Aucune carte graphique")

    def generate(self, req, output):
        total = int(req["steps"])
        for i in range(total):
            if self.cancelled():
                raise Cancelled()
            time.sleep(self.options.get("delay", 0))
            self.on_step(i + 1, total)
        if req["prompt"] == "boom":
            raise ValueError("kaboom")
        frames = np.full((5, 16, 32, 3), 40, np.uint8)
        return write_mp4(frames, 8, output)
'''

    @pytest.fixture
    def runtime(self, tmp_path, monkeypatch):
        rt = tmp_path / "video_runtime"
        (rt / "engines").mkdir(parents=True)
        for f in ("worker.py", "common.py"):
            shutil.copy(RUNTIME / f, rt / f)
        shutil.copy(RUNTIME / "engines" / "__init__.py", rt / "engines" / "__init__.py")
        (rt / "engines" / "stub.py").write_text(self.STUB)
        monkeypatch.setattr(audio_packs, "runtime_dir", lambda pack_id=None: rt)
        monkeypatch.setattr(audio_packs, "venv_python", lambda pack_id: Path(sys.executable))
        return rt

    def _run(self, options, items, cancel_after_steps=None):
        from app.audio_worker import AudioWorkerHandle

        cancel_at = cancel_after_steps

        async def go():
            nonlocal cancel_at
            handle = AudioWorkerHandle("m", "kiwi", "stub:Stub", options, asyncio.get_running_loop())
            events = []

            async def next_event():
                return await asyncio.wait_for(handle.events.get(), 60)

            try:
                while True:
                    evt = await next_event()
                    events.append(evt)
                    if evt["type"] in ("ready", "load_error", "exit"):
                        break
                if events[-1]["type"] == "ready":
                    handle.send({"type": "generate", "job_id": "j", "items": items})
                    steps = 0
                    while True:
                        evt = await next_event()
                        events.append(evt)
                        steps += evt["type"] == "step"
                        if cancel_at and steps == cancel_at:
                            handle.cancel_event.set()
                            cancel_at = None
                        if evt["type"] in ("done", "cancelled", "error", "exit"):
                            break
            finally:
                await handle.stop()
            return events

        return asyncio.run(go())

    def _item(self, tmp_path, name="a", prompt="hello", steps=3):
        req = {"prompt": prompt, "width": 32, "height": 16, "steps": steps, "seed": 7, "references": [],
               "extra": {"task": "t2v", "frames": 5, "fps": 8, "video": None}}
        return {"request": req, "output": str(tmp_path / f"{name}.mp4")}

    def test_round_trip(self, runtime, tmp_path):
        events = self._run({}, [self._item(tmp_path, "a"), self._item(tmp_path, "b", steps=2)])
        kinds = [e["type"] for e in events]
        assert kinds[:2] == ["loading", "ready"] and kinds[-1] == "done"
        assert kinds.count("item_start") == 2 and kinds.count("step") == 5 and kinds.count("video") == 2
        video = next(e for e in events if e["type"] == "video")
        assert video["index"] == 0 and video["seed"] == 7 and video["frames"] == 5 and video["fps"] == 8
        assert (video["width"], video["height"], video["has_audio"]) == (32, 16, False)
        assert Path(video["path"]).stat().st_size > 0
        step = next(e for e in events if e["type"] == "step")
        assert (step["step"], step["total"]) == (1, 3)

    def test_output_is_readable_by_the_app(self, runtime, tmp_path):
        from app.media import probe_video

        self._run({}, [self._item(tmp_path)])
        info = probe_video(tmp_path / "a.mp4")
        assert (info["width"], info["height"]) == (32, 16)

    def test_cancel_stops_between_steps(self, runtime, tmp_path):
        events = self._run({"delay": 0.2}, [self._item(tmp_path, steps=40)], cancel_after_steps=1)
        assert events[-1]["type"] == "cancelled"
        assert sum(e["type"] == "step" for e in events) < 10 and not any(e["type"] == "video" for e in events)

    def test_generation_error_is_reported(self, runtime, tmp_path):
        events = self._run({}, [self._item(tmp_path, prompt="boom")])
        assert events[-1]["type"] == "error" and events[-1]["error"] == "kaboom"

    def test_load_error_is_reported(self, runtime):
        events = self._run({"fail": True}, [])
        assert events[-1]["type"] == "load_error" and "carte graphique" in events[-1]["error"]


class TestRuntimeHelpers:
    @pytest.fixture
    def common(self):
        return _load("video_runtime_common", RUNTIME / "common.py")

    def test_write_probe_and_resample(self, common, tmp_path):
        frames = np.random.randint(0, 255, (17, 32, 48, 3), dtype=np.uint8)
        info = common.write_mp4(frames, 8, str(tmp_path / "s.mp4"))
        assert (info["width"], info["height"], info["frames"], info["duration"]) == (48, 32, 17, 2.125)
        assert common.probe(str(tmp_path / "s.mp4"))["frames"] == 17
        # 8 fps source read at 4 fps keeps motion speed: every other frame.
        got = common.read_frames_at(str(tmp_path / "s.mp4"), 4, 100, (24, 16))
        assert len(got) == 9 and got[0].size == (24, 16)
        assert len(common.read_frames_at(str(tmp_path / "s.mp4"), 8, 5)) == 5

    def test_unreadable_source(self, common, tmp_path):
        (tmp_path / "bad.mp4").write_bytes(b"nope")
        with pytest.raises(Exception):
            common.read_frames_at(str(tmp_path / "bad.mp4"), 8, 5)
