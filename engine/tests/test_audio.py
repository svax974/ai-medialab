# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "audio_runtime"))

from app import audio_packs  # noqa: E402
from app.dialogue import parse_dialogue, speakers_in  # noqa: E402
from app.engines import MODELS  # noqa: E402
from app.voices import resolve_voice  # noqa: E402
from common import split_text  # noqa: E402


class TestSplitText:
    def test_short_text_is_one_chunk(self):
        assert split_text("Bonjour tout le monde.", 300) == [("Bonjour tout le monde.", "sentence")]

    def test_never_exceeds_max_and_keeps_all_words(self):
        text = " ".join(f"Phrase numéro {i}, avec une virgule, et une suite." for i in range(40))
        chunks = split_text(text, 120)
        assert all(len(c) <= 120 for c, _ in chunks)
        assert " ".join(c for c, _ in chunks).split() == text.split()

    def test_paragraph_break_is_marked(self):
        chunks = split_text("Premier.\n\nSecond.", 300)
        assert [s for _, s in chunks] == ["paragraph", "sentence"]

    def test_unbroken_long_word_run_is_cut(self):
        chunks = split_text("mot " * 200, 100)
        assert all(len(c) <= 100 for c, _ in chunks)


class TestDialogue:
    SCRIPT = "Alice : Salut.\nMarc : Ça va ?\n\nAlice : Oui, et toi ?"

    def test_speakers_detected_in_order(self):
        assert speakers_in(self.SCRIPT) == ["Alice", "Marc"]

    def test_plain_colon_text_is_not_a_speaker_when_not_in_cast(self):
        cast = {"Alice": {"id": "a"}}
        segs = parse_dialogue("Alice : Note : ceci reste du texte.", cast, {"id": "d"})
        assert len(segs) == 1 and segs[0]["text"] == "Note : ceci reste du texte."

    def test_segments_get_their_voice(self):
        cast = {"Alice": {"id": "a"}, "Marc": {"id": "m"}}
        segs = parse_dialogue(self.SCRIPT, cast, {"id": "d"})
        assert [(s["label"], s["voice"]["id"]) for s in segs] == [("Alice", "a"), ("Marc", "m"), ("Alice", "a")]

    def test_continuation_line_extends_previous(self):
        cast = {"Alice": {"id": "a"}}
        segs = parse_dialogue("Alice : Bonjour\net la suite", cast, {"id": "d"})
        assert segs[0]["text"] == "Bonjour et la suite"


class TestResolveVoice:
    def test_preset_valid_for_language(self):
        spec = MODELS["kokoro-82m"]
        v = resolve_voice(spec, {"source": "preset", "id": "ff_siwis"}, "fr", "")
        assert v["kind"] == "preset" and v["id"] == "ff_siwis"

    def test_valid_preset_id_is_respected(self):
        spec = MODELS["kokoro-82m"]
        v = resolve_voice(spec, {"source": "preset", "id": "af_heart"}, "fr", "")
        assert v["id"] == "af_heart"  # id valid for the model is respected (the UI is what picks the language)

    def test_design_model_requires_description(self):
        with pytest.raises(ValueError):
            resolve_voice(MODELS["qwen3-tts-design"], None, "fr", "")
        v = resolve_voice(MODELS["qwen3-tts-design"], None, "fr", "voix grave")
        assert v["kind"] == "design"

    def test_clone_only_model_without_voice_errors(self):
        with pytest.raises(ValueError):
            resolve_voice(MODELS["qwen3-tts-clone"], None, "fr", "")

    def test_non_cloning_model_rejects_library_voice(self, monkeypatch):
        from app import voices

        monkeypatch.setattr(voices, "get_voice", lambda _id: {"url": "/media/uploads/x.wav", "transcript": "", "name": "x"})
        with pytest.raises(ValueError):
            resolve_voice(MODELS["kokoro-82m"], {"source": "library", "id": "x"}, "fr", "")


class TestCatalog:
    def test_audio_models_declare_pack_and_caps(self):
        audio = [m for m in MODELS.values() if m.kind == "audio"]
        assert audio
        for m in audio:
            assert m.backend == "pack" and m.options["pack"] in audio_packs.PACKS
            assert m.audio is not None and m.all_sources()

    def test_tts_models_have_a_way_to_pick_a_voice(self):
        for m in MODELS.values():
            if m.kind == "audio" and m.audio.task == "tts":
                assert m.audio.voices or m.audio.clone != "none" or m.audio.design, m.id

    def test_pack_requirements_hash_changes_with_requirements(self):
        a = audio_packs._requirements_hash(audio_packs.PACKS["speech"])
        b = audio_packs._requirements_hash(audio_packs.PACKS["qwen3"])
        assert a != b


def test_whisper_specs_follow_the_platform():
    from app import audio_packs
    from app.engines import audio_specs

    repo = audio_specs.WHISPER_SMALL.options["repo"]
    assert repo.startswith("mlx-community/") == audio_packs.is_apple_silicon()
    speech = audio_packs.PACKS["speech"]
    assert ("mlx-whisper>=0.4" in audio_packs.requirements_for(speech)) == audio_packs.is_apple_silicon()
