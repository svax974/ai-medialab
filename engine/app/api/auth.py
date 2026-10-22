# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Shared-secret check for the internal `/engine/v1` API (the NestJS server is the only legitimate caller)."""

from __future__ import annotations

import hmac
import os

from fastapi import HTTPException, Request

TOKEN_HEADER = "X-Engine-Token"
ENV_VAR = "ENGINE_TOKEN"
OPEN_PATHS = frozenset({"/engine/v1/status"})


def require_engine_token(request: Request) -> None:
    """Reject the request unless it carries `ENGINE_TOKEN`; no-op when the variable is unset (standalone dev).

    The variable is read per request so tests and launchers can set it after import. The comparison is
    constant-time. `/engine/v1/status` stays open (liveness probe).
    """
    expected = os.environ.get(ENV_VAR, "")
    if not expected or request.url.path.rstrip("/") in OPEN_PATHS:
        return
    given = request.headers.get(TOKEN_HEADER, "")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(401, "Jeton moteur invalide ou absent.")
