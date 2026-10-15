# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Chat models: the preset list, memory estimates, the catalog's view, the Hugging Face family and custom recipes
(no network, no llama.cpp, no torch)."""

import os
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402

from app import catalog, hf_search  # noqa: E402
from app.engines import MODELS, custom, get_spec  # noqa: E402
from app.engines.base import installation_status, with_variant  # noqa: E402
from app.engines.llm_models import (COMPUTE_BUFFER_GB, SPECS, kv_cache_gb, memory_need_gb)  # noqa: E402
from app.system import memory_plan  # noqa: E402

MAC36 = {"os": "Darwin", "arch": "arm64", "ram_gb": 36.0, "unusable_gpus": [],
         "accelerators": [{"vendor": "apple", "backend": "metal", "memory_gb": 36.0, "unified": True}],
         "engines": {"llamacpp": {"available": True, "variant": "metal", "binary": "/x/llama-server"}}}
MAC16 = {**MAC36, "ram_gb": 16.0}
NVIDIA8 = {"os": "Linux", "arch": "x86_64", "ram_gb": 32.0, "unusable_gpus": [],
           "accelerators": [{"vendor": "nvidia", "backend": "cuda", "memory_gb": 8.0, "unified": False}],
           "engines": {"llamacpp": {"available": True, "variant": "cuda", "binary": "/x/llama-server"}}}
CPU_ONLY = {"os": "Linux", "arch": "x86_64", "ram_gb": 16.0, "unusable_gpus": [], "accelerators": [],
            "engines": {"llamacpp": {"available": True, "variant": "cpu", "binary": "/x/llama-server"}}}


class TestPresets:
    def test_a_classic_list_covering_every_size(self):
        assert 8 <= len(SPECS) <= 12
        assert len({s.id for s in SPECS}) == len(SPECS) and all(s.id in MODELS for s in SPECS)
        assert any(s.download_size_gb <= 2 for s in SPECS)  # light enough to advise on updates
        assert any(3 <= s.download_size_gb <= 6 for s in SPECS) and any(8 <= s.download_size_gb <= 20 for s in SPECS)
        assert any(s.llm.vision for s in SPECS) and any(s.llm.reasoning != "none" for s in SPECS)
        assert any(s.llm.moe for s in SPECS) and any(s.llm.tools for s in SPECS)

    @pytest.mark.parametrize("spec", SPECS, ids=lambda s: s.id)
    def test_every_preset_is_complete_and_consistent(self, spec):
        assert (spec.kind, spec.backend, spec.engine) == ("llm", "llamacpp", "")
        assert spec.license and spec.description and spec.tags and spec.llm
        files = spec.options["files"]
        assert files["model"][0] == spec.options["repo"] and ("mmproj" in files) == spec.llm.vision
        assert spec.default_variant in {v.key for v in spec.variants}
        assert not any(w in spec.id for w in ("uncensored", "abliterated"))
        assert spec.llm.context_default <= spec.llm.context_max
        for v in spec.variants:  # each variant downloads its own file (and the projector) and nothing else
            wanted = {v.options["files"]["model"][1], *([v.options["files"]["mmproj"][1]] if spec.llm.vision else [])}
            assert {p for s in v.sources for p in (s.patterns or [])} == wanted
            assert v.size_gb == pytest.approx(sum(s.size_gb for s in v.sources), abs=0.011)
            assert v.weights_gb == v.size_gb and v.largest_component_gb < v.size_gb + 0.001

    def test_a_variant_swaps_the_file_and_keeps_the_rest(self):
        spec = with_variant(MODELS["llm-qwen3-8b"], "Q8_0")
        assert spec.options["files"]["model"] == ("Qwen/Qwen3-8B-GGUF", "Qwen3-8B-Q8_0.gguf")
        assert spec.download_size_gb == 8.11 and spec.precision == "Q8_0" and spec.options["kv"]["full"] == 36
        assert MODELS["llm-qwen3-8b"].options["files"]["model"][1] == "Qwen3-8B-Q4_K_M.gguf"  # the preset is untouched

    def test_a_vision_model_downloads_its_projector_too(self):
        spec = MODELS["llm-gemma-4-12b"]
        assert [s.patterns for s in spec.sources] == [["gemma-4-12b-it-qat-q4_0.gguf"], ["mmproj-gemma-4-12b-it-qat-q4_0.gguf"]]
        assert spec.download_size_gb == 6.66
        assert installation_status(spec)["state"] in ("missing", "partial")

    def test_the_default_model_for_a_first_chat_is_the_light_instruct_one(self):
        assert catalog.LLM_STARTER_ORDER[0] == "llm-qwen3-4b-instruct-2507"
        assert all(i in MODELS for i in catalog.LLM_STARTER_ORDER)


class TestMemoryEstimates:
    def test_the_cache_of_a_full_attention_model_grows_with_the_context(self):
        kv = {"full": 36, "heads": 8, "dim": 128}  # Qwen3 8B: 147 456 bytes per token
        assert kv_cache_gb(kv, 16384) == pytest.approx(36 * 8 * 128 * 4 * 16384 * 1.1 / 1024**3, abs=0.01)
        assert kv_cache_gb(kv, 32768) == pytest.approx(2 * kv_cache_gb(kv, 16384), abs=0.02)

    def test_a_sliding_window_layer_only_keeps_its_window(self):
        swa = {"full": 8, "swa": 40, "window": 1024, "heads": 8, "dim": 256}  # Gemma 4 12B
        full = {"full": 48, "heads": 8, "dim": 256}
        assert kv_cache_gb(swa, 65536) < kv_cache_gb(full, 65536) / 4
        assert kv_cache_gb(swa, 512) == kv_cache_gb(full, 512)  # a short context fits in every window

    def test_layers_without_a_cache_cost_nothing(self):
        assert kv_cache_gb({"full": 0, "heads": 8, "dim": 64}, 16384) == 0

    def test_an_unknown_architecture_is_guessed_from_the_weights_on_the_high_side(self):
        guess = kv_cache_gb(None, 16384, 4.68)  # Qwen3 8B's weights: close to its real 2.3 GB
        assert 2.0 < guess < 2.6
        assert kv_cache_gb(None, 16384, 0) > 0

    def test_the_need_adds_weights_cache_and_buffers(self):
        spec = MODELS["llm-qwen3-8b"]
        assert memory_need_gb(spec, 16384) == pytest.approx(spec.weights_gb + kv_cache_gb(spec.options["kv"], 16384)
                                                            + COMPUTE_BUFFER_GB, abs=0.01)
        assert memory_need_gb(spec, 65536) > memory_need_gb(spec, 16384)
        assert spec.options["overhead_gb"] == pytest.approx(memory_need_gb(spec, 16384) - spec.weights_gb, abs=0.01)


class TestPlan:
    def _plan(self, model_id, system):
        spec = get_spec(model_id)
        return catalog._engine_and_plan(spec, system)[2]

    def test_on_a_36_gb_mac_every_preset_fits(self):
        assert all(self._plan(s.id, MAC36)["fits"] for s in SPECS)

    def test_on_a_16_gb_mac_the_heavy_ones_are_refused_with_the_numbers(self):
        assert self._plan("llm-qwen3-8b", MAC16)["fits"] and self._plan("llm-gemma-4-e4b", MAC16)["fits"]
        refused = self._plan("llm-qwen3.8-27b", MAC16)
        assert refused["fits"] is False and "Go de mémoire" in refused["note"] and "16 Go ici" in refused["note"]

    def test_a_small_graphics_card_lets_the_cpu_take_the_rest(self):
        plan = self._plan("llm-gemma-4-12b", NVIDIA8)
        assert plan["fits"] and plan["strategy"] == "model_offload" and "processeur" in plan["note"]
        assert self._plan("llm-lfm2.5-1.2b", NVIDIA8) == {"fits": True, "strategy": "full", "note": ""}

    def test_without_a_gpu_the_model_runs_on_the_cpu_if_the_ram_allows(self):
        plan = self._plan("llm-qwen3-4b-instruct-2507", CPU_ONLY)
        assert plan["fits"] and "Aucun GPU" in plan["note"]
        assert self._plan("llm-gpt-oss-20b", CPU_ONLY)["fits"] is False

    def test_the_planner_counts_the_cache(self):
        spec = get_spec("llm-qwen3-8b")
        assert memory_plan(spec.weights_gb, spec.largest_component_gb, MAC16, "llamacpp", 0)["fits"]
        # 16 GB: 4.68 GB of weights fit alone, but not with a 27 GB cache
        assert memory_plan(spec.weights_gb, spec.largest_component_gb, MAC16, "llamacpp", 27.0)["fits"] is False


class TestCatalog:
    def test_the_catalog_lists_the_chat_models_with_their_engine_and_a_default(self, monkeypatch):
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: MAC36)
        monkeypatch.setattr(catalog, "get_system", lambda refresh=False: MAC36)
        # Nothing is downloaded (the Hugging Face cache of the machine running the test may hold shared files).
        monkeypatch.setattr(catalog.downloads, "status", lambda spec: {"state": "missing", "size_gb": 0.0, "need_gb": 1.0})
        out = catalog.describe_models()
        chat = {m["id"]: m for m in out["models"] if m["kind"] == "llm"}
        assert set(chat) == {s.id for s in SPECS}
        m = chat["llm-qwen3-8b"]
        assert m["engine_name"] == "llama.cpp" and m["engine_available"] and m["compatible"]
        assert m["llm"]["reasoning"] == "toggle" and m["llm"]["tools"] is True and m["llm"]["vision"] is False
        assert [v["key"] for v in m["variants"]] == ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0"] and m["precision"] == "Q4_K_M"
        assert out["llm"]["recommended_model_id"] == "llm-qwen3-4b-instruct-2507"
        assert out["llm"]["default_model_id"] == "llm-qwen3-4b-instruct-2507" and out["llm"]["ready"] is False

    def test_a_machine_without_the_engine_is_offered_the_install(self, monkeypatch):
        system = {**MAC36, "engines": {"llamacpp": {"available": False, "installable": True, "install_variant": "metal",
                                                    "install_size_mb": 11, "reason": "pas installé"}}}
        monkeypatch.setattr("app.system.get_system", lambda refresh=False: system)
        monkeypatch.setattr(catalog, "get_system", lambda refresh=False: system)
        monkeypatch.setattr(catalog.downloads, "status", lambda spec: {"state": "missing", "size_gb": 0.0, "need_gb": 1.0})
        m = next(m for m in catalog.describe_models()["models"] if m["id"] == "llm-qwen3-8b")
        assert m["needs_engine_install"] is True and m["engine_install_size_mb"] == 11 and m["ready"] is False
        assert "Metal" in m["engine_detail"] and m["compatible"] is True

    def test_engine_compat_for_the_hub_search(self):
        assert catalog.engine_compat("llamacpp", None, MAC36) == {"compatible": True, "reason": ""}
        none = {**MAC36, "engines": {"llamacpp": {"available": False, "reason": "absent"}}}
        assert catalog.engine_compat("llamacpp", None, none) == {"compatible": False, "reason": "absent"}


class TestHubFamily:
    def test_a_gguf_chat_repo_is_recognised_whatever_its_task_tag(self):
        c = hf_search.classify
        for task in ("text-generation", "image-text-to-text", "any-to-any"):
            family, details = c("o/m-GGUF", ["gguf", task, "base_model:quantized:o/m"])
            assert family == "llm-gguf" and details["base"] == "o/m"

    @pytest.mark.parametrize("repo,tags", [
        ("o/embed-GGUF", ["gguf", "text-generation"]),  # an embedding model, by its name
        ("o/embeddinggemma-GGUF", ["gguf", "feature-extraction"]),
        ("o/img-GGUF", ["gguf", "text-to-image"]),
        ("o/m", ["safetensors", "text-generation"]),  # not GGUF
        ("o/tts", ["gguf", "text-generation", "text-to-speech"]),
        ("o/vid", ["gguf", "image-text-to-text", "image-to-video"]),
    ])
    def test_other_repos_are_not_chat_models(self, repo, tags):
        assert hf_search.classify(repo, tags) is None

    def test_the_older_gguf_families_keep_priority(self):
        tags = ["gguf", "text-generation", "base_model:quantized:Qwen/Qwen-Image-2.1"]
        assert hf_search.classify("a/q", tags)[0] == "gguf-variant"

    def test_shards_are_one_model_and_drafts_and_projectors_are_not_models(self):
        files = {"m-Q4_K_M-00001-of-00002.gguf": 5, "m-Q4_K_M-00002-of-00002.gguf": 4, "m-Q8_0.gguf": 12,
                 "mmproj-m-F16.gguf": 1, "mtp-m-Q4_0.gguf": 1, "dflash-m-Q4_0.gguf": 1, "MTP/mtp-m.gguf": 1,
                 "eagle3-m-Q8_0.gguf": 1, "README.md": 1}
        groups = hf_search.group_gguf_files(files)
        assert [(g["label"], g["primary"], g["size"]) for g in groups] == [
            ("Q4_K_M", "m-Q4_K_M-00001-of-00002.gguf", 9), ("Q8_0", "m-Q8_0.gguf", 12)]
        assert groups[0]["files"] == ["m-Q4_K_M-00001-of-00002.gguf", "m-Q4_K_M-00002-of-00002.gguf"]

    def test_the_projector_is_chosen_by_precision(self):
        pick = hf_search.pick_mmproj
        assert pick({"mmproj-F16.gguf": 2, "mmproj-BF16.gguf": 3, "mmproj-Q8_0.gguf": 1}) == ("mmproj-BF16.gguf", 3)
        assert pick({"mmproj-Q8_0.gguf": 1, "x-mmproj-f16.gguf": 2}) == ("x-mmproj-f16.gguf", 2)
        assert pick({"a.gguf": 1}) is None

    def test_a_search_result_lists_the_quantizations_it_offers(self):
        files = ["m-Q8_0.gguf", "m-Q4_K_M.gguf", "mmproj-F16.gguf", "m-BF16.gguf", "m-Q4_K_M-00001-of-00002.gguf"]
        assert hf_search.listing_precisions("llm-gguf", "o/m", files, None) == ["Q4_K_M", "Q8_0", "BF16"]

    def _info(self, files, tags=("gguf", "text-generation"), gated=False, context=None):
        return SimpleNamespace(gated=gated, tags=list(tags), pipeline_tag="text-generation", card_data=None,
                               gguf={"context_length": context} if context else None,
                               siblings=[SimpleNamespace(rfilename=n, size=s) for n, s in files.items()])

    def _hub(self, monkeypatch, info):
        monkeypatch.setattr(hf_search, "_api", lambda: SimpleNamespace(model_info=lambda repo, files_metadata=False: info))
        monkeypatch.setattr(hf_search, "get_system", lambda: MAC36)
        monkeypatch.setattr("app.catalog.get_system", lambda refresh=False: MAC36)

    def test_inspecting_a_repo_gives_one_option_per_quantization_with_a_verdict(self, monkeypatch):
        gib = 1024**3
        files = {"m-Q4_K_M.gguf": 5 * gib, "m-Q8_0.gguf": 9 * gib, "mmproj-m-F16.gguf": gib // 2}
        self._hub(monkeypatch, self._info(files, context=65536))
        out = hf_search.inspect("o/m-GGUF")
        assert out["family"] == "llm-gguf" and out["compatible"] is True
        assert [(o["label"], o["size_gb"]) for o in out["options"]] == [("Q4_K_M", 5.5), ("Q8_0", 9.5)]
        first = out["options"][0]
        assert first["mmproj"] == "mmproj-m-F16.gguf" and first["context_max"] == 65536 and first["fits"] is True
        assert first["download_gb"] == 5.5 and "lit les images" in " ".join(out["notes"])

    def test_a_repo_without_a_model_file_is_refused(self, monkeypatch):
        self._hub(monkeypatch, self._info({"mmproj-x.gguf": 1, "README.md": 1}))
        with pytest.raises(hf_search.HubError, match="Aucun fichier GGUF"):
            hf_search.inspect("o/m-GGUF")

    def test_the_recipe_carries_the_files_and_becomes_a_chat_model(self, monkeypatch):
        gib = 1024**3
        files = {"m-Q4_K_M-00001-of-00002.gguf": 3 * gib, "m-Q4_K_M-00002-of-00002.gguf": 3 * gib,
                 "mmproj-m-BF16.gguf": gib // 4}
        self._hub(monkeypatch, self._info(files, context=200000))
        recipe = hf_search.make_recipe("Org/Thinking-8B-GGUF", "m-Q4_K_M-00001-of-00002.gguf")
        assert recipe["family"] == "llm-gguf" and recipe["files"] == [
            "m-Q4_K_M-00001-of-00002.gguf", "m-Q4_K_M-00002-of-00002.gguf"]
        assert recipe["mmproj"] == "mmproj-m-BF16.gguf" and recipe["size_gb"] == 6.25 and recipe["context_max"] == 200000
        spec = custom.build(recipe)
        assert spec.kind == "llm" and spec.backend == "llamacpp" and spec.custom and spec.precision == "Q4_K_M"
        assert spec.options["files"] == {"model": ("Org/Thinking-8B-GGUF", "m-Q4_K_M-00001-of-00002.gguf"),
                                         "mmproj": ("Org/Thinking-8B-GGUF", "mmproj-m-BF16.gguf")}
        assert [s.patterns for s in spec.sources][0] == recipe["files"]  # every shard is downloaded
        assert spec.llm.vision and spec.llm.tools and spec.llm.reasoning == "toggle"  # the name says it thinks
        assert spec.llm.context_max == 131072  # capped, whatever the card says
        assert spec.download_size_gb == 6.25 and spec.weights_gb == 6.25 and spec.largest_component_gb == 6.0

    def test_a_recipe_survives_a_restart_without_network(self):
        recipe = {"family": "llm-gguf", "id": "custom-x", "repo": "o/m", "name": "m Q4_K_M", "file": "m-Q4_K_M.gguf",
                  "size_gb": 4.0, "precision": "Q4_K_M", "license": "mit"}
        spec = custom.build(recipe)
        assert spec.options["files"] == {"model": ("o/m", "m-Q4_K_M.gguf")} and not spec.llm.vision
        assert spec.llm.context_max == 32768 and spec.llm.reasoning == "none" and spec.options["overhead_gb"] > 0

    def test_search_asks_the_hub_for_gguf_chat_repos_and_marks_what_this_machine_can_run(self, monkeypatch):
        seen = []

        def list_models(**kw):
            seen.append(kw)
            ok = SimpleNamespace(id="o/chat-GGUF", tags=["gguf", kw["pipeline_tag"]], downloads=5, likes=1,
                                 siblings=[SimpleNamespace(rfilename="c-Q4_K_M.gguf")], safetensors=None)
            nsfw = SimpleNamespace(id="o/x-GGUF", tags=["gguf", kw["pipeline_tag"], "not-for-all-audiences"], downloads=9,
                                   likes=0, siblings=[], safetensors=None)
            return [ok, nsfw]

        monkeypatch.setattr(hf_search, "_api", lambda: SimpleNamespace(list_models=list_models))
        monkeypatch.setattr(hf_search, "get_system", lambda: MAC36)
        out = hf_search.search("llm", "chat")
        assert {kw["pipeline_tag"] for kw in seen} == {"text-generation", "image-text-to-text", "any-to-any"}
        assert all(kw["filter"] == "gguf" and kw["search"] == "chat" for kw in seen)
        assert [r["repo"] for r in out] == ["o/chat-GGUF"]
        assert out[0]["family_label"] == "Chat (GGUF)" and out[0]["task"] == "llm" and out[0]["compatible"] is True
        assert out[0]["precisions"] == ["Q4_K_M"]
