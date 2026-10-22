# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Finds the French texts of the engine code, to check each has an English entry (`app/locales/en/*.json`).

`python tests/i18n_scan.py` (from engine/) prints the texts that have none, by source file, ready to be written in the
catalog. A text is French when it has an accented letter or two French function words; docstrings and the arguments of
`logger.*` / `print` calls are not shown to the user and are skipped. An f-string becomes a template: `{}` per value."""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
APP = ENGINE / "app"
# `app/` and the runtimes that run in their own environments (their messages come back through the engine).
ROOTS = (APP, ENGINE / "audio_runtime", ENGINE / "video_runtime")
ACCENTS = re.compile(r"[àâäçéèêëîïôöùûüœÀÂÇÉÈÊÎÔÙÛ]")
WORDS = re.compile(r"\b(le|la|les|des|du|un|une|est|pas|pour|avec|sans|ou|et|il|elle|ne|que|qui|sur|dans|par|au|aux|ce|cette|votre|vos|ici|plus|aucun|aucune)\b")
SKIPPED_CALLS = {"logger", "logging", "log", "print", "warnings"}


def is_french(text: str) -> bool:
    if not re.search(r"[A-Za-zÀ-ÿ]{2}", re.sub(r"\{\}", "", text)):
        return False
    if ACCENTS.search(text):
        return True
    words = WORDS.findall(text.lower())
    return len(words) >= 2 or (len(words) == 1 and words[0] != "plus" and len(text.split()) >= 3)


def _template(node: ast.JoinedStr) -> str:
    return "".join(part.value if isinstance(part, ast.Constant) else "{}" for part in node.values)


class _Collector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.texts: list[tuple[str, int]] = []
        self._skip: set[int] = set()

    def _mark_docstring(self, node: ast.AST) -> None:
        body = getattr(node, "body", None)
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            self._skip.add(id(body[0].value))

    def visit_Module(self, node: ast.Module) -> None:
        self._mark_docstring(node)
        self.generic_visit(node)

    visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = lambda self, node: (self._mark_docstring(node), self.generic_visit(node))[1]

    def visit_Call(self, node: ast.Call) -> None:
        target = node.func
        while isinstance(target, ast.Attribute):
            target = target.value
        if isinstance(target, ast.Name) and target.id in SKIPPED_CALLS:
            return
        self.generic_visit(node)

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        self.texts.append((_template(node).strip(), node.lineno))  # the pieces inside are not texts of their own

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, str) and id(node) not in self._skip:
            self.texts.append((node.value.strip(), node.lineno))


def french_texts() -> dict[str, list[str]]:
    """Text or template → where it is (`file:line`)."""
    found: dict[str, list[str]] = {}
    paths = sorted(path for root in ROOTS for path in root.rglob("*.py") if "shims" not in path.parts)
    for path in paths:
        collector = _Collector()
        collector.visit(ast.parse(path.read_text(encoding="utf-8")))
        for text, line in collector.texts:
            if is_french(text):
                found.setdefault(text, []).append(f"{path.relative_to(ENGINE)}:{line}")
    return found


def missing() -> dict[str, list[str]]:
    sys.path.insert(0, str(ENGINE))
    from app.i18n import catalog_entries

    entries = catalog_entries()
    return {text: where for text, where in french_texts().items() if text not in entries}


if __name__ == "__main__":
    by_file: dict[str, list[str]] = {}
    for text, where in missing().items():
        by_file.setdefault(where[0].split(":")[0], []).append(text)
    for file, texts in by_file.items():
        print(f"{file}: {len(texts)}")
    print(f"total: {sum(len(t) for t in by_file.values())}")
