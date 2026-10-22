# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""`/engine/v1` prefix, `X-Engine-Token` check, no `/api` prefix, OpenAPI schema. No model, no lifespan."""

import os

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import ensure_dirs  # noqa: E402
from app.main import app  # noqa: E402

TOKEN = "s3cret-token"


@pytest.fixture()
def client():
    ensure_dirs()
    return TestClient(app)  # no `with`: the lifespan (jobs worker, warm-up) is not started


def test_without_env_token_nothing_is_required(client, monkeypatch):
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    assert client.get("/engine/v1/status").status_code == 200


def test_token_required_on_engine_routes(client, monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    assert client.get("/engine/v1/jobs").status_code == 401
    assert client.get("/engine/v1/jobs", headers={"X-Engine-Token": "wrong"}).status_code == 401
    assert client.get("/engine/v1/jobs", headers={"X-Engine-Token": TOKEN}).status_code == 200


def test_status_is_open(client, monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    assert client.get("/engine/v1/status").status_code == 200


def test_there_is_no_api_prefix_any_more(client, monkeypatch):
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    for path in ("/api/status", "/api/voices", "/api/conversations", "/engine/v1/voices", "/engine/v1/conversations"):
        assert client.get(path).status_code == 404, path


def test_media_is_served_without_a_token(client, monkeypatch):
    from app.config import UPLOADS_DIR

    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    (UPLOADS_DIR / "probe.txt").write_text("x")
    try:
        assert client.get("/media/uploads/probe.txt").status_code == 200
    finally:
        (UPLOADS_DIR / "probe.txt").unlink(missing_ok=True)


def test_openapi_only_lists_engine_routes():
    paths = app.openapi()["paths"]
    assert "/engine/v1/status" in paths and "/engine/v1/events" in paths
    assert not any(p.startswith("/api") for p in paths)


def test_committed_openapi_is_current():
    import importlib.util
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "scripts-local" / "export_engine_openapi.py"
    spec = importlib.util.spec_from_file_location("export_engine_openapi", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.TARGET.read_text() == mod.render(), "engine/openapi.json is stale: run scripts-local/export_engine_openapi.py"
