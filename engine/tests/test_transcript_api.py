# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Internal API validation and SSE, using a fake worker and no lifespan/model startup."""

import os
from types import SimpleNamespace

os.environ.setdefault('IMAGEGEN_DATA_DIR', '/tmp/ai-medialab-tests')

import pytest
from fastapi.testclient import TestClient
from app import config
from app.api import transcripts as api
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('ENGINE_TOKEN', 'FAKE-transcript-token')
    monkeypatch.setattr(config, 'DATA_DIR', tmp_path)
    monkeypatch.setattr(api.jobs, 'busy', lambda: False)
    monkeypatch.setattr(api, 'llm', SimpleNamespace(generating=False))
    monkeypatch.setattr(api, 'ocr_llm', SimpleNamespace(generating=False))
    monkeypatch.setattr(api.transcription, 'choose', lambda *args: (SimpleNamespace(id='whisper'), ''))
    monkeypatch.setattr(api.audio_packs, 'is_installed', lambda _: True)
    return TestClient(app, headers={'X-Engine-Token': 'FAKE-transcript-token'})


def body(tmp_path):
    source = tmp_path / 'source.mp4'
    source.write_bytes(b'fake')
    return {'folder': str(tmp_path), 'path': str(source), 'model_id': 'whisper-small'}


def test_token_and_source_boundaries(client, tmp_path):
    request = body(tmp_path)
    assert client.post('/engine/v1/transcripts/read', json=request, headers={'X-Engine-Token': 'wrong'}).status_code == 401
    assert client.post('/engine/v1/transcripts/read', json={**request, 'path': '/etc/passwd'}).status_code == 422
    assert client.post('/engine/v1/transcripts/read', json={**request, 'url': 'https://youtu.be/abcdefghijk'}).status_code == 422
    assert client.post('/engine/v1/transcripts/read', json={**request, 'path': None, 'url': 'http://localhost/'}).status_code == 422
    assert client.post('/engine/v1/transcripts/read', json={**request, 'language': '../fr'}).status_code == 422


def test_busy_and_missing_reader_refusals(client, tmp_path, monkeypatch):
    request = body(tmp_path)
    monkeypatch.setattr(api.jobs, 'busy', lambda: True)
    assert client.post('/engine/v1/transcripts/read', json=request).status_code == 409
    monkeypatch.setattr(api.jobs, 'busy', lambda: False)
    monkeypatch.setattr(api.audio_packs, 'is_installed', lambda _: False)
    assert client.post('/engine/v1/transcripts/read', json=request).status_code == 409


def test_stream_and_stop_use_the_owned_worker(client, tmp_path, monkeypatch):
    recorded = []

    async def read(spec, request):
        recorded.append(request)
        yield {'type': 'segment', 'text': 'all the words', 'index': 0, 'done': 90, 'language': 'en'}
        yield {'type': 'done'}

    async def stop(): recorded.append('stopped')

    monkeypatch.setattr(api.transcript_job, 'read', read)
    monkeypatch.setattr(api.transcript_job, 'stop', stop)
    response = client.post('/engine/v1/transcripts/read', json={**body(tmp_path), 'path': None, 'url': 'https://youtu.be/abcdefghijk?list=ignored'})
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/event-stream')
    assert 'all the words' in response.text and '"done"' in response.text
    assert recorded[0]['url'] == 'https://www.youtube.com/watch?v=abcdefghijk'
    assert client.post('/engine/v1/transcripts/stop').json() == {'ok': True}
    assert recorded[-1] == 'stopped'
