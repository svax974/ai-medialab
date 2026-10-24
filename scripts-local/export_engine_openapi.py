#!/usr/bin/env python3
# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT
"""Write engine/openapi.json: the OpenAPI schema of the internal `/engine/v1` API (no server is started).

The NestJS back end generates its TypeScript types from this file (openapi-typescript). Run it from the repo root:

    engine/.venv/bin/python scripts-local/export_engine_openapi.py            # rewrite engine/openapi.json
    engine/.venv/bin/python scripts-local/export_engine_openapi.py --check    # exit 1 if the committed file is stale
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "engine" / "openapi.json"

# Importing the app must not touch the real data folder.
os.environ.setdefault("IMAGEGEN_DATA_DIR", tempfile.mkdtemp(prefix="ai-medialab-openapi-"))
sys.path.insert(0, str(ROOT / "engine"))


def render() -> str:
    from app.main import app  # noqa: PLC0415 (after the environment is set)

    schema = app.openapi()
    # FastAPI reports its own default ("0.1.0"): the release bumps `engine/pyproject.toml`, which is the version of record.
    schema["info"]["version"] = tomllib.loads((ROOT / "engine" / "pyproject.toml").read_text())["project"]["version"]
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not TARGET.is_file() or TARGET.read_text() != text:
            print(f"{TARGET} est périmé : relancez scripts-local/export_engine_openapi.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(text)
    print(f"{TARGET} écrit ({len(text)} octets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
