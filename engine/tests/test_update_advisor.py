# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Update adviser: sources, budgets, the check of the model's excerpts, severity and verdict, the analysis end to end with a
FAKE model (no network, no llama.cpp, no model, no torch)."""

import asyncio
import json
import os
import urllib.error
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402

from app import update_advisor as adv  # noqa: E402
from app.update_advisor import AdvisorError, GithubClient, RateLimited, Source  # noqa: E402


def src(i, kind, text, url="https://x/1", title="t"):
    return Source(f"S{i}", kind, title, url, text)


class TestQuotes:
    def test_normalisation_ignores_case_spaces_and_punctuation(self):
        assert adv.normalize("  Crash,  on LOAD!! (Metal) ") == "crash on load metal"
        assert adv.quote_in("crash on load", "The app: Crash, on  LOAD... of the model")

    def test_a_reworded_or_invented_excerpt_is_not_found(self):
        text = "The server crashes when the context is larger than 8192 tokens."
        assert adv.quote_in("crashes when the context is larger than 8192 tokens", text)
        assert not adv.quote_in("crashes when the context exceeds 8192 tokens", text)  # reworded
        assert not adv.quote_in("memory leak after ten generations", text)  # invented

    def test_a_very_short_excerpt_never_matches(self):
        assert not adv.quote_in("crash", "crash crash crash")


class TestSeverity:
    @pytest.mark.parametrize("kind,quote,expected", [
        ("issue", "Segfault on Metal since this build", "critical"),
        ("issue", "the output is a black image", "critical"),
        ("issue", "it works but is slower than before", "warning"),
        ("issue", "added a new sampler", "info"),
        ("release", "fix crash when the prompt is empty", "info"),  # a fix is not a defect
        ("commit", "Fixed: regression in the VAE tiling", "info"),
        ("discussion", "fixed it myself but it still crashes for others", "critical"),  # not a release: no fix exemption
        ("issue", "there is plenty of room left", "info"),  # "oom" inside "room" is not an out-of-memory
    ])
    def test_the_excerpt_itself_bounds_the_severity(self, kind, quote, expected):
        assert adv.severity_cap(kind, quote) == expected


class TestExtraction:
    SOURCES = [src(1, "issue", "Crash on load with Wan 2.2 since master-1000: the process exits with code 3."),
               src(2, "release", "Faster Metal kernels. Known issue: output is slower with flash attention enabled.")]

    def answer(self, *items):
        return json.dumps({"findings": list(items)})

    def test_an_exact_excerpt_is_kept_with_its_url(self):
        raw = self.answer({"source": "S1", "title": "Plantage au chargement", "severity": "critical",
                           "quote": "Crash on load with Wan 2.2 since master-1000"})
        kept, rejected = adv.extract_findings(raw, self.SOURCES)
        assert rejected == 0 and kept == [{"severity": "critical", "title": "Plantage au chargement", "url": "https://x/1",
                                           "quote": "Crash on load with Wan 2.2 since master-1000", "source_kind": "issue"}]

    def test_an_invented_excerpt_is_dropped(self):
        raw = self.answer({"source": "S1", "title": "x", "severity": "critical", "quote": "Wan 2.2 produces corrupted videos on Windows"})
        assert adv.extract_findings(raw, self.SOURCES) == ([], 1)

    def test_a_slightly_reworded_excerpt_is_dropped(self):
        raw = self.answer({"source": "S1", "title": "x", "severity": "critical", "quote": "Crash on loading with Wan 2.2 since master-1000"})
        assert adv.extract_findings(raw, self.SOURCES)[0] == []

    def test_the_declared_severity_is_capped_by_the_excerpt(self):
        raw = self.answer({"source": "S2", "title": "Lent", "severity": "critical", "quote": "output is slower with flash attention enabled"})
        assert adv.extract_findings(raw, self.SOURCES)[0][0]["severity"] == "warning"
        raw = self.answer({"source": "S2", "title": "Rapide", "severity": "critical", "quote": "Faster Metal kernels in this release"})
        assert adv.extract_findings(raw, self.SOURCES)[0] == []  # not in the source at all ("in this release")

    def test_an_excerpt_cited_under_the_wrong_source_is_given_to_the_right_one(self):
        raw = self.answer({"source": "S2", "title": "x", "severity": "warning", "quote": "the process exits with code 3"})
        kept = adv.extract_findings(raw, self.SOURCES)[0]
        assert len(kept) == 1 and kept[0]["source_kind"] == "issue"

    def test_duplicates_and_junk_items_are_dropped_and_the_count_is_capped(self):
        good = {"source": "S1", "title": "a", "severity": "warning", "quote": "the process exits with code 3"}
        raw = self.answer(good, dict(good, title="b"), "not an object", {"title": "no quote"})
        kept, rejected = adv.extract_findings(raw, self.SOURCES)
        assert len(kept) == 1 and rejected == 3
        many = [dict(good, quote=f"{good['quote']}") for _ in range(20)]
        assert len(adv.extract_findings(self.answer(*many), self.SOURCES)[0]) == 1

    def test_the_answer_may_be_wrapped_in_text_or_a_code_fence(self):
        raw = "```json\n" + self.answer({"source": "S1", "title": "x", "severity": "warning", "quote": "the process exits with code 3"}) + "\n```"
        assert len(adv.extract_findings(raw, self.SOURCES)[0]) == 1

    @pytest.mark.parametrize("raw", ["no json here", "{\"findings\": 3}", "{\"other\": []}", "{broken"])
    def test_an_answer_that_is_not_the_expected_json_raises(self, raw):
        with pytest.raises(ValueError):
            adv.extract_findings(raw, self.SOURCES)


class TestVerdict:
    def f(self, severity):
        return {"severity": severity}

    def test_it_comes_from_the_findings_and_the_known_regressions(self):
        assert adv.verdict_of([], []) == "none"
        assert adv.verdict_of([self.f("info")], []) == "none"
        assert adv.verdict_of([self.f("info"), self.f("warning")], []) == "caution"
        assert adv.verdict_of([self.f("warning"), self.f("critical")], []) == "discouraged"
        assert adv.verdict_of([], [{"severity": "critical"}]) == "discouraged"


class TestBudget:
    def test_sources_keep_their_order_get_numbered_and_are_cut_to_the_budget(self):
        sources = [Source("", "release", f"R{i}", f"https://x/{i}", "x" * 3000) for i in range(20)]
        kept, dropped = adv.fit_sources(sources, budget=10_000)
        assert [s.id for s in kept][:3] == ["S1", "S2", "S3"] and kept[0].title == "R0"
        assert sum(len(s.text) for s in kept) <= 10_000 and dropped == 20 - len(kept) and dropped > 0

    def test_a_long_source_is_cut_with_a_marker(self):
        kept, dropped = adv.fit_sources([Source("", "release", "R", "u", "word " * 5000)], budget=1_000)
        assert dropped == 0 and kept[0].text.endswith("[…]") and len(kept[0].text) < 1_000

    def test_the_default_budget_fits_the_context(self):
        from app.llm import estimate_tokens

        assert estimate_tokens("x" * adv.SOURCE_CHARS_BUDGET) + 700 + 1400 < adv.CONTEXT  # sources + instructions + answer


class TestGithub:
    def client(self, fetch, limit=3, clock=None):
        now = clock or (lambda: 1000.0)
        return GithubClient(fetch=fetch, now=now, limit=limit)

    def test_answers_are_cached_and_a_cached_answer_costs_nothing(self):
        calls = []
        gh = self.client(lambda url: calls.append(url) or {"n": len(calls)}, limit=1)
        assert gh.get("/a") == gh.get("/a") == {"n": 1} and len(calls) == 1

    def test_the_hourly_budget_is_enforced_and_renews(self):
        t = [1000.0]
        gh = self.client(lambda url: {}, limit=2, clock=lambda: t[0])
        gh.get("/a"), gh.get("/b")
        with pytest.raises(RateLimited):
            gh.get("/c")
        t[0] += 3601
        assert gh.get("/c") == {}

    def test_a_refusal_by_github_is_a_rate_limit_and_a_404_is_none(self):
        def fetch(url):
            code = 403 if "limited" in url else 404
            raise urllib.error.HTTPError(url, code, "x", {}, None)

        gh = self.client(fetch)
        with pytest.raises(RateLimited):
            gh.get("/limited")
        assert gh.get("/missing") is None

    def test_other_errors_are_not_hidden(self):
        def fetch(url):
            raise urllib.error.HTTPError(url, 500, "boom", {}, None)

        with pytest.raises(urllib.error.HTTPError):
            self.client(fetch).get("/x")


RELEASES = [{"tag_name": f"master-{n}-abcdef0", "published_at": f"2026-10-{n - 990:02d}T10:00:00Z", "html_url": f"https://gh/r/{n}",
             "body": f"notes of {n}: fix a typo"} for n in (1000, 1001, 1002, 1003)] + [
            {"tag_name": "master-956-1b0ba10", "published_at": "2026-10-01T10:00:00Z", "html_url": "https://gh/r/956", "body": "old"}]
ISSUES = [{"number": 7, "title": "Crash with Wan after update", "created_at": "2026-10-14T10:00:00Z", "html_url": "https://gh/i/7",
           "body": "It crashes on load since master-1002."},
          {"number": 8, "title": "A pull request", "created_at": "2026-10-14T11:00:00Z", "pull_request": {}, "html_url": "https://gh/p/8", "body": "x"},
          {"number": 3, "title": "Old issue", "created_at": "2026-09-01T10:00:00Z", "html_url": "https://gh/i/3", "body": "from before"}]
COMPARE = {"html_url": "https://gh/compare", "commits": [
    {"sha": "a" * 40, "commit": {"message": "feat: faster kernels\n\nlong body"}}, {"sha": "b" * 40, "commit": {"message": "fix: vae"}}]}


class FakeGithub:
    def __init__(self, fail=()):
        self.fail, self.paths = set(fail), []

    def get(self, path, ttl=0):
        self.paths.append(path)
        for key in self.fail:
            if key in path:
                raise RateLimited("limite de l'API GitHub atteinte")
        if "/releases?" in path:
            return RELEASES
        if "/issues?" in path:
            return ISSUES
        if "/compare/" in path:
            return COMPARE
        return None


class TestEngineSources:
    def test_releases_between_the_installed_build_and_the_target_newest_first(self):
        picked = adv.releases_between(RELEASES, "master-956-1b0ba10", "master-1002-abcdef0")
        assert [r["tag_name"].split("-")[1] for r in picked] == ["1002", "1001", "1000"]
        assert [r["tag_name"] for r in adv.releases_between(RELEASES, None, "master-1003-abcdef0")] == ["master-1003-abcdef0"]
        assert adv.releases_between([{"tag_name": "b11320", "published_at": "x"}, {"tag_name": "b11300", "published_at": "x"}], "b11300", "b11320")[0]["tag_name"] == "b11320"

    def test_the_sources_are_commits_then_releases_then_recent_issues_without_pull_requests(self):
        gh = FakeGithub()
        got = adv.collect_engine("sdcpp", "master-956-1b0ba10", "master-1002-abcdef0", gh)
        kinds = [s.kind for s in got.sources]
        assert kinds == ["commit", "release", "release", "release", "issue"] and got.notes == []
        assert got.sources[0].text.splitlines()[0].startswith("bbbbbbb fix: vae")  # oldest first reads as a story? newest first here
        assert [s.title for s in got.sources if s.kind == "issue"] == ["Issue #7 : Crash with Wan after update"]  # no PR, none before the first release
        assert len(gh.paths) == 3  # releases, compare, issues: the whole analysis costs three calls

    def test_a_refused_call_only_removes_its_source(self):
        got = adv.collect_engine("sdcpp", "master-956-1b0ba10", "master-1002-abcdef0", FakeGithub(fail=["/issues?"]))
        assert "issue" not in [s.kind for s in got.sources] and "release" in [s.kind for s in got.sources]
        assert any("Issues non lues" in n for n in got.notes)
        none = adv.collect_engine("sdcpp", "master-956-1b0ba10", "master-1002-abcdef0", FakeGithub(fail=["/releases?"]))
        assert none.sources == [] and none.notes


class FakeHub:
    def __init__(self, fail=()):
        self.fail = set(fail)

    def last_commits(self, repo, paths):
        if "commits" in self.fail:
            raise RuntimeError("down")
        return [{"id": "abc1234", "title": "Update the weights", "date": "2026-10-10"}]

    def discussions(self, repo, limit):
        return [{"num": "4", "title": "Garbage output with the new file", "date": "2026-10-11", "text": "The new file outputs garbage on Metal."}]

    def readme(self, repo, revision):
        return "# Model\nold line\n" if revision != "main" else "# Model\nnew line\nsecond\n"


class TestModelSources:
    def test_commits_discussions_and_the_card_are_read_per_repo(self):
        got = adv.collect_model(None, {"u/m": {"a.gguf": "id1"}}, FakeHub())
        assert [s.kind for s in got.sources] == ["commit", "discussion", "card"] and got.notes == []
        assert got.sources[1].url == "https://huggingface.co/u/m/discussions/4"
        assert "Garbage output" in got.sources[1].text

    def test_a_source_that_cannot_be_read_is_a_note_not_a_failure(self):
        got = adv.collect_model(None, {"u/m": {"a.gguf": "id1"}}, FakeHub(fail=["commits"]))
        assert [s.kind for s in got.sources] == ["discussion", "card"] and any("commits" in n for n in got.notes)

    def test_the_card_changes_are_the_added_and_removed_lines(self):
        assert adv.readme_changes("# Model\nold line\n", "# Model\nnew line\nsecond\n") == "-old line\n+new line\n+second"


class TestPickModel:
    def setup(self, monkeypatch, installed):
        monkeypatch.setattr("app.downloads.downloads.status", lambda spec: {"state": "installed" if spec.id in installed else "missing"})
        monkeypatch.setattr("app.downloads.downloads.invalidate", lambda: None)

    def test_none_installed_means_no_model(self, monkeypatch):
        self.setup(monkeypatch, set())
        assert adv.pick_model() is None

    def test_the_recommended_adviser_wins_when_installed(self, monkeypatch):
        self.setup(monkeypatch, {"llm-qwen3-4b-instruct-2507", "llm-qwen3-8b"})
        assert adv.pick_model().id == "llm-qwen3-4b-instruct-2507"

    def test_else_the_strongest_light_model_that_can_stay_quiet(self, monkeypatch):
        self.setup(monkeypatch, {"llm-lfm2.5-1.2b", "llm-qwen3-8b", "llm-gpt-oss-20b"})
        assert adv.pick_model().id == "llm-qwen3-8b"  # 20B is heavy, 1.2B is weaker

    def test_a_heavy_model_is_used_when_it_is_all_there_is(self, monkeypatch):
        self.setup(monkeypatch, {"llm-gpt-oss-20b"})
        assert adv.pick_model().id == "llm-gpt-oss-20b"


def run(coro):
    return asyncio.run(coro)


class Script:
    """A fake model: answers the extraction with `findings` (a function of the prompt) and the summary with `summary`."""

    def __init__(self, findings, summary="Résumé du modèle.", fail_summary=False):
        self.findings, self.summary, self.fail_summary, self.calls = findings, summary, fail_summary, []

    async def __call__(self, spec, messages, **kw):
        self.calls.append((messages, kw))
        if kw.get("response_format"):
            return self.findings if isinstance(self.findings, str) else json.dumps({"findings": self.findings})
        if self.fail_summary:
            raise AdvisorError("llm", "boom", 502)
        return self.summary


MODEL = SimpleNamespace(id="llm-qwen3-4b-instruct-2507", name="Qwen3 4B")
ROW = {"id": "sdcpp", "name": "stable-diffusion.cpp", "from": "master-956-1b0ba10", "to": "master-1002-abcdef0"}


@pytest.fixture
def engine_row(monkeypatch):
    monkeypatch.setattr(adv, "_row_of", lambda kind, item_id, target: dict(ROW))


def analyse(script, gh=None, row=None, model=MODEL):
    return run(adv.advise("engine", "sdcpp", "pinned", llm_call=script, github=gh or FakeGithub(), model=model))


class TestAdvise:
    GOOD = {"source": "S5", "title": "Plantage au chargement", "severity": "critical", "quote": "It crashes on load since master-1002"}

    def test_a_reported_crash_is_found_cited_and_makes_the_verdict_discouraged(self, engine_row):
        res = analyse(Script([self.GOOD]))
        assert res["verdict"] == "discouraged" and res["summary"] == "Résumé du modèle."
        assert res["findings"][0]["url"] == "https://gh/i/7" and res["findings"][0]["quote"].startswith("It crashes on load")
        assert res["llm_model_id"] == MODEL.id and res["from_version"] == "master-956-1b0ba10" and res["to_version"] == "master-1002-abcdef0"
        assert {"title": "Issue #7 : Crash with Wan after update", "url": "https://gh/i/7"} in res["sources"]
        assert res["rejected"] == 0 and res["notes"] == []

    def test_what_the_model_invents_is_dropped_and_nothing_is_said(self, engine_row):
        invented = {"source": "S1", "title": "Corruption des vidéos", "severity": "critical", "quote": "videos are corrupted on Windows"}
        res = analyse(Script([invented]))
        assert res["findings"] == [] and res["rejected"] == 1 and res["verdict"] == "none"
        assert res["summary"].startswith("Aucun problème signalé")

    def test_no_finding_means_no_second_call_to_the_model(self, engine_row):
        script = Script([])
        analyse(script)
        assert len(script.calls) == 1

    def test_the_extraction_asks_for_constrained_json_with_the_sources_numbered(self, engine_row):
        script = Script([])
        analyse(script)
        messages, kw = script.calls[0]
        assert kw["response_format"]["type"] == "json_schema" and kw["response_format"]["schema"] is adv.EXTRACT_SCHEMA
        user = messages[1]["content"]
        assert "[S1] (commit)" in user and "[S5] (issue)" in user and messages[0]["role"] == "system"

    def test_a_known_regression_is_always_reported(self, engine_row, monkeypatch):
        monkeypatch.setitem(ROW, "to", "master-870-abcdef0")
        res = analyse(Script([]))
        assert res["verdict"] == "discouraged" and res["findings"][0]["source_kind"] == "known" and res["findings"][0]["url"] == ""
        assert "issue #1976" in res["findings"][0]["title"]

    def test_the_summary_falls_back_to_a_template_when_the_model_fails_to_write_one(self, engine_row):
        res = analyse(Script([self.GOOD], fail_summary=True))
        assert res["summary"].startswith("Points signalés : Plantage au chargement")

    def test_an_unreadable_answer_is_an_error_not_a_clean_bill(self, engine_row):
        with pytest.raises(AdvisorError) as exc:
            analyse(Script("this is not json"))
        assert exc.value.code == "llm_output" and exc.value.status == 502

    def test_a_model_that_never_answers_ends_with_a_timeout(self, engine_row, monkeypatch):
        async def hang(spec, messages, **kw):
            await asyncio.sleep(30)

        monkeypatch.setattr(adv, "LLM_TIMEOUT_S", 0.05)
        with pytest.raises(AdvisorError) as exc:
            analyse(hang)
        assert exc.value.code == "llm" and exc.value.status == 504

    def test_when_github_cannot_be_read_at_all_there_is_nothing_to_say(self, engine_row):
        with pytest.raises(AdvisorError) as exc:
            analyse(Script([]), gh=FakeGithub(fail=["/releases?"]))
        assert exc.value.code == "no_sources" and exc.value.status == 502

    def test_a_partial_read_is_reported_in_the_notes(self, engine_row):
        res = analyse(Script([]), gh=FakeGithub(fail=["/issues?"]))
        assert any("Issues non lues" in n for n in res["notes"])

    def test_no_installed_model_is_a_typed_refusal(self, engine_row, monkeypatch):
        monkeypatch.setattr(adv.llamacpp, "installed_binary", lambda: ("metal", "/x"))
        monkeypatch.setattr(adv, "pick_model", lambda: None)
        with pytest.raises(AdvisorError) as exc:
            run(adv.advise("engine", "sdcpp", "pinned", llm_call=Script([]), github=FakeGithub()))
        assert exc.value.code == "no_model" and exc.value.status == 409

    def test_no_chat_engine_is_a_typed_refusal(self, engine_row, monkeypatch):
        monkeypatch.setattr(adv.llamacpp, "installed_binary", lambda: None)
        with pytest.raises(AdvisorError) as exc:
            run(adv.advise("engine", "sdcpp", "pinned", llm_call=Script([]), github=FakeGithub()))
        assert exc.value.code == "no_engine"

    def test_a_model_update_reads_the_hub(self, monkeypatch):
        monkeypatch.setattr(adv, "_row_of", lambda *a: {"id": "x", "name": "Wan", "from": "abc1234", "to": "f00dfeed1234"})
        monkeypatch.setattr(adv, "_changed_files", lambda spec: {"u/m": {"a.gguf": "id1"}})
        monkeypatch.setattr(adv, "resolve_variant", lambda base, chosen: base)
        monkeypatch.setitem(adv.MODELS, "x", SimpleNamespace(all_sources=lambda: []))
        finding = {"source": "S3", "title": "Sortie corrompue", "severity": "critical", "quote": "The new file outputs garbage on Metal"}
        res = run(adv.advise("model", "x", llm_call=Script([finding]), hub=FakeHub(), model=MODEL))
        assert res["verdict"] == "discouraged" and res["findings"][0]["url"] == "https://huggingface.co/u/m/discussions/4"
        assert res["from_version"] == "abc1234" and res["to_version"] == "f00dfeed1234" and res["notes"] == []


class FakeChatManager:
    """Stands for `llm.llm`: records what it was given and replays events."""

    def __init__(self, events):
        self.events, self.closed, self.requests = events, False, []

    def precheck(self, model_id, ctx=None):
        return SimpleNamespace(id=model_id)

    def prepare(self, spec, request):
        self.requests.append(request)
        return {"payload": True}

    async def chat(self, spec, request, payload):
        try:
            for ev in self.events:
                yield ev
        finally:
            self.closed = True


class TestRunLlm:
    def go(self, monkeypatch, events):
        fake = FakeChatManager(events)
        monkeypatch.setattr("app.llm.llm", fake)
        return fake

    def test_the_deltas_are_joined_and_the_settings_are_for_extraction(self, monkeypatch):
        fake = self.go(monkeypatch, [{"type": "delta", "content": "{\"a\""}, {"type": "delta", "content": ": 1}"}, {"type": "done"}])
        text = run(adv.run_llm(MODEL, [{"role": "user", "content": "x"}], max_tokens=50, response_format={"type": "json_object"}))
        req = fake.requests[0]
        assert text == "{\"a\": 1}" and req["reasoning"] == "off" and req["context_size"] == 16384 and req["response_format"] == {"type": "json_object"}
        assert req["params"]["temperature"] <= 0.2 and fake.closed

    def test_an_error_event_is_raised_and_the_manager_is_released(self, monkeypatch):
        fake = self.go(monkeypatch, [{"type": "delta", "content": "x"}, {"type": "error", "code": "closed", "message": "coupé"}, {"type": "delta", "content": "y"}])
        with pytest.raises(AdvisorError) as exc:
            run(adv.run_llm(MODEL, [], max_tokens=10))
        assert exc.value.code == "llm" and "coupé" in str(exc.value) and fake.closed

    def test_a_busy_engine_is_busy(self, monkeypatch):
        self.go(monkeypatch, [{"type": "error", "code": "busy", "message": "Une réponse est déjà en cours"}])
        with pytest.raises(AdvisorError) as exc:
            run(adv.run_llm(MODEL, [], max_tokens=10))
        assert exc.value.code == "busy" and exc.value.status == 409

    def test_a_refusal_of_the_chat_manager_keeps_its_status(self, monkeypatch):
        from app.llm import LlmBusy

        fake = self.go(monkeypatch, [])

        def refuse(model_id, ctx=None):
            raise LlmBusy("Le modèle n'est pas téléchargé.")

        fake.precheck = refuse
        with pytest.raises(AdvisorError) as exc:
            run(adv.run_llm(MODEL, [], max_tokens=10))
        assert exc.value.status == 409 and exc.value.code == "busy"


class TestRows:
    def test_a_pack_or_an_unknown_engine_has_nothing_to_analyse(self, monkeypatch):
        monkeypatch.setattr(adv.updates, "check_engines", lambda upstream=None: [
            {"id": "video-pack", "state": "update", "target": None, "latest": None, "installed": "2026-10-01"}])
        with pytest.raises(AdvisorError) as exc:
            adv._row_of("engine", "video-pack", "pinned")
        assert exc.value.code == "unsupported"
        with pytest.raises(AdvisorError) as exc:
            adv._row_of("engine", "nope", "pinned")
        assert exc.value.code == "not_installed" and exc.value.status == 404

    def test_the_latest_target_needs_a_newer_upstream_release(self, monkeypatch):
        row = {"id": "sdcpp", "state": "current", "target": "master-956-x", "latest": None, "installed": "master-956-x"}
        monkeypatch.setattr(adv.updates, "check_engines", lambda upstream=None: [row])
        with pytest.raises(AdvisorError) as exc:
            adv._row_of("engine", "sdcpp", "latest")
        assert exc.value.code == "nothing_to_analyse"
        row["latest"] = {"tag": "master-1100-abc", "regressions": []}
        assert adv._row_of("engine", "sdcpp", "latest")["to"] == "master-1100-abc"

    def test_an_engine_that_is_up_to_date_is_not_analysed_for_the_pinned_target(self, monkeypatch):
        row = {"id": "audiocpp", "state": "current", "target": "v0.9.1", "latest": None, "installed": "v0.9.1"}
        monkeypatch.setattr(adv.updates, "check_engines", lambda upstream=None: [row])
        with pytest.raises(AdvisorError):
            adv._row_of("engine", "audiocpp", "pinned")

    def test_a_model_row_carries_the_revision_and_the_fingerprint(self, monkeypatch):
        monkeypatch.setattr(adv.updates, "check_models", lambda only=None: [
            {"id": "m", "state": "update", "revision": "abc1234", "fingerprint": "0123456789ab", "name": "M"}])
        row = adv._row_of("model", "m", "pinned")
        assert row["from"] == "abc1234" and row["to"] == "0123456789ab"
        monkeypatch.setattr(adv.updates, "check_models", lambda only=None: [{"id": "m", "state": "current"}])
        with pytest.raises(AdvisorError):
            adv._row_of("model", "m", "pinned")
