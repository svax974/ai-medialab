# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Everything a model needs, installed in one go: the plan the user confirms, then one run with one progress and one cancel.

`plan_for_model` lists the missing pieces (base data, engine, model) with their sizes; what is already installed is not in
the download, so a shared piece (PyTorch, FFmpeg, an engine) is fetched once, by the first model that needs it.
`SetupRunner` runs the plan with the installers that exist (`audio_packs`, `engine_install`, `llamacpp`, `downloads`), one
after the other. Cancelling stops the current step, whose installer removes its partial files; the steps already finished
stay installed (a later model reuses them). State is broadcast through the `setup.progress` event.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

from . import audio_packs, components
from .events import bus
from .engines import get_spec
from .system import get_system

POLL_SECONDS = 0.5
CANCEL_GRACE_SECONDS = 60


def _sdcpp_outdated(spec: Any, system: dict[str, Any] | None) -> bool:
    from . import sdcpp
    return sdcpp.outdated_for(spec, (system or get_system())["engines"].get("sdcpp", {}))


def _steps_of(spec: Any, system: dict[str, Any] | None, purpose: str | None = None) -> list[dict[str, Any]]:
    """Steps of one model: its components (base first), then its files. `purpose` tags a model added along the asked one."""
    from .downloads import downloads

    steps: list[dict[str, Any]] = []
    for cid in components.components_of(spec):
        installed = components.is_installed(cid)
        if cid == components.SDCPP and installed and _sdcpp_outdated(spec, system):
            installed = False  # present but too old for this model: the install step updates it
        size = components.size_mb(cid, system)
        if cid == components.SDCPP and not installed and not size:
            from .engine_install import install_size_mb

            size = install_size_mb((system or get_system())["engines"]["sdcpp"].get("variant", ""))
        steps.append({"id": cid, "kind": components.kind_of(cid), "name": components.name_and_contents(cid)[0],
                      "installed": installed, "size_mb": 0 if installed else size,
                      "blocked": None if installed else components.blocked_reason(cid, system), "purpose": purpose})
    if spec.all_sources():
        status = downloads.status(spec)
        installed = status["state"] == "installed"
        remaining = max(0.0, (spec.download_size_gb or 0) - status["size_gb"]) * 1024
        steps.append({"id": spec.id, "kind": "model", "name": spec.name, "installed": installed,
                      "size_mb": 0 if installed else int(remaining), "blocked": None, "purpose": purpose})
    return steps


def transcription_companion(spec: Any, system: dict[str, Any] | None = None) -> Any | None:
    """The speech-to-text model to install along with a speech model, so that an imported voice sample is transcribed.

    None when the model is not a speech synthesis one, or when a transcription model is already on the disk. Among the
    transcription models, the first (in `transcription.PREFERRED` order) that needs no engine beyond those already installed
    or required by `spec` wins, else the first one this machine can run."""
    from . import transcription
    from .downloads import downloads
    from .engines import MODELS

    if spec.kind != "audio" or not spec.audio or spec.audio.task != "tts":
        return None
    candidates = transcription.ordered(MODELS)
    if any(downloads.status(m)["state"] == "installed" for m in candidates):
        return None
    covered = set(components.components_of(spec))
    usable = [m for m in candidates if not any(components.blocked_reason(c, system) for c in components.components_of(m))]
    cheap = [m for m in usable if all(c in covered or components.is_installed(c) for c in components.components_of(m))]
    return (cheap or usable or [None])[0]


def plan_for_model(model_id: str, system: dict[str, Any] | None = None) -> dict[str, Any]:
    """Steps to make a model usable: its components (base first), then the model files; `installed` steps cost nothing.
    A speech model brings a transcription model too (`transcription_companion`), tagged `purpose: "transcription"`.

    Raises KeyError for an unknown model. `blocked`: why this machine cannot run it at all (French), or None."""
    spec = get_spec(model_id)
    steps = _steps_of(spec, system)
    if companion := transcription_companion(spec, system):
        known = {s["id"] for s in steps}
        steps += [s for s in _steps_of(companion, system, "transcription") if s["id"] not in known]
    missing = [s for s in steps if not s["installed"]]
    return {"model_id": model_id, "steps": steps, "ready": not missing,
            "total_mb": sum(s["size_mb"] for s in missing),
            "blocked": next((s["blocked"] for s in missing if s["blocked"]), None)}


class _Adapter:
    """One installer seen through three calls: start it, read its state, cancel it."""

    def __init__(self, start: Callable[[], Awaitable[Any]], read: Callable[[], dict[str, Any]],
                 cancel: Callable[[], Awaitable[Any] | Any]) -> None:
        self.start, self.read, self.cancel = start, read, cancel


def _adapter(step: dict[str, Any], model_id: str) -> _Adapter:
    from . import llamacpp
    from .downloads import downloads
    from .engine_install import installer as sdcpp_installer

    cid = step["id"]
    if step["kind"] == "model":
        target = cid  # the asked model, or the transcription model added along with it

        def read() -> dict[str, Any]:
            job = downloads.job(target)
            return job.public() if job else {"state": "error", "error": "Téléchargement introuvable."}

        return _Adapter(lambda: downloads.start(target), read, lambda: downloads.cancel(target))
    if cid == components.SDCPP:
        return _Adapter(sdcpp_installer.start, sdcpp_installer.public, sdcpp_installer.cancel)
    if cid == components.LLAMACPP:
        return _Adapter(llamacpp.installer.start, llamacpp.installer.public, llamacpp.installer.cancel)
    pack = audio_packs.installer
    return _Adapter(lambda: pack.start(cid), pack.public, pack.cancel)


class SetupRunner:
    def __init__(self) -> None:
        self.state: dict[str, Any] = {"state": "idle"}
        self._cancel = False
        self._current: _Adapter | None = None

    def public(self) -> dict[str, Any]:
        return {**self.state, "steps": [dict(s) for s in self.state.get("steps", [])]}

    @property
    def running(self) -> bool:
        return self.state.get("state") == "running"

    def _set(self, **fields: Any) -> None:
        self.state = {**self.state, **fields}
        bus.publish("setup.progress", self.public())

    def _set_step(self, index: int, **fields: Any) -> None:
        steps = [dict(s) for s in self.state["steps"]]
        steps[index].update(fields)
        self._set(steps=steps)

    async def start(self, model_id: str, system: dict[str, Any] | None = None) -> dict[str, Any]:
        """Starts the install of what the model lacks. Raises KeyError (unknown model), RuntimeError (nothing can run it here,
        or another setup is running)."""
        if self.running:
            if self.state.get("model_id") == model_id:
                return self.public()
            raise RuntimeError("Une autre installation est déjà en cours.")
        plan = plan_for_model(model_id, system)
        if plan["blocked"]:
            raise RuntimeError(plan["blocked"])
        todo = [{**s, "state": "pending"} for s in plan["steps"] if not s["installed"]]
        if not todo:
            self.state = {"state": "done", "model_id": model_id, "steps": [], "current": -1, "total_mb": 0, "error": None}
            return self.public()
        self._cancel = False
        self.state = {"state": "running", "model_id": model_id, "model_name": get_spec(model_id).name, "steps": todo,
                      "current": 0, "total_mb": plan["total_mb"], "message": "Préparation…", "detail": "",
                      "done": 0, "total": 0, "rate": 0, "eta": None, "error": None, "started_at": time.time()}
        bus.publish("setup.progress", self.public())
        asyncio.create_task(self._run(model_id))
        return self.public()

    async def cancel(self) -> bool:
        if not self.running:
            return False
        self._cancel = True
        if self._current:
            result = self._current.cancel()
            if asyncio.iscoroutine(result):
                await result
        return True

    async def _run(self, model_id: str) -> None:
        steps = self.state["steps"]
        try:
            for index in range(len(steps)):
                if self._cancel:
                    break
                self._set(current=index, message="Préparation…", detail="", done=0, total=0, rate=0, eta=None)
                self._set_step(index, state="running")
                outcome = await self._run_step(index, model_id)
                self._set_step(index, state=outcome["state"])
                if outcome["state"] == "error":
                    self._set(state="error", error=outcome["error"], message="Échec de l'installation")
                    return
                if outcome["state"] != "done":
                    break
            if self._cancel:
                self._set(state="cancelled", message="Annulé", error=None)
            else:
                self._set(state="done", message="Terminé", error=None)
        except Exception as exc:  # noqa: BLE001
            self._set(state="error", error=str(exc), message="Échec de l'installation")
        finally:
            self._current = None
            bus.publish("models.changed", {})

    async def _run_step(self, index: int, model_id: str) -> dict[str, Any]:
        step = self.state["steps"][index]
        adapter = self._current = _adapter(step, model_id)
        try:
            await adapter.start()
        except (RuntimeError, ValueError, KeyError) as exc:
            return {"state": "error", "error": str(exc.args[0] if isinstance(exc, KeyError) else exc)}
        cancelled_at: float | None = None
        while True:
            await asyncio.sleep(POLL_SECONDS)
            seen = adapter.read()
            if self._cancel and cancelled_at is None:
                cancelled_at = time.time()
            if seen.get("state") != "running":
                return self._outcome(seen)
            if cancelled_at and time.time() - cancelled_at > CANCEL_GRACE_SECONDS:
                return {"state": "cancelled", "error": None}
            self._set(message=seen.get("message") or "", detail=seen.get("detail") or "", done=seen.get("done") or 0,
                      total=seen.get("total") or 0, rate=seen.get("rate") or 0, eta=seen.get("eta"))

    @staticmethod
    def _outcome(seen: dict[str, Any]) -> dict[str, Any]:
        state = seen.get("state")
        if state == "done":
            return {"state": "done", "error": None}
        if state == "cancelled":
            return {"state": "cancelled", "error": None}
        return {"state": "error", "error": seen.get("error") or "Échec de l'installation."}


setup_runner = SetupRunner()
