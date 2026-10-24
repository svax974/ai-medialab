# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Memory guard: reserve, preflight, watchdog kill of a worker tree, VAE memory settings (no torch, no model)."""

import subprocess
import sys
import time
from types import SimpleNamespace

import psutil

from app import memory_guard
from app.engines.diffusers_engine import VAE_TILE, tune_vae


def test_reserve_is_eight_percent_with_a_floor():
    assert memory_guard.reserve_gb(36) == 2.9
    assert memory_guard.reserve_gb(16) == 2.5
    assert memory_guard.reserve_gb(128) == 10.2


def test_preflight_refuses_with_the_numbers():
    assert memory_guard.preflight(10, 20, 36, "SDXL", pressure=2) is None
    msg = memory_guard.preflight(10, 12, 36, "SDXL", pressure=2)
    assert msg and "12,0 Go libres" in msg and "« SDXL »" in msg and "2,9 Go de réserve" in msg
    assert memory_guard.preflight(None, 1, 36, "Démo") is None


def test_under_normal_pressure_a_model_that_leaves_a_small_margin_is_allowed():
    # 11 GB free + inactive, normal pressure: a 9 GB model passes (a Mac hands inactive memory out on demand)...
    assert memory_guard.preflight(9, 11, 36, "FLUX", pressure=memory_guard.PRESSURE_NORMAL) is None
    # ...but not once the pressure rises, nor when even the small margin is gone.
    assert memory_guard.preflight(9, 11, 36, "FLUX", pressure=2)
    assert memory_guard.preflight(10, 11, 36, "FLUX", pressure=memory_guard.PRESSURE_NORMAL)


def _worker_with_child() -> subprocess.Popen:
    # A "worker" running a child process, as a worker runs sd-cli.
    return subprocess.Popen([sys.executable, "-c", "import subprocess,time;subprocess.Popen(['sleep','30']);time.sleep(30)"])


def _children(pid: int) -> list[psutil.Process]:
    deadline = time.time() + 5
    while time.time() < deadline:
        kids = psutil.Process(pid).children(recursive=True)
        if kids:
            return kids
        time.sleep(0.05)
    return []


def test_the_watchdog_kills_the_whole_worker_tree_when_memory_runs_low():
    proc = _worker_with_child()
    try:
        kids = _children(proc.pid)
        assert kids, "the child process did not start"
        free = {"gb": 20.0}
        guard = memory_guard.MemoryWatchdog(lambda: proc.pid, reserve=3.0, read_available=lambda: free["gb"],
                                            read_pressure=lambda: 1)
        assert guard.check(proc.pid) is None and proc.poll() is None
        free["gb"] = 1.0
        reason = guard.check(proc.pid)
        assert reason and "protection mémoire" in reason and "1,0 Go libres" in reason
        assert guard.tripped(proc.pid) == reason
        proc.wait(timeout=5)
        assert all(not k.is_running() or k.status() == psutil.STATUS_ZOMBIE for k in kids)
        assert guard.job_stats()["min_free_gb"] == 1.0
    finally:
        if proc.poll() is None:
            proc.kill()


def test_critical_pressure_trips_even_with_free_memory():
    proc = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"])
    try:
        guard = memory_guard.MemoryWatchdog(lambda: proc.pid, reserve=3.0, read_available=lambda: 20.0,
                                            read_pressure=lambda: memory_guard.PRESSURE_CRITICAL)
        assert "pression mémoire critique" in guard.check(proc.pid)
        proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()


def test_the_watchdog_thread_follows_the_target():
    proc = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"])
    try:
        guard = memory_guard.MemoryWatchdog(lambda: proc.pid, reserve=3.0, read_available=lambda: 1.0,
                                            read_pressure=lambda: 1)
        guard.start()
        proc.wait(timeout=5)
        guard.stop()
        assert guard.tripped(proc.pid)
    finally:
        if proc.poll() is None:
            proc.kill()


class FakeVae:
    def __init__(self, force_upcast=True):
        self.config = SimpleNamespace(force_upcast=force_upcast)
        self.tile_sample_min_size, self.tile_latent_min_size, self.use_tiling = 1024, 128, False

    def enable_tiling(self):
        self.use_tiling = True

    def register_to_config(self, **kw):
        self.config = SimpleNamespace(**{**vars(self.config), **kw})


def test_tune_vae_tiles_from_512_and_drops_the_float32_copy_outside_float16():
    vae = FakeVae()
    tune_vae(vae, "torch.bfloat16")
    assert vae.use_tiling and (vae.tile_sample_min_size, vae.tile_latent_min_size) == (VAE_TILE, VAE_TILE // 8)
    assert vae.config.force_upcast is False
    fp16 = FakeVae()
    tune_vae(fp16, "torch.float16")  # float16 overflows: the float32 copy stays
    assert fp16.config.force_upcast is True
    tune_vae(None, "torch.bfloat16")


def test_a_confirmed_job_is_only_killed_close_to_the_limit():
    guard = memory_guard.MemoryWatchdog(lambda: None, reserve=3.0, read_available=lambda: 1.0, read_pressure=lambda: 1)
    proc = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"])
    try:
        guard.begin_job(relaxed=True)
        assert guard.check(proc.pid) is None and proc.poll() is None  # 1 GB free: fine for a job the user confirmed
        guard.read_available = lambda: 0.3
        assert guard.check(proc.pid) is not None
        proc.wait(timeout=5)
    finally:
        proc.kill()
