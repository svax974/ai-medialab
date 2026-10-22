# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Private generation, engine side: where a private job writes, how it is served, and what it never says.

A private session is a random folder `<data>/private/<session id>` that the caller (NestJS) creates and removes. A
private job names it (`private_dir`); the engine then keeps EVERYTHING of that job inside it: the output files, the
thumbnails, the previews and the uploaded references (`inputs/`, `outputs/`, `thumbs/`, `previews/`). It also keeps
nothing about the job once it ended (no entry in the history of finished jobs), writes no prompt, path or error
detail to its journal, and strips the prompt from the description of what it produced. Files are served under
`/media/private/<session>/…` with `Cache-Control: no-store`.

What this does not do: an unlink is not a secure erase (APFS, SSD wear levelling), memory and swap are not scrubbed,
and the command line of the model process (which contains the prompt) is visible to the user's other processes while
the job runs. The honest list is in `back/src/modules/private/README.md`.
"""

from __future__ import annotations

import re
from pathlib import Path

from starlette.staticfiles import StaticFiles

from . import config

SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
SUBFOLDERS = ("inputs", "outputs", "thumbs", "previews", "tmp")
GENERIC_ERROR = "La génération a échoué (les détails ne sont pas conservés en mode privé)."
# Messages the engine itself writes about memory: no content, and the one thing the user can act on.
SAFE_PREFIXES = ("Mémoire insuffisante", "Mémoire GPU insuffisante", "Arrêté par la protection mémoire",
                 "Le processus du modèle s'est arrêté", "sd-cli s'est arrêté (code")


def session_dir(raw: str, what: str = "private_dir") -> Path:
    """The session folder `raw` names; ValueError unless it is `<data>/private/<id>` with a well-formed id."""
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError(f"{what} : chemin absolu attendu.")
    resolved = path.resolve()
    if resolved.parent != config.PRIVATE_DIR.resolve() or not SESSION_ID.match(resolved.name):
        raise ValueError(f"{what} : dossier de session privée invalide.")
    return resolved


def inside(path: Path, base: Path) -> bool:
    resolved = path.resolve()
    return resolved == base or base in resolved.parents


def subfolder(base: Path, name: str) -> Path:
    """`base/name`, created (a private folder is only readable by the user running the application)."""
    if name not in SUBFOLDERS:
        raise ValueError(f"dossier privé inconnu : {name}")
    folder = base / name
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def media_url(session: str | Path, folder: str, filename: str) -> str:
    """URL under which the engine serves a file of a private session (`/media/private/<id>/<folder>/<file>`)."""
    return f"/media/private/{Path(session).name}/{folder}/{filename}"


def sanitize_error(error: str | None, prompt: str = "") -> str | None:
    """What a private job reports of a failure that came from a model: the memory messages as they are, else nothing.

    Model errors quote the prompt, the files or the parameters, so only the first line of a message the engine itself
    wrote about memory survives; everything else becomes `GENERIC_ERROR`."""
    if not error:
        return error
    first = error.strip().splitlines()[0][:240] if error.strip() else ""
    if not first.startswith(SAFE_PREFIXES):
        return GENERIC_ERROR
    text = prompt.strip()
    return first.replace(text, "…") if len(text) >= 4 else first


class NoStoreStaticFiles(StaticFiles):
    """Static files that the browser must neither keep nor revalidate (no ETag, no Last-Modified)."""

    async def get_response(self, path, scope):  # noqa: ANN001  (Starlette signature)
        response = await super().get_response(path, scope)
        for name in ("etag", "last-modified"):
            if name in response.headers:
                del response.headers[name]
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
