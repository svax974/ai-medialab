# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""The engine's own state file and its takeover from the old database (custom model recipes). No model, no network."""

import json
import os
import sqlite3

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402

from app import engine_state  # noqa: E402

RECIPES = [{"id": "custom-x", "family": "gguf-variant", "repo": "u/Z-Image-Turbo-GGUF"}]


def make_legacy_db(path, settings):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.executemany("INSERT INTO settings VALUES (?, ?)", [(k, json.dumps(v)) for k, v in settings.items()])
    conn.commit()
    conn.close()


def test_without_any_old_database_an_empty_state_is_written_once(tmp_path):
    assert engine_state.load(tmp_path) == {}
    assert (tmp_path / engine_state.FILE_NAME).is_file()


@pytest.mark.parametrize("name", ["ai-medialab.db", "chambre-noire.db", "ai-medialab.db.imported"])
def test_recipes_are_taken_from_the_old_database_whatever_its_name(tmp_path, name):
    make_legacy_db(tmp_path / name, {"custom_models": RECIPES, "hf_token": "secret", "keep_alive_minutes": 3})
    state = engine_state.load(tmp_path)
    assert state == {"custom_models": RECIPES}  # settings Nest owns (token included) are not copied
    assert "secret" not in (tmp_path / engine_state.FILE_NAME).read_text()


def test_the_old_database_is_read_once_and_never_modified(tmp_path):
    make_legacy_db(tmp_path / "ai-medialab.db", {"custom_models": RECIPES})
    before = (tmp_path / "ai-medialab.db").read_bytes()
    engine_state.load(tmp_path)
    make_legacy_db(tmp_path / "chambre-noire.db", {"custom_models": []})
    assert engine_state.load(tmp_path)["custom_models"] == RECIPES  # the file wins, no second reading
    assert (tmp_path / "ai-medialab.db").read_bytes() == before


def test_an_unreadable_old_database_gives_an_empty_state(tmp_path):
    (tmp_path / "ai-medialab.db").write_text("not a database")
    assert engine_state.load(tmp_path) == {}


def test_update_merges_keys_and_survives_a_reload(tmp_path):
    engine_state.update(tmp_path, custom_models=RECIPES)
    engine_state.update(tmp_path, other=1)
    assert engine_state.load(tmp_path) == {"custom_models": RECIPES, "other": 1}
    assert not list(tmp_path.glob("*.tmp"))


def test_a_corrupt_state_file_is_ignored(tmp_path):
    (tmp_path / engine_state.FILE_NAME).write_text("{")
    assert engine_state.load(tmp_path) == {}


def test_custom_recipes_go_through_the_state_file(tmp_path, monkeypatch):
    from app.engines import custom

    monkeypatch.setattr(custom, "DATA_DIR", tmp_path)
    assert custom.load_recipes() == []
    models: dict = {}
    spec = custom.add(models, {"family": "sd-diffusers", "id": "custom-sd", "repo": "u/sd", "name": "sd",
                                     "pipeline": "StableDiffusionPipeline", "files": ["model_index.json", "unet/x.fp16.safetensors"],
                                     "fp16": True, "size_gb": 2.0, "weights_gb": 2.0, "largest_gb": 1.7, "precision": "fp16"})
    assert spec.id in models and [r["id"] for r in custom.load_recipes()] == ["custom-sd"]
    custom.remove(models, "custom-sd")
    assert custom.load_recipes() == [] and "custom-sd" not in models
