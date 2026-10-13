# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""`/engine/v1/jobs`, media ingest and purge, and the legacy `/api/messages` adapter on the shared manager. No model."""

import asyncio
import json
import os
import tempfile

os.environ["IMAGEGEN_DATA_DIR"] = tempfile.mkdtemp(prefix="ai-medialab-jobs-api-")
os.environ["IMAGEGEN_DEMO"] = "1"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import db, jobs as jobs_module, legacy_jobs, repo, runtime_settings  # noqa: E402
from app.api import jobs as jobs_api  # noqa: E402
from app.config import DATA_DIR, OUTPUTS_DIR, THUMBS_DIR, UPLOADS_DIR, ensure_dirs  # noqa: E402
from app.events import bus  # noqa: E402
from app.jobs import JobManager  # noqa: E402
from app.main import app  # noqa: E402
from app.media import encode_mp4  # noqa: E402
from test_jobs import FakeWorker  # noqa: E402

TOKEN = "s3cret-token"
H = {"X-Engine-Token": TOKEN}


@pytest.fixture()
def manager(monkeypatch):
    ensure_dirs()
    db.init_db()
    runtime_settings.apply({"keep_alive_minutes": -1, "previews": True, "low_memory": True, "quantize": {}, "variant": {}})
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    fresh = JobManager()
    for module in (jobs_api, legacy_jobs, jobs_module):
        monkeypatch.setattr(module, "jobs", fresh)
    monkeypatch.setattr(jobs_module, "WorkerHandle", FakeWorker)
    FakeWorker.mode = "ok"
    yield fresh
    runtime_settings.reset()


@pytest.fixture()
def client(manager):
    return TestClient(app)  # no lifespan: nothing runs the queue, jobs stay queued


def body(job_id="j1", **kw):
    return {"job_id": job_id, "kind": "image", "model_id": "demo", "prompt": "un chat", "output_dir": str(OUTPUTS_DIR),
            "params": {"seeds": [1], "steps": 2}, **kw}


class TestJobsApi:
    def test_the_token_is_required(self, client):
        assert client.post("/engine/v1/jobs", json=body()).status_code == 401
        assert client.get("/engine/v1/jobs").status_code == 401
        assert client.post("/engine/v1/media/purge", json={"files": []}).status_code == 401

    def test_check_answers_with_the_limits_and_defaults_of_the_model_or_the_message_to_show(self, client):
        from app.engines import MODELS

        ok = client.post("/engine/v1/jobs/check", json={"model_id": "demo"}, headers=H)
        assert ok.status_code == 200 and ok.json()["kind"] == "image" and ok.json()["max_count"] == 4
        assert ok.json()["default_params"]["steps"] == 12
        assert client.post("/engine/v1/jobs/check", json={"model_id": "ghost"}, headers=H).status_code == 422
        needs_ref = next((s for s in MODELS.values() if s.kind == "image" and s.requires_references), None)
        video = next((s for s in MODELS.values() if s.kind == "video" and s.video.image_input == "required"), None)
        if needs_ref:
            r = client.post("/engine/v1/jobs/check", json={"model_id": needs_ref.id}, headers=H)
            assert r.status_code == 422 and "image de référence" in r.json()["detail"]
            assert client.post("/engine/v1/jobs/check", json={"model_id": needs_ref.id, "reference_media": ["image"]},
                               headers=H).status_code == 200
        if video:
            r = client.post("/engine/v1/jobs/check", json={"model_id": video.id}, headers=H)
            assert r.status_code == 422 and "image de départ" in r.json()["detail"]
            ok = client.post("/engine/v1/jobs/check", json={"model_id": video.id, "reference_media": ["image"]}, headers=H)
            assert ok.json()["max_count"] == 2

    def test_submit_queues_a_job_and_reports_its_state(self, client):
        r = client.post("/engine/v1/jobs", json=body(), headers=H)
        assert r.status_code == 202 and r.json()["state"] == "queued" and r.json()["queue_position"] == 0
        assert client.get("/engine/v1/jobs/j1", headers=H).json()["state"] == "queued"
        assert [j["job_id"] for j in client.get("/engine/v1/jobs", headers=H).json()["jobs"]] == ["j1"]

    def test_submit_is_refused_for_bad_requests(self, client, tmp_path):
        post = lambda b: client.post("/engine/v1/jobs", json=b, headers=H)  # noqa: E731
        assert post(body(model_id="ghost")).status_code == 422
        assert post(body(kind="audio")).status_code == 422
        assert post(body(job_id="a/b")).status_code == 422
        assert post(body(params={"seeds": [1, 2, 3, 4, 5]})).status_code == 422
        assert post(body(output_dir="relative/dir")).status_code == 422
        assert post(body(output_dir=str(tmp_path))).status_code == 422
        assert post(body(inputs=["/etc/passwd"])).status_code == 422
        assert post(body(voices={"v": {"path": "/etc/passwd"}})).status_code == 422
        assert post(body(job_id="dup")).status_code == 202
        assert post(body(job_id="dup")).status_code == 409

    def test_cancel_a_queued_job_then_it_is_finished(self, client):
        client.post("/engine/v1/jobs", json=body(), headers=H)
        assert client.post("/engine/v1/jobs/j1/cancel", headers=H).json() == {"ok": True}
        assert client.get("/engine/v1/jobs/j1", headers=H).json()["state"] == "cancelled"
        assert client.post("/engine/v1/jobs/j1/cancel", headers=H).status_code == 409
        assert client.post("/engine/v1/jobs/ghost/cancel", headers=H).status_code == 404
        assert client.get("/engine/v1/jobs/ghost", headers=H).status_code == 404

    def test_the_jobs_routes_are_in_the_schema_and_not_on_the_legacy_prefix(self, client):
        paths = app.openapi()["paths"]
        for path in ("/engine/v1/jobs", "/engine/v1/jobs/check", "/engine/v1/jobs/{job_id}", "/engine/v1/jobs/{job_id}/cancel",
                     "/engine/v1/media/ingest", "/engine/v1/media/purge"):
            assert path in paths
        assert client.get("/api/jobs").status_code in (404, 503)

    def test_a_submitted_job_runs_to_the_end_and_emits_events_on_the_bus(self, manager):
        FakeWorker.mode = "ok"
        got: list[tuple[str, dict]] = []

        async def scenario():
            q = bus.subscribe()
            await manager.start()
            c = TestClient(app)
            # TestClient runs the route in another thread: submit from this loop's thread instead.
            from app.job_plans import JobRequest

            manager.submit(JobRequest(job_id="e2e", model_id="demo", prompt="p", params={"seeds": [4], "steps": 2},
                                      output_dir=str(OUTPUTS_DIR)))
            for _ in range(300):
                await asyncio.sleep(0.02)
                while not q.empty():
                    frame = q.get_nowait().split("\n")
                    got.append((frame[0].removeprefix("event: "), json.loads(frame[1].removeprefix("data: "))))
                if manager.describe("e2e") and manager.describe("e2e")["state"] == "done":
                    break
            r = c.get("/engine/v1/jobs/e2e", headers=H)
            while not q.empty():
                frame = q.get_nowait().split("\n")
                got.append((frame[0].removeprefix("event: "), json.loads(frame[1].removeprefix("data: "))))
            bus.unsubscribe(q)
            await manager.shutdown()
            return r.json()

        state = asyncio.run(scenario())
        assert state["state"] == "done" and state["outputs"][0]["filename"] == "e2e_0.png"
        names = [n for n, d in got if d.get("job_id") == "e2e"]
        assert names[0] == "job.started" and names[-1] == "job.done" and "job.output" in names


class TestMedia:
    def test_ingest_an_image_stores_png_and_thumbnail_and_consumes_the_source(self, client):
        src = UPLOADS_DIR / "tmp_up1"
        Image.new("RGBA", (300, 200), (255, 0, 0, 0)).save(src, format="PNG")
        r = client.post("/engine/v1/media/ingest", headers=H,
                        json={"source_path": str(src), "asset_id": "a1", "original_name": "photo.png"})
        assert r.status_code == 200
        assert r.json() == {"media": "image", "filename": "a1.png", "thumb": "a1.webp", "width": 300, "height": 200,
                            "duration": None, "meta": {}}
        assert (UPLOADS_DIR / "a1.png").is_file() and (THUMBS_DIR / "a1.webp").is_file() and not src.exists()

    def test_ingest_an_unreadable_file_is_a_422_and_the_source_is_removed(self, client):
        src = UPLOADS_DIR / "tmp_bad"
        src.write_bytes(b"not an image")
        r = client.post("/engine/v1/media/ingest", headers=H,
                        json={"source_path": str(src), "asset_id": "a2", "original_name": "x.png"})
        assert r.status_code == 422 and "Image illisible : x.png" in r.json()["detail"] and not src.exists()

    def test_ingest_a_video_keeps_it_and_probes_it(self, client):
        src = UPLOADS_DIR / "tmp_vid"
        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, src.with_suffix(".mp4"))
        src.with_suffix(".mp4").rename(src)
        r = client.post("/engine/v1/media/ingest", headers=H,
                        json={"source_path": str(src), "asset_id": "v1", "original_name": "clip.mp4",
                              "content_type": "video/mp4"})
        data = r.json()
        assert r.status_code == 200 and data["media"] == "video" and data["filename"] == "v1.mp4"
        assert (data["width"], data["height"]) == (48, 32) and data["meta"]["fps"] == 8 and data["duration"] > 0
        assert (UPLOADS_DIR / "v1.mp4").is_file() and (THUMBS_DIR / "v1.webp").is_file() and not src.exists()

    def test_ingest_refuses_a_path_outside_the_data_folder_and_a_missing_file(self, client, tmp_path):
        outside = tmp_path / "x.png"
        outside.write_bytes(b"x")
        post = lambda p: client.post("/engine/v1/media/ingest", headers=H, json={"source_path": p, "asset_id": "z"})  # noqa: E731
        assert post(str(outside)).status_code == 422 and outside.exists()
        assert post(str(UPLOADS_DIR / "nope")).status_code == 422

    def test_purge_deletes_files_and_thumbnails_and_refuses_paths(self, client):
        (UPLOADS_DIR / "p.png").write_bytes(b"1")
        (OUTPUTS_DIR / "q.png").write_bytes(b"1")
        (THUMBS_DIR / "q.webp").write_bytes(b"1")
        files = [{"folder": "uploads", "filename": "p.png"}, {"folder": "outputs", "filename": "q.png", "thumb": "q.webp"},
                 {"folder": "outputs", "filename": "gone.png"}]
        assert client.post("/engine/v1/media/purge", headers=H, json={"files": files}).json() == {"deleted": 3}
        assert not (UPLOADS_DIR / "p.png").exists() and not (THUMBS_DIR / "q.webp").exists()
        bad = {"files": [{"folder": "uploads", "filename": "../x.png"}]}
        assert client.post("/engine/v1/media/purge", headers=H, json=bad).status_code == 422


class TestLegacyAdapter:
    """The old `/api/messages` path: message and asset rows are written by the sink, old event names are published."""

    @staticmethod
    def _seed(prompt="un chat", model="demo", ref=None):
        ts = db.now()
        with db.connect() as conn:
            conn.execute("INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES ('c', 't', 'image', ?, ?)", (ts, ts))
            conn.execute("INSERT INTO messages (id, conversation_id, role, prompt, created_at) VALUES ('u', 'c', 'user', ?, ?)", (prompt, ts))
            if ref:
                conn.execute("INSERT INTO assets (id, kind, filename, created_at) VALUES ('r', 'upload', ?, ?)", (ref, ts))
                conn.execute("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('u', 'r', 0)")
            conn.execute("INSERT INTO messages (id, conversation_id, parent_id, role, prompt, model_id, params, status, created_at) "
                         "VALUES ('m', 'c', 'u', 'assistant', ?, ?, ?, 'queued', ?)",
                         (prompt, model, json.dumps({"seeds": [5], "steps": 2, "megapixels": 0.1}), ts))

    @staticmethod
    def _drive(manager, until):
        got: list[tuple[str, dict]] = []

        async def scenario():
            q = bus.subscribe()
            await manager.start()
            legacy_jobs.enqueue("m")
            for _ in range(300):
                await asyncio.sleep(0.02)
                if until():
                    break
            while not q.empty():
                frame = q.get_nowait().split("\n")
                if len(frame) > 1 and frame[1].startswith("data: "):
                    got.append((frame[0].removeprefix("event: "), json.loads(frame[1].removeprefix("data: "))))
            bus.unsubscribe(q)
            await manager.shutdown()

        asyncio.run(scenario())
        return got

    @pytest.fixture(autouse=True)
    def clean(self, manager):
        with db.connect() as conn:
            for table in ("message_refs", "assets", "messages", "conversations"):
                conn.execute(f"DELETE FROM {table}")

    def test_a_message_is_generated_and_its_rows_and_events_are_written_as_before(self, manager):
        self._seed()
        got = self._drive(manager, lambda: (repo.get_message("m") or {}).get("status") == "done")
        msg = repo.get_message("m")
        assert msg["status"] == "done" and msg["started_at"] and msg["finished_at"] and msg["error"] is None
        assert msg["params"]["width"] > 0 and msg["params"]["seeds"] == [5]
        out = msg["outputs"][0]
        assert out["media"] == "image" and out["seed"] == 5 and out["conversation_id"] == "c" and out["message_id"] == "m"
        assert out["url"] == "/media/outputs/m_0.png" and out["thumb_url"].startswith("/media/thumbs/")
        assert (out["width"], out["height"]) == Image.open(OUTPUTS_DIR / "m_0.png").size
        assert out["meta"]["model_id"] == "demo" and out["meta"]["steps"] == 2
        kinds = [n for n, _ in got]
        assert "message.updated" in kinds and "job.image" in kinds and "job.progress" in kinds
        assert not any(n in ("job.started", "job.output", "job.done") for n in kinds), "new-API names stay off the legacy path"
        statuses = [d["status"] for n, d in got if n == "message.updated"]
        assert statuses[:2] == ["loading", "running"] and statuses[-1] == "done"
        progress = [d for n, d in got if n == "job.progress"]
        assert all(d["message_id"] == "m" and d["conversation_id"] == "c" for d in progress)
        image = next(d for n, d in got if n == "job.image")
        assert image["message_id"] == "m" and image["conversation_id"] == "c" and image["asset"]["id"] == out["id"]

    def test_references_of_the_prompt_reach_the_job_in_order(self, manager):
        Image.new("RGB", (64, 64)).save(UPLOADS_DIR / "legacy_ref.png")
        self._seed(ref="legacy_ref.png")
        req = legacy_jobs.request_from_message(repo.get_message("m"))
        assert req.inputs == [str(UPLOADS_DIR / "legacy_ref.png")] and req.job_id == "m"
        assert req.extra == {"message_id": "m", "conversation_id": "c"}

    def test_an_invalid_prompt_ends_the_message_in_error(self, manager):
        self._seed(prompt="   ")
        self._drive(manager, lambda: (repo.get_message("m") or {}).get("status") == "error")
        msg = repo.get_message("m")
        assert msg["status"] == "error" and msg["error"] == "Le prompt est vide." and msg["finished_at"]

    def test_an_unknown_model_fails_at_once_without_queueing(self, manager):
        self._seed(model="ghost")
        legacy_jobs.enqueue("m")
        msg = repo.get_message("m")
        assert msg["status"] == "error" and "ghost" in msg["error"] and manager.pending == []

    def test_a_message_that_is_not_queued_is_ignored(self, manager):
        self._seed()
        repo.update_message("m", status="done")
        legacy_jobs.enqueue("m")
        assert manager.pending == []

    def test_cancelling_a_queued_message_marks_it_cancelled(self, manager):
        self._seed()
        legacy_jobs.enqueue("m")
        assert manager.pending == ["m"]
        asyncio.run(manager.cancel("m"))
        assert repo.get_message("m")["status"] == "cancelled"
