# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Route of « what's new » (`hf_trending.py`): recent, successful Hugging Face models this machine can run.

Under the `hf` segment with the search and the inspection of a repository: an entry is added with the same flow
(`GET /hf/inspect`, then `POST /models/custom`)."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import hf_search, hf_trending

trending_router = APIRouter(prefix="/hf", tags=["hf"])


class TrendingOption(BaseModel):
    """The variant the add flow would select by default."""

    key: str | None = None
    label: str | None = None
    precision: str | None = None
    size_gb: float | None = None
    download_gb: float | None = None
    fits: bool | None = None
    fit_note: str | None = None


class TrendingEntry(BaseModel):
    repo: str
    name: str
    author: str
    family: str
    family_label: str
    task: str
    created_at: str
    age_days: int
    downloads: int
    likes: int
    trending_score: float
    license: str
    # `noncommercial` or `custom` when the licence is not a plain open one.
    license_note: Literal["noncommercial", "custom"] | None = None
    compatible: bool
    reason: str
    options: int
    option: TrendingOption | None = None
    url: str


class TrendingHidden(BaseModel):
    heavy: int
    existing: int


class TrendingResponse(BaseModel):
    kind: str
    days: int
    generated_at: float
    cached: bool
    results: list[TrendingEntry]
    hidden: TrendingHidden


@trending_router.get("/trending", response_model=TrendingResponse)
async def hf_trending_models(
    kind: Literal["image", "audio", "video", "llm"] = "image",
    days: int = Query(hf_trending.DEFAULT_DAYS, ge=hf_trending.MIN_DAYS, le=hf_trending.MAX_DAYS),
    limit: int = Query(hf_trending.DEFAULT_LIMIT, ge=1, le=hf_trending.MAX_LIMIT),
    include_heavy: bool = False,
    refresh: bool = False,
) -> dict:
    """New models of a kind that are successful and runnable here, best first. Reads the Hub: can take seconds the first time, then an hour from memory."""
    try:
        return await asyncio.to_thread(hf_trending.trending, kind, days, limit, include_heavy, refresh)
    except hf_search.HubError as exc:
        raise HTTPException(502, str(exc)) from None
