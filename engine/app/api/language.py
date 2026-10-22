# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Language of the interface on the HTTP side: where it is read (`Accept-Language`) and the two ways texts leave in it."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ..i18n import localize, parse_accept_language, set_language


class LanguageMiddleware:
    """Pure ASGI (no buffering of the streams): remembers the language announced by the request, if it names one."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            raw = dict(scope["headers"]).get(b"accept-language")
            lang = parse_accept_language(raw.decode("latin-1") if raw else None)
            if lang:
                set_language(lang)
        await self.app(scope, receive, send)


class LocalizedJSONResponse(JSONResponse):
    """Default response class: the texts of the answer in the language of the interface."""

    def render(self, content: Any) -> bytes:
        return super().render(localize(content))


async def localized_http_exception(request: Request, exc: HTTPException):
    exc.detail = localize(exc.detail)
    return await http_exception_handler(request, exc)
