# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Chat models: the llama-server manager, the event stream, the memory arbitration and the routes, against a FAKE
`llama-server` (a Python script that answers like the real one's HTTP API: no llama.cpp, no model, no torch)."""

import asyncio
import dataclasses
import json
import os
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import httpx  # noqa: E402
import pytest  # noqa: E402

from app import config, llm as llm_module, llamacpp, memory_budget, memory_guard  # noqa: E402
from app.engines import MODELS  # noqa: E402
from app.engines.base import LlmCaps  # noqa: E402
from app.llm import ChatEvents, LlmBusy, LlmError, LlmManager, LlmNotFound, build_command, iter_sse  # noqa: E402

FAKE = textwrap.dedent('''\
    #!{python}
    import json, os, sys, time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    a = sys.argv[1:]
    opt = lambda name, default=None: a[a.index(name) + 1] if name in a else default
    port, ctx, key = int(opt("--port")), int(opt("--ctx-size", "4096")), os.environ.get("LLAMA_API_KEY", "")
    log, delay, mode = os.environ.get("FAKE_LLAMA_LOG"), float(os.environ.get("FAKE_LLAMA_LOAD_DELAY", "0")), os.environ.get("FAKE_LLAMA_MODE", "")
    started = time.time()

    def note(**kw):
        if log:
            with open(log, "a") as f:
                f.write(json.dumps(kw) + "\\n")

    note(event="start", argv=a, has_key=bool(key), pid=os.getpid(), env_has_token="HF_TOKEN" in os.environ)
    if mode == "crash":
        print("llama-server: error: could not load the model", flush=True); sys.exit(3)
    if mode == "oom":
        print("ggml_metal: failed to allocate buffer, out of memory", flush=True); sys.exit(1)

    def text_of(msg):
        c = msg.get("content")
        return c if isinstance(c, str) else " ".join(p.get("text", "") for p in c or [] if p.get("type") == "text")

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args): pass

        def send_json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                loading = time.time() - started < delay
                return self.send_json(503 if loading else 200, {{"error": {{"code": 503, "message": "Loading model"}}}} if loading else {{"status": "ok"}})
            self.send_json(404, {{}})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{{}}")
            if self.headers.get("Authorization") != "Bearer " + key:
                return self.send_json(401, {{"error": {{"message": "bad key"}}}})
            if self.path == "/tokenize":
                return self.send_json(200, {{"tokens": list(range(len(body.get("content", "").split())))}})
            if self.path != "/v1/chat/completions":
                return self.send_json(404, {{}})
            note(event="chat", payload=body)
            user = text_of(body["messages"][-1])
            if "ctx" in user:
                return self.send_json(400, {{"error": {{"code": 400, "type": "exceed_context_size_error", "message": "too long",
                                                     "n_prompt_tokens": 9000, "n_ctx": ctx}}}})
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            def chunk(delta=None, finish=None, **extra):
                choices = [{{"index": 0, "delta": delta or {{}}, "finish_reason": finish}}] if delta is not None or finish else []
                self.wfile.write(("data: " + json.dumps({{"id": "c1", "choices": choices, **extra}}) + "\\n\\n").encode()); self.wfile.flush()
            try:
                if "slow" in user:
                    for i in range(400):
                        chunk({{"content": "mot%d " % i}}); time.sleep(0.05)
                    return
                if "think" in user:
                    chunk({{"reasoning_content": "Je "}}); chunk({{"reasoning_content": "réfléchis."}})
                if "tool" in user:
                    chunk({{"tool_calls": [{{"index": 0, "id": "call_1", "type": "function", "function": {{"name": "search", "arguments": ""}}}}]}})
                    chunk({{"tool_calls": [{{"index": 0, "function": {{"arguments": "{{\\"q\\": "}}}}]}}); chunk({{"tool_calls": [{{"index": 0, "function": {{"arguments": "\\"x\\"}}"}}}}]}})
                    chunk({{}}, "tool_calls")
                else:
                    chunk({{"content": "Bon"}}); chunk({{"content": "jour"}}); chunk({{}}, "stop")
                words = sum(len(text_of(m).split()) for m in body["messages"])
                chunk(timings={{"cache_n": 2, "prompt_n": words, "prompt_ms": 12.5, "predicted_n": 2, "predicted_ms": 40.0,
                               "predicted_per_second": 50.0}})
                chunk(usage={{"prompt_tokens": words + 2, "completion_tokens": 2, "total_tokens": words + 4}})
                self.wfile.write(b"data: [DONE]\\n\\n"); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                note(event="closed")

    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
''')

MAC36 = {"os": "Darwin", "arch": "arm64", "ram_gb": 36.0, "unusable_gpus": [], "disk": {"free_gb": 500.0},
         "accelerators": [{"vendor": "apple", "backend": "metal", "memory_gb": 36.0, "unified": True}],
         "engines": {"llamacpp": {"available": True, "variant": "metal", "binary": "/x/llama-server"}}}


@pytest.fixture
def env(tmp_path, monkeypatch):
    folder = tmp_path / "llamacpp" / "metal"
    folder.mkdir(parents=True)
    (folder / "llama-server").write_text(FAKE.format(python=sys.executable))
    (folder / "llama-server").chmod(0o755)
    (folder / "VERSION.json").write_text(json.dumps({"tag": "b11312"}))
    log = tmp_path / "fake.log"
    monkeypatch.setenv("IMAGEGEN_LLAMACPP_DIR", str(tmp_path / "llamacpp"))
    monkeypatch.setenv("FAKE_LLAMA_LOG", str(log))
    monkeypatch.setenv("HF_TOKEN", "must-not-leak")
    for name in ("FAKE_LLAMA_MODE", "FAKE_LLAMA_LOAD_DELAY"):
        monkeypatch.delenv(name, raising=False)
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(config, "DATA_DIR", data)

    def model_file(repo, filename):
        p = tmp_path / "models" / repo.replace("/", "--") / filename
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"gguf")
        return p

    monkeypatch.setattr(llm_module, "llamacpp_model_file", model_file)
    monkeypatch.setattr("app.downloads.downloads.status", lambda spec: {"state": "installed", "size_gb": 1.0, "need_gb": 0.0})
    monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC36)
    monkeypatch.setattr(memory_guard, "available_gb", lambda: 30.0)
    monkeypatch.setattr("app.jobs.jobs.current", None)
    monkeypatch.setattr("app.jobs.jobs.pending", [])
    monkeypatch.setattr("app.jobs.jobs.worker", None)
    manager = LlmManager()
    return SimpleNamespace(manager=manager, log=log, tmp=tmp_path, data=data, monkeypatch=monkeypatch)


def log_events(env, kind: str | None = None) -> list[dict]:
    if not env.log.exists():
        return []
    events = [json.loads(line) for line in env.log.read_text().splitlines() if line.strip()]
    return [e for e in events if kind is None or e["event"] == kind]


def user(text, *parts):
    return {"role": "user", "content": [{"type": "text", "text": text}, *parts] if parts else text}


async def reply(env, model_id="llm-qwen3-4b-instruct-2507", text="bonjour", **request):
    """All the events of one reply, through the same three steps as the route (check, prepare, chat)."""
    request = {"model_id": model_id, "messages": [user(text)], **request}
    manager = env.manager
    spec = manager.precheck(model_id, request.get("context_size"))
    payload = manager.prepare(spec, request)
    return [e async for e in manager.chat(spec, request, payload)]


def run(env, scenario):
    async def main():
        try:
            return await scenario()
        finally:
            await env.manager.stop()

    return asyncio.run(main())


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


class TestStream:
    def test_a_reply_is_loading_then_deltas_then_usage_then_done(self, env):
        events = run(env, lambda: reply(env))
        kinds = [e["type"] for e in events]
        assert kinds[0] == "loading" and kinds[-2:] == ["usage", "done"]
        assert "".join(e["content"] for e in events if e["type"] == "delta") == "Bonjour"
        assert set(kinds) <= {"loading", "delta", "usage", "done"}
        usage = next(e for e in events if e["type"] == "usage")
        assert usage == {"type": "usage", "prompt_tokens": 3, "completion_tokens": 2, "cached_tokens": 2,
                         "tokens_per_second": 50.0, "prompt_ms": 12.5, "predicted_ms": 40.0, "context_size": 16384}
        assert events[-1] == {"type": "done", "finish_reason": "stop"}

    def test_the_server_is_started_locally_with_the_documented_flags_and_the_key_in_the_environment(self, env):
        run(env, lambda: reply(env))
        (start,) = log_events(env, "start")
        argv = start["argv"]
        assert argv[argv.index("--host") + 1] == "127.0.0.1" and argv[argv.index("--ctx-size") + 1] == "16384"
        assert argv[argv.index("--parallel") + 1] == "1" and argv[argv.index("-ngl") + 1] == "all"
        assert {"--jinja", "--no-webui", "--no-slots"} <= set(argv) and "--mmproj" not in argv
        assert argv[argv.index("--cache-ram") + 1] == "1024"  # not the 8 GiB default
        assert argv[argv.index("--reasoning-format") + 1] == "deepseek" and argv[argv.index("--alias") + 1] == "llm-qwen3-4b-instruct-2507"
        assert "--api-key" not in argv and start["has_key"] is True  # the key never shows in the process list
        assert not any(a for a in argv if "must-not-leak" in a)
        assert int(argv[argv.index("--port") + 1]) > 1024

    def test_sampling_parameters_reach_the_server_and_the_cache_is_asked_for(self, env):
        params = {"temperature": 0.3, "top_p": 0.9, "top_k": 40, "min_p": 0.05, "repeat_penalty": 1.1,
                  "presence_penalty": 0.2, "frequency_penalty": 0.1, "max_tokens": 64, "seed": 7, "stop": ["END"]}
        run(env, lambda: reply(env, params=params))
        (chat,) = log_events(env, "chat")
        payload = chat["payload"]
        assert {k: payload[k] for k in params} == params
        assert payload["stream"] is True and payload["stream_options"] == {"include_usage": True} and payload["cache_prompt"] is True
        assert "tools" not in payload and "reasoning_effort" not in payload

    def test_reasoning_and_tool_calls_are_separated_from_the_answer(self, env):
        events = run(env, lambda: reply(env, "llm-qwen3-8b", "think about it and use a tool", tools=[{"type": "function", "function": {"name": "search"}}]))
        assert [e["content"] for e in events if e["type"] == "reasoning"] == ["Je ", "réfléchis."]
        (calls,) = [e for e in events if e["type"] == "tool_calls"]
        assert calls["calls"] == [{"id": "call_1", "type": "function", "function": {"name": "search", "arguments": '{"q": "x"}'}}]
        assert events[-1] == {"type": "done", "finish_reason": "tool_calls"}
        assert not any(e["type"] == "delta" for e in events)
        (chat,) = log_events(env, "chat")
        assert chat["payload"]["tools"][0]["function"]["name"] == "search" and chat["payload"]["parallel_tool_calls"] is False

    def test_the_reasoning_choice_becomes_the_effort_the_model_understands(self, env):
        run(env, lambda: reply(env, "llm-qwen3-8b", reasoning="off"))
        assert log_events(env, "chat")[0]["payload"]["reasoning_effort"] == "none"
        run(env, lambda: reply(env, "llm-gpt-oss-20b", reasoning="high"))
        assert log_events(env, "chat")[1]["payload"]["reasoning_effort"] == "high"

    def test_a_context_overflow_is_an_error_event_with_the_figures(self, env):
        async def scenario():
            return await reply(env, text="ctx"), env.manager.status()["state"]

        events, state = run(env, scenario)
        error = events[-1]
        assert error["type"] == "error" and error["code"] == "context_exceeded"
        assert (error["n_prompt_tokens"], error["n_ctx"]) == (9000, 16384) and "9000" in error["message"]
        assert state == "ready"  # the server is fine, only this request was too long

    def test_the_conversation_is_sent_whole_every_time_and_the_engine_keeps_nothing(self, env):
        async def scenario():
            history = [user("première"), {"role": "assistant", "content": "ok"}, user("deuxième")]
            return await reply(env, messages=history)

        run(env, scenario)
        assert [m["content"] for m in log_events(env, "chat")[0]["payload"]["messages"]] == ["première", "ok", "deuxième"]


class TestLoading:
    def test_the_same_model_and_context_is_reused_and_a_new_context_or_model_reloads(self, env):
        async def scenario():
            await reply(env)
            first = env.manager.server.proc.pid
            await reply(env, text="encore")
            same = env.manager.server.proc.pid
            await reply(env, context_size=4096)
            resized = env.manager.server.proc.pid
            await reply(env, "llm-lfm2.5-1.2b")
            return first, same, resized, env.manager.server.proc.pid

        first, same, resized, switched = run(env, scenario)
        assert first == same and len({first, resized, switched}) == 3
        starts = log_events(env, "start")
        assert len(starts) == 3
        assert [s["argv"][s["argv"].index("--ctx-size") + 1] for s in starts] == ["16384", "4096", "16384"]
        assert not alive(first) and not alive(resized)  # one model in memory: the previous server is gone

    def test_the_context_is_kept_within_what_the_model_supports(self, env):
        run(env, lambda: reply(env, "llm-qwen3-1.7b", context_size=1_000_000))
        assert log_events(env, "start")[0]["argv"][log_events(env, "start")[0]["argv"].index("--ctx-size") + 1] == "32768"

    def test_a_vision_model_gets_its_projector_and_reads_images(self, env):
        image = {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgo="}}
        run(env, lambda: reply(env, "llm-gemma-4-e4b", messages=[user("décris", image)]))
        argv = log_events(env, "start")[0]["argv"]
        assert argv[argv.index("--mmproj") + 1].endswith("gemma-4-E4B-it-mmproj.gguf")
        parts = log_events(env, "chat")[0]["payload"]["messages"][0]["content"]
        assert parts[1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgo="}}

    def test_an_image_of_the_data_folder_is_read_by_the_engine(self, env):
        (env.data / "uploads").mkdir()
        (env.data / "uploads" / "p.png").write_bytes(b"\x89PNG data")
        image = {"type": "image_url", "image_url": {"url": str(env.data / "uploads" / "p.png")}}
        run(env, lambda: reply(env, "llm-gemma-4-e4b", messages=[user("décris", image)]))
        sent = log_events(env, "chat")[0]["payload"]["messages"][0]["content"][1]["image_url"]["url"]
        assert sent.startswith("data:image/png;base64,") and "/" not in sent[:22].replace("data:image/png;base64,", "")

    def test_the_status_follows_the_server(self, env):
        async def scenario():
            before = env.manager.status()
            await reply(env, "llm-gemma-4-e4b")
            during = env.manager.status()
            await env.manager.stop()
            return before, during, env.manager.status()

        before, during, after = run(env, scenario)
        assert before["state"] == "idle" and before["model_id"] is None
        assert during["state"] == "ready" and during["model_id"] == "llm-gemma-4-e4b" and during["vision"] is True
        assert during["context_size"] == 16384 and during["variant"] == "QAT Q4_0" and during["pid"]
        assert after["state"] == "idle" and after["model_id"] is None and not alive(during["pid"])

    def test_loading_reports_its_progress_until_the_server_is_healthy(self, env):
        env.monkeypatch.setenv("FAKE_LLAMA_LOAD_DELAY", "1.6")
        events = run(env, lambda: reply(env))
        loading = [e for e in events if e["type"] == "loading"]
        assert loading[0]["phase"] == "starting" and any(e["phase"] == "loading" and e["elapsed_s"] >= 1 for e in loading)
        assert events[-1]["type"] == "done"

    def test_a_server_that_dies_while_loading_gives_a_message(self, env):
        env.monkeypatch.setenv("FAKE_LLAMA_MODE", "crash")
        events = run(env, lambda: reply(env))
        assert events[-1]["type"] == "error" and events[-1]["code"] == "refused"
        assert "code 3" in events[-1]["message"] and "could not load the model" in events[-1]["message"]
        assert env.manager.status()["state"] == "idle" and env.manager.server is None
        assert env.manager.last_error == events[-1]["message"]

    def test_an_out_of_memory_exit_is_explained(self, env):
        env.monkeypatch.setenv("FAKE_LLAMA_MODE", "oom")
        events = run(env, lambda: reply(env))
        assert "Mémoire insuffisante pour charger" in events[-1]["message"]

    def test_the_memory_watchdog_kills_a_server_that_runs_the_machine_out(self, env):
        env.monkeypatch.setenv("FAKE_LLAMA_LOAD_DELAY", "30")
        manager = env.manager
        manager.guard = memory_guard.MemoryWatchdog(manager._watched_pid, reserve=3.0, read_available=lambda: 1.0,
                                                    read_pressure=lambda: 1)

        async def scenario():
            await manager.start()
            return await reply(env)

        events = run(env, scenario)
        manager.guard.stop()
        assert events[-1]["type"] == "error" and "protection mémoire" in events[-1]["message"]
        assert manager.server is None and not [p for p in log_events(env, "start") if alive(p["pid"])]


class TestMemoryRules:
    def test_not_enough_free_memory_refuses_before_anything_starts(self, env):
        env.monkeypatch.setattr(memory_guard, "available_gb", lambda: 6.0)
        events = run(env, lambda: reply(env, "llm-qwen3-8b"))
        assert events[-1]["type"] == "error" and events[-1]["code"] == "refused"
        assert "Mémoire insuffisante" in events[-1]["message"] and "6,0 Go libres" in events[-1]["message"]
        assert log_events(env, "start") == []  # nothing was launched

    def test_a_graphics_card_with_its_own_memory_skips_the_unified_memory_check(self, env):
        discrete = {**MAC36, "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 24.0, "unified": False}]}
        env.monkeypatch.setattr("app.system.get_system", lambda refresh=False: discrete)
        env.monkeypatch.setattr(memory_guard, "available_gb", lambda: 1.0)
        assert run(env, lambda: reply(env))[-1]["type"] == "done"
        argv = log_events(env, "start")[0]["argv"]
        assert argv[argv.index("-ngl") + 1] == "all"  # 24 GB of VRAM hold a 4B model entirely

    def test_a_model_too_big_for_the_card_leaves_the_layer_placement_to_llama_cpp(self, env):
        small = {**MAC36, "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 4.0, "unified": False}]}
        env.monkeypatch.setattr("app.system.get_system", lambda refresh=False: small)
        run(env, lambda: reply(env, "llm-qwen3-8b"))
        assert "-ngl" not in log_events(env, "start")[0]["argv"]  # `--fit` (on by default) places the layers

    def test_a_running_generation_refuses_the_chat_and_a_queued_one_too(self, env):
        env.monkeypatch.setattr("app.jobs.jobs.current", "message-1")
        with pytest.raises(LlmBusy, match="génération de médias") as exc:
            env.manager.precheck("llm-qwen3-8b")
        assert exc.value.status == 409
        env.monkeypatch.setattr("app.jobs.jobs.current", None)
        env.monkeypatch.setattr("app.jobs.jobs.pending", ["message-2"])
        with pytest.raises(LlmBusy):
            env.manager.precheck("llm-qwen3-8b")

    def _tight_ceiling(self, env, *model_ids):
        """A ceiling that holds any one of the models but never two of them together."""
        from app.engines import get_spec
        from app.engines.llm_models import memory_need_gb

        sizes = [memory_need_gb(get_spec(i), get_spec(i).llm.context_default) if get_spec(i).llm else get_spec(i).weights_gb
                 for i in model_ids]
        env.monkeypatch.setattr("app.memory_budget.ceiling_gb", lambda machine=None: max(sizes) + 0.1)

    def test_the_generation_worker_leaves_before_the_chat_model_loads_when_both_do_not_fit(self, env):
        calls = []

        async def unload():
            calls.append("unload")
            env.monkeypatch.setattr("app.jobs.jobs.worker", None)

        self._tight_ceiling(env, "z-image-turbo-gguf", "llm-qwen3-4b-instruct-2507")
        env.monkeypatch.setattr("app.jobs.jobs.worker", SimpleNamespace(alive=True, model_id="z-image-turbo-gguf"))
        env.monkeypatch.setattr("app.jobs.jobs.unload", unload)
        assert run(env, lambda: reply(env))[-1]["type"] == "done" and calls == ["unload"]

    def test_the_generation_worker_stays_loaded_next_to_the_chat_model_when_both_fit(self, env):
        calls = []

        async def unload():
            calls.append("unload")

        env.monkeypatch.setattr("app.jobs.jobs.worker", SimpleNamespace(alive=True, model_id="z-image-turbo-gguf"))
        env.monkeypatch.setattr("app.jobs.jobs.unload", unload)
        assert run(env, lambda: reply(env))[-1]["type"] == "done" and calls == []

    def test_the_chat_model_leaves_before_a_generation_worker_loads_when_both_do_not_fit_and_a_reply_in_progress_blocks_it(self, env):
        from app.job_plans import JobRequest
        from app.jobs import JobManager

        env.monkeypatch.setattr(llm_module, "llm", env.manager)
        self._tight_ceiling(env, "z-image-turbo-gguf", "llm-qwen3-4b-instruct-2507")
        env.monkeypatch.setattr("app.memory_budget._slots", {
            "chat": memory_budget.Slot("chat", env.manager.resident, lambda: env.manager.generating, env.manager.stop)})
        job = JobRequest(job_id="j1", model_id="z-image-turbo-gguf", prompt="x", params={})

        async def scenario():
            jm = JobManager()
            jm._memory_preflight = lambda spec: "refus de test"  # stops right after the chat model is unloaded
            await reply(env)
            pid = env.manager.server.proc.pid
            jm.jobs[job.job_id] = job
            ok = await jm._ensure_worker(job, "z-image-turbo-gguf", None, {})
            freed = (env.manager.server is None, alive(pid))
            env.manager._chatting = True  # a reply is being written: the job must not unload its model
            jm.jobs["j2"] = job2 = JobRequest(job_id="j2", model_id="z-image-turbo-gguf", prompt="x", params={})
            blocked = await jm._ensure_worker(job2, "z-image-turbo-gguf", None, {})
            env.manager._chatting = False
            return ok, freed, blocked, job.error, job2.error

        ok, freed, blocked, error, error2 = run(env, scenario)
        assert ok is False and freed == (True, False) and error == "refus de test"
        assert blocked is False and "réponse de chat est en cours" in error2

    def test_a_generation_is_refused_at_submission_while_a_reply_is_written(self, env):
        from app.main import app

        env.monkeypatch.setattr("app.api.jobs.llm", SimpleNamespace(generating=True))
        body = {"job_id": "j1", "kind": "image", "model_id": "z-image-turbo-gguf", "output_dir": str(env.data / "outputs")}

        async def post():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
                return await client.post("/engine/v1/jobs", json=body)

        res = asyncio.run(post())
        assert res.status_code == 409 and "réponse de chat" in res.json()["detail"]

    def test_a_chat_model_cannot_be_used_as_a_media_generator(self):
        from app.job_checks import check_generation

        with pytest.raises(ValueError, match="modèle de chat"):
            check_generation("llm-qwen3-8b", [])

    def test_a_diagram_model_cannot_be_used_as_a_media_generator(self):
        """Diagram models have no `engine` class to load (see `engines/diagram_models.py`): retrying/cancelling a
        diagram message must never reach the media job queue, which would crash the worker trying to resolve it."""
        from app.job_checks import check_generation

        with pytest.raises(ValueError, match="modèle de diagramme"):
            check_generation("diagram-qwen3-4b-instruct-2507", [])


class TestCancellation:
    def test_leaving_the_stream_stops_the_generation_and_keeps_the_model_ready(self, env):
        async def scenario():
            manager = env.manager
            spec = manager.precheck("llm-qwen3-4b-instruct-2507")
            request = {"model_id": spec.id, "messages": [user("slow please")]}
            agen = manager.chat(spec, request, manager.prepare(spec, request))
            seen = 0
            async for event in agen:
                seen += event["type"] == "delta"
                if seen == 3:
                    break
            assert manager.generating and manager.status()["state"] == "generating"
            await agen.aclose()
            pid = manager.server.proc.pid
            for _ in range(60):  # the fake notices the closed connection at its next write
                if log_events(env, "closed"):
                    break
                await asyncio.sleep(0.1)
            again = await reply(env, text="encore")
            return pid, manager.server.proc.pid, again

        pid, after, again = run(env, scenario)
        assert log_events(env, "closed") and pid == after and len(log_events(env, "start")) == 1
        assert again[-1] == {"type": "done", "finish_reason": "stop"} and not env.manager.generating

    def test_one_reply_at_a_time(self, env):
        async def scenario():
            manager = env.manager
            spec = manager.precheck("llm-qwen3-4b-instruct-2507")
            request = {"model_id": spec.id, "messages": [user("slow please")]}
            first = manager.chat(spec, request, manager.prepare(spec, request))
            async for event in first:
                if event["type"] == "delta":
                    break
            with pytest.raises(LlmBusy, match="déjà en cours"):
                manager.precheck(spec.id)
            second = [e async for e in manager.chat(spec, request, manager.prepare(spec, request))]
            await first.aclose()
            return second

        second = run(env, scenario)
        assert second == [{"type": "error", "code": "busy", "message": "Une réponse est déjà en cours de génération."}]

    def test_a_server_that_dies_mid_reply_is_reported_with_its_reason(self, env):
        async def scenario():
            manager = env.manager
            spec = manager.precheck("llm-qwen3-4b-instruct-2507")
            request = {"model_id": spec.id, "messages": [user("slow please")]}
            events = []
            async for event in manager.chat(spec, request, manager.prepare(spec, request)):
                events.append(event)
                if event["type"] == "delta" and len(events) > 3:
                    manager.guard._trips[manager.server.proc.pid] = "Arrêté par la protection mémoire : test."
                    manager.server.proc.kill()
            return events

        events = run(env, scenario)
        assert events[-1]["type"] == "error" and events[-1]["code"] == "closed" and "protection mémoire" in events[-1]["message"]


class TestUnloading:
    def test_unloading_stops_the_process_and_the_keep_alive_does_it_after_a_reply(self, env):
        env.monkeypatch.setattr("app.jobs.load_settings", lambda: {"keep_alive_minutes": 0})

        async def scenario():
            await reply(env)
            pid = env.manager.server.proc.pid
            for _ in range(30):
                if env.manager.server is None:
                    break
                await asyncio.sleep(0.1)
            return pid, env.manager.server

        pid, server = run(env, scenario)
        assert server is None and not alive(pid)

    def test_a_negative_keep_alive_keeps_the_model_loaded(self, env):
        env.monkeypatch.setattr("app.jobs.load_settings", lambda: {"keep_alive_minutes": -1})

        async def scenario():
            await reply(env)
            await asyncio.sleep(0.3)
            return env.manager.server is not None and env.manager.status()["state"] == "ready"

        assert run(env, scenario)

    def test_stopping_twice_is_harmless(self, env):
        async def scenario():
            await env.manager.stop()
            await reply(env)
            await env.manager.stop()
            await env.manager.stop()
            return env.manager.status()["state"]

        assert run(env, scenario) == "idle"


class TestTokenize:
    def test_the_count_is_exact_when_the_model_is_loaded_and_an_estimate_otherwise(self, env):
        async def scenario():
            cold = await env.manager.tokenize("un deux trois quatre", None)
            await reply(env)
            warm = await env.manager.tokenize("un deux trois quatre", None)
            same = await env.manager.tokenize("un deux trois quatre", "llm-qwen3-4b-instruct-2507")
            other = await env.manager.tokenize("un deux trois quatre", "llm-qwen3-8b")  # not the loaded one: never loads it
            return cold, warm, same, other

        cold, warm, same, other = run(env, scenario)
        assert cold == {"tokens": 6, "exact": False} and other == cold
        assert warm == same == {"tokens": 4, "exact": True}

    def test_the_estimate_is_one_token_per_three_and_a_half_characters(self):
        assert llm_module.estimate_tokens("") == 0 and llm_module.estimate_tokens("x" * 35) == 10 and llm_module.estimate_tokens("x") == 1


class TestRequests:
    def test_images_are_only_read_from_the_data_folder_or_taken_as_data_urls(self, env):
        resolve = llm_module.resolve_image
        assert resolve("data:image/png;base64,AAAA") == "data:image/png;base64,AAAA"
        for bad in ("https://evil.example/x.png", "http://127.0.0.1:8000/x.png", "file:///etc/passwd", "ftp://x/y.png",
                    "relative/x.png", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA"):
            with pytest.raises(LlmError):
                resolve(bad)
        outside = env.tmp / "outside.png"
        outside.write_bytes(b"x")
        with pytest.raises(LlmError, match="en dehors du dossier de données"):
            resolve(str(outside))
        with pytest.raises(LlmError, match="en dehors du dossier de données"):
            resolve(str(env.data / ".." / "outside.png"))
        (env.data / "notes.txt").write_text("x")
        with pytest.raises(LlmError, match="format non pris en charge"):
            resolve(str(env.data / "notes.txt"))
        with pytest.raises(LlmError, match="introuvable"):
            resolve(str(env.data / "missing.png"))

    def test_a_constrained_json_answer_is_passed_to_the_server_as_it_is(self, env):
        spec = MODELS["llm-qwen3-4b-instruct-2507"]
        fmt = {"type": "json_schema", "schema": {"type": "object", "properties": {"a": {"type": "string"}}}}
        assert env.manager.prepare(spec, {"messages": [{"role": "user", "content": "x"}], "response_format": fmt})["response_format"] == fmt
        assert "response_format" not in env.manager.prepare(spec, {"messages": [{"role": "user", "content": "x"}]})

    def test_an_oversized_image_is_refused(self, env, monkeypatch):
        monkeypatch.setattr(llm_module, "MAX_IMAGE_BYTES", 10)
        big = env.data / "big.png"
        big.write_bytes(b"x" * 11)
        with pytest.raises(LlmError, match="20 Mo"):
            llm_module.resolve_image(str(big))

    def test_a_symlink_out_of_the_data_folder_is_refused(self, env):
        target = env.tmp / "secret.png"
        target.write_bytes(b"x")
        (env.data / "link.png").symlink_to(target)
        with pytest.raises(LlmError, match="en dehors du dossier de données"):
            llm_module.resolve_image(str(env.data / "link.png"))

    def test_a_model_without_vision_refuses_images_and_one_without_tools_refuses_tools(self, env):
        manager = env.manager
        text_only = MODELS["llm-qwen3-4b-instruct-2507"]
        image = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
        with pytest.raises(LlmError, match="ne lit pas les images"):
            manager.prepare(text_only, {"messages": [user("x", image)]})
        no_tools = dataclasses.replace(text_only, llm=LlmCaps(tools=False))
        with pytest.raises(LlmError, match="n'appelle pas de fonctions"):
            manager.prepare(no_tools, {"messages": [user("x")], "tools": [{"type": "function"}]})

    def test_the_reasoning_choice_is_mapped_per_kind_of_model(self):
        effort = llm_module.reasoning_effort
        plain, toggle, levels, always = (SimpleNamespace(llm=LlmCaps(reasoning=r)) for r in ("none", "toggle", "levels", "always"))
        assert [effort(plain, w) for w in ("auto", "off", "high")] == [None, None, None]
        assert [effort(toggle, w) for w in ("auto", "off", "high")] == [None, "none", None]
        assert [effort(levels, w) for w in ("auto", "off", "low", "medium", "high")] == [None, "none", "low", "medium", "high"]
        assert [effort(always, w) for w in ("auto", "off", "high")] == [None, None, None]  # cannot be silenced

    def test_the_command_line_only_holds_our_values_and_never_a_key(self, env, tmp_path):
        spec = MODELS["llm-gemma-4-e4b"]
        cmd = build_command(Path("/x/llama-server"), spec, Path("/m/model.gguf"), Path("/m/mm.gguf"), 4242, 8192, True)
        assert cmd[:3] == ["/x/llama-server", "--model", "/m/model.gguf"]
        assert cmd[cmd.index("--host") + 1] == "127.0.0.1" and cmd[cmd.index("--port") + 1] == "4242"
        assert "--api-key" not in cmd and "--api-key-file" not in cmd and "--mmproj" in cmd and "-ngl" in cmd
        assert "--mmproj" not in build_command(Path("/x/llama-server"), spec, Path("/m/model.gguf"), None, 1, 8192, False)
        assert "-ngl" not in build_command(Path("/x/llama-server"), spec, Path("/m/model.gguf"), None, 1, 8192, False)

    def test_prechecks_name_what_is_wrong(self, env, monkeypatch):
        manager = env.manager
        with pytest.raises(LlmNotFound):
            manager.precheck("nope")
        with pytest.raises(LlmError, match="n'est pas un modèle de chat") as exc:
            manager.precheck("z-image-turbo-gguf")
        assert exc.value.status == 422
        monkeypatch.setattr("app.downloads.downloads.status", lambda spec: {"state": "partial", "size_gb": 1.0, "need_gb": 1.0})
        with pytest.raises(LlmBusy, match="pas \\(entièrement\\) téléchargé"):
            manager.precheck("llm-qwen3-8b")
        monkeypatch.setenv("IMAGEGEN_LLAMACPP_DIR", str(env.tmp / "empty"))
        with pytest.raises(LlmBusy, match="n'est pas installé"):
            manager.precheck("llm-qwen3-8b")


class TestEvents:
    def test_chunks_become_events_and_the_usage_comes_from_both_objects(self):
        e = ChatEvents(8192)
        events = e.feed({"choices": [{"delta": {"role": "assistant", "content": ""}}]})
        events += e.feed({"choices": [{"delta": {"reasoning_content": "hm"}}]})
        events += e.feed({"choices": [{"delta": {"content": "ok"}, "finish_reason": "length"}], "timings": {"predicted_n": 5, "prompt_n": 7, "cache_n": 3, "predicted_per_second": 12.345}})
        events += e.feed({"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
        assert events == [{"type": "reasoning", "content": "hm"}, {"type": "delta", "content": "ok"}]
        end = e.finish()
        assert end[-1] == {"type": "done", "finish_reason": "length"}
        assert end[0]["prompt_tokens"] == 10 and end[0]["completion_tokens"] == 5 and end[0]["tokens_per_second"] == 12.35
        assert end[0]["context_size"] == 8192 and end[0]["cached_tokens"] == 3

    def test_without_a_usage_object_the_timings_are_used(self):
        e = ChatEvents(4096)
        e.feed({"choices": [{"delta": {"content": "x"}}], "timings": {"predicted_n": 5, "prompt_n": 7, "cache_n": 3}})
        usage = e.finish()[0]
        assert usage["prompt_tokens"] == 10 and usage["completion_tokens"] == 5

    def test_parallel_tool_calls_are_assembled_by_index(self):
        e = ChatEvents(4096)
        for call in ({"index": 0, "id": "a", "function": {"name": "f", "arguments": "{"}}, {"index": 1, "id": "b", "function": {"name": "g", "arguments": ""}},
                     {"index": 0, "function": {"arguments": "}"}}, {"index": 1, "function": {"arguments": "{}"}}):
            e.feed({"choices": [{"delta": {"tool_calls": [call]}}]})
        calls = e.finish()[0]["calls"]
        assert [(c["id"], c["function"]) for c in calls] == [("a", {"name": "f", "arguments": "{}"}), ("b", {"name": "g", "arguments": "{}"})]

    def test_sse_lines_are_parsed_until_done_and_noise_is_skipped(self):
        lines = [b": ping\n", b"data: {\"a\": 1}\n", b"\n", b"event: x\n", b"data: not json\n", b"data: {\"b\": 2}\n", b"data: [DONE]\n", b"data: {\"c\": 3}\n"]
        assert list(iter_sse(lines)) == [{"a": 1}, {"b": 2}]

    def test_a_stream_cut_before_done_is_an_error_not_an_end(self):
        got = []
        with pytest.raises(EOFError):
            for item in iter_sse([b"data: {\"a\": 1}\n", b"data: {\"b\": 2}\n"]):
                got.append(item)
        assert got == [{"a": 1}, {"b": 2}]

    def test_an_unknown_upstream_error_keeps_its_message(self):
        err = llm_module.upstream_error(500, b'{"error": {"message": "boom"}}')
        assert err == {"type": "error", "code": "upstream", "message": "boom"}
        assert "500" in llm_module.upstream_error(500, b"<html>")["message"]


def call(app, method, url, **kw):
    """One request, no model started (refusals and the like)."""
    async def main():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
            return await client.request(method, url, **kw)

    return asyncio.run(main())


def session(env, app, scenario):
    """Several requests in ONE event loop (the server process belongs to the loop that started it), model stopped after."""
    async def main():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
            try:
                return await scenario(client)
            finally:
                await env.manager.stop()

    return asyncio.run(main())


class TestRoutes:
    @pytest.fixture
    def api(self, env):
        from app.main import app

        env.monkeypatch.setattr("app.api.llm.llm", env.manager)
        env.monkeypatch.delenv("ENGINE_TOKEN", raising=False)
        return app

    def test_a_reply_is_a_server_sent_event_stream(self, api, env):
        body = {"model_id": "llm-qwen3-4b-instruct-2507", "messages": [{"role": "user", "content": "bonjour"}]}
        res = session(env, api, lambda c: c.post("/engine/v1/llm/chat", json=body))
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
        parsed = []
        for block in (b for b in res.text.split("\n\n") if b.strip()):
            name, data = block.split("\n")
            assert name.startswith("event: ") and data.startswith("data: ")
            event = json.loads(data[6:])
            assert name[7:] == event["type"]
            parsed.append(event)
        assert [e["type"] for e in parsed][-2:] == ["usage", "done"] and parsed[0]["type"] == "loading"

    @pytest.mark.parametrize("body,status,text", [
        ({"model_id": "nope", "messages": [{"role": "user", "content": "x"}]}, 404, "inconnu"),
        ({"model_id": "z-image-turbo-gguf", "messages": [{"role": "user", "content": "x"}]}, 422, "pas un modèle de chat"),
        ({"model_id": "llm-qwen3-8b", "messages": []}, 422, None),
        ({"model_id": "llm-qwen3-8b", "messages": [{"role": "robot", "content": "x"}]}, 422, None),
        ({"model_id": "llm-qwen3-8b", "messages": [{"role": "user", "content": "x"}], "params": {"temperature": 9}}, 422, None),
        ({"model_id": "llm-qwen3-8b", "messages": [{"role": "user", "content": "x"}], "reasoning": "maximum"}, 422, None),
        ({"model_id": "llm-qwen3-8b", "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://x/y.png"}}]}]}, 422, "ne lit pas les images"),
        ({"model_id": "llm-gemma-4-e4b", "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://x/y.png"}}]}]}, 422, "Image refusée"),
    ])
    def test_refusals_come_before_the_stream_as_plain_http_errors(self, api, env, body, status, text):
        res = call(api, "POST", "/engine/v1/llm/chat", json=body)
        assert res.status_code == status
        if text:
            assert text in json.dumps(res.json(), ensure_ascii=False)
        assert log_events(env, "start") == []  # no model was loaded for a refused request

    def test_a_machine_without_the_engine_or_the_files_gets_a_409(self, api, env):
        body = {"model_id": "llm-qwen3-8b", "messages": [{"role": "user", "content": "x"}]}
        env.monkeypatch.setattr("app.downloads.downloads.status", lambda spec: {"state": "missing", "size_gb": 0, "need_gb": 5})
        res = call(api, "POST", "/engine/v1/llm/chat", json=body)
        assert res.status_code == 409 and "télécharg" in res.json()["detail"]
        env.monkeypatch.setenv("IMAGEGEN_LLAMACPP_DIR", str(env.tmp / "empty"))
        res = call(api, "POST", "/engine/v1/llm/chat", json=body)
        assert res.status_code == 409 and "pas installé" in res.json()["detail"]

    def test_status_unload_and_tokenize(self, api, env):
        body = {"model_id": "llm-qwen3-4b-instruct-2507", "messages": [{"role": "user", "content": "x"}]}

        async def scenario(c):
            out = {"idle": (await c.get("/engine/v1/llm/status")).json()["state"],
                   "cold": (await c.post("/engine/v1/llm/tokenize", json={"text": "un deux"})).json()}
            await c.post("/engine/v1/llm/chat", json=body)
            out["status"] = (await c.get("/engine/v1/llm/status")).json()
            out["warm"] = (await c.post("/engine/v1/llm/tokenize", json={"text": "un deux"})).json()
            env.manager._chatting = True
            out["busy"] = (await c.post("/engine/v1/llm/unload")).status_code
            env.manager._chatting = False
            out["unloaded"] = (await c.post("/engine/v1/llm/unload")).json()["state"]
            return out

        out = session(env, api, scenario)
        assert out["idle"] == "idle" and out["cold"] == {"tokens": 2, "exact": False}
        assert out["status"]["state"] == "ready" and out["status"]["model_id"] == "llm-qwen3-4b-instruct-2507"
        assert out["warm"] == {"tokens": 2, "exact": True} and out["busy"] == 409 and out["unloaded"] == "idle"

    def test_the_engine_token_protects_the_chat_routes(self, api, env):
        env.monkeypatch.setenv("ENGINE_TOKEN", "s3cret")
        for method, url in (("GET", "/engine/v1/llm/status"), ("POST", "/engine/v1/llm/unload"),
                            ("POST", "/engine/v1/engines/llamacpp/install")):
            assert call(api, method, url).status_code == 401
        assert call(api, "GET", "/engine/v1/llm/status", headers={"X-Engine-Token": "s3cret"}).status_code == 200

    def test_the_runtime_can_be_removed_unless_the_model_is_loaded(self, api, env):
        body = {"model_id": "llm-qwen3-4b-instruct-2507", "messages": [{"role": "user", "content": "x"}]}

        async def scenario(c):
            await c.post("/engine/v1/llm/chat", json=body)
            busy = await c.delete("/engine/v1/engines/llamacpp")
            await c.post("/engine/v1/llm/unload")
            return busy, await c.delete("/engine/v1/engines/llamacpp")

        busy, removed = session(env, api, scenario)
        assert busy.status_code == 409 and "déchargez" in busy.json()["detail"]
        assert removed.json() == {"ok": True} and not (env.tmp / "llamacpp").exists()

    def test_cancelling_when_nothing_installs_is_a_409(self, api):
        res = call(api, "DELETE", "/engine/v1/engines/llamacpp/install")
        assert res.status_code == 409 and "Aucune installation" in res.json()["detail"]


class TestPrivateReplies:
    """A private session (private_session.py): the conversation reaches only the server's socket, and leaves no line."""

    def test_the_server_is_asked_for_warnings_and_errors_only(self, env):
        run(env, lambda: reply(env))
        (start,) = log_events(env, "start")
        argv = start["argv"]
        assert argv[argv.index("--log-verbosity") + 1] == "2"  # the debug level is the one that logs requests (server-http.cpp)
        assert "--log-prompts-dir" not in argv and "--log-file" not in argv and "--slot-save-path" not in argv

    def test_nothing_of_the_conversation_reaches_the_command_line_or_the_engine_output(self, env, capsys):
        sentinel = "PHRASE-TEMOIN-7f3a91"
        run(env, lambda: reply(env, text=f"bonjour {sentinel}", private=True))
        (start,) = log_events(env, "start")
        assert sentinel not in json.dumps(start["argv"])
        assert sentinel not in capsys.readouterr().out
        (chat,) = log_events(env, "chat")
        assert "private" not in chat["payload"]  # the flag is ours: llama-server never sees it

    def test_a_private_reply_leaves_no_unload_line_but_a_normal_one_does(self, env, capsys):
        run(env, lambda: reply(env, private=True))
        assert "[memory] llm" not in capsys.readouterr().out
        run(env, lambda: reply(env))
        assert "[memory] llm" in capsys.readouterr().out
        assert env.manager.private_used is False  # the flag does not outlive the model it concerned
