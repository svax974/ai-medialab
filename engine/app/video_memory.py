# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""How long one video run can be on this machine: estimated at first, then measured.

A video model's memory grows with the volume it renders (frames × width × height). Nobody can measure every model on
every machine in advance, so the length of each `sd-cli` run is decided from what was measured on THIS machine:

- before any measure of a model, a conservative prior (`prior_gb`) and a short probe run (`PROBE_FRAMES`);
- after every run, the memory it really drew (`PeakMeter`: how far the Mac's available memory fell) is recorded
  (`record`, kept in `video-memory.json` of the data folder: a cache of measures, no application data);
- the next run is the longest one whose predicted memory fits the budget (`next_run_frames`), without ever growing
  more than `GROWTH` times beyond the biggest run measured so far, so that an extrapolation never goes far from data.

The budget is the memory available at the start of the run minus the reserve of `memory_guard`; it is also what
`sd-cli --max-vram` receives. The watchdog of `memory_guard` stays behind all of this.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import config
from .memory_guard import available_gb, fmt_gb

# A run never grows more than this factor beyond the biggest one measured.
GROWTH = 1.6
# Margin applied to the memory growth between the biggest measured run and a bigger one.
SAFETY = 1.25
# Without measures: the weights resident during sampling (the text encoder is released) and the growth per Mvox,
# calibrated on a single real run (Wan 2.2 5B Q4_K_M, 9 frames at 480x832: 7 GB, 8.5 GB of weights) and made
# conservative (x1.5). Measures replace it as soon as there are some.
PRIOR_BASE_RATIO = 0.6
PRIOR_SLOPE_GB_PER_MVOX = 0.9
PRIOR_REFERENCE_WEIGHTS_GB = 8.5
# Lowest slope trusted from measures (the available memory is noisy: a flat reading must not allow anything).
MIN_SLOPE_GB_PER_MVOX = 0.15
# Frames of the first run of a model that was never measured (the one measured safe on a 36 GB Mac).
PROBE_FRAMES = 9
KEEP_SAMPLES = 6
FILE_NAME = "video-memory.json"


@dataclass(frozen=True)
class Sample:
    """One measured run: the volume rendered (millions of voxels = frames × width × height / 1e6) and the memory drawn."""

    mvox: float
    used_gb: float


def mvox(frames: int, width: int, height: int) -> float:
    return frames * width * height / 1e6


def _prior_slope(weights_gb: float) -> float:
    # Bigger models have wider layers: the growth per voxel scales with the square root of their size (at least 1).
    return PRIOR_SLOPE_GB_PER_MVOX * max(1.0, (weights_gb / PRIOR_REFERENCE_WEIGHTS_GB) ** 0.5)


def prior_gb(weights_gb: float, volume: float) -> float:
    """Memory expected for `volume` Mvox of a model never measured."""
    return weights_gb * PRIOR_BASE_RATIO + _prior_slope(weights_gb) * volume


def _slope(ordered: list[Sample], weights_gb: float) -> float:
    if len(ordered) >= 2 and ordered[-1].mvox > ordered[-2].mvox:
        slope = (ordered[-1].used_gb - ordered[-2].used_gb) / (ordered[-1].mvox - ordered[-2].mvox)
        return max(MIN_SLOPE_GB_PER_MVOX, slope)
    return _prior_slope(weights_gb)


def predict_gb(samples: list[Sample], volume: float, weights_gb: float) -> tuple[float, bool]:
    """(memory expected for `volume` Mvox, whether it rests on measures). A bigger measured run bounds a smaller one."""
    if not samples:
        return prior_gb(weights_gb, volume), False
    ordered = sorted(samples, key=lambda s: s.mvox)
    bigger = next((s for s in ordered if s.mvox >= volume), None)
    if bigger:
        return bigger.used_gb, True
    top = ordered[-1]
    return top.used_gb + SAFETY * _slope(ordered, weights_gb) * (volume - top.mvox), True


def _form(frames: int, step: int) -> int:
    """Largest count of the n * step + 1 form that is at most `frames` (at least step + 1)."""
    return max(step + 1, (frames - 1) // step * step + 1)


def next_run_frames(*, new_needed: int, first: bool, step: int, ceiling: int, width: int, height: int,
                    samples: list[Sample], budget_gb: float, weights_gb: float) -> tuple[int, bool]:
    """Frames of the next run, and whether the prediction behind it rests on measures.

    `new_needed`: frames still to produce. The first run produces all of its frames, the following ones all but the
    first (a copy of the start image). The run is the longest one that finishes the clip, stays under `ceiling`,
    grows at most `GROWTH` times beyond the biggest measured run (the probe size without measures) and is predicted
    to fit `budget_gb`; never shorter than `step + 1`."""
    finish = new_needed if first else new_needed + 1
    frames = _form(min(ceiling, finish), step)
    per_frame = width * height / 1e6
    biggest = max((s.mvox for s in samples), default=0.0)
    limit = max(biggest * GROWTH, PROBE_FRAMES * per_frame)
    while frames > step + 1:
        volume = frames * per_frame
        predicted, _ = predict_gb(samples, volume, weights_gb)
        if volume <= limit + 1e-9 and predicted <= budget_gb:
            break
        frames -= step
    return frames, bool(samples)


def explain_refusal(frames: int, predicted_gb: float, budget_gb: float, name: str) -> str:
    return (f"Mémoire insuffisante pour générer « {name} » ici : même le plus court passage ({frames} images) a besoin "
            f"d'environ {fmt_gb(predicted_gb)} Go (mesuré sur cette machine) et {fmt_gb(budget_gb)} Go seulement sont "
            "disponibles en gardant la réserve du système. Fermez des applications gourmandes, puis relancez.")


class PeakMeter:
    """How far the machine's available memory falls while a run executes (the weights, the compute buffers, the VAE)."""

    def __init__(self, read: Callable[[], float] = available_gb) -> None:
        self.read = read
        self.before = read()
        self.low = self.before

    def sample(self) -> None:
        self.low = min(self.low, self.read())

    @property
    def used_gb(self) -> float:
        return max(0.0, self.before - self.low)


def store_path() -> Path:
    return config.DATA_DIR / FILE_NAME


def _read_all() -> dict[str, list[dict[str, float]]]:
    try:
        data = json.loads(store_path().read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load_samples(key: str) -> list[Sample]:
    out = []
    for raw in _read_all().get(key, []):
        try:
            out.append(Sample(float(raw["mvox"]), float(raw["used_gb"])))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def record(key: str, sample: Sample) -> None:
    """Keeps the measure (the biggest runs of the model, one per volume, the heaviest reading of each)."""
    data = _read_all()
    merged = {round(s.mvox, 3): s for s in load_samples(key)}
    known = merged.get(round(sample.mvox, 3))
    if known is None or sample.used_gb > known.used_gb:
        merged[round(sample.mvox, 3)] = sample
    kept = sorted(merged.values(), key=lambda s: s.mvox)[-KEEP_SAMPLES:]
    data[key] = [{"mvox": s.mvox, "used_gb": round(s.used_gb, 2)} for s in kept]
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    os.replace(tmp, path)
