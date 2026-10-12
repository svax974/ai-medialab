# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Migration of the old chambre-noire.db database after the project rename."""

from app import config


def test_legacy_db_is_renamed(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "ai-medialab.db")
    monkeypatch.setattr(config, "MEDIA_DIRS", {})
    (tmp_path / "chambre-noire.db").write_text("db")
    (tmp_path / "chambre-noire.db-wal").write_text("wal")
    config.ensure_dirs()
    assert (tmp_path / "ai-medialab.db").read_text() == "db"
    assert (tmp_path / "ai-medialab.db-wal").read_text() == "wal"
    assert not (tmp_path / "chambre-noire.db").exists()


def test_existing_new_db_is_never_overwritten(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "ai-medialab.db")
    monkeypatch.setattr(config, "MEDIA_DIRS", {})
    (tmp_path / "chambre-noire.db").write_text("old")
    (tmp_path / "ai-medialab.db").write_text("new")
    config.ensure_dirs()
    assert (tmp_path / "ai-medialab.db").read_text() == "new"
