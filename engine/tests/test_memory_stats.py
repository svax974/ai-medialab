# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Memory use as the user reads it (macOS: Activity Monitor's figure), the live report and the emergency stop. No model."""

import asyncio
import subprocess
import sys
import time
from types import SimpleNamespace

import psutil
import pytest

from app import emergency, memory_guard, memory_stats

# `vm_stat` of a 36 GB Apple Silicon Mac under load (page size 16384), captured on 2026-10-24 next to Activity Monitor.
VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    12957.
Pages active:                                 736977.
Pages inactive:                               736387.
Pages speculative:                               744.
Pages throttled:                                   0.
Pages wired down:                             235262.
Pages purgeable:                               15164.
"Translation faults":                     2283216279.
File-backed pages:                            386467.
Anonymous pages:                             1087641.
Pages stored in compressor:                  1434142.
Pages occupied by compressor:                 580003.
"""
TOTAL = 38654705664  # hw.memsize of that machine
GIB = 1024**3


class TestMacOsFigures:
    def test_the_counters_are_read_with_the_page_size_of_the_machine(self):
        size, counters = memory_stats.parse_vm_stat(VM_STAT)
        assert size == 16384
        assert counters["Pages wired down"] == 235262 and counters["Anonymous pages"] == 1087641
        assert counters["Translation faults"] == 2283216279  # quoted names are read too

    def test_used_memory_is_app_plus_wired_plus_compressed_not_the_file_cache(self):
        size, counters = memory_stats.parse_vm_stat(VM_STAT)
        parts = memory_stats.macos_breakdown(size, counters, TOTAL)
        assert parts["app"] == pytest.approx((1087641 - 15164) * 16384 / GIB)
        assert parts["wired"] == pytest.approx(235262 * 16384 / GIB)
        assert parts["compressed"] == pytest.approx(580003 * 16384 / GIB)
        assert parts["used"] == pytest.approx(parts["app"] + parts["wired"] + parts["compressed"])
        assert parts["cached"] == pytest.approx((386467 + 15164) * 16384 / GIB)
        # What Activity Monitor shows (≈ 80 % of 36 GB), not psutil's `total - free` (≈ 100 %) nor `total - available` (≈ 68 %).
        assert 0.78 < parts["used"] * GIB / TOTAL < 0.82

    def test_used_never_goes_past_the_total(self):
        assert memory_stats.macos_breakdown(16384, {"Anonymous pages": 10**9}, TOTAL)["used"] == pytest.approx(TOTAL / GIB)


class TestSample:
    def fake(self, monkeypatch, platform, text=None, level=None):
        monkeypatch.setattr(memory_stats.sys, "platform", platform)
        monkeypatch.setattr(memory_stats.psutil, "virtual_memory", lambda: SimpleNamespace(total=TOTAL, available=TOTAL // 4))
        monkeypatch.setattr(memory_stats.psutil, "swap_memory", lambda: SimpleNamespace(used=4 * GIB, total=5 * GIB))
        monkeypatch.setattr(memory_stats, "_read_vm_stat", lambda: text)
        monkeypatch.setattr(memory_guard, "_macos_pressure", lambda: (lambda: level) if level else None)

    def test_macos_uses_the_page_counters_and_the_system_pressure(self, monkeypatch):
        self.fake(monkeypatch, "darwin", VM_STAT, level=2)
        out = memory_stats.sample()
        assert out["source"] == "vm_stat" and out["total_gb"] == 36.0 and out["pressure"] == "warning"
        assert 78 < out["used_pct"] < 82 and out["swap_used_gb"] == 4.0
        assert set(out["breakdown"]) == {"app", "wired", "compressed", "cached"}

    def test_macos_falls_back_to_available_when_vm_stat_is_missing(self, monkeypatch):
        self.fake(monkeypatch, "darwin", None, level=1)
        out = memory_stats.sample()
        assert out["source"] == "psutil" and out["used_pct"] == 75.0 and out["breakdown"] is None and out["pressure"] == "normal"

    def test_elsewhere_it_is_total_minus_available_and_the_pressure_follows_the_share(self, monkeypatch):
        self.fake(monkeypatch, "linux")
        assert memory_stats.sample()["used_pct"] == 75.0
        monkeypatch.setattr(memory_stats.psutil, "virtual_memory", lambda: SimpleNamespace(total=TOTAL, available=TOTAL // 10))
        assert memory_stats.sample()["pressure"] == "warning"
        monkeypatch.setattr(memory_stats.psutil, "virtual_memory", lambda: SimpleNamespace(total=TOTAL, available=TOTAL // 50))
        assert memory_stats.sample()["pressure"] == "critical"

    def test_the_critical_macos_level_is_critical(self, monkeypatch):
        self.fake(monkeypatch, "darwin", VM_STAT, level=4)
        assert memory_stats.sample()["pressure"] == "critical"

    def test_the_real_machine_gives_a_plausible_reading(self):
        out = memory_stats.sample()
        assert 0 < out["used_pct"] <= 100 and out["total_gb"] > 0 and out["pressure"] in ("normal", "warning", "critical")


def sleeper() -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])


class TestEmergencyStop:
    def setup_fakes(self, monkeypatch):
        from app import jobs as jobs_module
        from app import llm as llm_module

        worker_proc, chat_proc = sleeper(), sleeper()
        cancelled = []

        async def cancel(job_id):
            cancelled.append(job_id)
            return True

        fake_jobs = SimpleNamespace(
            pending=["m2", "m3"], current="m1", cancel=cancel, guard=memory_guard.MemoryWatchdog(lambda: None, reserve=1),
            worker=SimpleNamespace(alive=True, model_id="z-image", process=SimpleNamespace(pid=worker_proc.pid)))
        chat = SimpleNamespace(server=SimpleNamespace(alive=True, model_id="llm-x", proc=SimpleNamespace(pid=chat_proc.pid)),
                               guard=memory_guard.MemoryWatchdog(lambda: None, reserve=1), generating=True)
        ocr = SimpleNamespace(server=None, guard=memory_guard.MemoryWatchdog(lambda: None, reserve=1), generating=False)
        monkeypatch.setattr(jobs_module, "jobs", fake_jobs)
        monkeypatch.setattr(llm_module, "managers", lambda: (chat, ocr))
        monkeypatch.setattr(emergency.bus, "publish", lambda *a, **k: None)
        monkeypatch.setattr(emergency, "live", lambda: {})
        return fake_jobs, chat, worker_proc, chat_proc, cancelled

    def test_it_cancels_the_queue_then_kills_every_model_process_and_says_why(self, monkeypatch):
        jobs, chat, worker_proc, chat_proc, cancelled = self.setup_fakes(monkeypatch)
        try:
            out = asyncio.run(emergency.stop_everything())
            assert out == {"stopped": ["z-image", "llm-x"], "cancelled": 2} and cancelled == ["m2", "m3"]
            for proc in (worker_proc, chat_proc):
                deadline = time.time() + 5
                while proc.poll() is None and time.time() < deadline:
                    time.sleep(0.05)
                assert proc.poll() is not None
            assert "Arrêt d'urgence" in jobs.guard.tripped(worker_proc.pid)
            assert "Arrêt d'urgence" in chat.guard.tripped(chat_proc.pid)
        finally:
            for proc in (worker_proc, chat_proc):
                if proc.poll() is None:
                    proc.kill()

    def test_with_nothing_loaded_it_stops_nothing(self, monkeypatch):
        jobs, chat, worker_proc, chat_proc, _ = self.setup_fakes(monkeypatch)
        worker_proc.kill(); chat_proc.kill()
        jobs.pending, jobs.worker, chat.server = [], None, None
        assert asyncio.run(emergency.stop_everything()) == {"stopped": [], "cancelled": 0}

    def test_the_process_really_was_a_tree(self):
        # `kill_tree` is what the stop relies on: a child of the worker (sd-cli) goes with it.
        parent = subprocess.Popen([sys.executable, "-c", "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);time.sleep(60)"])
        try:
            deadline = time.time() + 5
            while not psutil.Process(parent.pid).children() and time.time() < deadline:
                time.sleep(0.05)
            child = psutil.Process(parent.pid).children()[0]
            memory_guard.MemoryWatchdog(lambda: None, reserve=1).stop_process(parent.pid, "x")
            assert not child.is_running() or child.status() == psutil.STATUS_ZOMBIE
        finally:
            parent.kill()


class TestLive:
    def test_the_report_joins_the_machine_the_budget_and_what_runs(self, monkeypatch):
        from app import jobs as jobs_module
        from app import llm as llm_module
        from app import memory_budget

        monkeypatch.setattr(emergency.memory_stats, "sample", lambda: {"used_pct": 80.0})
        monkeypatch.setattr(memory_budget, "snapshot", lambda: {"ceiling_gb": 28.8, "used_gb": 5.0, "models": []})
        monkeypatch.setattr(memory_budget, "residents", lambda skip=None: [])
        monkeypatch.setattr(jobs_module, "jobs", SimpleNamespace(current=None, pending=[]))
        idle = SimpleNamespace(generating=False)
        monkeypatch.setattr(llm_module, "managers", lambda: (idle, idle))
        out = emergency.live()
        assert out["used_pct"] == 80.0 and out["budget"]["ceiling_gb"] == 28.8
        assert out["activity"] == {"working": False, "queued": 0, "loaded": 0, "can_stop": False}

    def test_the_button_is_available_when_a_job_is_queued_or_a_reply_is_written(self, monkeypatch):
        from app import jobs as jobs_module
        from app import llm as llm_module
        from app import memory_budget

        monkeypatch.setattr(memory_budget, "residents", lambda skip=None: [])
        monkeypatch.setattr(jobs_module, "jobs", SimpleNamespace(current=None, pending=["m1"]))
        monkeypatch.setattr(llm_module, "managers", lambda: (SimpleNamespace(generating=True), SimpleNamespace(generating=False)))
        assert emergency.activity() == {"working": True, "queued": 1, "loaded": 0, "can_stop": True}
