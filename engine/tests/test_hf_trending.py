# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""« What's new »: selection, ranking, entries, cache and route (Hub and memory verdicts simulated: no network, no torch)."""

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import hf_search, hf_trending as ht  # noqa: E402
from app.engines import MODELS  # noqa: E402
from app.main import app  # noqa: E402

NOW = datetime(2026, 10, 15, tzinfo=timezone.utc)
SDXL_TAGS = ["diffusers:StableDiffusionXLPipeline", "license:mit"]
ZIMAGE_TAGS = ["gguf", "base_model:quantized:Tongyi-MAI/Z-Image-Turbo", "license:apache-2.0"]
TTS_TAGS = ["qwen3_tts", "license:apache-2.0"]
LLM_TAGS = ["gguf", "text-generation", "base_model:quantized:acme/Chat-8B", "license:apache-2.0"]


def repo(name, tags, *, age=10, likes=100, downloads=50_000, trend=5.0, gated=False, pipeline="text-to-image", **extra):
    return SimpleNamespace(id=name, tags=tags, likes=likes, downloads=downloads, trending_score=trend, gated=gated,
                           private=False, disabled=False, pipeline_tag=pipeline,
                           created_at=NOW - timedelta(days=age) if age is not None else None, **extra)


def select(models, kind="image", days=90):
    return ht.select(models, kind, days, NOW)


class TestSelection:
    def test_a_successful_recent_supported_repo_is_kept(self):
        kept, known = select([repo("acme/sdxl-a", SDXL_TAGS)])
        assert [(m.id, fam) for m, fam, _ in kept] == [("acme/sdxl-a", "sd-diffusers")] and known == 0

    def test_the_window_is_applied_here_because_the_hub_cannot_filter_by_date(self):
        old, undated = repo("acme/old", SDXL_TAGS, age=120), repo("acme/undated", SDXL_TAGS, age=None)
        assert select([old, undated])[0] == []
        assert [m.id for m, *_ in select([old], days=180)[0]] == ["acme/old"]

    @pytest.mark.parametrize("likes,downloads,kept", [(15, 2_000, True), (14, 2_000, False), (15, 1_999, False), (0, 9e6, False)])
    def test_success_needs_both_likes_and_downloads(self, likes, downloads, kept):
        assert bool(select([repo("acme/x", SDXL_TAGS, likes=likes, downloads=downloads)])[0]) is kept

    def test_the_bar_depends_on_the_kind(self):
        tts = repo("acme/tts", TTS_TAGS, likes=8, downloads=250)
        assert select([tts], "audio")[0]
        llm = repo("acme/Chat-8B-GGUF", LLM_TAGS, likes=99, downloads=50_000, pipeline="text-generation")
        assert not select([llm], "llm")[0]

    @pytest.mark.parametrize("name,tags", [
        ("acme/Super-Uncensored-XL", SDXL_TAGS), ("acme/abliterated-xl", SDXL_TAGS), ("acme/NSFW-xl", SDXL_TAGS),
        ("acme/fine", SDXL_TAGS + ["not-for-all-audiences"]), ("acme/fine", SDXL_TAGS + ["base_model:acme/Heretic-base"]),
    ])
    def test_adult_and_uncensored_variants_are_left_out(self, name, tags):
        assert select([repo(name, tags)])[0] == []

    def test_gated_private_and_unsupported_repos_are_left_out(self):
        models = [repo("acme/gated", SDXL_TAGS, gated="auto"), repo("acme/unknown-format", ["diffusers:SomeOtherPipeline"]),
                  repo("acme/gguf-of-nothing-we-run", ["gguf", "base_model:quantized:acme/other"])]
        private = repo("acme/private", SDXL_TAGS)
        private.private = True
        assert select([*models, private])[0] == []

    def test_a_repo_of_another_kind_is_not_listed(self):
        tts = repo("acme/tts", TTS_TAGS, likes=500, downloads=90_000)
        assert select([tts], "image")[0] == [] and select([tts], "audio")[0]

    def test_what_the_catalog_already_has_is_counted_not_listed(self):
        known = next(s.repo for m in MODELS.values() for s in m.all_sources() if s.repo and hf_search._existing_for(s.repo))
        kept, count = select([repo(known, SDXL_TAGS)])
        assert kept == [] and count == 1

    def test_best_first_by_trend_then_downloads(self):
        a, b, c = (repo(f"acme/{n}", SDXL_TAGS, trend=t, downloads=d) for n, t, d in (("a", 1, 90_000), ("b", 9, 5_000), ("c", 9, 8_000)))
        assert [m.id for m, *_ in select([a, b, c])[0]] == ["acme/c", "acme/b", "acme/a"]

    def test_one_hot_base_does_not_flood_the_list(self):
        quants = [repo(f"q{i}/Z-Image-Turbo-GGUF", ZIMAGE_TAGS, trend=10 - i) for i in range(6)]
        assert len(select(quants)[0]) == ht.MAX_PER_BASE


class TestEntries:
    options = [{"key": "a", "label": "Q8_0", "precision": "Q8_0", "size_gb": 9.0, "download_gb": 9.0, "fits": False, "fit_note": "trop gros"},
               {"key": "b", "label": "Q4_K_M", "precision": "Q4_K_M", "size_gb": 5.0, "download_gb": 5.0, "fits": True, "fit_note": ""},
               {"key": "c", "label": "Q2_K", "precision": "Q2_K", "size_gb": 3.0, "download_gb": 3.0, "fits": True, "fit_note": ""}]

    def test_the_proposed_variant_is_the_one_the_add_flow_selects(self):
        assert ht.proposed_option(self.options)["label"] == "Q4_K_M"
        assert ht.proposed_option([self.options[0]])["label"] == "Q8_0"  # nothing fits: the only one, flagged as not fitting
        nothing = [{**o, "fits": False} for o in self.options]
        assert ht.proposed_option(nothing)["label"] == "Q8_0"  # the list starts with the first one given: the engine sorts by size, smallest first
        assert ht.proposed_option([]) is None
        plain = [{"label": "fp16", "fits": True}, {"label": "fp8", "fits": True}, {"label": "int4", "fits": None}]
        assert ht.proposed_option(plain)["label"] == "fp8"  # no Q4_K: the middle one

    @pytest.mark.parametrize("license_,note", [("apache-2.0", None), ("mit", None), ("cc-by-nc-4.0", "noncommercial"),
                                               ("other", "custom"), ("", "custom"), ("openrail++", "custom"), ("llama3.1", "custom")])
    def test_a_licence_that_is_not_plainly_open_is_flagged(self, license_, note):
        assert ht.license_note(license_) == note

    def inspected(self, **over):
        return {"family_label": "GGUF", "license": "apache-2.0", "compatible": True, "reason": "", "options": self.options, **over}

    def test_an_entry_gathers_the_listing_and_the_inspection(self):
        entry = ht.build_entry(repo("acme/Z-Image-Turbo-GGUF", ZIMAGE_TAGS, age=12, likes=40, downloads=9_000, trend=3.5),
                               "gguf-variant", self.inspected(), NOW)
        assert (entry["name"], entry["author"], entry["age_days"], entry["likes"], entry["downloads"]) == ("Z Image Turbo GGUF", "acme", 12, 40, 9_000)
        assert entry["option"]["label"] == "Q4_K_M" and entry["option"]["size_gb"] == 5.0 and entry["options"] == 3
        assert entry["compatible"] is True and entry["reason"] == "" and entry["license_note"] is None
        assert entry["url"] == "https://huggingface.co/acme/Z-Image-Turbo-GGUF"

    def test_too_heavy_or_without_engine_means_not_compatible_with_the_reason(self):
        heavy = ht.build_entry(repo("a/b", ZIMAGE_TAGS), "gguf-variant", self.inspected(options=[self.options[0]]), NOW)
        assert heavy["compatible"] is False and heavy["reason"] == "trop gros"
        no_engine = ht.build_entry(repo("a/b", ZIMAGE_TAGS), "gguf-variant", self.inspected(compatible=False, reason="Pas de GPU."), NOW)
        assert no_engine["compatible"] is False and no_engine["reason"] == "Pas de GPU."


class FakeHub:
    """`list_models` that answers by filter and records every call."""

    def __init__(self, models=None, fail=False):
        self.models, self.fail, self.calls = models or {}, fail, []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise ConnectionError("offline")
        return list(self.models.get(str(kwargs.get("filter")), []))


def inspect_ok(repo_id):
    return {"family_label": "SD", "license": "mit", "compatible": True, "reason": "",
            "options": [{"key": "default", "label": "fp16", "precision": "fp16", "size_gb": 6.5, "download_gb": 6.5, "fits": True}]}


@pytest.fixture(autouse=True)
def fresh_cache():
    ht.clear_cache()
    yield
    ht.clear_cache()


class TestTrending:
    def hub(self):
        return FakeHub({"diffusers:StableDiffusionXLPipeline": [repo("acme/sdxl-new", SDXL_TAGS, age=5)]})

    def test_it_asks_the_hub_by_trend_and_by_date_for_every_family(self, monkeypatch):
        hub = self.hub()
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))
        ht.trending("image", list_models=hub, inspect=inspect_ok)
        sorts = {(str(c.get("filter")), c["sort"]) for c in hub.calls}
        assert ("diffusers:StableDiffusionXLPipeline", "trending_score") in sorts and ("diffusers:StableDiffusionXLPipeline", "created_at") in sorts
        assert all(c["limit"] == ht.QUERY_LIMIT and "trendingScore" in c["expand"] and c["gated"] is False for c in hub.calls)
        assert not any("search" in c for c in hub.calls if "diffusers" in str(c.get("filter")))

    def test_the_answer_keeps_the_inspection_of_the_survivors_only(self, monkeypatch):
        seen = []
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))

        def inspect(repo_id):
            seen.append(repo_id)
            return inspect_ok(repo_id)

        hub = FakeHub({"diffusers:StableDiffusionXLPipeline": [repo("acme/sdxl-new", SDXL_TAGS), repo("acme/flop", SDXL_TAGS, likes=1)]})
        out = ht.trending("image", list_models=hub, inspect=inspect)
        assert seen == ["acme/sdxl-new"] and [e["repo"] for e in out["results"]] == ["acme/sdxl-new"]
        assert out["cached"] is False and out["hidden"] == {"heavy": 0, "existing": 0}

    def test_an_hour_in_memory_and_a_refresh_that_cannot_hammer_the_hub(self, monkeypatch):
        clock = {"t": 1_000.0}
        monkeypatch.setattr(ht.time, "time", lambda: clock["t"])
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))
        hub = self.hub()
        ht.trending("image", list_models=hub, inspect=inspect_ok)
        first = len(hub.calls)
        clock["t"] += 30
        assert ht.trending("image", list_models=hub, inspect=inspect_ok, refresh=True)["cached"] is True
        clock["t"] += 3_000
        assert ht.trending("image", list_models=hub, inspect=inspect_ok)["cached"] is True and len(hub.calls) == first
        assert ht.trending("image", list_models=hub, inspect=inspect_ok, refresh=True)["cached"] is False  # older than a minute
        clock["t"] += 4_000
        assert ht.trending("image", list_models=hub, inspect=inspect_ok)["cached"] is False  # older than an hour
        assert len(hub.calls) == 3 * first

    def test_the_cache_is_per_kind_and_window(self, monkeypatch):
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))
        hub = self.hub()
        ht.trending("image", 90, list_models=hub, inspect=inspect_ok)
        before = len(hub.calls)
        ht.trending("image", 30, list_models=hub, inspect=inspect_ok)
        assert len(hub.calls) == 2 * before

    def test_heavy_models_are_hidden_unless_asked_for_and_counted(self, monkeypatch):
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))

        def inspect(repo_id):
            ok = inspect_ok(repo_id)
            return ok if repo_id.endswith("light") else {**ok, "options": [{**ok["options"][0], "fits": False, "fit_note": "Trop lourd."}]}

        hub = FakeHub({"diffusers:StableDiffusionXLPipeline": [repo("acme/light", SDXL_TAGS, trend=1), repo("acme/heavy", SDXL_TAGS, trend=9)]})
        default = ht.trending("image", list_models=hub, inspect=inspect)
        assert [e["repo"] for e in default["results"]] == ["acme/light"] and default["hidden"]["heavy"] == 1
        everything = ht.trending("image", include_heavy=True, list_models=hub, inspect=inspect)
        assert [e["repo"] for e in everything["results"]] == ["acme/heavy", "acme/light"]
        assert everything["results"][0]["compatible"] is False and everything["hidden"]["heavy"] == 0

    def test_limit_and_window_are_bounded(self, monkeypatch):
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))
        hub = FakeHub({"diffusers:StableDiffusionXLPipeline": [repo(f"acme/m{i}", SDXL_TAGS, trend=i) for i in range(8)]})
        out = ht.trending("image", days=9999, limit=3, list_models=hub, inspect=inspect_ok)
        assert out["days"] == ht.MAX_DAYS and len(out["results"]) == 3
        assert ht.trending("image", days=1, limit=0, list_models=hub, inspect=inspect_ok)["days"] == ht.MIN_DAYS

    def test_a_repo_the_application_cannot_read_after_all_is_dropped(self, monkeypatch):
        monkeypatch.setattr(ht, "datetime", SimpleNamespace(now=lambda tz=None: NOW))

        def inspect(repo_id):
            if "broken" in repo_id:
                raise hf_search.HubError("Fichiers manquants.")
            if "odd" in repo_id:
                raise KeyError("layout")
            return inspect_ok(repo_id)

        models = [repo(n, SDXL_TAGS) for n in ("acme/fine", "acme/broken", "acme/odd")]
        out = ht.trending("image", list_models=FakeHub({"diffusers:StableDiffusionXLPipeline": models}), inspect=inspect)
        assert [e["repo"] for e in out["results"]] == ["acme/fine"]

    def test_unknown_kind_and_offline_hub_are_errors_with_a_french_message(self):
        with pytest.raises(hf_search.HubError, match="inconnu"):
            ht.trending("music")
        with pytest.raises(hf_search.HubError, match="injoignable"):
            ht.trending("image", list_models=FakeHub(fail=True), inspect=inspect_ok)

    def test_every_kind_has_queries_and_a_bar(self):
        for kind in ht.KINDS:
            assert ht.family_queries(kind) and kind in ht.THRESHOLDS
        assert {q["pipeline_tag"] for q in ht.family_queries("llm")} >= {"text-generation", "image-text-to-text"}  # those of the search


class TestLanguageModels:
    def llm(self, name="acme/Chat-8B-GGUF", tags=LLM_TAGS, **kw):
        return repo(name, tags, likes=500, downloads=90_000, pipeline="text-generation", **kw)

    def test_a_gguf_text_model_is_a_language_model_of_the_application(self):
        kept, _ = select([self.llm()], "llm")
        assert [(m.id, fam, det["base"]) for m, fam, det in kept] == [("acme/Chat-8B-GGUF", "llm-gguf", "acme/Chat-8B")]
        assert ht.kind_of("llm-gguf") == "llm" and ht.kind_of("qwen3-tts") == "audio" and ht.kind_of("video-gguf") == "video"

    def test_what_is_not_a_chat_model_is_left_out(self):
        embedding = self.llm("acme/Chat-8B-embedding-GGUF")
        image = repo("acme/img", ["gguf", "text-to-image", "base_model:quantized:acme/x"], likes=500, downloads=90_000, pipeline="text-to-image")
        assert select([embedding, image], "llm")[0] == []

    def test_a_language_model_is_not_listed_on_an_image_page(self):
        assert select([self.llm()], "image")[0] == []

    def test_the_bar_is_the_highest_of_all_kinds(self):
        assert ht.THRESHOLDS["llm"].likes > ht.THRESHOLDS["image"].likes and ht.THRESHOLDS["llm"].downloads > ht.THRESHOLDS["video"].downloads

    def test_the_search_filter_of_the_llm_family_is_used_as_is(self):
        queries = ht.family_queries("llm")
        assert queries and all(q["filter"] == "gguf" and "sort" not in q and "limit" not in q for q in queries)


class TestRoute:
    @pytest.fixture()
    def client(self, monkeypatch):
        monkeypatch.delenv("ENGINE_TOKEN", raising=False)
        return TestClient(app)

    def test_it_returns_the_answer_with_the_documented_shape(self, client, monkeypatch):
        entry = ht.build_entry(repo("acme/sdxl-new", SDXL_TAGS), "sd-diffusers", inspect_ok(""), NOW)
        seen = {}

        def fake(kind, days, limit, include_heavy, refresh):
            seen.update(kind=kind, days=days, limit=limit, include_heavy=include_heavy, refresh=refresh)
            return {"kind": kind, "days": days, "generated_at": 1.0, "cached": False, "results": [entry],
                    "hidden": {"heavy": 2, "existing": 1}}

        monkeypatch.setattr(ht, "trending", fake)
        body = client.get("/engine/v1/hf/trending?kind=audio&days=30&limit=5&include_heavy=true&refresh=true").json()
        assert seen == {"kind": "audio", "days": 30, "limit": 5, "include_heavy": True, "refresh": True}
        assert body["results"][0]["repo"] == "acme/sdxl-new" and body["hidden"] == {"heavy": 2, "existing": 1}
        assert body["results"][0]["option"]["label"] == "fp16"

    def test_the_parameters_are_validated_by_the_engine_too(self, client):
        assert client.get("/engine/v1/hf/trending?kind=music").status_code == 422
        assert client.get("/engine/v1/hf/trending?days=3").status_code == 422
        assert client.get("/engine/v1/hf/trending?limit=500").status_code == 422

    def test_a_hub_that_cannot_be_reached_is_a_502(self, client, monkeypatch):
        def boom(*args):
            raise hf_search.HubError("Hugging Face est injoignable.")

        monkeypatch.setattr(ht, "trending", boom)
        res = client.get("/engine/v1/hf/trending?kind=image")
        assert res.status_code == 502 and "injoignable" in res.json()["detail"]

    def test_the_route_needs_the_engine_token(self, monkeypatch):
        monkeypatch.setenv("ENGINE_TOKEN", "s3cret")
        assert TestClient(app).get("/engine/v1/hf/trending").status_code in (401, 403)
