# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Hardware detection: `get_system()` answers without waiting for the PyTorch probe (replaced here: torch is never imported)."""

import threading

import pytest

from app import system

MPS_PROBE = {"torch": "2.0", "cuda": False, "hip": None, "mps": True, "devices": [], "diffusers": "0.30"}


@pytest.fixture
def probe(monkeypatch):
    """A probe held until `release` is set; `calls` counts its runs. The module state is reset around each test."""
    release, calls = threading.Event(), []

    def fake_probe():
        calls.append(1)
        release.wait(5)
        return MPS_PROBE

    monkeypatch.setattr(system, "_probe_torch", fake_probe)
    for name, value in (("_cache", None), ("_torch_info", None), ("_probe_started", False), ("_on_probe_done", None)):
        monkeypatch.setattr(system, name, value)
    yield release, calls
    release.set()


def test_answers_while_the_probe_runs(probe):
    release, _calls = probe
    info = system.get_system()
    assert info["torch"]["pending"] is True
    assert info["engines"]["torch"] == {"available": False, "pending": True, "reason": "Détection de PyTorch en cours…"}
    assert "llamacpp" in info["engines"] and info["disk"]["free_gb"] >= 0
    release.set()


def test_end_of_probe_drops_the_cache_and_calls_back(probe):
    release, calls = probe
    done = threading.Event()
    system.warm_up(done.set)
    system.get_system()
    release.set()
    assert done.wait(5)
    info = system.get_system()
    assert info["torch"]["pending"] is False and info["torch"]["torch"] == "2.0"
    assert any(a.get("torch_mps") for a in info["accelerators"]) or info["engines"]["torch"]["available"] is False
    assert len(calls) == 1


def test_refresh_keeps_the_probe_result(probe):
    release, calls = probe
    done = threading.Event()
    system.warm_up(done.set)
    release.set()
    assert done.wait(5)
    system.get_system(refresh=True)
    system.get_system(refresh=True)
    assert len(calls) == 1
