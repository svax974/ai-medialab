# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Stateless job manager: events, queue, cancellation, history; planning and output description. No model: the demo
engine's spec is registered and a fake worker plays the model process."""

import asyncio
import os
import tempfile

os.environ["IMAGEGEN_DATA_DIR"] = tempfile.mkdtemp(prefix="ai-medialab-jobs-")
os.environ["IMAGEGEN_DEMO"] = "1"

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from app import jobs as jobs_module, runtime_settings  # noqa: E402
from app.config import OUTPUTS_DIR, PREVIEWS_DIR, UPLOADS_DIR, ensure_dirs  # noqa: E402
from app.events import bus  # noqa: E402
from app.job_outputs import describe_output  # noqa: E402
from app.job_plans import JobRequest, build_plan  # noqa: E402
from app.jobs import HISTORY_SIZE, JobManager  # noqa: E402


class FakeWorker:
    """Plays the image worker protocol on the loop: ready, then per `generate` item_start/phase/step/preview/image/done."""

    instances: list["FakeWorker"] = []
    mode = "ok"  # ok | load_error | crash | slow

    def __init__(self, model_id, quantize, options, loop):
        self.model_id, self.quantize, self.options, self.loop = model_id, quantize, options, loop
        self.events: asyncio.Queue = asyncio.Queue()
        self.cancel_event = _Flag()
        self.alive = True
        self.sent: list[dict] = []
        FakeWorker.instances.append(self)
        loop.call_soon(self.events.put_nowait,
                       {"type": "load_error", "error": "boom", "trace": ""} if FakeWorker.mode == "load_error"
                       else {"type": "ready", "model_id": model_id, "load_seconds": 0.0})

    def send(self, cmd):
        self.sent.append(cmd)
        if cmd["type"] == "generate":
            self.loop.create_task(self._generate(cmd))

    async def _generate(self, cmd):
        put = self.events.put_nowait
        job_id = cmd["job_id"]
        for index, item in enumerate(cmd["items"]):
            put({"type": "item_start", "job_id": job_id, "index": index, "seed": item["request"]["seed"], "t": 0.0})
            for step in (1, 2):
                await asyncio.sleep(0.02 if FakeWorker.mode != "slow" else 0.2)
                if self.cancel_event.is_set():
                    put({"type": "cancelled", "job_id": job_id})
                    return
                put({"type": "step", "job_id": job_id, "index": index, "step": step, "total": 2, "t": float(step)})
            if FakeWorker.mode == "crash":
                put({"type": "exit", "code": -9})
                return
            preview = PREVIEWS_DIR / f"{job_id}_{index}_1.jpg"
            Image.new("RGB", (8, 8)).save(preview)
            put({"type": "preview", "job_id": job_id, "index": index, "path": str(preview)})
            width, height = item["request"]["width"], item["request"]["height"]
            Image.new("RGB", (width, height), "red").save(item["output"])
            put({"type": "image", "job_id": job_id, "index": index, "path": item["output"],
                 "seed": item["request"]["seed"], "seconds": 0.1})
        put({"type": "done", "job_id": job_id})

    async def stop(self):
        self.alive = False
        self.events.put_nowait({"type": "exit", "code": 0})  # what the process reader reports once it is gone


class _Flag:
    def __init__(self):
        self._set = False

    def set(self):
        self._set = True

    def clear(self):
        self._set = False

    def is_set(self):
        return self._set


@pytest.fixture(autouse=True)
def env(monkeypatch):
    ensure_dirs()
    runtime_settings.apply({"keep_alive_minutes": -1, "previews": True, "low_memory": True, "quantize": {}, "variant": {}})
    FakeWorker.instances.clear()
    FakeWorker.mode = "ok"
    monkeypatch.setattr(jobs_module, "WorkerHandle", FakeWorker)
    yield
    runtime_settings.reset()


def make_job(job_id="j1", **kw) -> JobRequest:
    events: list[tuple[str, dict]] = []
    job = JobRequest(job_id=job_id, model_id="demo", prompt=kw.pop("prompt", "un chat"),
                     params=kw.pop("params", {"seeds": [11], "steps": 2, "aspect": "1:1", "megapixels": 0.1}),
                     output_dir=str(OUTPUTS_DIR), sink=lambda j, name, data: events.append((name, data)), **kw)
    job.events = events  # type: ignore[attr-defined]
    return job


async def run(manager: JobManager, *jobs: JobRequest, until=None):
    await manager.start()
    for job in jobs:
        manager.submit(job)
    for _ in range(300):
        await asyncio.sleep(0.02)
        if until():
            break
    await manager.shutdown()


def names(job) -> list[str]:
    return [n for n, _ in job.events]


def test_a_job_reports_started_progress_preview_output_and_done():
    manager, job = JobManager(), make_job()
    asyncio.run(run(manager, job, until=lambda: job.state == "done"))
    seen = names(job)
    assert seen[0] == "job.started" and seen[-1] == "job.done"
    assert {"job.progress", "job.preview", "job.output"} <= set(seen)
    started = dict(job.events)["job.started"]
    assert started["kind"] == "image" and started["model_id"] == "demo"
    assert started["params"]["width"] > 0 and started["params"]["seeds"] == [11]
    phases = [d["phase"] for n, d in job.events if n == "job.progress" and "phase" in d]
    assert phases[0] == "loading" and "running" in phases
    steps = [d["step"] for n, d in job.events if n == "job.progress" and d.get("step")]
    assert steps == [1, 2]
    preview = dict(job.events)["job.preview"]
    assert preview["url"].startswith("/media/previews/j1_0_1.jpg") and preview["index"] == 0
    assert not list(PREVIEWS_DIR.glob("j1_*")), "previews are removed when the job ends"
    assert all(d["job_id"] == "j1" for _, d in job.events)


def test_the_output_event_describes_the_file_for_the_caller_to_register():
    manager, job = JobManager(), make_job()
    asyncio.run(run(manager, job, until=lambda: job.state == "done"))
    out = dict(job.events)["job.output"]
    assert out["media"] == "image" and out["index"] == 0 and out["seed"] == 11
    assert out["filename"] == "j1_0.png" and out["path"] == str(OUTPUTS_DIR / "j1_0.png")
    assert out["thumb"] == f"{out['asset_id']}.webp" and (OUTPUTS_DIR.parent / "thumbs" / out["thumb"]).is_file()
    assert (out["width"], out["height"]) == Image.open(out["path"]).size
    assert out["meta"]["model_id"] == "demo" and out["meta"]["prompt"] == "un chat" and out["meta"]["steps"] == 2
    assert job.outputs and job.outputs[0]["asset_id"] == out["asset_id"]


def test_finished_jobs_stay_describable_with_their_outputs():
    manager, job = JobManager(), make_job()
    asyncio.run(run(manager, job, until=lambda: job.state == "done"))
    state = manager.describe("j1")
    assert state["state"] == "done" and len(state["outputs"]) == 1 and state["error"] is None
    assert manager.describe("nope") is None and manager.active() == []


def test_history_is_bounded():
    manager = JobManager()
    for i in range(HISTORY_SIZE + 5):
        job = make_job(f"h{i}")
        manager.jobs[job.job_id] = job
        manager._finish(job, "done")
    assert len(manager.history) == HISTORY_SIZE and manager.describe("h0") is None and manager.describe("h104")


def test_jobs_run_one_at_a_time_in_order_and_the_model_stays_loaded():
    manager, a, b = JobManager(), make_job("a"), make_job("b")

    async def scenario():
        await manager.start()
        manager.submit(a)
        manager.submit(b)
        assert manager.status()["queue"] == ["a", "b"]
        for _ in range(300):
            await asyncio.sleep(0.02)
            assert not (a.state in ("loading", "running") and b.state in ("loading", "running"))
            if b.state == "done":
                break
        await manager.shutdown()

    asyncio.run(scenario())
    assert a.state == b.state == "done" and len(FakeWorker.instances) == 1
    assert [c["job_id"] for c in FakeWorker.instances[0].sent] == ["a", "b"]


def test_cancelling_a_queued_job_never_reaches_the_worker():
    manager, a, b = JobManager(), make_job("a"), make_job("b")

    async def scenario():
        await manager.start()
        manager.submit(a)
        manager.submit(b)
        assert await manager.cancel("b") is True
        for _ in range(300):
            await asyncio.sleep(0.02)
            if a.state == "done":
                break
        assert await manager.cancel("a") is False  # finished
        await manager.shutdown()

    asyncio.run(scenario())
    assert b.state == "cancelled" and names(b) == ["job.cancelled"]
    assert [c["job_id"] for c in FakeWorker.instances[0].sent] == ["a"]


def test_cancelling_a_running_job_asks_the_worker_and_ends_cancelled():
    FakeWorker.mode = "slow"
    manager, job = JobManager(), make_job()

    async def scenario():
        await manager.start()
        manager.submit(job)
        for _ in range(300):
            await asyncio.sleep(0.02)
            if job.state == "running":
                break
        assert await manager.cancel("j1") is True
        for _ in range(300):
            await asyncio.sleep(0.02)
            if job.state == "cancelled":
                break
        kept.append(manager.worker is not None and manager.worker.alive)
        await manager.shutdown()

    kept: list[bool] = []
    asyncio.run(scenario())
    assert job.state == "cancelled" and names(job)[-1] == "job.cancelled" and "job.output" not in names(job)
    assert kept == [True]  # the loaded model stays for the next job


def test_cancelling_while_the_model_loads_kills_the_worker(monkeypatch):
    manager, job = JobManager(), make_job()

    class Hold(FakeWorker):  # never answers ready
        def __init__(self, *a):
            super().__init__(*a)
            self.events = asyncio.Queue()

    async def scenario():
        monkeypatch.setattr(jobs_module, "WorkerHandle", Hold)
        await manager.start()
        manager.submit(job)
        for _ in range(300):
            await asyncio.sleep(0.02)
            if manager.state == "loading":
                break
        assert await manager.cancel("j1") is True
        for _ in range(300):
            await asyncio.sleep(0.02)
            if job.state == "cancelled":
                break
        await manager.shutdown()

    asyncio.run(scenario())
    assert job.state == "cancelled" and manager.worker is None and FakeWorker.instances[0].alive is False


def test_a_load_error_fails_the_job_with_the_reason():
    FakeWorker.mode = "load_error"
    manager, job = JobManager(), make_job()
    asyncio.run(run(manager, job, until=lambda: job.state == "failed"))
    assert job.error == "Échec du chargement du modèle : boom"
    assert dict(job.events)["job.failed"]["error"] == job.error and manager.last_error == "boom"


def test_a_job_refused_for_lack_of_free_memory_carries_a_code_and_can_be_forced(monkeypatch):
    monkeypatch.setattr(JobManager, "_memory_preflight", lambda self, spec: "Mémoire insuffisante : test.")
    manager, job = JobManager(), make_job()
    asyncio.run(run(manager, job, until=lambda: job.state == "failed"))
    assert job.error_code == "memory" and dict(job.events)["job.failed"]["code"] == "memory"
    assert manager.describe("j1")["error_code"] == "memory" and not FakeWorker.instances

    manager, forced = JobManager(), make_job("j2", params={"seeds": [11], "steps": 2, "aspect": "1:1", "megapixels": 0.1,
                                                          "force_memory": True})
    asyncio.run(run(manager, forced, until=lambda: forced.state == "done"))
    assert forced.state == "done" and forced.error_code is None and "force_memory" not in forced.params


def test_a_worker_killed_by_the_memory_guard_says_why(monkeypatch):
    from types import SimpleNamespace

    FakeWorker.mode = "crash"
    monkeypatch.setattr(FakeWorker, "process", SimpleNamespace(pid=-4242), raising=False)
    manager, job = JobManager(), make_job()
    manager.guard._trips[-4242] = "Arrêté par la protection mémoire : test."
    asyncio.run(run(manager, job, until=lambda: job.state == "failed"))
    assert job.error == "Arrêté par la protection mémoire : test." and manager.worker is None


def test_a_worker_crash_fails_the_job_with_a_memory_hint():
    FakeWorker.mode = "crash"
    manager, job = JobManager(), make_job()
    asyncio.run(run(manager, job, until=lambda: job.state == "failed"))
    assert "code -9" in job.error and "Mémoire insuffisante" in job.error and manager.worker is None


def test_invalid_content_fails_the_job_and_the_queue_goes_on():
    manager, bad, good = JobManager(), make_job("bad", prompt="  "), make_job("good")
    asyncio.run(run(manager, bad, good, until=lambda: good.state == "done"))
    assert bad.state == "failed" and bad.error == "Le prompt est vide."
    assert names(bad) == ["job.failed"] and good.state == "done"


def test_unknown_model_fails_the_job():
    manager, job = JobManager(), make_job()
    job.model_id = "no-such-model"
    asyncio.run(run(manager, job, until=lambda: job.state == "failed"))
    assert "no-such-model" in job.error


def test_submitting_an_active_job_id_is_refused_and_a_finished_one_can_be_reused():
    manager, job = JobManager(), make_job()
    manager.submit(job)
    with pytest.raises(ValueError):
        manager.submit(make_job())
    manager.pending.clear()
    manager._finish(job, "cancelled")
    manager.submit(make_job())  # same id again after it ended
    assert manager.describe("j1")["state"] == "queued" and manager.describe("j1")["queue_position"] == 0


def test_a_failing_sink_does_not_stop_the_queue():
    manager, a, b = JobManager(), make_job("a"), make_job("b")

    def broken(_job, name, _data):
        raise RuntimeError("sink down")

    a.sink = broken
    asyncio.run(run(manager, a, b, until=lambda: b.state == "done"))
    assert b.state == "done"


def test_default_sink_publishes_on_the_event_bus():
    manager, job = JobManager(), make_job()
    job.sink = None
    received: list[str] = []

    async def scenario():
        q = bus.subscribe()
        await manager.start()
        manager.submit(job)
        for _ in range(300):
            await asyncio.sleep(0.02)
            while not q.empty():
                received.append(q.get_nowait().split("\n")[0])
            if job.state == "done":
                break
        while not q.empty():
            received.append(q.get_nowait().split("\n")[0])
        bus.unsubscribe(q)
        await manager.shutdown()

    asyncio.run(scenario())
    assert "event: job.started" in received and "event: job.output" in received and "event: job.done" in received


def test_snapshot_replays_progress_of_running_jobs():
    manager, job = JobManager(), make_job()
    manager.jobs["j1"] = job
    manager.progress["j1"] = {"job_id": "j1", "phase": "running"}
    assert manager.snapshot() == [{"job_id": "j1", "phase": "running"}]


class TestPlans:
    def test_image_plan_resolves_size_seeds_and_references(self, tmp_path):
        ref = UPLOADS_DIR / "ref.png"
        Image.new("RGB", (200, 100)).save(ref)
        job = make_job(inputs=[str(ref), str(tmp_path / "missing.png")], params={"aspect": "auto", "megapixels": 0.5, "seeds": [1, 2]})
        plan = build_plan(job)
        assert plan["kind"] == "image" and plan["params"]["references_used"] == 1
        assert plan["params"]["width"] > plan["params"]["height"] and len(plan["items"]) == 2
        assert plan["items"][1]["output"] == str(OUTPUTS_DIR / "j1_1.png")
        assert plan["items"][0]["request"]["references"] == [str(ref)]

    def test_image_plan_records_the_edit_settings_actually_used(self):
        ref = UPLOADS_DIR / "ref.png"
        Image.new("RGB", (64, 64)).save(ref)
        job = make_job(inputs=[str(ref)], params={"steps": 20, "guidance": 1, "seeds": [1]})
        job.model_id = "qwen-image-2.1-gguf"
        plan = build_plan(job)
        assert (plan["params"]["steps"], plan["params"]["guidance"]) == (12, 4.0)
        assert (plan["items"][0]["request"]["steps"], plan["items"][0]["request"]["guidance"]) == (12, 4.0)

    def test_image_plan_passes_model_specific_params_to_the_engine(self):
        job = make_job(params={"lora_scale": 0.7, "seeds": [1]})
        job.model_id = "pixel-art-xl"
        request = build_plan(job)["items"][0]["request"]
        assert request["extra"] == {"lora_scale": 0.7, "pixel_perfect": True}

    def test_face_plan_takes_its_size_from_the_start_image(self):
        face, start = UPLOADS_DIR / "face.png", UPLOADS_DIR / "start.png"
        Image.new("RGB", (512, 512)).save(face)
        Image.new("RGB", (1024, 512)).save(start)
        job = make_job(inputs=[str(face), str(start)], params={"aspect": "auto", "megapixels": 0, "seeds": [1]})
        job.model_id = "pixel-art-xl-face"
        plan = build_plan(job)
        assert plan["params"]["width"] > plan["params"]["height"] and plan["params"]["references_used"] == 2
        assert plan["items"][0]["request"]["extra"]["face_scale"] == 0.6

    def test_unknown_model_and_empty_prompt_are_value_errors(self):
        with pytest.raises(ValueError, match="Le prompt est vide"):
            build_plan(make_job(prompt=""))
        job = make_job()
        job.model_id = "ghost"
        with pytest.raises(ValueError):
            build_plan(job)

    def test_describe_output_for_audio_carries_duration_and_voice(self):
        plan = {"model_id": "m", "prompt": "t", "params": {"language": "fr"}, "voice_label": "Siwis",
                "speakers": [], "items": [{"instruct": None}]}
        out = describe_output(plan, {"type": "audio", "index": 0, "path": str(OUTPUTS_DIR / "a_0.wav"), "seed": 3,
                                     "duration": 2.5, "seconds": 1.0, "sample_rate": 24000, "peaks": [0.1], "markers": []})
        assert out["media"] == "audio" and out["duration"] == 2.5 and out["thumb"] is None
        assert out["meta"]["voice"] == "Siwis" and out["meta"]["sample_rate"] == 24000

    def test_library_voice_given_by_the_caller_is_used_before_the_engine_database(self):
        from app.engines import MODELS
        from app.voices import resolve_voice

        spec = next((s for s in MODELS.values() if s.kind == "audio" and s.audio.clone != "none"), None)
        if spec is None:
            pytest.skip("no cloning audio model registered")
        lib = {"v1": {"path": "/data/uploads/v.wav", "transcript": "bonjour", "name": "Moi"}}
        voice = resolve_voice(spec, {"source": "library", "id": "v1"}, "fr", "", lib)
        assert voice == {"kind": "clone", "ref_audio": "/data/uploads/v.wav", "ref_text": "bonjour", "label": "Moi"}
        with pytest.raises(ValueError, match="n'existe plus"):
            resolve_voice(spec, {"source": "library", "id": "other"}, "fr", "", lib)

    def test_without_a_library_the_voice_does_not_exist(self):
        from app import voices
        from app.engines import MODELS

        spec = next((s for s in MODELS.values() if s.kind == "audio" and s.audio.clone != "none"), None)
        if spec is None:
            pytest.skip("no cloning audio model registered")
        for library in ({}, None):  # the engine has no voice library of its own
            with pytest.raises(ValueError, match="n'existe plus"):
                voices.resolve_voice(spec, {"source": "library", "id": "x"}, "fr", "", library)


def _video_job(model_id: str, inputs: list[str], params: dict | None = None) -> JobRequest:
    job = make_job(inputs=inputs, params={"seeds": [1, 2, 3], **(params or {})})
    job.model_id = model_id
    return job


def _image_file(name: str, size: tuple[int, int]) -> str:
    path = UPLOADS_DIR / name
    Image.new("RGB", size).save(path)
    return str(path)


class TestVideoPlans:
    """What the video composer can attach: start image, end image, source video (+ a reference image), nothing."""

    def test_start_and_end_images_make_a_first_last_frame_clip_and_a_third_image_is_dropped(self):
        a, b, c = (_image_file(f"{n}.png", (64, 64)) for n in "abc")
        plan = build_plan(_video_job("wan-2.2-i2v-a14b", [a, b, c], {"seconds": 3, "aspect": "9:16", "resolution": "480p"}))
        p = plan["params"]
        assert p["task"] == "i2v" and p["references_used"] == 2 and len(plan["items"]) == 2  # clips capped at 2
        assert plan["items"][0]["request"]["references"] == [a, b]
        assert (p["frames"] - 1) % 4 == 0 and p["fps"] == 16 and p["seconds"] == round(p["frames"] / 16, 2)
        assert p["height"] > p["width"] and p["aspect"] == "9:16"

    def test_a_model_without_end_image_keeps_the_start_image_only(self):
        a, b = _image_file("s1.png", (64, 64)), _image_file("s2.png", (64, 64))
        plan = build_plan(_video_job("wan-2.2-ti2v-5b", [a, b]))
        assert plan["params"]["task"] == "i2v" and plan["items"][0]["request"]["references"] == [a]

    def test_a_source_video_edits_and_a_reference_image_rides_along_when_the_model_takes_one(self, tmp_path):
        import numpy as np
        from app.media import encode_mp4

        src = UPLOADS_DIR / "src_edit.mp4"
        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, src)
        ref = _image_file("style.png", (64, 64))
        plan = build_plan(_video_job("kiwi-edit-5b", [ref, str(src)], {"strength": 0.5}))
        request = plan["items"][0]["request"]
        assert plan["params"]["task"] == "v2v" and plan["params"]["references_used"] == 2
        assert request["references"] == [ref] and request["extra"]["video"] == str(src) and request["strength"] == 0.5
        # A text-and-edit model that takes no image ignores it.
        plan = build_plan(_video_job("cogvideox-2b", [ref, str(src)]))
        assert plan["params"]["task"] == "v2v" and plan["items"][0]["request"]["references"] == []

    def test_auto_aspect_follows_the_start_image(self):
        portrait = _image_file("portrait.png", (100, 200))
        p = build_plan(_video_job("wan-2.2-ti2v-5b", [portrait], {"aspect": "auto"}))["params"]
        assert p["height"] > p["width"] and p["aspect"] == "16:9"  # the ratio comes from the image, the label is kept

    def test_an_attachment_the_model_cannot_use_is_ignored_and_a_required_one_is_asked_for(self):
        img = _image_file("ignored.png", (64, 64))
        plan = build_plan(_video_job("cogvideox-2b", [img]))
        assert plan["params"]["task"] == "t2v" and plan["params"]["references_used"] == 0
        with pytest.raises(ValueError, match="vidéo source"):
            build_plan(_video_job("kiwi-edit-5b", [img]))
        with pytest.raises(ValueError, match="image de départ"):
            build_plan(_video_job("hunyuan-video-1.5-i2v", []))

    def test_boolean_parameters_such_as_the_fast_decoder_reach_the_worker(self):
        on = build_plan(_video_job("wan-2.2-ti2v-5b-gguf", [], {"fast_decode": True}))
        off = build_plan(_video_job("wan-2.2-ti2v-5b-gguf", [], {"fast_decode": False}))
        assert on["items"][0]["request"]["extra"]["fast_decode"] is True
        assert off["items"][0]["request"]["extra"]["fast_decode"] is False

    def test_the_duration_is_clamped_to_what_the_model_renders(self):
        long = build_plan(_video_job("cogvideox-2b", [], {"seconds": 600}))["params"]
        short = build_plan(_video_job("cogvideox-2b", [], {"seconds": 0.1}))["params"]
        assert long["seconds"] > short["seconds"] > 0 and long["frames"] > short["frames"]

    def test_describe_output_for_a_video_makes_the_poster_and_keeps_duration_and_fps(self):
        import numpy as np
        from app.config import THUMBS_DIR
        from app.media import encode_mp4

        path = OUTPUTS_DIR / "clip_0.mp4"
        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, path)
        plan = {"model_id": "m", "prompt": "un chat", "params": {"steps": 20, "guidance": 5.0, "task": "i2v", "strength": None},
                "items": [{}]}
        out = describe_output(plan, {"type": "video", "index": 0, "path": str(path), "seed": 7, "width": 48, "height": 32,
                                     "duration": 1.125, "seconds": 12.0, "fps": 8, "frames": 9, "has_audio": False})
        assert out["media"] == "video" and out["filename"] == "clip_0.mp4" and out["duration"] == 1.125
        assert (THUMBS_DIR / out["thumb"]).is_file() and (out["width"], out["height"]) == (48, 32)
        assert out["meta"] == {"model_id": "m", "prompt": "un chat", "steps": 20, "guidance": 5.0, "seconds": 12.0, "fps": 8,
                               "frames": 9, "has_audio": False, "video_seconds": 1.125, "task": "i2v", "strength": None}

    def test_the_generation_check_asks_for_what_the_model_needs_and_caps_clips_at_two(self):
        from app.job_checks import check_generation

        with pytest.raises(ValueError, match="image de départ"):
            check_generation("hunyuan-video-1.5-i2v", [])
        with pytest.raises(ValueError, match="vidéo source"):
            check_generation("kiwi-edit-5b", ["image"])
        ok = check_generation("kiwi-edit-5b", ["image", "video"])
        assert ok["kind"] == "video" and ok["max_count"] == 2 and "seeds" not in ok["default_params"]
