# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Studio settings pushed by Nest (`PUT /engine/v1/runtime/settings`): memory-only values, token, checks. No model."""

import os

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import runtime_settings  # noqa: E402
from app.config import ensure_dirs  # noqa: E402
from app.engines import selected_variants  # noqa: E402
from app.jobs import jobs, load_settings  # noqa: E402
from app.main import app  # noqa: E402

TOKEN = "s3cret-token"
URL = "/engine/v1/runtime/settings"
PUSH = {"keep_alive_minutes": 30, "previews": False, "low_memory": False, "hf_token": "  hf_abc  ",
        "quantize": {"kokoro-82m": 4}, "variant": {"wan-2.2-ti2v-5b": "Q8_0"}}


@pytest.fixture()
def client(monkeypatch):
    ensure_dirs()
    runtime_settings.reset()
    monkeypatch.setattr(jobs, "worker", None)
    monkeypatch.setattr(jobs, "current", None)
    yield TestClient(app)
    runtime_settings.reset()


def test_defaults_apply_until_nest_pushes(client):
    assert not runtime_settings.received()
    assert runtime_settings.get_settings() == {}
    assert load_settings()["keep_alive_minutes"] == 10


def test_push_replaces_studio_keys_and_ignores_unknown_ones(client):
    res = client.put(URL, json=PUSH)
    assert res.status_code == 200
    assert runtime_settings.received()
    st = runtime_settings.get_settings()
    assert st["keep_alive_minutes"] == 30 and st["hf_token"] == "hf_abc"
    runtime_settings.apply({"keep_alive_minutes": 5, "custom_models": [1]})
    assert runtime_settings.get_settings() == {"keep_alive_minutes": 5}
    runtime_settings.apply(PUSH)
    assert load_settings()["previews"] is False
    assert selected_variants() == {"wan-2.2-ti2v-5b": "Q8_0"}


def test_response_never_carries_the_token(client):
    body = client.put(URL, json=PUSH).json()
    assert "hf_token" not in body and body["has_hf_token"] is True
    assert client.put(URL, json={**PUSH, "hf_token": ""}).json()["has_hf_token"] is False


def test_unknown_variant_and_quantization_are_422_and_nothing_applies(client):
    assert client.put(URL, json={**PUSH, "variant": {"nope": "Q4"}}).status_code == 422
    assert client.put(URL, json={**PUSH, "variant": {"wan-2.2-ti2v-5b": "zzz"}}).status_code == 422
    assert client.put(URL, json={**PUSH, "quantize": {"kokoro-82m": 7}}).status_code == 422
    assert not runtime_settings.received()


def test_variant_change_during_a_generation_is_409(client, monkeypatch):
    class Worker:
        model_id = "wan-2.2-ti2v-5b"

    monkeypatch.setattr(jobs, "worker", Worker())
    monkeypatch.setattr(jobs, "current", "message-1")
    assert client.put(URL, json=PUSH).status_code == 409
    assert not runtime_settings.received()


def test_variant_change_unloads_the_loaded_model(client, monkeypatch):
    class Worker:
        model_id = "wan-2.2-ti2v-5b"

    unloaded = []

    async def unload():
        unloaded.append(True)

    monkeypatch.setattr(jobs, "worker", Worker())
    monkeypatch.setattr(jobs, "unload", unload)
    assert client.put(URL, json=PUSH).status_code == 200
    assert unloaded == [True]


def test_route_needs_the_engine_token(client, monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    assert client.put(URL, json=PUSH).status_code == 401
    assert client.put(URL, json=PUSH, headers={"X-Engine-Token": TOKEN}).status_code == 200
    assert client.put("/api/runtime/settings", json=PUSH).status_code == 404  # no `/api` prefix any more
