# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Worker lifecycle with fake processes. No model imports, hardware probes or external network."""

import asyncio
import json
from types import SimpleNamespace

import anyio
import pytest

from app import transcript_job as job


class Process:
    pid = 987654
    returncode = None

    def __init__(self):
        self.stdout = asyncio.StreamReader()
        async def drain(): pass
        self.stdin = SimpleNamespace(write=lambda _: None, drain=drain, close=lambda: None)

    async def wait(self):
        self.stdout.feed_eof()
        self.returncode = -9
        return -9


@pytest.fixture
def worker(monkeypatch):
    state = SimpleNamespace(process=None, killed=[], registered=[], removed=[], refusal=None)

    async def spawn(*args, **kwargs):
        state.process = Process()
        return state.process

    async def room(*args):
        return state.refusal

    class Guard:
        def __init__(self, callback): pass
        def begin_job(self): pass
        def start(self): pass
        def stop(self): pass
        def tripped(self, pid): return None

    monkeypatch.setattr(job, '_lock', asyncio.Lock())
    monkeypatch.setattr(job, '_process', None)
    monkeypatch.setattr(job.asyncio, 'create_subprocess_exec', spawn)
    monkeypatch.setattr(job.memory_budget, 'make_room', room)
    monkeypatch.setattr(job.memory_budget, 'register', state.registered.append)
    monkeypatch.setattr(job.memory_budget, 'unregister', state.removed.append)
    monkeypatch.setattr(job.memory_guard, 'preflight', lambda *args: None)
    monkeypatch.setattr(job.memory_guard, 'available_gb', lambda: 10)
    monkeypatch.setattr(job.memory_guard, 'total_gb', lambda: 36)
    monkeypatch.setattr(job.memory_guard, 'MemoryWatchdog', Guard)
    monkeypatch.setattr(job.memory_guard, 'kill_tree', state.killed.append)
    return state


SPEC = SimpleNamespace(id='whisper', name='Whisper', weights_gb=0.5)


def test_refusal_does_not_spawn_a_model(worker):
    worker.refusal = 'memory refusal'

    async def run():
        return [event async for event in job.read(SPEC, {})]

    assert asyncio.run(run()) == [{'type': 'error', 'code': 'memory', 'message': 'memory refusal'}]
    assert worker.process is None
    assert not job.busy()


def test_disconnect_stops_tree_and_releases_budget(worker):
    async def run():
        stream = job.read(SPEC, {})
        pending = asyncio.create_task(anext(stream))
        while worker.process is None:
            await asyncio.sleep(0)
        worker.process.stdout.feed_data((json.dumps({'type': 'segment', 'text': 'partial'}) + '\n').encode())
        assert (await pending)['text'] == 'partial'
        assert job.busy()
        await stream.aclose()

    asyncio.run(run())
    assert worker.killed == [987654]
    assert worker.removed == ['transcription']
    assert not job.busy() and job._process is None


def test_cancelled_starlette_scope_still_acknowledges_process_exit(worker):
    async def consume():
        async for _event in job.read(SPEC, {}):
            pass

    async def run():
        async with anyio.create_task_group() as group:
            group.start_soon(consume)
            while worker.process is None:
                await anyio.sleep(0)
            group.cancel_scope.cancel()

    anyio.run(run)
    assert worker.killed == [987654]
    assert worker.process.returncode == -9
    assert worker.removed == ['transcription']


def test_unexpected_eof_is_a_failure_and_done_stops_cleanly(worker):
    async def run(terminal):
        stream = job.read(SPEC, {})
        pending = asyncio.create_task(anext(stream))
        while worker.process is None:
            await asyncio.sleep(0)
        if terminal:
            worker.process.stdout.feed_data(b'{"type":"done"}\n')
        worker.process.stdout.feed_eof()
        result = await pending
        await stream.aclose()
        return result

    assert asyncio.run(run(False))['type'] == 'error'
    worker.process = None
    assert asyncio.run(run(True)) == {'type': 'done'}


def test_stop_acknowledges_stream_cleanup_before_returning(worker):
    async def consume():
        return [event async for event in job.read(SPEC, {})]

    async def run():
        running = asyncio.create_task(consume())
        while worker.process is None:
            await asyncio.sleep(0)
        await job.stop()
        assert not job.busy()
        await running

    asyncio.run(run())
    assert worker.process.returncode == -9
    assert worker.removed == ['transcription']


def test_worker_environment_excludes_secrets_and_python_hooks(monkeypatch):
    monkeypatch.setenv('ENGINE_TOKEN', 'FAKE-engine')
    monkeypatch.setenv('HF_TOKEN', 'FAKE-hub')
    monkeypatch.setenv('PYTHONPATH', '/tmp/untrusted')
    env = job.worker_env()
    assert 'ENGINE_TOKEN' not in env and 'HF_TOKEN' not in env and 'untrusted' not in env['PYTHONPATH']
    assert env['HF_HUB_OFFLINE'] == '1'
    assert str(job.ROOT_DIR / 'engine-runtime/site-packages') in env['PYTHONPATH']
