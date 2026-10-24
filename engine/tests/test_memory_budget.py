# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Global memory budget: ceiling from the setting, eviction of the least recently used idle model (no torch, no model)."""

import asyncio

import pytest

from app import memory_budget, runtime_settings
from app.memory_budget import Resident, Slot


class Holder:
    """A fake holder of one resident model."""

    def __init__(self, key: str, gb: float, last_used: float, busy: bool = False, lets_go: bool = True) -> None:
        self.key, self.gb, self.last_used, self.is_busy, self.lets_go = key, gb, last_used, busy, lets_go
        self.loaded = True
        self.evictions = 0

    def resident(self):
        return Resident(self.key, self.key.upper(), self.gb, self.last_used) if self.loaded else None

    async def evict(self) -> None:
        self.evictions += 1
        self.loaded = not self.lets_go

    def slot(self) -> Slot:
        return Slot(self.key, self.resident, lambda: self.is_busy, self.evict)


@pytest.fixture()
def budget(monkeypatch):
    """A 36 GB machine with shared memory, no setting pushed, and no registered holder."""
    runtime_settings.reset()
    monkeypatch.setattr(memory_budget, "_slots", {})
    monkeypatch.setattr(memory_budget, "machine_gb", lambda: 36.0)
    monkeypatch.setattr(memory_budget, "memory_shared", lambda: True)
    yield memory_budget
    runtime_settings.reset()


def hold(*holders: Holder) -> None:
    for holder in holders:
        memory_budget.register(holder.slot())


def make_room(need: float, requester: str = "new", name: str = "Nouveau"):
    return asyncio.run(memory_budget.make_room(need, requester, name))


class TestCeiling:
    def test_it_is_eighty_percent_of_the_machine_by_default(self, budget):
        assert budget.ceiling_gb() == 28.8

    def test_the_setting_replaces_it_and_zero_means_automatic(self, budget):
        runtime_settings.apply({"memory_limit_gb": 12})
        assert budget.ceiling_gb() == 12
        runtime_settings.apply({"memory_limit_gb": 0})
        assert budget.ceiling_gb() == 28.8

    def test_it_never_goes_past_what_the_safety_reserve_leaves(self, budget):
        runtime_settings.apply({"memory_limit_gb": 99})
        assert budget.ceiling_gb() == 33.1  # 36 GB minus the 2.9 GB reserve


class TestMakeRoom:
    def test_a_model_that_fits_next_to_the_others_unloads_nothing(self, budget):
        chat = Holder("chat", 10, 1)
        hold(chat)
        assert make_room(8) is None and chat.evictions == 0

    def test_the_least_recently_used_idle_model_leaves_first_and_only_as_many_as_needed(self, budget):
        old, recent = Holder("old", 12, 1), Holder("recent", 12, 2)
        hold(old, recent)
        assert make_room(10) is None  # 12 + 12 + 10 > 28.8: one must go, and it is the oldest
        assert (old.evictions, recent.evictions) == (1, 0)

    def test_a_busy_model_is_never_unloaded(self, budget):
        busy, idle = Holder("busy", 14, 1, busy=True), Holder("idle", 8, 2)
        hold(busy, idle)
        assert make_room(10) is None and busy.evictions == 0 and idle.evictions == 1

    def test_it_refuses_with_the_numbers_when_only_busy_models_stand_in_the_way(self, budget):
        hold(Holder("busy", 22, 1, busy=True))
        msg = make_room(10)
        assert msg and "« Nouveau »" in msg and "28,8 Go" in msg and "BUSY" in msg

    def test_a_model_bigger_than_the_ceiling_is_refused_without_unloading_anything(self, budget):
        other = Holder("other", 4, 1)
        hold(other)
        runtime_settings.apply({"memory_limit_gb": 8})
        msg = make_room(9)
        assert msg and "au-dessus du plafond" in msg and "8,0 Go" in msg and other.evictions == 0

    def test_the_requester_does_not_count_against_itself(self, budget):
        mine = Holder("new", 20, 1)
        hold(mine)
        assert make_room(20) is None and mine.evictions == 0  # it replaces its own model

    def test_a_holder_that_cannot_let_go_is_asked_once_not_forever(self, budget):
        stuck = Holder("stuck", 20, 1, lets_go=False)
        hold(stuck)
        assert make_room(15) is not None and stuck.evictions == 1

    def test_without_shared_memory_every_idle_model_leaves(self, budget, monkeypatch):
        monkeypatch.setattr(memory_budget, "memory_shared", lambda: False)
        a, b = Holder("a", 1, 1), Holder("b", 1, 2, busy=True)
        hold(a, b)
        assert make_room(1) is None and (a.evictions, b.evictions) == (1, 0)

    def test_nothing_to_load_nothing_to_do(self, budget):
        assert make_room(None) is None and make_room(0) is None


def test_the_snapshot_lists_the_resident_models_and_the_ceiling(budget):
    hold(Holder("chat", 10.04, 2), Holder("media", 5.0, 1))
    snap = memory_budget.snapshot()
    assert snap["ceiling_gb"] == 28.8 and snap["used_gb"] == 15.0
    assert [m["model_id"] for m in snap["models"]] == ["media", "chat"]  # least recently used first
