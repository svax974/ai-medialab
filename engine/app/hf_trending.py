# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""« What's new »: recent Hugging Face models that are successful and that this machine can run.

No language model is involved. The ranking only uses the signals the Hub itself publishes: `trendingScore` (the Hub's own
measure of recent momentum), the downloads of the last 30 days, the likes and the creation date. A candidate must be

- inside the window (`days`, 90 by default: the Hub cannot filter by date, so the window is applied here),
- successful: at least `THRESHOLDS[kind].likes` likes AND `THRESHOLDS[kind].downloads` downloads over 30 days,
- in a family the application can add (`hf_search.classify`), readable by `hf_search.inspect` (so that adding it will
  work) and not gated,
- not already in the catalog, not marked for adults and not named like an uncensored / abliterated variant,
- runnable here: the engine of its family is available or installable and its proposed variant fits the memory (same
  verdicts as the model list and the search, `hf_search.inspect`). Models that do not fit are only returned on request.

The Hub is queried once per family and per sort (`trending_score`, `created_at`), the survivors are inspected in
parallel (size of each variant, licence, memory verdict) and the result is kept in memory for an hour per
(kind, window): the Hub rate-limits anonymous clients. `kind` is image, audio, video or llm.
"""

from __future__ import annotations

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from . import hf_search
from .engines.custom import _title

KINDS = ("image", "audio", "video", "llm")
DEFAULT_DAYS, MIN_DAYS, MAX_DAYS = 90, 7, 365
DEFAULT_LIMIT, MAX_LIMIT = 12, 30
CACHE_SECONDS = 3600
# A refresh asked by the user is ignored when the cached answer is younger than this.
MIN_REFRESH_SECONDS = 60
# How many repos of one reference model (e.g. Qwen-Image-2.1 GGUF) one answer may hold: a hot base is re-quantized by dozens.
MAX_PER_BASE = 3
# Hub properties to fetch (no file list: the survivors are inspected afterwards).
EXPAND = ["downloads", "likes", "tags", "trendingScore", "createdAt", "gated", "pipeline_tag", "private", "disabled"]
SORTS = ("trending_score", "created_at")
QUERY_LIMIT = 100
# At most this many survivors are inspected (one or a few Hub requests each) per kind and window.
CANDIDATE_CAP = 24
WORKERS = 6


@dataclass(frozen=True)
class Threshold:
    """What a repo needs to count as successful: likes AND downloads of the last 30 days."""

    likes: int
    downloads: int


# Chosen from what the Hub returns for each type (read on the real Hub in October 2026): the repos of the supported
# image / audio / video families are few and modest (a good one has tens of likes, a niche text-to-speech tuning about
# ten), language models are far more popular. A laxer bar lets in fine-tunes with 2-3 likes and no use. Heuristics:
# change the numbers here.
THRESHOLDS: dict[str, Threshold] = {
    "image": Threshold(15, 2_000),
    "audio": Threshold(8, 250),
    "video": Threshold(10, 2_000),
    "llm": Threshold(100, 20_000),
}

# Names and tags of what is left out by default.
NOISE = re.compile(r"uncensor|abliterat|heretic|obliterat|nsfw|nude|naked|porn|erotic|hentai|lewd|jailbreak|undress|xxx", re.I)
ADULT_TAGS = {"not-for-all-audiences", "nsfw"}
# Licences that allow a normal use; anything else gets a note in the list.
OPEN_LICENSES = {"apache-2.0", "mit", "bsd-2-clause", "bsd-3-clause", "cc-by-4.0", "cc0-1.0", "unlicense", "isc", "wtfpl"}


class _Cache:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.entries: dict[tuple[str, int], tuple[float, list[dict[str, Any]], dict[str, int]]] = {}

    def get(self, key: tuple[str, int], max_age: float) -> tuple[float, list[dict[str, Any]], dict[str, int]] | None:
        with self.lock:
            hit = self.entries.get(key)
        return hit if hit and time.time() - hit[0] < max_age else None

    def put(self, key: tuple[str, int], entries: list[dict[str, Any]], hidden: dict[str, int]) -> float:
        now = time.time()
        with self.lock:
            self.entries[key] = (now, entries, hidden)
        return now

    def clear(self) -> None:
        with self.lock:
            self.entries.clear()


_cache = _Cache()


def clear_cache() -> None:
    _cache.clear()


def family_queries(kind: str) -> list[dict[str, Any]]:
    """The Hub filters that cover the families of a kind: those of the search, minus its sort, limit and expand."""
    return [{k: v for k, v in q.items() if k not in ("sort", "limit", "expand")} for q in hf_search._queries(kind, "")]


def fetch_candidates(kind: str, list_models: Callable[..., Iterable[Any]]) -> list[Any]:
    """Every repo the Hub returns for the families of the kind, sorted by trend and by creation date (duplicates removed)."""
    jobs = [{**q, "sort": s, "limit": QUERY_LIMIT, "expand": EXPAND} for q in family_queries(kind) for s in SORTS]
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = list(pool.map(lambda kw: list(list_models(**kw)), jobs))
    except Exception as exc:  # noqa: BLE001
        raise hf_search.HubError(f"Hugging Face est injoignable ({type(exc).__name__}). Vérifiez la connexion.") from None
    seen: dict[str, Any] = {}
    for model in (m for batch in batches for m in batch):
        seen.setdefault(model.id, model)
    return list(seen.values())


def _age_days(model: Any, now: datetime) -> float | None:
    created = getattr(model, "created_at", None)
    return (now - created).total_seconds() / 86400 if created else None


def is_noise(model: Any) -> bool:
    tags = set(getattr(model, "tags", None) or [])
    return bool(NOISE.search(model.id)) or bool(tags & ADULT_TAGS) or any(NOISE.search(t) for t in tags if t.startswith("base_model:"))


def kind_of(family: str) -> str | None:
    """The kind (image, audio, video, llm) a family belongs to."""
    if family.startswith("llm"):
        return "llm"
    return {"image": "image", "tts": "audio", "stt": "audio", "video": "video"}.get(hf_search.TASK.get(family, ""))


def classify_family(kind: str, model: Any) -> tuple[str, dict[str, Any]] | None:
    """(family, details) of a repo for this kind, by the application's own classification (see `hf_search.classify`)."""
    cls = hf_search.classify(model.id, list(getattr(model, "tags", None) or []))
    return cls if cls is not None and kind_of(cls[0]) == kind else None


def select(models: Iterable[Any], kind: str, days: int, now: datetime | None = None,
           cap: int = CANDIDATE_CAP) -> tuple[list[tuple[Any, str, dict[str, Any]]], int]:
    """(the candidates worth inspecting, best first; how many were left out because the catalog already has them).

    Inside the window, successful, supported, not noise. Pure (no network): everything it needs is on the Hub listing."""
    now = now or datetime.now(timezone.utc)
    bar = THRESHOLDS[kind]
    kept: list[tuple[Any, str, dict[str, Any]]] = []
    known = 0
    for m in models:
        age = _age_days(m, now)
        if age is None or age > days or getattr(m, "gated", False) or getattr(m, "private", False) or getattr(m, "disabled", False):
            continue
        if (m.likes or 0) < bar.likes or (m.downloads or 0) < bar.downloads or is_noise(m):
            continue
        cls = classify_family(kind, m)
        if cls is None:
            continue
        if hf_search._existing_for(m.id):
            known += 1
            continue
        kept.append((m, *cls))
    kept.sort(key=lambda c: (-(c[0].trending_score or 0), -(c[0].downloads or 0)))
    return _limit_per_base(kept)[:cap], known


def _limit_per_base(kept: list[tuple[Any, str, dict[str, Any]]]) -> list[tuple[Any, str, dict[str, Any]]]:
    count: dict[str, int] = {}
    out = []
    for item in kept:
        base = item[2].get("base") if item[1] in ("gguf-variant", "video-gguf", "llm-gguf") else None
        if base:
            count[base] = count.get(base, 0) + 1
            if count[base] > MAX_PER_BASE:
                continue
        out.append(item)
    return out


def proposed_option(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The variant the "add" flow selects by default: among those that fit, Q4_K if any, else the middle one (same rule as
    `defaultOption` in the interface). When none fits, the smallest one: what the model needs at the very least."""
    runnable = [o for o in options if o.get("fits") is not False]
    if not runnable:
        return options[0] if options else None
    return next((o for o in runnable if re.match(r"Q4_K", o["label"])), runnable[len(runnable) // 2])


def license_note(license_: str) -> str | None:
    """`noncommercial` or `custom` when the licence is not a plain open one, else None."""
    lic = (license_ or "").lower()
    if lic in OPEN_LICENSES:
        return None
    return "noncommercial" if re.search(r"(^|-)nc(-|$)|non-?commercial", lic) else "custom"


def build_entry(model: Any, family: str, inspected: dict[str, Any], now: datetime) -> dict[str, Any]:
    """One answer line from the Hub listing and the inspection of the repo."""
    option = proposed_option(inspected["options"])
    fits = bool(option) and option.get("fits") is not False
    compatible = bool(inspected["compatible"]) and fits
    reason = inspected.get("reason") or (option or {}).get("fit_note") or ""
    created = model.created_at
    return {
        "repo": model.id, "name": _title(model.id), "author": model.id.split("/")[0], "family": family,
        "family_label": inspected["family_label"], "task": hf_search.TASK[family], "created_at": created.isoformat(),
        "age_days": max(0, int((now - created).total_seconds() // 86400)), "downloads": model.downloads or 0,
        "likes": model.likes or 0, "trending_score": model.trending_score or 0, "license": inspected["license"],
        "license_note": license_note(inspected["license"]), "compatible": compatible, "reason": "" if compatible else reason,
        "options": len(inspected["options"]),
        "option": {k: option.get(k) for k in ("key", "label", "precision", "size_gb", "download_gb", "fits", "fit_note")}
        if option else None,
        "url": f"https://huggingface.co/{model.id}",
    }


def build_entries(chosen: list[tuple[Any, str, dict[str, Any]]], inspect: Callable[[str], dict[str, Any]],
                  now: datetime) -> list[dict[str, Any]]:
    """Inspect the candidates in parallel; one the application cannot read after all (missing files, unexpected layout) is dropped."""
    def one(item: tuple[Any, str, dict[str, Any]]) -> dict[str, Any] | None:
        model, family, _details = item
        try:
            return build_entry(model, family, inspect(model.id), now)
        except hf_search.HubError:
            return None
        except Exception:  # noqa: BLE001  one odd repo must not hide the others
            return None

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return [e for e in pool.map(one, chosen) if e is not None]


def compute(kind: str, days: int, list_models: Callable[..., Iterable[Any]], inspect: Callable[[str], dict[str, Any]],
            now: datetime | None = None) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """All the entries for a kind and a window (heavy ones included, flagged) and the counts of what was left out."""
    now = now or datetime.now(timezone.utc)
    chosen, known = select(fetch_candidates(kind, list_models), kind, days, now)
    return build_entries(chosen, inspect, now), {"existing": known}


def trending(kind: str, days: int = DEFAULT_DAYS, limit: int = DEFAULT_LIMIT, include_heavy: bool = False,
             refresh: bool = False, list_models: Callable[..., Iterable[Any]] | None = None,
             inspect: Callable[[str], dict[str, Any]] | None = None) -> dict[str, Any]:
    """The « what's new » answer for a kind: `results` (best first), what was hidden and when it was computed."""
    if kind not in KINDS:
        raise hf_search.HubError("Type de modèle inconnu.")
    days = min(MAX_DAYS, max(MIN_DAYS, days))
    limit = min(MAX_LIMIT, max(1, limit))
    key = (kind, days)
    hit = _cache.get(key, MIN_REFRESH_SECONDS if refresh else CACHE_SECONDS)
    cached = hit is not None
    if hit is None:
        entries, hidden = compute(kind, days, list_models or hf_search._api().list_models, inspect or hf_search.inspect)
        stamp = _cache.put(key, entries, hidden)
    else:
        stamp, entries, hidden = hit
    shown = [e for e in entries if include_heavy or e["compatible"]]
    return {"kind": kind, "days": days, "generated_at": stamp, "cached": cached, "results": shown[:limit],
            "hidden": {"heavy": sum(1 for e in entries if not e["compatible"]) if not include_heavy else 0,
                       "existing": hidden["existing"]}}
