# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Move of the old desktop data folder (app.chambrenoire.studio) into the current one."""

from app.legacy_data import legacy_dirs_from_env, migrate_legacy_data


def make(tmp_path):
    data = tmp_path / "app.aimedialab.studio"
    legacy = tmp_path / "app.chambrenoire.studio"
    (data / "logs").mkdir(parents=True)
    (data / "secrets.json").write_text("{}")
    (legacy / "outputs").mkdir(parents=True)
    (legacy / "outputs" / "a.png").write_text("png")
    (legacy / "logs").mkdir()
    (legacy / "ai-medialab.db").write_text("db")
    (legacy / "secrets.json").write_text("old")
    return data, legacy


def test_entries_are_moved_and_shell_files_kept(tmp_path):
    data, legacy = make(tmp_path)
    moved = migrate_legacy_data(data, [legacy])
    assert moved == ["ai-medialab.db", "outputs"]
    assert (data / "ai-medialab.db").read_text() == "db"
    assert (data / "outputs" / "a.png").read_text() == "png"
    assert (data / "secrets.json").read_text() == "{}"
    assert (legacy / "secrets.json").exists()  # never taken, so the old folder stays for the user


def test_nothing_moves_when_the_current_folder_has_a_database(tmp_path):
    data, legacy = make(tmp_path)
    (data / "ai-medialab.db").write_text("current")
    assert migrate_legacy_data(data, [legacy]) == []
    assert (legacy / "ai-medialab.db").exists()


def test_existing_entries_are_not_overwritten_and_missing_folder_is_ignored(tmp_path):
    data, legacy = make(tmp_path)
    (data / "outputs").mkdir()
    moved = migrate_legacy_data(data, [tmp_path / "absent", legacy])
    assert moved == ["ai-medialab.db"]
    assert (legacy / "outputs" / "a.png").exists()


def test_same_folder_and_env_parsing(tmp_path):
    assert migrate_legacy_data(tmp_path, [tmp_path]) == []
    assert legacy_dirs_from_env({}) == []
    assert [str(p) for p in legacy_dirs_from_env({"IMAGEGEN_LEGACY_DATA_DIRS": "/a"})] == ["/a"]
