# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Language of the interface: the mechanism (`app/i18n.py`, `app/api/language.py`) and the coverage of the English catalog."""

import json
import os

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import i18n  # noqa: E402
from app.api.language import LanguageMiddleware, LocalizedJSONResponse, localized_http_exception  # noqa: E402

import i18n_scan  # noqa: E402  # noqa: E402


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    (tmp_path / "en").mkdir()
    (tmp_path / "en" / "demo.json").write_text(json.dumps({
        "Aucun fichier reçu.": "No file received.",
        "Il faut ≈ {} Go ({} Go ici).": "Needs ≈ {0} GB ({1} GB here).",
        "Erreur {} sur {}": "Error {} on {}",
    }), encoding="utf-8")
    monkeypatch.setattr(i18n, "LOCALES_DIR", tmp_path)
    i18n.clear_catalog()
    yield
    i18n.set_language(i18n.DEFAULT_LANGUAGE)
    i18n.clear_catalog()


class TestTranslate:
    def test_parse_accept_language(self):
        assert i18n.parse_accept_language("fr-FR,fr;q=0.9,en;q=0.8") == "fr"
        assert i18n.parse_accept_language("de,en-US;q=0.8") == "en"
        assert i18n.parse_accept_language("de,*") is None
        assert i18n.parse_accept_language(None) is None

    def test_exact_template_and_sentences(self, catalog):
        i18n.set_language("en")
        assert i18n.translate("Aucun fichier reçu.") == "No file received."
        assert i18n.translate("Il faut ≈ 12 Go (8 Go ici).") == "Needs ≈ 12 GB (8 GB here)."
        assert i18n.translate("Erreur 5 sur a") == "Error 5 on a"
        assert i18n.translate("Aucun fichier reçu. Il faut ≈ 3 Go (2 Go ici).") == "No file received. Needs ≈ 3 GB (2 GB here)."

    def test_a_value_that_is_a_text_of_the_catalog_is_translated_too(self, catalog):
        i18n.set_language("en")
        assert i18n.translate("Erreur Aucun fichier reçu. sur b") == "Error No file received. on b"

    def test_unknown_text_stays_as_is_and_french_is_untouched(self, catalog):
        i18n.set_language("en")
        assert i18n.translate("Texte inconnu") == "Texte inconnu"
        i18n.set_language("fr")
        assert i18n.translate("Aucun fichier reçu.") == "Aucun fichier reçu."

    def test_localize_walks_structures_but_not_keys(self, catalog):
        i18n.set_language("en")
        assert i18n.localize({"Aucun fichier reçu.": ["Aucun fichier reçu.", 3, None]}) == {"Aucun fichier reçu.": ["No file received.", 3, None]}


class TestHttp:
    def client(self) -> TestClient:
        app = FastAPI(default_response_class=LocalizedJSONResponse)
        app.add_middleware(LanguageMiddleware)
        app.add_exception_handler(HTTPException, localized_http_exception)

        @app.get("/ok")
        def ok():
            return {"note": "Aucun fichier reçu."}

        @app.get("/refuse")
        def refuse():
            raise HTTPException(409, "Aucun fichier reçu.")

        return TestClient(app)

    def test_answers_and_errors_follow_accept_language(self, catalog):
        client = self.client()
        assert client.get("/ok", headers={"Accept-Language": "en"}).json() == {"note": "No file received."}
        assert client.get("/refuse", headers={"Accept-Language": "en"}).json() == {"detail": "No file received."}
        assert client.get("/ok", headers={"Accept-Language": "fr"}).json() == {"note": "Aucun fichier reçu."}


def test_every_french_text_of_the_code_has_an_english_entry():
    missing = i18n_scan.missing()
    assert not missing, f"{len(missing)} French texts without an entry in app/locales/en (python tests/i18n_scan.py):\n" + "\n".join(
        f"  {where[0]}  {text[:90]}" for text, where in list(missing.items())[:25])
