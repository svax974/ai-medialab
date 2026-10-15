# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""`/engine/v1/updates/*`: what the routes check before they start an installer (no download, no model, no network)."""

import os
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import updates  # noqa: E402
from app.api import updates as api  # noqa: E402
from app.config import ensure_dirs  # noqa: E402
from app.main import app  # noqa: E402

MODEL = next(iter(api.MODELS))


@pytest.fixture()
def client(monkeypatch):
    ensure_dirs()
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    monkeypatch.setattr(api.jobs, "current", None, raising=False)
    monkeypatch.setattr(api.jobs, "worker", None, raising=False)
    return TestClient(app)


def row(state, **extra):
    return {"id": MODEL, "state": state, "size_gb": 1.5, "error": None, **extra}


class TestCheck:
    def test_it_returns_engines_and_models(self, client, monkeypatch):
        monkeypatch.setattr(updates, "check_all", lambda: {"engines": [], "models": [row("current")], "checked_at": 1.0})
        body = client.get("/engine/v1/updates/check").json()
        assert body["models"][0]["state"] == "current" and body["engines"] == []


class TestModelUpdate:
    def start_recorder(self, monkeypatch):
        calls = []

        async def start(model_id, **kwargs):
            calls.append((model_id, kwargs))
            return SimpleNamespace(public=lambda: {"model_id": model_id, "state": "running"})

        monkeypatch.setattr(api.downloads, "start", start)
        return calls

    def test_an_update_downloads_again_with_the_size_of_what_changed(self, client, monkeypatch):
        monkeypatch.setattr(updates, "check_models", lambda only=None: [row("update")])
        calls = self.start_recorder(monkeypatch)
        res = client.post(f"/engine/v1/updates/models/{MODEL}")
        assert res.status_code == 200 and res.json()["state"] == "running"
        assert calls == [(MODEL, {"refresh": True, "need_gb": 1.5})]

    @pytest.mark.parametrize("rows,status", [([], 409), ([row("current")], 409), ([row("error", error="Pas de réseau.")], 409)])
    def test_nothing_starts_without_an_update(self, client, monkeypatch, rows, status):
        monkeypatch.setattr(updates, "check_models", lambda only=None: rows)
        calls = self.start_recorder(monkeypatch)
        assert client.post(f"/engine/v1/updates/models/{MODEL}").status_code == status and calls == []

    def test_an_unknown_model_is_a_404(self, client):
        assert client.post("/engine/v1/updates/models/nope").status_code == 404

    def test_a_model_in_memory_is_refused(self, client, monkeypatch):
        monkeypatch.setattr(api.jobs, "worker", SimpleNamespace(model_id=MODEL, alive=True))
        assert client.post(f"/engine/v1/updates/models/{MODEL}").status_code == 409

    def test_a_refused_start_is_a_409(self, client, monkeypatch):
        monkeypatch.setattr(updates, "check_models", lambda only=None: [row("update")])

        async def start(*args, **kwargs):
            raise RuntimeError("Un autre téléchargement est déjà en cours.")

        monkeypatch.setattr(api.downloads, "start", start)
        res = client.post(f"/engine/v1/updates/models/{MODEL}")
        assert res.status_code == 409 and "autre téléchargement" in res.json()["detail"]


class TestEngineUpdate:
    def engines(self, monkeypatch, *rows):
        monkeypatch.setattr(updates, "check_engines", lambda *a, **k: list(rows))

    def recorders(self, monkeypatch):
        calls = []

        async def sd(variant=None, tag=None):
            calls.append(("sdcpp", variant, tag))
            return {"state": "running"}

        async def pack(pack_id, tag=None):
            calls.append(("pack", pack_id, tag))
            return {"state": "running"}

        monkeypatch.setattr(api.sdcpp_installer, "start", sd)
        monkeypatch.setattr(api.pack_installer, "start", pack)
        return calls

    def test_sdcpp_is_installed_again_in_the_variant_that_is_there(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "update", "variant": "metal", "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/sdcpp").status_code == 200
        assert calls == [("sdcpp", "metal", None)]

    def test_a_pack_goes_through_the_pack_installer(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "qwen3", "state": "update", "variant": None, "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/qwen3").status_code == 200 and calls == [("pack", "qwen3", None)]

    def test_an_engine_that_is_current_or_missing_is_refused(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "current", "variant": "metal", "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/sdcpp").status_code == 409
        assert client.post("/engine/v1/updates/engines/audiocpp").status_code == 404 and calls == []

    def test_nothing_is_replaced_while_a_generation_runs(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "update", "variant": "metal", "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        monkeypatch.setattr(api.jobs, "current", object(), raising=False)
        assert client.post("/engine/v1/updates/engines/sdcpp").status_code == 409 and calls == []

    def test_a_pack_in_use_by_the_loaded_model_is_refused(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "qwen3", "state": "update", "variant": None, "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        loaded = next(m for m in api.MODELS.values() if m.options.get("pack") == "qwen3")
        monkeypatch.setattr(api.jobs, "worker", SimpleNamespace(model_id=loaded.id, alive=True))
        assert client.post("/engine/v1/updates/engines/qwen3").status_code == 409 and calls == []

    def test_the_latest_release_is_installed_by_its_tag_even_when_the_pinned_one_is_current(self, client, monkeypatch):
        latest = {"tag": "master-999-zzz", "regressions": []}
        self.engines(monkeypatch, {"id": "sdcpp", "state": "current", "variant": "metal", "latest": latest, "rollback": False},
                     {"id": "audiocpp", "state": "update", "variant": "metal", "latest": {"tag": "v1.0.0", "regressions": []}, "rollback": False})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/sdcpp?target=latest").status_code == 200
        assert client.post("/engine/v1/updates/engines/audiocpp?target=latest").status_code == 200
        assert calls == [("sdcpp", "metal", "master-999-zzz"), ("pack", "audiocpp", "v1.0.0")]

    def test_latest_needs_a_newer_release_and_pinned_stays_the_default(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "current", "variant": "metal", "latest": None, "rollback": False},
                     {"id": "qwen3", "state": "update", "variant": None, "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/sdcpp?target=latest").status_code == 409  # nothing newer is known
        assert client.post("/engine/v1/updates/engines/qwen3?target=latest").status_code == 409  # a Python pack has no latest
        assert client.post("/engine/v1/updates/engines/sdcpp?target=pinned").status_code == 409  # already on the pin
        assert calls == []

    def test_a_build_newer_than_the_pin_can_go_back_to_the_pinned_release(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "current", "variant": "metal", "latest": None, "rollback": True})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/sdcpp").status_code == 200 and calls == [("sdcpp", "metal", None)]

    def test_only_the_known_targets_are_accepted(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "update", "variant": "metal", "latest": None, "rollback": False})
        calls = self.recorders(monkeypatch)
        assert client.post("/engine/v1/updates/engines/sdcpp?target=master-1").status_code == 422 and calls == []

    def test_latest_is_still_refused_while_a_generation_runs(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "sdcpp", "state": "current", "variant": "metal", "latest": {"tag": "x", "regressions": []}, "rollback": False})
        calls = self.recorders(monkeypatch)
        monkeypatch.setattr(api.jobs, "current", object(), raising=False)
        assert client.post("/engine/v1/updates/engines/sdcpp?target=latest").status_code == 409 and calls == []

    def test_a_refused_start_is_a_409(self, client, monkeypatch):
        self.engines(monkeypatch, {"id": "qwen3", "state": "update", "variant": None, "latest": None, "rollback": False})

        async def pack(pack_id, tag=None):
            raise RuntimeError("Une autre installation de moteur audio est déjà en cours.")

        monkeypatch.setattr(api.pack_installer, "start", pack)
        assert client.post("/engine/v1/updates/engines/qwen3").status_code == 409
