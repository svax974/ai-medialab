# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Language of the interface for the texts the engine writes (catalog notes, parameter labels, progress messages, errors).

The source texts are French; `app/locales/en/*.json` maps each French text to its English one (the catalog of a language
is a directory of files merged, one per source module, so they can be edited side by side). A text with values is written
once with `{}` for each (`"Il faut ≈ {} Go ({} Go ici)."`), and `{0}`, `{1}` in the English side when the order changes.

Nothing in the engine code calls a translation function: the answers are translated on the way out (`localize`, applied
by the JSON response class, the HTTP error handler and the event stream), so a text added to the code only needs its
English entry. `tests/test_i18n.py` fails on a French text of the code that has none.

The language is the one the Nest server announces with `Accept-Language` (the language chosen in the settings). The app is
single-user: one current value serves the requests and the threads that run behind them (progress of an installation).
Without a catalog entry a text stays French, deliberately visible.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

SUPPORTED = ("fr", "en")
DEFAULT_LANGUAGE = "en"
LOCALES_DIR = Path(__file__).parent / "locales"

_current = DEFAULT_LANGUAGE
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
_PLACEHOLDER = re.compile(r"\{\d*\}")


def parse_accept_language(header: str | None) -> str | None:
    """First supported language of an `Accept-Language` value, in the order given; None when it names none."""
    for part in (header or "").split(","):
        tag = part.split(";")[0].strip().lower().split("-")[0]
        if tag in SUPPORTED:
            return tag
    return None


def set_language(lang: str) -> None:
    global _current
    if lang in SUPPORTED:
        _current = lang


def language() -> str:
    return _current


@lru_cache(maxsize=1)
def catalog_entries() -> dict[str, str]:
    """French text (or template with `{}`) → English, merged from every file of `locales/en/`."""
    entries: dict[str, str] = {}
    for path in sorted((LOCALES_DIR / "en").glob("*.json")):
        entries.update(json.loads(path.read_text(encoding="utf-8")))
    return entries


@lru_cache(maxsize=1)
def _catalog() -> tuple[dict[str, str], list[tuple[re.Pattern[str], str]]]:
    """(exact texts, templates with values as regexes) of the catalog."""
    entries = catalog_entries()
    exact = {fr: en for fr, en in entries.items() if "{}" not in fr}
    templates = []
    for fr, en in sorted(entries.items(), key=lambda item: -len(item[0])):
        if "{}" in fr:
            pattern = "(.+?)".join(re.escape(piece) for piece in fr.split("{}"))
            templates.append((re.compile(pattern, re.DOTALL), en))
    return exact, templates


def clear_catalog() -> None:
    """Tests only: forgets the loaded files."""
    catalog_entries.cache_clear()
    _catalog.cache_clear()
    _translate_text.cache_clear()


def _fill(template: str, values: tuple[str, ...]) -> str:
    sequence = iter(values)
    return _PLACEHOLDER.sub(lambda m: values[int(m.group()[1:-1])] if m.group() != "{}" else next(sequence), template)


def _translate_whole(text: str) -> str | None:
    exact, templates = _catalog()
    if text in exact:
        return exact[text]
    for pattern, english in templates:
        match = pattern.fullmatch(text)
        if match:
            # A value that is itself a catalog text (a reason, a description) is translated too.
            return _fill(english, tuple(_translate_text(value) for value in match.groups()))
    return None


@lru_cache(maxsize=4096)
def _translate_text(text: str) -> str:
    whole = _translate_whole(text)
    if whole is not None:
        return whole
    # A text built from several sentences (`note += ...`): each one that has an entry is translated.
    parts = _SENTENCE_END.split(text)
    if len(parts) < 2:
        return text
    translated = [_translate_whole(part) for part in parts]
    if all(t is None for t in translated):
        return text
    return " ".join(t if t is not None else part for t, part in zip(translated, parts))


def translate(text: str) -> str:
    """The text in the current language (it is returned unchanged in French or when it has no entry)."""
    return text if _current == "fr" or not text.strip() else _translate_text(text)


def localize(value: Any) -> Any:
    """`value` (any JSON structure) with each string translated; keys are left alone."""
    if _current == "fr":
        return value
    if isinstance(value, str):
        return _translate_text(value) if value.strip() else value
    if isinstance(value, list):
        return [localize(item) for item in value]
    if isinstance(value, dict):
        return {key: localize(item) for key, item in value.items()}
    return value
