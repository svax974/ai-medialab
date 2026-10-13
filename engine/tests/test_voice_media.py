# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""`/engine/v1/media/voice-reference` and `/engine/v1/media/transcribe` (Nest-only routes). No model: the transcriber is replaced."""

import io
import os
import tempfile

os.environ["IMAGEGEN_DATA_DIR"] = tempfile.mkdtemp(prefix="ai-medialab-voice-media-")
os.environ["IMAGEGEN_DEMO"] = "1"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
import soundfile as sf  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import transcription  # noqa: E402
from app.api import voice_media  # noqa: E402
from app.config import UPLOADS_DIR, ensure_dirs  # noqa: E402
from app.main import app  # noqa: E402

TOKEN = "s3cret-token"
H = {"X-Engine-Token": TOKEN}


@pytest.fixture()
def client(monkeypatch):
    ensure_dirs()
    monkeypatch.setenv("ENGINE_TOKEN", TOKEN)
    return TestClient(app)


def write_tone(name: str, seconds: float, rate: int = 16000):
    t = np.linspace(0, seconds, int(rate * seconds), endpoint=False)
    path = UPLOADS_DIR / name
    sf.write(str(path), (0.4 * np.sin(2 * np.pi * 220 * t)).astype("float32"), rate, format="WAV")
    return path


class TestVoiceReference:
    def test_the_token_is_required(self, client):
        assert client.post("/engine/v1/media/voice-reference", json={"source_path": "x", "voice_id": "v"}).status_code == 401

    def test_a_clip_becomes_a_24k_reference_with_peaks_and_the_source_stays(self, client):
        src = write_tone("tmp_a", 2.0)
        r = client.post("/engine/v1/media/voice-reference", headers=H, json={"source_path": str(src), "voice_id": "v1"})
        assert r.status_code == 200
        out = r.json()
        assert out["filename"] == "voice_v1.wav" and 1.8 < out["duration"] < 2.4 and len(out["peaks"]) == 120
        data, rate = sf.read(str(UPLOADS_DIR / "voice_v1.wav"))
        assert rate == 24000 and data.ndim == 1
        assert src.exists()

    def test_a_too_short_unreadable_or_outside_clip_is_a_422(self, client, tmp_path):
        short = write_tone("tmp_s", 0.3)
        post = lambda p, v="v2": client.post("/engine/v1/media/voice-reference", headers=H, json={"source_path": str(p), "voice_id": v})  # noqa: E731
        assert "une seconde" in post(short).json()["detail"]
        junk = UPLOADS_DIR / "tmp_j"
        junk.write_bytes(b"not audio")
        assert post(junk).status_code == 422
        outside = tmp_path / "o.wav"
        sf.write(str(outside), np.zeros(24000, dtype="float32"), 24000, format="WAV")
        assert post(outside).status_code == 422
        assert post(UPLOADS_DIR / "missing").status_code == 422
        assert not (UPLOADS_DIR / "voice_v2.wav").exists()

    def test_the_route_is_in_the_schema_and_not_on_the_legacy_prefix(self, client):
        paths = client.get("/openapi.json").json()["paths"]
        assert "/engine/v1/media/voice-reference" in paths and "/engine/v1/media/transcribe" in paths
        assert client.post("/api/media/voice-reference", json={}).status_code != 200


class TestTranscribe:
    def test_the_text_comes_from_the_chosen_model_and_the_language_is_passed(self, client, monkeypatch):
        src = write_tone("tmp_t", 1.5)
        seen = {}
        monkeypatch.setattr(voice_media.transcription, "choose", lambda *a, **k: (object(), ""))
        monkeypatch.setattr(voice_media.transcription, "transcribe",
                            lambda spec, path, lang: seen.update(path=path, lang=lang) or {"text": "bonjour", "language": "fr", "duration": 1.5, "model": "m"})
        r = client.post("/engine/v1/media/transcribe", headers=H, json={"path": str(src), "language": "fr"})
        assert r.status_code == 200 and r.json()["text"] == "bonjour"
        assert seen == {"path": str(src.resolve()), "lang": "fr"}

    def test_no_installed_model_is_a_409_with_the_reason_and_a_failure_is_a_500(self, client, monkeypatch):
        src = write_tone("tmp_t2", 1.5)
        monkeypatch.setattr(voice_media.transcription, "choose", lambda *a, **k: (None, "Aucun modèle"))
        assert client.post("/engine/v1/media/transcribe", headers=H, json={"path": str(src)}).json()["detail"] == "Aucun modèle"
        monkeypatch.setattr(voice_media.transcription, "choose", lambda *a, **k: (object(), ""))

        def boom(*a):
            raise RuntimeError("worker mort")

        monkeypatch.setattr(voice_media.transcription, "transcribe", boom)
        r = client.post("/engine/v1/media/transcribe", headers=H, json={"path": str(src)})
        assert r.status_code == 500 and r.json()["detail"] == "worker mort"

    def test_a_path_outside_the_data_folder_or_missing_is_a_422(self, client, tmp_path):
        assert client.post("/engine/v1/media/transcribe", headers=H, json={"path": str(tmp_path / "x.wav")}).status_code == 422
        assert client.post("/engine/v1/media/transcribe", headers=H, json={"path": str(UPLOADS_DIR / "none")}).status_code == 422
