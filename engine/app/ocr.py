# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Reading the text of an image or of the pages of a PDF with an OCR model (`engines/ocr_models.py`).

The engine keeps nothing: a request names a file of the data folder, a model and a task, and the answer is a stream of events
(`pages`, `page`, `done`, `error`, plus the `loading` events of the model). A PDF is rasterized one page at a time, right
before the model reads it, into a temporary folder that is removed at the end. The model runs in its own `llama-server`
(`llm.ocr_llm`), so it can stay loaded next to the chat model when both fit under the memory ceiling (`memory_budget.py`).
"""

from __future__ import annotations

import asyncio
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

from . import config
from .engines.base import ModelSpec
from .llm import IMAGE_MIME, LlmError, ocr_llm

PDF_SUFFIX = ".pdf"
MAX_PAGES = 300  # one request reads at most this many pages
RENDER_LONG_SIDE = 2000  # pixels of the longest side of a rasterized page: sharp enough to read, small enough to be fast
MAX_PDF_BYTES = 200 * 1024 * 1024


class OcrError(LlmError):
    """A refusal of the request itself (unreadable file, unknown task): the route answers it before any byte is streamed."""


def task_prompt(spec: ModelSpec, task: str, prompt: str | None) -> str:
    """The prompt for a task: the model's own wording, or the user's instruction for `custom` on a model that follows any."""
    caps = spec.ocr
    if caps is None:
        raise OcrError(f"« {spec.name} » n'est pas un modèle de lecture de texte.")
    if task == "custom":
        if not caps.free_prompt:
            raise OcrError(f"« {spec.name} » ne suit pas de consigne libre : choisissez l'une de ses tâches.")
        if not (prompt or "").strip():
            raise OcrError("La consigne est vide.")
        return prompt.strip()  # type: ignore[union-attr]
    key = caps.default_task if task == "default" else task
    if key not in caps.tasks:
        raise OcrError(f"« {spec.name} » ne propose pas la tâche « {task} ».")
    return caps.tasks[key]


def clean(spec: ModelSpec, text: str) -> str:
    """The answer without the markers the model adds around its text (grounding boxes...)."""
    for pattern in spec.ocr.strip if spec.ocr else []:
        text = re.sub(pattern, "", text, flags=re.S)
    return text.strip()


def source_kind(path: Path) -> str:
    """`pdf` or `image` for a readable file, else a refusal."""
    if not path.is_file():
        raise OcrError("Fichier introuvable.")
    suffix = path.suffix.lower()
    if suffix == PDF_SUFFIX:
        if path.stat().st_size > MAX_PDF_BYTES:
            raise OcrError("PDF refusé : plus de 200 Mo.")
        return "pdf"
    if suffix in IMAGE_MIME:
        return "image"
    raise OcrError("Format non pris en charge : image (png, jpg, webp, gif) ou PDF.")


def open_pdf(path: Path) -> Any:
    import pypdfium2 as pdfium

    try:
        return pdfium.PdfDocument(str(path))
    except Exception as exc:  # noqa: BLE001  pdfium raises its own PdfiumError for a damaged or protected file
        raise OcrError("PDF illisible (abîmé ou protégé par un mot de passe).") from exc


def render_page(pdf: Any, index: int, out: Path) -> Path:
    """Page `index` (0-based) as a PNG in `out`."""
    page = pdf[index]
    try:
        width, height = page.get_size()
        scale = max(0.5, min(4.0, RENDER_LONG_SIDE / max(width, height, 1.0)))
        file = out / f"page-{index + 1:04d}.png"
        page.render(scale=scale).to_pil().convert("RGB").save(file)
        return file
    finally:
        page.close()


def select_pages(total: int, wanted: list[int] | None) -> list[int]:
    """0-based indexes to read: the 1-based `wanted` pages (sorted, without duplicates), else all, within `MAX_PAGES`."""
    if wanted is None:
        chosen = list(range(total))
    else:
        bad = [p for p in wanted if p < 1 or p > total]
        if bad:
            raise OcrError(f"Page hors du document ({total} pages) : {bad[0]}.")
        chosen = sorted({p - 1 for p in wanted})
    if not chosen:
        raise OcrError("Aucune page à lire.")
    if len(chosen) > MAX_PAGES:
        raise OcrError(f"{MAX_PAGES} pages au plus par lecture.")
    return chosen


def page_request(image: Path, prompt: str, force_memory: bool = False) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [{"type": "image_url", "image_url": {"url": str(image)}}]
    if prompt:  # a model such as LightOnOCR reads the image alone
        parts.append({"type": "text", "text": prompt})
    return {"messages": [{"role": "user", "content": parts}], "reasoning": "off", "force_memory": force_memory}


async def read_page(spec: ModelSpec, image: Path, prompt: str, forward: Any, force_memory: bool = False) -> dict[str, Any]:
    """One page through the model: `{text, truncated, usage}`, or the error event that stopped it."""
    request = page_request(image, prompt, force_memory)
    payload = ocr_llm.prepare(spec, request)
    text, truncated, usage = "", False, {}
    async for event in ocr_llm.chat(spec, request, payload):
        kind = event["type"]
        if kind == "delta":
            text += event["content"]
        elif kind == "loading":
            forward(event)
        elif kind == "usage":
            usage = {k: event.get(k) for k in ("prompt_tokens", "completion_tokens", "tokens_per_second")}
        elif kind == "done":
            truncated = event.get("finish_reason") == "length"
        elif kind == "error":
            return {"error": event}
    return {"text": clean(spec, text), "truncated": truncated, "usage": usage}


async def read(spec: ModelSpec, source: Path, task: str, prompt: str | None, pages: list[int] | None,
               force_memory: bool = False) -> AsyncIterator[dict[str, Any]]:
    """Events of one reading. Checks that can fail (file, task, pages) have already run in `prepare`."""
    plan = prepare(spec, source, task, prompt, pages)
    tmp = config.DATA_DIR / "ocr-tmp" / uuid.uuid4().hex
    pdf = open_pdf(source) if plan["kind"] == "pdf" else None
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    try:
        total = len(plan["indexes"])
        yield {"type": "pages", "total": total, "document_pages": plan["document_pages"]}
        for position, index in enumerate(plan["indexes"]):
            yield {"type": "page_start", "index": index + 1, "position": position + 1, "total": total}
            if pdf is not None:
                tmp.mkdir(parents=True, exist_ok=True)
                image = await asyncio.to_thread(render_page, pdf, index, tmp)
            else:
                image = source
            answer = await read_page(spec, image, plan["prompt"], queue.put_nowait, force_memory)
            while not queue.empty():
                yield queue.get_nowait()
            if "error" in answer:
                yield answer["error"]
                return
            yield {"type": "page", "index": index + 1, "position": position + 1, "total": total, **answer}
        yield {"type": "done", "pages": total}
    finally:
        if pdf is not None:
            pdf.close()
        shutil.rmtree(tmp, ignore_errors=True)


def prepare(spec: ModelSpec, source: Path, task: str, prompt: str | None, pages: list[int] | None) -> dict[str, Any]:
    """Everything a reading needs, or the refusal: `{kind, prompt, indexes, document_pages}`."""
    kind = source_kind(source)
    text_prompt = task_prompt(spec, task, prompt)
    if kind == "image":
        if pages not in (None, [1]):
            raise OcrError("Une image n'a qu'une page.")
        return {"kind": kind, "prompt": text_prompt, "indexes": [0], "document_pages": 1}
    pdf = open_pdf(source)
    try:
        total = len(pdf)
    finally:
        pdf.close()
    return {"kind": kind, "prompt": text_prompt, "indexes": select_pages(total, pages), "document_pages": total}
