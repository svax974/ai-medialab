# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""`POST /engine/v1/updates/advice`: validation, typed refusals and the shape of the answer (the adviser itself is replaced)."""

import os
import time
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import update_advisor  # noqa: E402
from app.api import updates as api  # noqa: E402
from app.config import ensure_dirs  # noqa: E402
from app.main import app  # noqa: E402

ADVICE = {"kind": "engine", "id": "sdcpp", "target": "latest", "from_version": "master-956-1b0ba10", "to_version": "master-1002-abc",
          "verdict": "caution", "summary": "Un point à surveiller.", "notes": ["Issues non lues : limite."], "truncated": 0,
          "rejected": 1, "llm_model_id": "llm-qwen3-4b-instruct-2507", "generated_at": time.time(),
          "findings": [{"severity": "warning", "title": "Lent", "quote": "slower with flash attention", "url": "https://gh/i/1",
                        "source_kind": "issue", "extra": "ignored"}],
          "sources": [{"title": "Issue #1", "url": "https://gh/i/1"}]}


@pytest.fixture()
def client(monkeypatch):
    ensure_dirs()
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    monkeypatch.setattr(api.jobs, "current", None, raising=False)
    monkeypatch.setattr(api.jobs, "pending", [], raising=False)
    return TestClient(app)


def advise(monkeypatch, result=None, error=None, calls=None):
    async def fake(kind, item_id, target="pinned"):
        if calls is not None:
            calls.append((kind, item_id, target))
        if error:
            raise error
        return result

    monkeypatch.setattr(update_advisor, "advise", fake)


class TestAdviceRoute:
    def test_it_returns_the_advice_in_its_public_shape(self, client, monkeypatch):
        calls = []
        advise(monkeypatch, ADVICE, calls=calls)
        res = client.post("/engine/v1/updates/advice", json={"kind": "engine", "id": "sdcpp", "target": "latest"})
        assert res.status_code == 200 and calls == [("engine", "sdcpp", "latest")]
        body = res.json()
        assert body["verdict"] == "caution" and body["findings"][0]["source_kind"] == "issue" and "extra" not in body["findings"][0]
        assert body["notes"] == ["Issues non lues : limite."] and body["sources"][0]["url"] == "https://gh/i/1"

    def test_the_target_defaults_to_the_tested_release(self, client, monkeypatch):
        calls = []
        advise(monkeypatch, ADVICE, calls=calls)
        client.post("/engine/v1/updates/advice", json={"kind": "model", "id": "wan"})
        assert calls == [("model", "wan", "pinned")]

    @pytest.mark.parametrize("body", [{}, {"kind": "pack", "id": "x"}, {"kind": "engine", "id": ""}, {"kind": "engine", "id": "x", "target": "newest"},
                                      {"kind": "engine", "id": "x" * 200}])
    def test_a_bad_body_is_a_422_and_nothing_runs(self, client, monkeypatch, body):
        calls = []
        advise(monkeypatch, ADVICE, calls=calls)
        assert client.post("/engine/v1/updates/advice", json=body).status_code == 422 and calls == []

    @pytest.mark.parametrize("code,status", [("no_model", 409), ("no_engine", 409), ("nothing_to_analyse", 409), ("unsupported", 409),
                                             ("no_sources", 502), ("llm", 504), ("llm_output", 502), ("not_installed", 404)])
    def test_the_refusals_carry_a_code_and_the_message(self, client, monkeypatch, code, status):
        advise(monkeypatch, error=update_advisor.AdvisorError(code, "Texte d'aide.", status))
        res = client.post("/engine/v1/updates/advice", json={"kind": "engine", "id": "sdcpp"})
        assert res.status_code == status and res.json()["detail"] == {"code": code, "message": "Texte d'aide."}

    def test_a_generation_in_progress_refuses_the_analysis(self, client, monkeypatch):
        calls = []
        advise(monkeypatch, ADVICE, calls=calls)
        monkeypatch.setattr(api.jobs, "current", SimpleNamespace(), raising=False)
        res = client.post("/engine/v1/updates/advice", json={"kind": "engine", "id": "sdcpp"})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "busy" and calls == []

    def test_a_second_analysis_is_refused_while_one_runs(self, client, monkeypatch):
        advise(monkeypatch, ADVICE)
        monkeypatch.setattr(api, "_advising", SimpleNamespace(locked=lambda: True))
        res = client.post("/engine/v1/updates/advice", json={"kind": "engine", "id": "sdcpp"})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "busy"
