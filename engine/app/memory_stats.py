# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Memory use of the machine as the user would read it, not as a library happens to report it.

On macOS the free memory is almost always near zero (the system fills it with file cache) and `psutil`'s `used` or `available`
are not what Activity Monitor shows. "Memory Used" there is **App Memory + Wired + Compressed**, from the page counters of `vm_stat`:

    used = (anonymous pages - purgeable pages + wired pages + pages occupied by the compressor) * page size

The file cache (file-backed and purgeable pages) is not counted: the system gives it back at once. How the system is doing is a
separate matter, told by macOS's own memory pressure level (`kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical)
and by the swap in use. Elsewhere (Linux, Windows) `total - available` is the figure `psutil` computes for that purpose.
"""

from __future__ import annotations

import re
import subprocess
import sys
from typing import Any

import psutil

from . import memory_guard

GIB = 1024**3
PRESSURE_NAMES = {1: "normal", 2: "warning", 4: "critical"}
_PAGE_SIZE = re.compile(r"page size of (\d+) bytes")
_COUNTER = re.compile(r"^\"?([^\":]+)\"?:\s+(\d+)\.?\s*$")


def parse_vm_stat(text: str) -> tuple[int, dict[str, int]]:
    """(page size, counters by name) from the output of `vm_stat`."""
    size = _PAGE_SIZE.search(text)
    counters: dict[str, int] = {}
    for line in text.splitlines():
        match = _COUNTER.match(line.strip())
        if match:
            counters[match.group(1).strip()] = int(match.group(2))
    return (int(size.group(1)) if size else 16384), counters


def macos_breakdown(page_size: int, c: dict[str, int], total_bytes: int) -> dict[str, float]:
    """Activity Monitor's figures (GB) from the page counters."""
    app = max(0, c.get("Anonymous pages", 0) - c.get("Pages purgeable", 0)) * page_size
    wired = c.get("Pages wired down", 0) * page_size
    compressed = c.get("Pages occupied by compressor", 0) * page_size
    cached = (c.get("File-backed pages", 0) + c.get("Pages purgeable", 0)) * page_size
    used = min(total_bytes, app + wired + compressed)
    return {"used": used / GIB, "app": app / GIB, "wired": wired / GIB, "compressed": compressed / GIB, "cached": cached / GIB}


def _read_vm_stat() -> str | None:
    try:
        return subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def _pressure_name(used_pct: float, level: int | None) -> str:
    """macOS gives its own level; elsewhere the share in use stands in for it."""
    if level is not None:
        return PRESSURE_NAMES.get(level, "critical" if level >= 4 else "normal")
    return "critical" if used_pct >= 95 else "warning" if used_pct >= 85 else "normal"


def sample() -> dict[str, Any]:
    """One reading: total and used memory (GB, percent), what the used part is made of (macOS), swap in use and the pressure."""
    vm = psutil.virtual_memory()
    swap = psutil.swap_memory()
    parts: dict[str, float] | None = None
    level: int | None = None
    if sys.platform == "darwin":
        text = _read_vm_stat()
        if text:
            page_size, counters = parse_vm_stat(text)
            parts = macos_breakdown(page_size, counters, vm.total)
        reader = memory_guard._macos_pressure()
        level = reader() if reader else None
    used_gb = parts["used"] if parts else (vm.total - vm.available) / GIB
    total_gb = vm.total / GIB
    used_pct = round(100 * used_gb / total_gb, 1) if total_gb else 0.0
    return {
        "total_gb": round(total_gb, 1), "used_gb": round(used_gb, 1), "used_pct": used_pct,
        "free_gb": round(max(0.0, total_gb - used_gb), 1),
        "breakdown": {k: round(v, 1) for k, v in parts.items() if k != "used"} if parts else None,
        "swap_used_gb": round(swap.used / GIB, 1), "swap_total_gb": round(swap.total / GIB, 1),
        "pressure": _pressure_name(used_pct, level),
        "source": "vm_stat" if parts else "psutil",
    }
