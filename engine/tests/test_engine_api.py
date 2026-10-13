# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""`/engine/v1` prefix, `X-Engine-Token` check, legacy `/api` untouched, OpenAPI schema. No model, no lifespan."""

import os

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.config import ensure_dirs  # noqa: E402
from app.main import app  # noqa: E402

TOKEN = "s3cret-token"


@pytest.fixture()
def client():
    ensure_dirs()
    db.init_db()
    return TestClient(app)  # no `with`: the lifespan (jobs worker, warm-up) is not started


def test_without_env_token_nothing_is_required(client, monkeypatch):
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    assert client.get("/engine/v1/status").status_code == 200
    assert client.get("/api/status").status_code == 200


def test_token_required_on_engine_routes(client, monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    assert client.get("/engine/v1/voices").status_code == 401
    assert client.get("/engine/v1/voices", headers={"X-Engine-Token": "wrong"}).status_code == 401
    assert client.get("/engine/v1/voices", headers={"X-Engine-Token": TOKEN}).status_code == 200


def test_status_is_open(client, monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    assert client.get("/engine/v1/status").status_code == 200


def test_legacy_api_ignores_token(client, monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    assert client.get("/api/voices").status_code == 200
    assert client.get("/api/status").status_code == 200


def test_both_prefixes_serve_the_same_payload(client, monkeypatch):
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    assert client.get("/api/status").json() == client.get("/engine/v1/status").json()


def test_openapi_only_lists_engine_routes():
    paths = app.openapi()["paths"]
    assert "/engine/v1/status" in paths and "/engine/v1/events" in paths
    assert not any(p.startswith("/api") for p in paths)


def test_committed_openapi_is_current():
    import importlib.util
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "scripts" / "export_engine_openapi.py"
    spec = importlib.util.spec_from_file_location("export_engine_openapi", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.TARGET.read_text() == mod.render(), "engine/openapi.json is stale: run scripts/export_engine_openapi.py"
