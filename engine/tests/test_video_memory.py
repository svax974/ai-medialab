# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Length of video runs from the memory measured on this machine (pure functions and a JSON file: no torch, no model)."""

import json
import os

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import video_memory as vm  # noqa: E402

W, H = 832, 480  # the 480p of Wan 2.2: 0.4 Mvox per frame


def plan(**kw):
    args = dict(new_needed=481, first=True, step=4, ceiling=121, width=W, height=H, samples=[], budget_gb=14.0,
                weights_gb=8.5)
    return vm.next_run_frames(**{**args, **kw})[0]


class TestPrediction:
    def test_the_prior_matches_the_one_real_measure_it_was_calibrated_on(self):
        # Wan 2.2 5B Q4_K_M, 9 frames at 480x832: 7 GB measured, the prior stays above it (conservative)
        predicted = vm.prior_gb(8.5, vm.mvox(9, W, H))
        assert 7.0 < predicted < 9.5

    def test_bigger_models_grow_faster_per_voxel(self):
        assert vm.prior_gb(21.5, 4.0) - vm.prior_gb(21.5, 0.0) > vm.prior_gb(8.5, 4.0) - vm.prior_gb(8.5, 0.0)

    def test_a_bigger_measured_run_bounds_a_smaller_one(self):
        samples = [vm.Sample(4.0, 8.0), vm.Sample(8.0, 11.0)]
        assert vm.predict_gb(samples, 6.0, 8.5) == (11.0, True)

    def test_above_the_biggest_measure_it_extrapolates_with_a_margin(self):
        samples = [vm.Sample(4.0, 8.0), vm.Sample(8.0, 12.0)]  # 1 GB per Mvox
        predicted, measured = vm.predict_gb(samples, 10.0, 8.5)
        assert measured and predicted == pytest.approx(12.0 + vm.SAFETY * 1.0 * 2.0)

    def test_a_flat_reading_never_allows_free_growth(self):
        samples = [vm.Sample(4.0, 8.0), vm.Sample(8.0, 8.0)]  # noise: no growth seen
        assert vm.predict_gb(samples, 18.0, 8.5)[0] >= 8.0 + vm.SAFETY * vm.MIN_SLOPE_GB_PER_MVOX * 10.0

    def test_without_measures_it_says_so(self):
        assert vm.predict_gb([], 4.0, 8.5)[1] is False


class TestPlanning:
    def test_a_model_never_measured_starts_with_the_probe(self):
        assert plan() == vm.PROBE_FRAMES

    def test_a_clip_shorter_than_the_probe_is_one_run(self):
        assert plan(new_needed=5) == 5

    def test_a_run_grows_at_most_1_6_times_beyond_the_biggest_measure(self):
        samples = [vm.Sample(vm.mvox(25, W, H), 6.0)]
        assert plan(samples=samples) == 37  # 40 frames allowed by the growth, the closest 4k+1 below
        big = [vm.Sample(vm.mvox(97, W, H), 6.0)]
        assert plan(samples=big, budget_gb=40.0) == 121  # the ceiling of the model
        assert plan(samples=big, budget_gb=14.0) < 121  # the memory predicted for a longer run does not fit

    def test_the_budget_shortens_the_run(self):
        samples = [vm.Sample(vm.mvox(25, W, H), 9.0), vm.Sample(vm.mvox(33, W, H), 11.0)]
        roomy, tight = plan(samples=samples, budget_gb=30.0), plan(samples=samples, budget_gb=11.0)
        assert tight == 33 and roomy > tight  # the 33-frame run is known to need 11 GB

    def test_never_below_one_step_plus_one_frame(self):
        assert plan(samples=[vm.Sample(vm.mvox(9, W, H), 50.0)], budget_gb=1.0) == 5

    def test_the_last_run_only_needs_the_remaining_frames_plus_the_start_image(self):
        samples = [vm.Sample(vm.mvox(97, W, H), 6.0)]
        assert plan(samples=samples, new_needed=12, first=False) == 13

    def test_the_run_count_for_20_seconds_with_a_cold_start(self):
        samples, produced, runs = [], 0, []
        while produced < 481:
            frames = plan(samples=samples, new_needed=481 - produced, first=produced == 0, budget_gb=14.0)
            runs.append(frames)
            samples = [*samples, vm.Sample(vm.mvox(frames, W, H), 4.0 + 0.5 * vm.mvox(frames, W, H))]
            produced += frames if produced == 0 else frames - 1
        assert runs[0] == 9 and max(runs) <= 121 and sum(runs) - (len(runs) - 1) == 481
        assert len(runs) < 30  # the probe grows quickly: a bad prior only costs the first few runs


class TestMeasures:
    def test_the_meter_reports_how_far_the_available_memory_fell(self):
        readings = iter([20.0, 18.0, 12.5, 15.0])
        meter = vm.PeakMeter(lambda: next(readings))
        meter.sample()
        meter.sample()
        meter.sample()
        assert meter.used_gb == pytest.approx(7.5)

    def test_measures_are_kept_per_model_and_volume(self, tmp_path, monkeypatch):
        monkeypatch.setattr(vm, "store_path", lambda: tmp_path / "m.json")
        vm.record("a", vm.Sample(4.0, 7.0))
        vm.record("a", vm.Sample(4.0, 6.0))  # a lighter reading of the same volume does not lower it
        vm.record("a", vm.Sample(4.0, 7.5))  # a heavier one replaces it
        vm.record("b", vm.Sample(1.0, 3.0))
        assert vm.load_samples("a") == [vm.Sample(4.0, 7.5)]
        assert vm.load_samples("b") == [vm.Sample(1.0, 3.0)]
        assert vm.load_samples("none") == []

    def test_only_the_biggest_runs_are_kept(self, tmp_path, monkeypatch):
        monkeypatch.setattr(vm, "store_path", lambda: tmp_path / "m.json")
        for i in range(1, 10):
            vm.record("a", vm.Sample(float(i), 2.0 + i))
        assert [s.mvox for s in vm.load_samples("a")] == [4.0, 5.0, 6.0, 7.0, 8.0, 9.0]

    def test_a_corrupted_file_is_ignored_and_rewritten(self, tmp_path, monkeypatch):
        path = tmp_path / "m.json"
        monkeypatch.setattr(vm, "store_path", lambda: path)
        path.write_text("{not json")
        assert vm.load_samples("a") == []
        vm.record("a", vm.Sample(2.0, 5.0))
        assert json.loads(path.read_text())["a"] == [{"mvox": 2.0, "used_gb": 5.0}]

    def test_the_refusal_gives_the_numbers(self):
        text = vm.explain_refusal(5, 9.46, 4.2, "Wan")
        assert "« Wan »" in text and "9,5 Go" in text and "4,2 Go" in text and "5 images" in text
