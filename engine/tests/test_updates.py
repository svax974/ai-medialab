# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Update checks: Hub file ids against the cache, pruning of replaced revisions, engine versions (no network, no torch)."""

import json
import os
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402

from app import audio_packs, audiocpp, config, engine_install, updates  # noqa: E402
from app.engines.base import HfSource  # noqa: E402


@pytest.fixture
def hub(tmp_path, monkeypatch):
    monkeypatch.setattr("huggingface_hub.constants.HF_HUB_CACHE", str(tmp_path / "hub"))
    (tmp_path / "hub").mkdir()
    return tmp_path / "hub"


def make_snapshot(hub, repo, revision, files, main=True, links=True):
    """A cache entry: `files` maps a path to (blob id, content). Blobs are shared between snapshots."""
    root = hub / f"models--{repo.replace('/', '--')}"
    (root / "blobs").mkdir(parents=True, exist_ok=True)
    snap = root / "snapshots" / revision
    for rel, (blob_id, content) in files.items():
        blob = root / "blobs" / blob_id
        blob.write_bytes(content)
        target = snap / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if links:
            target.symlink_to(os.path.relpath(blob, target.parent))
        else:
            target.write_bytes(content)
    if main:
        (root / "refs").mkdir(exist_ok=True)
        (root / "refs" / "main").write_text(revision)
    return root


class TestDiff:
    def test_the_blob_a_link_points_to_is_compared_with_the_hub_id(self, hub):
        make_snapshot(hub, "u/m", "r1", {"unet/a.safetensors": ("aaa", b"12345"), "config.json": ("ccc", b"{}")})
        local = updates.local_files("u/m")
        assert local["unet/a.safetensors"] == ("aaa", 5) and local["config.json"] == ("ccc", 2)
        src = HfSource("u/m", ["unet/*"])
        same = {"unet/a.safetensors": ("aaa", 5), "config.json": ("ccc2", 2)}
        assert updates.diff_source(src, same, local).changed == []  # config.json is outside the patterns
        newer = {"unet/a.safetensors": ("bbb", 9)}
        diff = updates.diff_source(src, newer, local)
        assert diff.changed == ["unet/a.safetensors"] and diff.bytes == 9

    def test_files_the_cache_does_not_have_are_not_updates(self, hub):
        make_snapshot(hub, "u/m", "r1", {"a.safetensors": ("aaa", b"1")})
        remote = {"a.safetensors": ("aaa", 1), "a-fp32.safetensors": ("zzz", 99)}  # a variant the user never downloaded
        assert updates.diff_source(HfSource("u/m", None), remote, updates.local_files("u/m")).changed == []

    def test_a_cache_of_plain_copies_is_compared_by_size(self, hub):
        make_snapshot(hub, "u/m", "r1", {"a.bin": ("aaa", b"12345")}, links=False)
        local = updates.local_files("u/m")
        assert local["a.bin"] == (None, 5)
        assert updates.diff_source(HfSource("u/m", None), {"a.bin": ("x", 5)}, local).changed == []
        assert updates.diff_source(HfSource("u/m", None), {"a.bin": ("x", 6)}, local).changed == ["a.bin"]

    def test_the_main_snapshot_wins_over_an_older_one(self, hub):
        make_snapshot(hub, "u/m", "old", {"a": ("a1", b"1")}, main=False)
        make_snapshot(hub, "u/m", "new", {"a": ("a2", b"22")}, main=True)
        assert updates.local_files("u/m")["a"] == ("a2", 2)

    def test_an_uncached_repo_has_no_files(self, hub):
        assert updates.local_files("nobody/nothing") == {}


def fake_model(*sources, model_id="m", name="Modèle", kind="image"):
    return SimpleNamespace(id=model_id, name=name, kind=kind, all_sources=lambda: list(sources))


class TestModels:
    def test_a_model_is_an_update_when_a_file_it_has_changed(self, hub, monkeypatch):
        make_snapshot(hub, "u/m", "r1", {"w.safetensors": ("aaa", b"x" * 10)})
        make_snapshot(hub, "u/t", "r1", {"t.safetensors": ("ttt", b"y")})
        monkeypatch.setattr(updates, "installed_models", lambda: [
            fake_model(HfSource("u/m", None), HfSource("u/t", None), model_id="two"), fake_model(HfSource("u/t", None), model_id="one")])
        hub_files = {"u/m": {"w.safetensors": ("bbb", 3 * 1024**3)}, "u/t": {"t.safetensors": ("ttt", 1)}}
        rows = {r["id"]: r for r in updates.check_models(remote=lambda repo: hub_files[repo])}
        assert rows["two"]["state"] == "update" and rows["two"]["files"] == 1 and rows["two"]["size_gb"] == 3.0
        assert rows["one"]["state"] == "current" and rows["one"]["size_gb"] == 0.0

    def test_an_update_row_carries_the_revision_of_the_cache_and_a_fingerprint_of_what_changed(self, hub, monkeypatch):
        make_snapshot(hub, "u/m", "abcdef0123456", {"w.safetensors": ("aaa", b"x" * 10)})
        monkeypatch.setattr(updates, "installed_models", lambda: [fake_model(HfSource("u/m", None))])

        def check(remote_id):
            return updates.check_models(remote=lambda repo: {"w.safetensors": (remote_id, 10)})[0]

        first, again, other = check("bbb"), check("bbb"), check("ccc")
        assert first["revision"] == "abcdef0" and len(first["fingerprint"]) == 12
        assert again["fingerprint"] == first["fingerprint"] != other["fingerprint"]  # another change on the Hub, another fingerprint
        assert check("aaa")["fingerprint"] is None and check("aaa")["state"] == "current"

    def test_one_unreadable_repo_is_that_models_error_only(self, hub, monkeypatch):
        make_snapshot(hub, "u/a", "r1", {"a": ("a1", b"1")})
        make_snapshot(hub, "u/b", "r1", {"b": ("b1", b"1")})
        monkeypatch.setattr(updates, "installed_models", lambda: [
            fake_model(HfSource("u/a", None), model_id="a"), fake_model(HfSource("u/b", None), model_id="b")])

        def remote(repo):
            if repo == "u/a":
                raise ConnectionError("name resolution failed")
            return {"b": ("b1", 1)}

        rows = {r["id"]: r for r in updates.check_models(remote=remote)}
        assert rows["a"]["state"] == "error" and "Hugging Face" in rows["a"]["error"]
        assert rows["b"]["state"] == "current"

    def test_a_repo_shared_by_two_models_is_read_once(self, hub, monkeypatch):
        make_snapshot(hub, "u/shared", "r1", {"a": ("a1", b"1")})
        monkeypatch.setattr(updates, "installed_models", lambda: [
            fake_model(HfSource("u/shared", None), model_id="a"), fake_model(HfSource("u/shared", None), model_id="b")])
        calls = []
        updates.check_models(remote=lambda repo: calls.append(repo) or {"a": ("a1", 1)})
        assert calls == ["u/shared"]

    def test_only_one_model_can_be_asked_for(self, hub, monkeypatch):
        make_snapshot(hub, "u/a", "r1", {"a": ("a1", b"1")})
        monkeypatch.setattr(updates, "installed_models", lambda: [
            fake_model(HfSource("u/a", None), model_id="a"), fake_model(HfSource("u/a", None), model_id="b")])
        assert [r["id"] for r in updates.check_models(remote=lambda repo: {"a": ("a1", 1)}, only="b")] == ["b"]


class TestPrune:
    def test_replaced_files_of_old_revisions_are_removed_and_the_others_kept(self, hub):
        root = make_snapshot(hub, "u/m", "old", {"w.safetensors": ("w1", b"x" * 100), "extra.safetensors": ("e1", b"e" * 7),
                                                  "same.json": ("s1", b"{}")}, main=False)
        make_snapshot(hub, "u/m", "new", {"w.safetensors": ("w2", b"y" * 50), "same.json": ("s1", b"{}")}, main=True)
        freed = updates.prune_replaced("u/m")
        assert freed == 100  # the old weights; the identical json is still linked from the new snapshot
        old = root / "snapshots" / "old"
        assert not (old / "w.safetensors").exists() and (old / "extra.safetensors").is_symlink()  # another model's file
        assert not (root / "blobs" / "w1").exists() and (root / "blobs" / "w2").exists() and (root / "blobs" / "s1").exists()
        assert (root / "snapshots" / "new" / "w.safetensors").read_bytes() == b"y" * 50

    def test_an_old_snapshot_left_empty_is_removed(self, hub):
        root = make_snapshot(hub, "u/m", "old", {"a": ("a1", b"1")}, main=False)
        make_snapshot(hub, "u/m", "new", {"a": ("a2", b"2")}, main=True)
        updates.prune_replaced("u/m")
        assert not (root / "snapshots" / "old").exists() and (root / "snapshots" / "new").is_dir()

    def test_nothing_happens_without_a_main_ref(self, hub):
        root = make_snapshot(hub, "u/m", "only", {"a": ("a1", b"1")}, main=False)
        assert updates.prune_replaced("u/m") == 0 and (root / "snapshots" / "only" / "a").is_symlink()

    def test_data_still_linked_by_another_repo_is_kept(self, hub):
        shared = hub / "store"
        shared.mkdir()
        (shared / "data").write_bytes(b"z" * 20)
        for repo, rev, main in (("u/m", "old", False), ("u/other", "r", True)):
            snap = hub / f"models--{repo.replace('/', '--')}" / "snapshots" / rev
            snap.mkdir(parents=True)
            (snap / "w").symlink_to(shared / "data")
        make_snapshot(hub, "u/m", "new", {"w": ("w2", b"n")}, main=True)
        assert updates.prune_replaced("u/m") == 0 and (shared / "data").exists()


class TestEngines:
    def sdcpp_build(self, tmp_path, monkeypatch, tag):
        monkeypatch.setattr(config, "ENGINES_DIR", tmp_path)
        folder = tmp_path / "sdcpp" / "metal"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "sd-cli").write_text("")
        (folder / "VERSION.json").write_text(json.dumps({"tag": tag}))

    def test_a_build_older_than_the_pin_is_an_update(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, "master-900-abc")
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        row = updates._sdcpp_rows(lambda repo: "master-999-zzz")[0]
        assert row["state"] == "update" and row["installed"] == "master-900-abc"
        assert row["target"] == engine_install.PINNED_TAG and row["upstream"] == "master-999-zzz" and row["variant"] == "metal"

    def test_the_pinned_build_is_current_and_a_newer_upstream_one_is_offered_as_latest(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, engine_install.PINNED_TAG)
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        row = updates._sdcpp_rows(lambda repo: "master-999-zzz")[0]
        assert row["state"] == "current" and row["upstream"] == "master-999-zzz"
        assert row["latest"] == {"tag": "master-999-zzz", "regressions": []} and row["advice"] is None

    def test_an_older_build_gets_both_the_tested_update_and_the_latest(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, "master-900-abc")
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        row = updates._sdcpp_rows(lambda repo: "master-999-zzz")[0]
        assert row["state"] == "update" and row["target"] == engine_install.PINNED_TAG and row["latest"]["tag"] == "master-999-zzz"

    def test_a_build_newer_than_the_pin_is_not_downgraded_and_has_no_latest_when_it_is_the_upstream_one(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, "master-999-zzz")
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        row = updates._sdcpp_rows(lambda repo: "master-999-zzz")[0]
        assert row["state"] == "current" and row["latest"] is None and row["rollback"] is True  # may go back to the pin

    def test_a_build_older_than_the_pin_cannot_roll_back(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, "master-900-abc")
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        assert updates._sdcpp_rows(lambda repo: None)[0]["rollback"] is False

    def test_without_a_reachable_upstream_there_is_no_latest(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, engine_install.PINNED_TAG)
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        assert updates._sdcpp_rows(lambda repo: None)[0]["latest"] is None

    def test_a_latest_release_in_a_known_regression_range_carries_the_warning(self, tmp_path, monkeypatch):
        monkeypatch.delenv("IMAGEGEN_SDCPP_TAG", raising=False)
        self.sdcpp_build(tmp_path, monkeypatch, "master-700-abc")
        monkeypatch.setattr(updates, "KNOWN_REGRESSIONS", (updates.Regression("sdcpp", 960, 970, "Effet.", "Source."),))
        row = updates._sdcpp_rows(lambda repo: "master-965-abc")[0]
        assert row["latest"] == {"tag": "master-965-abc", "regressions": [{"effect": "Effet.", "source": "Source."}]}

    def test_following_latest_compares_with_upstream(self, tmp_path, monkeypatch):
        self.sdcpp_build(tmp_path, monkeypatch, "master-1-a")
        monkeypatch.setenv("IMAGEGEN_SDCPP_TAG", "latest")
        row = updates._sdcpp_rows(lambda repo: "master-2-b")[0]
        assert row["state"] == "update" and row["latest"] is None  # the recommended update already is the latest
        assert updates._sdcpp_rows(lambda repo: None)[0]["state"] == "current"  # unknown upstream: nothing to offer

    def test_no_installed_build_no_row(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "ENGINES_DIR", tmp_path)
        assert updates._sdcpp_rows(lambda repo: None) == []

    def test_audiocpp_follows_its_own_pin(self, tmp_path, monkeypatch):
        monkeypatch.setenv("IMAGEGEN_AUDIOCPP_DIR", str(tmp_path))
        monkeypatch.delenv("IMAGEGEN_AUDIOCPP_TAG", raising=False)
        folder = tmp_path / "metal"
        folder.mkdir()
        (folder / audiocpp.binary_name()).write_text("")
        (folder / "VERSION.json").write_text(json.dumps({"tag": "v0.1.0"}))
        row = updates._audiocpp_rows(lambda repo: None)[0]
        assert (row["id"], row["state"], row["target"]) == ("audiocpp", "update", audiocpp.PINNED_TAG)

    def python_pack(self, tmp_path, monkeypatch, pack_hash):
        monkeypatch.setattr(audio_packs, "FAMILY_DIRS", {"audio": tmp_path, "video": tmp_path, "runtime": tmp_path})
        folder = tmp_path / "qwen3"
        python = audio_packs.venv_python("qwen3")
        python.parent.mkdir(parents=True)
        python.write_text("")
        (folder / "ready.json").write_text(json.dumps({"hash": pack_hash, "installed_at": 1_700_000_000}))

    def test_a_pack_whose_pinned_dependencies_changed_is_an_update(self, tmp_path, monkeypatch):
        self.python_pack(tmp_path, monkeypatch, "0123456789abcdef")
        row = next(r for r in updates._pack_rows() if r["id"] == "qwen3")
        assert row["state"] == "update" and row["reason"] == "recipe" and row["installed"].startswith("2023-11")

    def test_a_pack_installed_with_todays_pins_is_current(self, tmp_path, monkeypatch):
        self.python_pack(tmp_path, monkeypatch, audio_packs._requirements_hash(audio_packs.PACKS["qwen3"]))
        assert next(r for r in updates._pack_rows() if r["id"] == "qwen3")["state"] == "current"

    def test_a_pack_that_is_not_installed_is_not_listed(self, tmp_path, monkeypatch):
        monkeypatch.setattr(audio_packs, "FAMILY_DIRS", {"audio": tmp_path, "video": tmp_path, "runtime": tmp_path})
        assert updates._pack_rows() == []

    def test_engines_serve_the_kinds_of_their_models(self):
        assert "image" in updates._kinds(lambda s: s.backend == "sdcpp") and "video" in updates._kinds(lambda s: s.backend == "sdcpp")
        assert updates._kinds(lambda s: s.options.get("pack") == "audiocpp") == ["audio"]


class TestRefreshDownload:
    """`DownloadManager._run(refresh=True)` visits the repos that are installed; a normal run skips them."""

    class FakeProc:
        stdout = None

        def __init__(self):
            self.stdout = self._lines()

        async def _lines(self):
            yield json.dumps({"type": "progress", "done": 5, "total": 10, "rate": 1}).encode()

        async def wait(self):
            return 0

    def run(self, hub, monkeypatch, refresh):
        import asyncio

        from app import downloads as dl

        make_snapshot(hub, "u/m", "r1", {"w.safetensors": ("w1", b"x")})
        spawned = []

        async def fake_exec(*args, **kwargs):
            spawned.append(args[3])  # python -m app.download_worker <repo>
            return self.FakeProc()

        monkeypatch.setattr(dl.asyncio, "create_subprocess_exec", fake_exec)
        spec = SimpleNamespace(id="m", all_sources=lambda: [HfSource("u/m", None, ["w.safetensors"])])
        job = dl.DownloadJob(model_id="m")
        asyncio.run(dl.downloads._run(job, spec, refresh))
        return job, spawned

    def test_an_installed_repo_is_visited_again_for_an_update(self, hub, monkeypatch):
        job, spawned = self.run(hub, monkeypatch, refresh=True)
        assert spawned == ["u/m"] and job.state == "done"

    def test_a_normal_download_skips_an_installed_repo(self, hub, monkeypatch):
        job, spawned = self.run(hub, monkeypatch, refresh=False)
        assert spawned == [] and job.state == "done"

    def test_after_an_update_the_replaced_revision_is_pruned(self, hub, monkeypatch):
        import asyncio

        from app import downloads as dl

        root = make_snapshot(hub, "u/m", "old", {"w.safetensors": ("w1", b"x")}, main=False)

        async def fake_exec(*args, **kwargs):
            make_snapshot(hub, "u/m", "new", {"w.safetensors": ("w2", b"yy")}, main=True)  # what snapshot_download leaves
            return self.FakeProc()

        monkeypatch.setattr(dl.asyncio, "create_subprocess_exec", fake_exec)
        spec = SimpleNamespace(id="m", all_sources=lambda: [HfSource("u/m", None, ["w.safetensors"])])
        asyncio.run(dl.downloads._run(dl.DownloadJob(model_id="m"), spec, True))
        assert not (root / "snapshots" / "old").exists() and (root / "snapshots" / "new" / "w.safetensors").is_symlink()


class TestKnownRegressions:
    def test_the_table_only_holds_what_the_repository_documents(self):
        for r in updates.KNOWN_REGRESSIONS:
            assert r.first <= r.last and r.effect and r.source
            source_file = config.ROOT_DIR / r.source.split(",")[0].split(" ")[0]
            assert source_file.is_file(), r.source
        text = (config.ROOT_DIR / "engine/app/engine_install.py").read_text()
        assert "master-864" in text and "master-899" in text and "#1976" in text  # what the sd.cpp entry rests on

    def test_a_release_inside_a_range_is_warned_about_and_the_bounds_count(self):
        assert [r["effect"] for r in updates.regressions_for("sdcpp", "master-864-abc")] != []
        assert updates.regressions_for("sdcpp", "master-899-abc") != []
        assert updates.regressions_for("sdcpp", "master-863-abc") == []
        assert updates.regressions_for("sdcpp", "master-900-abc") == []
        assert updates.regressions_for("sdcpp", "master-956-1b0ba10") == []  # the pin is outside

    def test_other_engines_and_unreadable_tags_have_none(self):
        assert updates.regressions_for("audiocpp", "master-880-abc") == []
        assert updates.regressions_for("sdcpp", "v0.9.1") == [] and updates.regressions_for("sdcpp", None) == []

    def test_releases_are_ordered_by_number_and_by_version(self):
        assert updates._newer("master-1000-a", "master-999-b") and not updates._newer("master-9-a", "master-10-b")
        assert updates._newer("v0.10.0", "v0.9.1") and not updates._newer("v0.9.1", "v0.9.1")
        assert updates._newer("nightly", None) and not updates._newer(None, "v1")
