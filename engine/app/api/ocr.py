# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Routes of the OCR models (`/engine/v1/ocr/*`): read an image or a PDF, state and unloading of the OCR server.

`POST /ocr/read` streams server-sent events, one JSON object per event, each with its `type` (see `ocr.read`):

    loading     {phase: starting | loading, model_id, elapsed_s?}      the model is being loaded
    pages       {total, document_pages}                                how many pages will be read
    page_start  {index, position, total}                               a page begins (`index`: page of the document, from 1)
    page        {index, position, total, text, truncated, usage}       a page is read
    done        {pages}                                                always the last event of a good reading
    error       {code, message}                                        the reading stopped (the pages already sent stay valid)

Closing the connection stops the reading and leaves the model loaded.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import ocr
from ..llm import LlmError, ocr_llm
from .jobs import _inside_data_dir
from .llm import LlmStatus, sse

ocr_router = APIRouter(prefix="/ocr", tags=["ocr"])


class OcrBody(BaseModel):
    model_id: str
    path: str = Field(description="Absolute path of an image or a PDF inside the data folder.")
    task: Literal["default", "text", "markdown", "table", "formula", "chart", "custom"] = "default"
    prompt: str | None = Field(default=None, max_length=4000, description="The instruction of a `custom` task.")
    pages: list[int] | None = Field(default=None, max_length=ocr.MAX_PAGES, description="Pages of a PDF to read, from 1; all when absent.")


@ocr_router.get("/status", response_model=LlmStatus)
def ocr_status() -> dict[str, Any]:
    return ocr_llm.status()


@ocr_router.post("/unload", response_model=LlmStatus)
async def unload() -> dict[str, Any]:
    """Unloads the OCR model (409 while a page is being read)."""
    if ocr_llm.generating:
        raise HTTPException(409, "Une lecture est en cours.")
    await ocr_llm.stop()
    return ocr_llm.status()


@ocr_router.post("/read")
async def read(body: OcrBody) -> StreamingResponse:
    """Streams the reading (`text/event-stream`, events above). Refusals that come before any byte are plain HTTP errors:
    404 unknown model, 422 not an OCR model, unreadable file, unknown task, pages outside the document, 409 engine or model not
    installed, a media generation or another reply running."""
    source = _inside_data_dir(body.path, "path")
    try:
        spec = ocr_llm.precheck(body.model_id)
        ocr.prepare(spec, source, body.task, body.prompt, body.pages)
    except LlmError as exc:
        raise HTTPException(exc.status, str(exc)) from None

    async def stream() -> AsyncIterator[str]:
        try:
            async for event in ocr.read(spec, Path(source), body.task, body.prompt, body.pages):
                yield sse(event)
        except LlmError as exc:
            yield sse({"type": "error", "code": "refused", "message": str(exc)})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
