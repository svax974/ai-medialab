# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Chat models: llama.cpp's server (`llama-server`) is the one place language models run.

The engine keeps no conversation: Nest sends the whole history with every request (`POST /llm/chat`) and gets a stream of
normalised events back (`ChatEvents` below). The server is a long-lived process of its own (one model, one chat at a time,
`--parallel 1`) listening on 127.0.0.1 only, behind a random API key that never leaves this module.

Memory is shared with the image, audio and video workers, so ONE model lives in memory at a time for the whole
application (see `ARCHITECTURE.md`, « Filets de sécurité mémoire »):

- before a chat model loads, the generation worker is stopped (refused with `LlmBusy` while a generation or a queued one is
  running); before a generation loads its worker, the chat server is stopped (`jobs.py`, `api/jobs.py`);
- `memory_guard.preflight` checks the memory free right now against the weights, the KV cache of the requested context and
  llama.cpp's buffers (`engines/llm_models.memory_need_gb`);
- a `MemoryWatchdog` watches the server's process tree and kills it before the machine runs out.

Flags of `llama-server` (tools/server/README.md of release b11317, the pinned one): `--model`, `--host`, `--port`,
`--ctx-size`, `--parallel`, `--jinja`, `--no-webui`, `--no-slots`, `--mmproj`, `--reasoning-format`, `--alias`, `-ngl`;
the API key travels in the environment variable `LLAMA_API_KEY` (listed there), not on the command line.
"""

from __future__ import annotations

import asyncio
import base64
import http.client
import json
import os
import re
import secrets
import socket
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, AsyncIterator, Callable

from . import config, llamacpp, memory_guard
from .engines import MODELS, get_spec
from .engines.base import ModelSpec
from .engines.llm_models import memory_need_gb
from .events import bus

CONTEXT_MIN = 2048
LOAD_TIMEOUT_S = 900  # a 20 GB model read from a slow disk takes minutes
READ_TIMEOUT_S = 3600  # a long prompt on a slow machine is minutes without a token: only cancelling stops a request
STOP_GRACE_S = 5.0
IMAGE_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
DATA_URL = re.compile(r"^data:image/(?:png|jpe?g|webp|gif);base64,", re.I)
REASONING_LEVELS = ("low", "medium", "high")


class LlmError(RuntimeError):
    """A refusal with the HTTP status the route answers (the message is shown to the user as it is)."""

    status = 422


class LlmNotFound(LlmError):
    status = 404


class LlmBusy(LlmError):
    status = 409


# Requests ---------------------------------------------------------------------------------------------------------------

def resolve_image(url: str) -> str:
    """Data URL of an image: a data URL as it is (checked), or a file of the data folder read here. Anything else (a remote
    address, `file://`, a path elsewhere) is refused: the server never fetches what the caller names."""
    if url.startswith("data:"):
        if not DATA_URL.match(url) or len(url) > MAX_IMAGE_BYTES * 4 // 3 + 64:
            raise LlmError("Image refusée : data URL invalide ou trop grosse (20 Mo au plus).")
        return url
    if "://" in url or not Path(url).is_absolute():
        raise LlmError("Image refusée : seuls un fichier du dossier de données (chemin absolu) ou une data URL sont acceptés.")
    path, root = Path(url).resolve(), config.DATA_DIR.resolve()
    if root not in path.parents:
        raise LlmError("Image refusée : en dehors du dossier de données.")
    mime = IMAGE_MIME.get(path.suffix.lower())
    if mime is None or not path.is_file():
        raise LlmError("Image refusée : fichier introuvable ou format non pris en charge (png, jpg, webp, gif).")
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise LlmError("Image refusée : plus de 20 Mo.")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def prepare_messages(messages: list[dict[str, Any]], vision: bool) -> list[dict[str, Any]]:
    """Messages as llama-server takes them: image addresses turned into data URLs, empty texts kept as they are."""
    out: list[dict[str, Any]] = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            parts = []
            for part in content:
                if part.get("type") == "image_url":
                    if not vision:
                        raise LlmError("Ce modèle ne lit pas les images : choisissez un modèle avec la mention « vision ».")
                    parts.append({"type": "image_url", "image_url": {"url": resolve_image(part["image_url"]["url"])}})
                else:
                    parts.append({"type": "text", "text": part.get("text") or ""})
            message = {**message, "content": parts}
        out.append(message)
    return out


def completion_payload(spec: ModelSpec, request: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Body of llama-server's `/v1/chat/completions` for one request (sampling, tools, reasoning)."""
    payload: dict[str, Any] = {"messages": messages, "stream": True, "stream_options": {"include_usage": True},
                               "cache_prompt": True}
    params = request.get("params") or {}
    for key in ("temperature", "top_p", "top_k", "min_p", "repeat_penalty", "presence_penalty", "frequency_penalty",
                "max_tokens", "seed", "stop"):
        if params.get(key) is not None:
            payload[key] = params[key]
    tools = request.get("tools")
    if tools:
        if not spec.llm or not spec.llm.tools:
            raise LlmError(f"« {spec.name} » n'appelle pas de fonctions : choisissez un modèle avec la mention « outils ».")
        payload.update(tools=tools, parallel_tool_calls=False)
        if request.get("tool_choice") is not None:
            payload["tool_choice"] = request["tool_choice"]
    effort = reasoning_effort(spec, request.get("reasoning") or "auto")
    if effort:
        payload["reasoning_effort"] = effort
    if request.get("response_format"):  # {"type": "json_schema", "schema": {...}}: constrained JSON (tools/server/README.md, b11317)
        payload["response_format"] = request["response_format"]
    return payload


def reasoning_effort(spec: ModelSpec, wanted: str) -> str | None:
    """`reasoning_effort` to send for what the user asked ('auto' | 'off' | 'low' | 'medium' | 'high'), or None to leave the
    model's default: a model that cannot think ignores it, one that only toggles ignores the levels, one that always thinks
    cannot be silenced."""
    mode = spec.llm.reasoning if spec.llm else "none"
    if mode == "none" or wanted == "auto":
        return None
    if wanted == "off":
        return "none" if mode in ("toggle", "levels") else None
    return wanted if mode == "levels" and wanted in REASONING_LEVELS else None


# Server-sent events ------------------------------------------------------------------------------------------------------

class ChatEvents:
    """Turns llama-server's OpenAI-style chunks into the events of `POST /llm/chat`:

    `delta` {content}, `reasoning` {content}, `tool_calls` {calls} (once, complete, OpenAI shape), `usage` {prompt_tokens,
    completion_tokens, cached_tokens, tokens_per_second, prompt_ms, predicted_ms, context_size}, `done` {finish_reason}."""

    def __init__(self, context_size: int) -> None:
        self.context_size = context_size
        self.finish_reason: str | None = None
        self._calls: dict[int, dict[str, Any]] = {}
        self._usage: dict[str, Any] = {}
        self._timings: dict[str, Any] = {}

    def feed(self, chunk: dict[str, Any]) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        self._usage.update(chunk.get("usage") or {})
        self._timings.update(chunk.get("timings") or {})
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            if delta.get("reasoning_content"):
                events.append({"type": "reasoning", "content": delta["reasoning_content"]})
            if delta.get("content"):
                events.append({"type": "delta", "content": delta["content"]})
            for call in delta.get("tool_calls") or []:
                self._add_call(call)
            self.finish_reason = choice.get("finish_reason") or self.finish_reason
        return events

    def _add_call(self, call: dict[str, Any]) -> None:
        mine = self._calls.setdefault(call.get("index", 0), {"id": "", "type": "function",
                                                              "function": {"name": "", "arguments": ""}})
        mine["id"] = call.get("id") or mine["id"]
        fn = call.get("function") or {}
        mine["function"]["name"] = fn.get("name") or mine["function"]["name"]
        mine["function"]["arguments"] += fn.get("arguments") or ""

    def finish(self) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        if self._calls:
            calls = [self._calls[i] for i in sorted(self._calls)]
            events.append({"type": "tool_calls", "calls": calls})
            self.finish_reason = "tool_calls"
        events.append({"type": "usage", **self.usage()})
        events.append({"type": "done", "finish_reason": self.finish_reason or "stop"})
        return events

    def usage(self) -> dict[str, Any]:
        t, u = self._timings, self._usage
        return {"prompt_tokens": u.get("prompt_tokens", t.get("prompt_n", 0) + t.get("cache_n", 0)),
                "completion_tokens": u.get("completion_tokens", t.get("predicted_n", 0)),
                "cached_tokens": t.get("cache_n", 0),
                "tokens_per_second": round(t.get("predicted_per_second") or 0, 2),
                "prompt_ms": round(t.get("prompt_ms") or 0, 1), "predicted_ms": round(t.get("predicted_ms") or 0, 1),
                "context_size": self.context_size}


def iter_sse(lines: Any) -> Any:
    """`data:` payloads of a server-sent event stream read line by line (bytes), until `[DONE]`. A stream that ends without
    it was cut (the server died, the connection dropped): EOFError, never a normal end."""
    for raw in lines:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            yield json.loads(data)
        except ValueError:
            continue
    raise EOFError("flux interrompu avant sa fin")


def upstream_error(status: int, body: bytes) -> dict[str, Any]:
    """The `error` event for a failed request to llama-server (the context overflow gets its own code and figures)."""
    try:
        err = json.loads(body.decode("utf-8", errors="replace")).get("error") or {}
    except ValueError:
        err = {}
    if err.get("type") == "exceed_context_size_error":
        used, size = err.get("n_prompt_tokens"), err.get("n_ctx")
        return {"type": "error", "code": "context_exceeded", "n_prompt_tokens": used, "n_ctx": size,
                "message": f"La conversation dépasse la fenêtre de contexte ({used} tokens pour {size}) : "
                           "raccourcissez-la, ou ouvrez-la avec un contexte plus grand."}
    return {"type": "error", "code": "upstream", "message": str(err.get("message") or f"Le moteur de chat a répondu {status}.")}


# The server -------------------------------------------------------------------------------------------------------------

# Size of the prompt cache kept in RAM next to the model (`llama-server --cache-ram`, MiB).
PROMPT_CACHE_MIB = 1024


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def build_command(binary: Path, spec: ModelSpec, model: Path, mmproj: Path | None, port: int, ctx: int, full_gpu: bool) -> list[str]:
    """`llama-server` command line for one model. Pure: nothing is started here; every value is ours, none comes from a request."""
    cmd = [str(binary), "--model", str(model), "--alias", spec.id, "--host", "127.0.0.1", "--port", str(port),
           "--ctx-size", str(ctx), "--parallel", "1", "--jinja", "--no-webui", "--no-slots",
           "--reasoning-format", "deepseek",
           # Requests and responses are logged only at the debug level (5, `server-http.cpp` of b11317). Asked here so that
           # an environment variable (`LLAMA_ARG_LOG_VERBOSITY`, `-v`) cannot put the conversation into the log lines
           # kept for error messages; warnings and errors (what a failed start needs) still show.
           "--log-verbosity", "2",
           # Host-RAM cache of past prompt states: 8 GiB by default (`-cram` of b11317), more than a 36 GB Mac with a model
           # loaded can spare. 1 GiB still lets one conversation resume without recomputing its prompt.
           "--cache-ram", str(PROMPT_CACHE_MIB)]
    if full_gpu:
        cmd += ["-ngl", "all"]
    if mmproj is not None:
        cmd += ["--mmproj", str(mmproj)]
    return cmd


def http_get(port: int, path: str, key: str = "", timeout: float = 5.0) -> tuple[int, bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        conn.request("GET", path, headers={"Authorization": f"Bearer {key}"} if key else {})
        resp = conn.getresponse()
        return resp.status, resp.read()
    finally:
        conn.close()


def http_post_json(port: int, path: str, payload: dict[str, Any], key: str, timeout: float = 30.0) -> tuple[int, bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        conn.request("POST", path, body=json.dumps(payload), headers={"Content-Type": "application/json",
                                                                      "Authorization": f"Bearer {key}"})
        resp = conn.getresponse()
        return resp.status, resp.read()
    finally:
        conn.close()


class Server:
    """A running `llama-server`: its process, address, key and the last lines of its log (for the error message)."""

    def __init__(self, proc: asyncio.subprocess.Process, spec: ModelSpec, port: int, key: str, ctx: int, vision: bool) -> None:
        self.proc, self.spec, self.port, self.key, self.ctx, self.vision = proc, spec, port, key, ctx, vision
        self.model_id, self.variant = spec.id, spec.variant
        self.started_at = time.time()
        self.tail: deque[str] = deque(maxlen=40)
        self._drain = asyncio.create_task(self._read_log())

    async def _read_log(self) -> None:
        assert self.proc.stdout is not None
        async for raw in self.proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line:
                self.tail.append(line)

    @property
    def alive(self) -> bool:
        return self.proc.returncode is None


def explain_exit(code: int | None, tail: list[str], tripped: str | None) -> str:
    """Message for a server that stopped by itself: the memory guard's, an out-of-memory hint, or the log's last lines."""
    if tripped:
        return tripped
    text = " ".join(tail[-12:]).lower()
    if any(w in text for w in ("out of memory", "failed to allocate", "cudamalloc", "insufficient memory")):
        return ("Mémoire insuffisante pour charger ce modèle avec ce contexte. Essayez un contexte plus court, une quantification "
                "plus forte ou un modèle plus léger.")
    last = [line for line in tail if line.strip()][-3:]
    return f"Le moteur de chat s'est arrêté (code {code}). " + " / ".join(last)


def _abort(holder: dict[str, Any]) -> None:
    """Closes the connection of a running request from another thread: llama-server notices and stops generating.
    The socket is kept in `holder` because `http.client` lets go of it once the response headers are read."""
    holder["cancel"] = True
    sock = holder.get("sock")
    if sock is None:
        return
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    try:
        sock.close()
    except OSError:
        pass


def _read_stream(port: int, key: str, payload: dict[str, Any], put: Callable[[tuple], None], holder: dict[str, Any]) -> None:
    """Thread: POSTs the completion and hands every chunk (or the failure) over through `put`."""
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=READ_TIMEOUT_S)
    except OSError as exc:
        put(("closed", exc))
        return
    holder["sock"] = sock
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=READ_TIMEOUT_S)
    conn.sock = sock
    try:
        if holder.get("cancel"):  # the caller left before the request started
            return
        conn.request("POST", "/v1/chat/completions", body=json.dumps(payload),
                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        resp = conn.getresponse()
        if resp.status != 200:
            put(("http_error", resp.status, resp.read()))
            return
        for chunk in iter_sse(resp):
            put(("chunk", chunk))
        put(("end",))
    except (OSError, http.client.HTTPException, EOFError) as exc:
        put(("closed", exc))
    finally:
        _abort(holder)


class LlmManager:
    """Loads, serves and unloads the chat model. See the module docstring for the memory rules."""

    def __init__(self) -> None:
        self.server: Server | None = None
        self.state = "idle"  # idle | loading | ready | generating
        self.last_error: str | None = None
        self._lock = asyncio.Lock()  # one load at a time
        self._chatting = False  # one request at a time (`--parallel 1`)
        self.private_used = False  # a private reply ran since the model loaded: its unloading leaves no log line (private_session.py)
        self._idle_task: asyncio.Task | None = None
        self.guard = memory_guard.MemoryWatchdog(self._watched_pid)

    def _watched_pid(self) -> int | None:
        s = self.server
        return s.proc.pid if s and s.alive else None

    async def start(self) -> None:
        self.guard.start()

    async def shutdown(self) -> None:
        self.guard.stop()
        await self.stop()

    @property
    def generating(self) -> bool:
        return self._chatting

    def status(self) -> dict[str, Any]:
        s = self.server
        loaded = bool(s and s.alive)
        state = self.state if loaded or self.state == "loading" else "idle"
        return {"state": state, "model_id": s.model_id if loaded else None, "variant": s.variant if loaded else None,
                "context_size": s.ctx if loaded else None, "vision": s.vision if loaded else None,
                "pid": s.proc.pid if loaded else None, "started_at": s.started_at if loaded else None,
                "last_error": self.last_error}

    def _publish(self) -> None:
        bus.publish("llm.status", self.status())

    def _set(self, state: str) -> None:
        self.state = state
        self._publish()

    # Checks ---------------------------------------------------------------------------------------------------------

    def precheck(self, model_id: str, context_size: int | None = None) -> ModelSpec:
        """The model's spec, or the refusal (with its HTTP status) of a chat that cannot start now."""
        from .downloads import downloads
        from .jobs import jobs

        spec = MODELS.get(model_id)
        # "diagram" models reuse this same one-shot completion endpoint (same GGUF files as their "llm" counterpart,
        # see engines/diagram_models.py): structured JSON for the Diagrams tab, not a conversational chat.
        if spec is None or spec.kind not in ("llm", "diagram"):
            raise LlmNotFound("Modèle de chat inconnu.") if spec is None else LlmError(f"« {spec.name} » n'est pas un modèle de chat.")
        spec = get_spec(model_id)
        if llamacpp.installed_binary() is None:
            raise LlmBusy("Le moteur de chat (llama.cpp) n'est pas installé : ouvrez Modèles pour l'installer.")
        downloads.invalidate()
        if downloads.status(spec)["state"] != "installed":
            raise LlmBusy(f"Le modèle « {spec.name} » n'est pas (entièrement) téléchargé. Ouvrez Modèles pour le télécharger.")
        if self._chatting:
            raise LlmBusy("Une réponse est déjà en cours de génération.")
        if jobs.current or jobs.pending:
            raise LlmBusy("Une génération de médias est en cours : attendez sa fin ou annulez-la avant de discuter.")
        return spec

    def context_for(self, spec: ModelSpec, wanted: int | None) -> int:
        caps = spec.llm
        size = wanted or (self.server.ctx if self.server and self.server.alive and self.server.model_id == spec.id
                          else caps.context_default)
        return max(CONTEXT_MIN, min(size, caps.context_max))

    def _preflight(self, spec: ModelSpec, ctx: int) -> str | None:
        from .system import get_system

        system = get_system()
        accel = system["accelerators"][0] if system["accelerators"] else None
        if accel and not accel.get("unified"):
            return None  # the weights go to the graphics card's own memory
        return memory_guard.preflight(memory_need_gb(spec, ctx), memory_guard.available_gb(), system["ram_gb"], spec.name)

    # Loading --------------------------------------------------------------------------------------------------------

    async def ensure(self, spec: ModelSpec, ctx: int, emit: Callable[[dict[str, Any]], None]) -> Server:
        """The server loaded with `spec` at `ctx` tokens of context (loading it, and unloading what was there, if needed)."""
        async with self._lock:
            s = self.server
            if s and s.alive and s.model_id == spec.id and s.variant == spec.variant and s.ctx == ctx:
                return s
            from .jobs import jobs

            if jobs.current or jobs.pending:
                raise LlmBusy("Une génération de médias est en cours : attendez sa fin ou annulez-la avant de discuter.")
            await self._stop_locked()
            if jobs.worker:
                await jobs.unload()  # one model in memory: the generation worker leaves first
            refused = self._preflight(spec, ctx)
            if refused:
                self.last_error = refused
                raise LlmError(refused)
            self._cancel_idle()
            return await self._launch(spec, ctx, emit)

    async def _launch(self, spec: ModelSpec, ctx: int, emit: Callable[[dict[str, Any]], None]) -> Server:
        from .system import get_system

        files, found = spec.options["files"], llamacpp.installed_binary()
        assert found is not None
        paths = {role: llamacpp_model_file(*repo_file) for role, repo_file in files.items()}
        if any(p is None for p in paths.values()):
            raise LlmBusy(f"Fichiers de « {spec.name} » introuvables : téléchargez le modèle.")
        plan = _plan(spec, get_system())
        key, port = secrets.token_urlsafe(24), free_port()
        cmd = build_command(found[1], spec, paths["model"], paths.get("mmproj"), port, ctx, plan.get("strategy") == "full")
        self._set("loading")
        self.last_error = None
        emit({"type": "loading", "phase": "starting", "model_id": spec.id})
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, cwd=str(found[1].parent),
            env={**os.environ, "LLAMA_API_KEY": key, "NO_COLOR": "1"})
        self.guard.begin_job()
        server = Server(proc, spec, port, key, ctx, bool(paths.get("mmproj")))
        self.server = server
        try:
            await self._wait_healthy(server, emit)
        except BaseException:
            await self._stop_locked()
            self._set("idle")
            raise
        self._set("ready")
        return server

    async def _wait_healthy(self, server: Server, emit: Callable[[dict[str, Any]], None]) -> None:
        started, last_emit = time.time(), 0.0
        while True:
            if not server.alive:
                msg = explain_exit(server.proc.returncode, list(server.tail), self.guard.tripped(server.proc.pid))
                self.last_error = msg
                raise LlmError(msg)
            try:
                status, _ = await asyncio.to_thread(http_get, server.port, "/health", "", 2.0)
            except (OSError, http.client.HTTPException):
                status = 0
            if status == 200:
                return
            now = time.time()
            if now - started > LOAD_TIMEOUT_S:
                raise LlmError("Le chargement du modèle prend trop de temps : abandon.")
            if now - last_emit >= 1.0:
                emit({"type": "loading", "phase": "loading", "model_id": server.model_id, "elapsed_s": round(now - started)})
                last_emit = now
            await asyncio.sleep(0.3)

    # Unloading ------------------------------------------------------------------------------------------------------

    async def stop(self) -> None:
        async with self._lock:
            had_server = self.server is not None
            await self._stop_locked()
        if had_server or self.state != "idle":
            self._set("idle")

    async def _stop_locked(self) -> None:
        s, self.server = self.server, None
        self._cancel_idle()
        if s is None:
            return
        if s.alive:
            s.proc.terminate()
            try:
                await asyncio.wait_for(s.proc.wait(), STOP_GRACE_S)
            except asyncio.TimeoutError:
                await asyncio.to_thread(memory_guard.kill_tree, s.proc.pid)
                await s.proc.wait()  # the next model must not load while this one still holds its memory
        s._drain.cancel()
        stats = self.guard.job_stats()
        if not self.private_used:  # a private session leaves no trace of the model it used
            print(f"[memory] llm {s.model_id} : mémoire libre au plus bas {stats['min_free_gb']} Go, "
                  f"processus au plus haut {stats['peak_worker_gb']} Go", flush=True)
        self.private_used = False

    def _cancel_idle(self) -> None:
        if self._idle_task:
            self._idle_task.cancel()
            self._idle_task = None

    def schedule_idle_unload(self) -> None:
        """After a reply: unload when the keep-alive delay of the settings (shared with the generation worker) has passed."""
        from .jobs import load_settings

        minutes = load_settings()["keep_alive_minutes"]
        self._cancel_idle()
        if minutes is None or minutes < 0 or not self.server:
            return

        async def later() -> None:
            await asyncio.sleep(max(0, minutes) * 60)
            if not self._chatting:
                await self.stop()

        self._idle_task = asyncio.create_task(later())

    # Chat -----------------------------------------------------------------------------------------------------------

    @staticmethod
    def prepare(spec: ModelSpec, request: dict[str, Any]) -> dict[str, Any]:
        """Body for llama-server from a request, or the refusal of its content (tools, images, reasoning) before anything loads."""
        return completion_payload(spec, request, prepare_messages(request["messages"], bool(spec.llm and spec.llm.vision)))

    async def chat(self, spec: ModelSpec, request: dict[str, Any], payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        """Events of one reply (`payload` from `prepare`), loading the model first when needed. Leaving the loop (the client
        went away) stops the generation and leaves the server loaded and ready."""
        if self._chatting:  # checked and set with no await in between: two requests cannot both pass
            yield {"type": "error", "code": "busy", "message": "Une réponse est déjà en cours de génération."}
            return
        self._chatting = True
        self.private_used = self.private_used or bool(request.get("private"))
        ctx = self.context_for(spec, request.get("context_size"))
        loop, out = asyncio.get_running_loop(), asyncio.Queue()
        holder: dict[str, Any] = {}
        load: asyncio.Task | None = None
        try:
            load = asyncio.create_task(self.ensure(spec, ctx, lambda ev: out.put_nowait(ev)))
            while not load.done() or not out.empty():
                try:
                    yield await asyncio.wait_for(out.get(), 0.25)
                except asyncio.TimeoutError:
                    continue
            server = await load
            self._set("generating")
            events = ChatEvents(server.ctx)
            threading.Thread(target=_read_stream, daemon=True, args=(
                server.port, server.key, {**payload, "model": spec.id},
                lambda item: loop.call_soon_threadsafe(out.put_nowait, item), holder)).start()
            async for event in self._events_of(server, out, events):
                yield event
        except LlmError as exc:
            yield {"type": "error", "code": "refused", "message": str(exc)}
        finally:
            _abort(holder)
            if load is not None and not load.done():
                load.cancel()
            self._chatting = False
            if self.server and self.server.alive:
                self._set("ready")
                self.schedule_idle_unload()

    async def _events_of(self, server: Server, out: asyncio.Queue, events: ChatEvents) -> AsyncIterator[dict[str, Any]]:
        while True:
            item = await out.get()
            kind = item[0]
            if kind == "chunk":
                for ev in events.feed(item[1]):
                    yield ev
            elif kind == "end":
                for ev in events.finish():
                    yield ev
                return
            elif kind == "http_error":
                yield upstream_error(item[1], item[2])
                return
            elif kind == "closed":
                try:
                    await asyncio.wait_for(server.proc.wait(), 1.0)  # a dying server is reaped a moment after its socket closes
                except asyncio.TimeoutError:
                    pass
                msg = explain_exit(server.proc.returncode, list(server.tail), self.guard.tripped(server.proc.pid)) \
                    if not server.alive else "La connexion au moteur de chat a été coupée."
                yield {"type": "error", "code": "closed", "message": msg}
                return

    async def tokenize(self, text: str, model_id: str | None) -> dict[str, Any]:
        """Token count of `text`: exact when the asked model (or any, when none is asked) is loaded, else an estimate."""
        s = self.server
        if s and s.alive and (model_id is None or model_id == s.model_id):
            try:
                status, body = await asyncio.to_thread(http_post_json, s.port, "/tokenize", {"content": text}, s.key)
                if status == 200:
                    return {"tokens": len(json.loads(body).get("tokens", [])), "exact": True}
            except (OSError, http.client.HTTPException, ValueError):
                pass
        return {"tokens": estimate_tokens(text), "exact": False}


def estimate_tokens(text: str) -> int:
    """Rough token count without a tokenizer: one token per 3.5 characters, on the high side for English and French."""
    return -(-len(text) * 2 // 7) if text else 0


def llamacpp_model_file(repo: str, filename: str) -> Path | None:
    from .audiocpp import model_file

    return model_file(repo, filename)


def _plan(spec: ModelSpec, system: dict[str, Any]) -> dict[str, Any]:
    from .system import memory_plan

    return memory_plan(spec.weights_gb, spec.largest_component_gb, system, spec.backend, spec.options.get("overhead_gb", 0.0))


llm = LlmManager()
