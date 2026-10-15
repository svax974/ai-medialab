# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Routes of the chat models (`/engine/v1/llm/*`) and of their runtime installer (`/engine/v1/engines/llamacpp/*`).

The engine keeps no conversation: Nest sends the whole history with every `POST /llm/chat` and receives a stream of
server-sent events, one JSON object per event, each with its `type` (see `llm.ChatEvents` and `llm.upstream_error`):

    loading     {phase: starting | loading, model_id, elapsed_s?}      the model is being loaded
    reasoning   {content}                                              a piece of the model's thinking
    delta       {content}                                              a piece of the answer
    tool_calls  {calls: [{id, type: "function", function: {name, arguments}}]}   once, complete
    usage       {prompt_tokens, completion_tokens, cached_tokens, tokens_per_second, prompt_ms, predicted_ms, context_size}
    done        {finish_reason: stop | length | tool_calls}            always the last event of a good reply
    error       {code: refused | busy | context_exceeded | upstream | closed, message, n_prompt_tokens?, n_ctx?}

Closing the connection stops the generation and leaves the model loaded.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import llamacpp
from ..events import bus
from ..llm import LlmError, llm

llm_router = APIRouter(prefix="/llm", tags=["llm"])
llamacpp_router = APIRouter(prefix="/engines/llamacpp", tags=["llm"])


class ImageUrl(BaseModel):
    url: str = Field(max_length=30_000_000, description="A data URL, or the absolute path of a file of the data folder.")


class ChatPart(BaseModel):
    type: Literal["text", "image_url"]
    text: str | None = None
    image_url: ImageUrl | None = None


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[ChatPart] | None = None
    tool_calls: list[dict[str, Any]] | None = Field(default=None, description="OpenAI-shaped calls of an assistant turn.")
    tool_call_id: str | None = Field(default=None, description="The call a `tool` message answers.")
    name: str | None = None


class SamplingParams(BaseModel):
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    top_k: int | None = Field(default=None, ge=0, le=1000)
    min_p: float | None = Field(default=None, ge=0, le=1)
    repeat_penalty: float | None = Field(default=None, ge=0, le=2)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=262144)
    seed: int | None = Field(default=None, ge=0, le=4294967295)
    stop: list[str] | None = Field(default=None, max_length=8)


class ChatBody(BaseModel):
    model_id: str
    messages: list[ChatMessage] = Field(min_length=1, max_length=2000)
    params: SamplingParams = Field(default_factory=SamplingParams)
    context_size: int | None = Field(default=None, ge=256, le=1_048_576,
                                     description="Tokens of context; clamped to the model's range. The model reloads when it changes.")
    tools: list[dict[str, Any]] | None = Field(default=None, max_length=64, description="OpenAI function schemas.")
    tool_choice: str | dict[str, Any] | None = None
    reasoning: Literal["auto", "off", "low", "medium", "high"] = "auto"
    response_format: dict[str, Any] | None = Field(
        default=None, description="Constrained JSON answer, as llama-server takes it: {type: 'json_object' | 'json_schema', schema?}.")
    private: bool = Field(default=False, description="A private session's reply: unloading the model afterwards leaves no log line.")


class LlmStatus(BaseModel):
    state: Literal["idle", "loading", "ready", "generating"]
    model_id: str | None = None
    variant: str | None = None
    context_size: int | None = None
    vision: bool | None = None
    pid: int | None = None
    started_at: float | None = None
    last_error: str | None = None


class TokenizeBody(BaseModel):
    text: str = Field(max_length=2_000_000)
    model_id: str | None = None


class TokenCount(BaseModel):
    tokens: int
    exact: bool = Field(description="False: an estimate (the model is not loaded).")


def sse(event: dict[str, Any]) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


@llm_router.get("/status", response_model=LlmStatus)
def llm_status() -> dict[str, Any]:
    return llm.status()


@llm_router.post("/chat")
async def chat(body: ChatBody) -> StreamingResponse:
    """Streams one reply (`text/event-stream`, events above). Refusals that come before any byte are plain HTTP errors:
    404 unknown model, 422 not a chat model or a request the model cannot take (images, tools), 409 engine or model not
    installed, a media generation or another reply running."""
    request = body.model_dump(exclude_none=True)
    try:
        spec = llm.precheck(body.model_id, body.context_size)
        payload = llm.prepare(spec, request)
    except LlmError as exc:
        raise HTTPException(exc.status, str(exc)) from None

    async def stream() -> AsyncIterator[str]:
        async for event in llm.chat(spec, request, payload):
            yield sse(event)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@llm_router.post("/unload", response_model=LlmStatus)
async def unload() -> dict[str, Any]:
    """Unloads the chat model (409 while a reply is being generated)."""
    if llm.generating:
        raise HTTPException(409, "Une réponse est en cours de génération.")
    await llm.stop()
    return llm.status()


@llm_router.post("/tokenize", response_model=TokenCount)
async def tokenize(body: TokenizeBody) -> dict[str, Any]:
    """Tokens of a text, for the context gauge: exact when the model is loaded, else an estimate."""
    return await llm.tokenize(body.text, body.model_id)


# Runtime (llama.cpp) --------------------------------------------------------------------------------------------------

@llamacpp_router.post("/install")
async def install_runtime() -> dict[str, Any]:
    """Installs llama.cpp for this machine; the progress comes through the `llamacpp.install` event."""
    try:
        return await llamacpp.installer.start()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


@llamacpp_router.delete("/install")
async def cancel_runtime_install() -> dict[str, Any]:
    if not llamacpp.installer.cancel():
        raise HTTPException(409, "Aucune installation en cours.")
    return {"ok": True}


@llamacpp_router.delete("")
async def uninstall_runtime() -> dict[str, Any]:
    """Removes llama.cpp (409 while the chat model is loaded or an install runs)."""
    if llm.server is not None and llm.server.alive:
        raise HTTPException(409, "Le moteur de chat est en cours d'utilisation : déchargez le modèle d'abord.")
    if llamacpp.installer.running:
        raise HTTPException(409, "Une installation est en cours.")
    await asyncio.to_thread(shutil.rmtree, llamacpp.install_root(), True)
    from ..system import get_system

    get_system(refresh=True)
    bus.publish("models.changed", {})
    return {"ok": True}
