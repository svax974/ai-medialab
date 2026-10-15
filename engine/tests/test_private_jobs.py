# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Private generation, engine side: every file stays in the session folder, nothing of the job survives it, nothing
about its content reaches the journal, an event or an error. A sentinel prompt is followed everywhere. No model."""

import asyncio
import json
import os
import tempfile

os.environ["IMAGEGEN_DATA_DIR"] = tempfile.mkdtemp(prefix="ai-medialab-private-")
os.environ["IMAGEGEN_DEMO"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import jobs as jobs_module, private_session, runtime_settings  # noqa: E402
from app.api import jobs as jobs_api  # noqa: E402
from app.config import DATA_DIR, OUTPUTS_DIR, PREVIEWS_DIR, PRIVATE_DIR, THUMBS_DIR, UPLOADS_DIR, ensure_dirs  # noqa: E402
from app.job_plans import JobRequest, build_plan  # noqa: E402
from app.jobs import JobManager  # noqa: E402
from app.main import app  # noqa: E402
from test_jobs import FakeWorker  # noqa: E402

SENTINEL = "SENTINELLE-prompt-privé-7f3a91"
TOKEN = "s3cret-token"
H = {"X-Engine-Token": TOKEN}
SESSION = "s" + "0123456789abcdef" * 2


class PrivateWorker(FakeWorker):
    """The fake worker, writing its previews where the engine tells it to, and able to fail quoting the prompt."""

    mode = "ok"

    async def _generate(self, cmd):
        if PrivateWorker.mode == "fail":
            self.events.put_nowait({"type": "error", "job_id": cmd["job_id"],
                                    "error": f"RuntimeError: cannot encode {cmd['items'][0]['request']['prompt']}",
                                    "trace": f"Traceback ... prompt={cmd['items'][0]['request']['prompt']!r}"})
            return
        self.previews = cmd["preview_dir"]
        job_id = cmd["job_id"]
        for index, item in enumerate(cmd["items"]):
            self.events.put_nowait({"type": "item_start", "job_id": job_id, "index": index, "seed": 1, "t": 0.0})
            preview = os.path.join(cmd["preview_dir"], f"{job_id}_{index}_1.jpg")
            Image.new("RGB", (8, 8)).save(preview)
            self.events.put_nowait({"type": "preview", "job_id": job_id, "index": index, "path": preview})
            Image.new("RGB", (item["request"]["width"], item["request"]["height"]), "red").save(item["output"])
            self.events.put_nowait({"type": "image", "job_id": job_id, "index": index, "path": item["output"], "seed": 1,
                                    "seconds": 0.1})
        self.events.put_nowait({"type": "done", "job_id": job_id})


@pytest.fixture()
def session():
    ensure_dirs()
    folder = PRIVATE_DIR / SESSION
    for name in private_session.SUBFOLDERS:
        (folder / name).mkdir(parents=True, exist_ok=True)
    yield folder
    import shutil

    shutil.rmtree(folder, ignore_errors=True)


@pytest.fixture()
def manager(monkeypatch):
    ensure_dirs()
    runtime_settings.apply({"keep_alive_minutes": -1, "previews": True, "low_memory": True, "quantize": {}, "variant": {}})
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    fresh = JobManager()
    for module in (jobs_api, jobs_module):
        monkeypatch.setattr(module, "jobs", fresh)
    monkeypatch.setattr(jobs_module, "WorkerHandle", PrivateWorker)
    PrivateWorker.mode = "ok"
    yield fresh
    runtime_settings.reset()


def tree(root) -> list[str]:
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()) if root.exists() else []


def make_job(job_id, session, *, private=True, prompt=SENTINEL):
    events: list[tuple[str, dict]] = []
    out = (session / "outputs") if private else OUTPUTS_DIR
    job = JobRequest(job_id=job_id, model_id="demo", prompt=prompt, params={"seeds": [11], "steps": 2, "aspect": "1:1", "megapixels": 0.1},
                     output_dir=str(out), private_dir=str(session) if private else None,
                     sink=lambda j, name, data: events.append((name, data)))
    job.events = events  # type: ignore[attr-defined]
    return job


async def run(manager, job):
    await manager.start()
    manager.submit(job)
    for _ in range(300):
        await asyncio.sleep(0.02)
        if job.job_id not in manager.jobs:
            break
    await manager.shutdown()


class TestPrivateJob:
    def test_every_file_stays_in_the_session_folder_and_the_usual_folders_stay_untouched(self, manager, session):
        before = {d: tree(d) for d in (UPLOADS_DIR, OUTPUTS_DIR, THUMBS_DIR, PREVIEWS_DIR)}
        job = make_job("p1", session)
        asyncio.run(run(manager, job))
        assert job.state == "done"
        files = tree(session)
        assert any(f.startswith("outputs/p1_0") for f in files) and any(f.startswith("thumbs/") for f in files)
        assert not any(f.startswith("previews/") for f in files)  # the previews are cleaned at the end, like any job
        assert {d: tree(d) for d in (UPLOADS_DIR, OUTPUTS_DIR, THUMBS_DIR, PREVIEWS_DIR)} == before

    def test_the_worker_is_told_to_keep_its_temporary_files_and_previews_in_the_session(self, manager, session):
        job = make_job("p9", session)
        asyncio.run(run(manager, job))
        command = PrivateWorker.instances[-1].sent[0]
        assert command["tmp_dir"] == str(session / "tmp") and command["preview_dir"] == str(session / "previews")
        normal = make_job("n9", session, private=False)
        asyncio.run(run(JobManager(), normal))
        assert PrivateWorker.instances[-1].sent[0]["tmp_dir"] is None

    def test_nothing_of_the_job_survives_it_in_the_engine(self, manager, session):
        job = make_job("p2", session)
        asyncio.run(run(manager, job))
        assert manager.describe("p2") is None and "p2" not in manager.history

    def test_a_normal_job_still_keeps_its_outcome_and_its_prompt(self, manager, session):
        job = make_job("n1", session, private=False, prompt="un chat normal")
        asyncio.run(run(manager, job))
        assert manager.describe("n1")["state"] == "done"
        output = dict(job.events)["job.output"]
        assert output["meta"]["prompt"] == "un chat normal"
        assert (THUMBS_DIR / output["thumb"]).is_file()

    def test_no_event_carries_the_prompt_and_the_description_of_the_file_has_none(self, manager, session):
        job = make_job("p3", session)
        asyncio.run(run(manager, job))
        assert SENTINEL not in json.dumps(job.events, default=str)
        output = dict(job.events)["job.output"]
        assert "prompt" not in output["meta"] and output["path"].startswith(str(session))
        previews = [data["url"] for name, data in job.events if name == "job.preview"]
        assert previews and all(u.startswith(f"/media/private/{SESSION}/previews/") for u in previews)

    def test_the_item_requests_carry_the_private_flag_for_the_engines_that_keep_measures(self, session):
        plan = build_plan(make_job("p4", session))
        assert plan["private_dir"] == str(session)
        assert all(item["request"]["extra"].get("private") is True for item in plan["items"])
        normal = build_plan(make_job("p5", session, private=False))
        assert not any(item["request"]["extra"].get("private") for item in normal["items"])

    def test_a_failure_quoting_the_prompt_leaves_no_trace_in_the_journal_nor_in_the_error(self, manager, session, capsys):
        PrivateWorker.mode = "fail"
        job = make_job("p6", session)
        asyncio.run(run(manager, job))
        out = capsys.readouterr()
        assert job.state == "failed" and job.error == private_session.GENERIC_ERROR
        assert SENTINEL not in out.out + out.err and SENTINEL not in json.dumps(job.events, default=str)

    def test_a_private_job_leaves_no_line_in_the_journal_not_even_that_it_ran(self, manager, session, capsys):
        asyncio.run(run(manager, make_job("p8", session)))
        asyncio.run(run(JobManager(), make_job("n8", session, private=False, prompt="un chat normal")))
        out = capsys.readouterr().out
        assert "p8" not in out and "n8" in out  # the normal job keeps its memory line, the private one has none

    def test_a_normal_failure_is_still_traced_for_debugging(self, manager, session, capsys):
        PrivateWorker.mode = "fail"
        job = make_job("n2", session, private=False, prompt="un chat normal")
        asyncio.run(run(manager, job))
        assert "un chat normal" in capsys.readouterr().out and "cannot encode" in job.error

    def test_the_memory_messages_are_the_only_errors_a_private_job_keeps(self):
        keep = "Mémoire insuffisante pour cette vidéo. Réduisez la définition."
        assert private_session.sanitize_error(keep) == keep
        assert private_session.sanitize_error(f"{keep}\nprompt: {SENTINEL}") == keep  # only the first line
        assert private_session.sanitize_error("sd-cli s'est arrêté (code 1, build metal).\nprompt: x") == \
            "sd-cli s'est arrêté (code 1, build metal)."
        assert private_session.sanitize_error(f"boom {SENTINEL}", SENTINEL) == private_session.GENERIC_ERROR
        assert private_session.sanitize_error(None) is None


@pytest.fixture()
def client(manager):
    return TestClient(app)


def body(job_id, session, **kw):
    return {"job_id": job_id, "kind": "image", "model_id": "demo", "prompt": SENTINEL, "params": {"seeds": [1], "steps": 2},
            "output_dir": str(session / "outputs"), "private_dir": str(session), **kw}


class TestPrivateApi:
    def test_a_private_job_is_accepted_only_for_a_well_formed_session_with_its_output_inside(self, client, session, tmp_path):
        post = lambda b: client.post("/engine/v1/jobs", json=b, headers=H)  # noqa: E731
        assert post(body("a1", session)).status_code == 202
        assert post(body("a2", session, private_dir="relative")).status_code == 422
        assert post(body("a3", session, private_dir=str(DATA_DIR))).status_code == 422  # not a session folder
        assert post(body("a4", session, private_dir=str(PRIVATE_DIR / "court"))).status_code == 422  # malformed id
        assert post(body("a5", session, private_dir=str(PRIVATE_DIR / SESSION / "outputs"))).status_code == 422
        assert post(body("a6", session, output_dir=str(OUTPUTS_DIR))).status_code == 422  # output outside the session
        assert post(body("a7", session, private_dir=str(tmp_path))).status_code == 422

    def test_a_private_upload_and_its_thumbnail_stay_in_the_session(self, client, session):
        before = {d: tree(d) for d in (UPLOADS_DIR, THUMBS_DIR)}
        raw = DATA_DIR / "tmp_raw.png"
        Image.new("RGB", (40, 30), "blue").save(raw)
        r = client.post("/engine/v1/media/ingest", headers=H, json={
            "source_path": str(raw), "asset_id": "ref1", "original_name": "ma-photo-perso.png", "private_dir": str(session)})
        assert r.status_code == 200 and r.json()["filename"] == "ref1.png"
        assert (session / "inputs" / "ref1.png").is_file() and (session / "thumbs" / r.json()["thumb"]).is_file()
        assert not raw.exists() and {d: tree(d) for d in (UPLOADS_DIR, THUMBS_DIR)} == before

    def test_the_private_mount_is_never_cacheable_and_the_normal_ones_are_unchanged(self, client, session):
        Image.new("RGB", (8, 8)).save(session / "outputs" / "x.png")
        Image.new("RGB", (8, 8)).save(OUTPUTS_DIR / "y.png")
        private = client.get(f"/media/private/{SESSION}/outputs/x.png")
        assert private.status_code == 200 and "no-store" in private.headers["cache-control"]
        assert "etag" not in private.headers and "last-modified" not in private.headers
        assert "etag" in client.get("/media/outputs/y.png").headers
        (OUTPUTS_DIR / "y.png").unlink()

    def test_the_session_folders_are_private_to_the_user(self):
        ensure_dirs()
        assert (PRIVATE_DIR.stat().st_mode & 0o077) == 0
