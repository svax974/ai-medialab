# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""OCR: the catalogue of OCR models, prompts, cleaning, PDF pages and the reading stream (a fake model, no llama.cpp)."""

import asyncio
import os
from types import SimpleNamespace

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from app import ocr  # noqa: E402
from app.engines import MODELS, get_spec  # noqa: E402
from app.engines.llm_models import memory_need_gb  # noqa: E402

OCR_IDS = [m.id for m in MODELS.values() if m.kind == "ocr"]


class TestCatalogue:
    def test_there_are_ocr_models_and_every_one_is_consistent(self):
        assert len(OCR_IDS) >= 6
        for model_id in OCR_IDS:
            spec = get_spec(model_id)
            assert spec.backend == "llamacpp" and spec.llm and spec.llm.vision and spec.ocr
            assert spec.ocr.default_task in spec.ocr.tasks, model_id
            assert spec.ocr.strengths and spec.ocr.weaknesses and spec.license, model_id
            assert set(spec.options["files"]) == {"model", "mmproj"}, model_id  # a vision model needs its projector
            assert memory_need_gb(spec, spec.llm.context_default) > spec.weights_gb

    def test_ids_are_unique_and_prefixed(self):
        assert len(set(OCR_IDS)) == len(OCR_IDS) and all(i.startswith("ocr-") for i in OCR_IDS)

    def test_the_lightest_models_fit_a_small_machine(self):
        assert get_spec("ocr-glm-ocr").weights_gb < 2
        assert memory_need_gb(get_spec("ocr-glm-ocr"), 16384) < 4

    def test_an_ocr_model_is_not_a_media_generator(self):
        from app.job_checks import check_generation

        with pytest.raises(ValueError, match="lecture de texte"):
            check_generation("ocr-glm-ocr", [])

    def test_the_starter_is_an_ocr_model(self):
        from app.catalog import OCR_STARTER_ORDER

        assert all(i in MODELS for i in OCR_STARTER_ORDER)


class TestPrompts:
    def test_default_task_uses_the_models_own_prompt(self):
        assert ocr.task_prompt(get_spec("ocr-glm-ocr"), "default", None) == "Text Recognition:"
        assert ocr.task_prompt(get_spec("ocr-paddleocr-vl-1.6"), "table", None) == "Table Recognition:"

    def test_a_model_that_reads_the_image_alone_has_an_empty_prompt(self):
        assert ocr.task_prompt(get_spec("ocr-lightonocr-2-1b"), "default", None) == ""

    def test_an_unknown_task_is_refused(self):
        with pytest.raises(ocr.OcrError, match="ne propose pas la tâche"):
            ocr.task_prompt(get_spec("ocr-glm-ocr"), "chart", None)

    def test_a_free_instruction_needs_a_model_that_follows_it_and_a_text(self):
        assert ocr.task_prompt(get_spec("ocr-qwen3-vl-2b"), "custom", "  liste les montants ") == "liste les montants"
        with pytest.raises(ocr.OcrError, match="consigne libre"):
            ocr.task_prompt(get_spec("ocr-glm-ocr"), "custom", "x")
        with pytest.raises(ocr.OcrError, match="vide"):
            ocr.task_prompt(get_spec("ocr-qwen3-vl-2b"), "custom", "  ")

    def test_the_grounding_markers_of_deepseek_ocr_are_removed(self):
        raw = "<|ref|>title<|/ref|><|det|>[[10, 10, 400, 60]]<|/det|>\n# Facture\n\n<|ref|>text<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|>\nTotal : 12 €\n"
        assert ocr.clean(get_spec("ocr-deepseek-ocr"), raw) == "# Facture\n\nTotal : 12 €"
        assert ocr.clean(get_spec("ocr-glm-ocr"), "  texte <b> \n") == "texte <b>"


class TestPages:
    def test_all_pages_or_the_asked_ones_sorted_without_duplicates(self):
        assert ocr.select_pages(3, None) == [0, 1, 2]
        assert ocr.select_pages(5, [4, 2, 2]) == [1, 3]

    def test_a_page_outside_the_document_or_too_many_pages_are_refused(self):
        with pytest.raises(ocr.OcrError, match="hors du document"):
            ocr.select_pages(3, [4])
        with pytest.raises(ocr.OcrError, match="hors du document"):
            ocr.select_pages(3, [0])
        with pytest.raises(ocr.OcrError, match="au plus"):
            ocr.select_pages(ocr.MAX_PAGES + 1, None)
        with pytest.raises(ocr.OcrError, match="Aucune"):
            ocr.select_pages(3, [])

    def test_the_file_kind_is_checked(self, tmp_path):
        png, pdf, txt = tmp_path / "a.PNG", tmp_path / "b.pdf", tmp_path / "c.txt"
        for f in (png, pdf, txt):
            f.write_bytes(b"x")
        assert ocr.source_kind(png) == "image" and ocr.source_kind(pdf) == "pdf"
        with pytest.raises(ocr.OcrError, match="non pris en charge"):
            ocr.source_kind(txt)
        with pytest.raises(ocr.OcrError, match="introuvable"):
            ocr.source_kind(tmp_path / "none.png")


def make_pdf(path, pages: int) -> None:
    images = [Image.new("RGB", (595, 842), "white") for _ in range(pages)]
    images[0].save(path, save_all=True, append_images=images[1:])


class TestPdf:
    def test_pages_are_counted_and_rendered_within_the_size_limit(self, tmp_path):
        pdf_file = tmp_path / "doc.pdf"
        make_pdf(pdf_file, 3)
        pdf = ocr.open_pdf(pdf_file)
        try:
            assert len(pdf) == 3
            out = ocr.render_page(pdf, 1, tmp_path)
        finally:
            pdf.close()
        assert out.name == "page-0002.png"
        with Image.open(out) as image:
            assert max(image.size) <= ocr.RENDER_LONG_SIDE + 1

    def test_a_damaged_pdf_is_refused_with_a_message(self, tmp_path):
        bad = tmp_path / "bad.pdf"
        bad.write_bytes(b"not a pdf")
        with pytest.raises(ocr.OcrError, match="illisible"):
            ocr.open_pdf(bad)


class FakeOcr:
    """Stands for `ocr_llm`: answers each page with the name of its image, or fails on a chosen page."""

    def __init__(self, fail_on: str | None = None) -> None:
        self.fail_on, self.requests = fail_on, []

    def prepare(self, spec, request):
        self.requests.append(request)
        return {}

    async def chat(self, spec, request, payload):
        image = request["messages"][0]["content"][0]["image_url"]["url"]
        name = image.rsplit("/", 1)[-1]
        yield {"type": "loading", "phase": "starting", "model_id": spec.id}
        if name == self.fail_on:
            yield {"type": "error", "code": "upstream", "message": "boom"}
            return
        yield {"type": "delta", "content": f"texte de {name}"}
        yield {"type": "usage", "prompt_tokens": 10, "completion_tokens": 5, "tokens_per_second": 50.0}
        yield {"type": "done", "finish_reason": "stop"}


def run_read(monkeypatch, source, fake, pages=None, task="default", prompt=None, model="ocr-glm-ocr"):
    monkeypatch.setattr(ocr, "ocr_llm", fake)

    async def collect():
        return [e async for e in ocr.read(get_spec(model), source, task, prompt, pages)]

    return asyncio.run(collect())


class TestRead:
    def test_an_image_is_one_page(self, tmp_path, monkeypatch):
        image = tmp_path / "scan.png"
        Image.new("RGB", (40, 40), "white").save(image)
        fake = FakeOcr()
        events = run_read(monkeypatch, image, fake)
        kinds = [e["type"] for e in events]
        assert kinds == ["pages", "page_start", "loading", "page", "done"]
        assert events[0] == {"type": "pages", "total": 1, "document_pages": 1}
        page = events[3]
        assert page["text"] == "texte de scan.png" and page["truncated"] is False and page["usage"]["completion_tokens"] == 5
        assert fake.requests[0]["messages"][0]["content"][1] == {"type": "text", "text": "Text Recognition:"}

    def test_a_pdf_is_read_page_by_page_and_its_temporary_images_are_removed(self, tmp_path, monkeypatch):
        monkeypatch.setattr(ocr.config, "DATA_DIR", tmp_path)
        pdf = tmp_path / "doc.pdf"
        make_pdf(pdf, 3)
        events = run_read(monkeypatch, pdf, FakeOcr(), pages=[3, 1])
        pages = [e for e in events if e["type"] == "page"]
        assert [(p["index"], p["position"], p["total"]) for p in pages] == [(1, 1, 2), (3, 2, 2)]
        assert [p["text"] for p in pages] == ["texte de page-0001.png", "texte de page-0003.png"]
        assert events[0]["document_pages"] == 3 and events[-1] == {"type": "done", "pages": 2}
        assert not list((tmp_path / "ocr-tmp").glob("*"))

    def test_the_pages_read_before_a_failure_are_kept_and_the_reading_stops(self, tmp_path, monkeypatch):
        monkeypatch.setattr(ocr.config, "DATA_DIR", tmp_path)
        pdf = tmp_path / "doc.pdf"
        make_pdf(pdf, 3)
        events = run_read(monkeypatch, pdf, FakeOcr(fail_on="page-0002.png"))
        assert [e["type"] for e in events if e["type"] in ("page", "error", "done")] == ["page", "error"]
        assert not list((tmp_path / "ocr-tmp").glob("*"))

    def test_a_free_instruction_replaces_the_prompt(self, tmp_path, monkeypatch):
        image = tmp_path / "scan.png"
        Image.new("RGB", (40, 40), "white").save(image)
        fake = FakeOcr()
        run_read(monkeypatch, image, fake, task="custom", prompt="liste les montants", model="ocr-qwen3-vl-2b")
        assert fake.requests[0]["messages"][0]["content"][1]["text"] == "liste les montants"

    def test_a_model_that_reads_the_image_alone_gets_no_text_part(self, tmp_path, monkeypatch):
        image = tmp_path / "scan.png"
        Image.new("RGB", (40, 40), "white").save(image)
        fake = FakeOcr()
        run_read(monkeypatch, image, fake, model="ocr-lightonocr-2-1b")
        assert len(fake.requests[0]["messages"][0]["content"]) == 1

    def test_a_page_range_on_an_image_is_refused(self, tmp_path):
        image = tmp_path / "scan.png"
        Image.new("RGB", (40, 40), "white").save(image)
        with pytest.raises(ocr.OcrError, match="qu'une page"):
            ocr.prepare(get_spec("ocr-glm-ocr"), image, "default", None, [2])


def test_the_ocr_server_is_separate_from_the_chat_one():
    from app.llm import llm, manager_for, ocr_llm

    assert manager_for("ocr-glm-ocr") is ocr_llm and manager_for("llm-qwen3-8b") is llm and ocr_llm.role == "ocr"
    with pytest.raises(Exception, match="pas un modèle de chat"):
        ocr_llm.precheck("llm-qwen3-8b")
    assert not SimpleNamespace(**ocr_llm.status()).model_id


class TestHub:
    """Hugging Face: a vision GGUF repo that reads text belongs to the OCR search, any other language model to the chat's."""

    def test_an_ocr_repo_is_its_own_family(self):
        from app import hf_search

        tags = ["gguf", "image-text-to-text", "base_model:quantized:o/m"]
        assert hf_search.classify("o/GLM-OCR-GGUF", tags)[0] == "ocr-gguf"
        assert hf_search.classify("o/m-GGUF", [*tags, "ocr"])[0] == "ocr-gguf"
        assert hf_search.classify("o/Qwen3-VL-GGUF", tags)[0] == "llm-gguf"

    def test_the_search_for_ocr_models_asks_for_vision_gguf_repos_named_ocr(self):
        from app import hf_search

        queries = hf_search._queries("ocr", "dots")
        assert queries == [{**queries[0], "filter": "gguf", "pipeline_tag": "image-text-to-text", "search": "dots ocr"}]
        assert hf_search._queries("ocr", "")[0]["search"] == "ocr"

    def test_each_search_keeps_its_own_repos(self, monkeypatch):
        from app import hf_search

        def list_models(**kw):
            return [SimpleNamespace(id="o/DeepSeek-OCR-GGUF", tags=["gguf", "image-text-to-text"], downloads=5, likes=1,
                                    siblings=[SimpleNamespace(rfilename="d-Q8_0.gguf")], safetensors=None),
                    SimpleNamespace(id="o/chat-GGUF", tags=["gguf", "image-text-to-text"], downloads=9, likes=1,
                                    siblings=[SimpleNamespace(rfilename="c-Q8_0.gguf")], safetensors=None)]

        monkeypatch.setattr(hf_search, "_api", lambda: SimpleNamespace(list_models=list_models))
        monkeypatch.setattr(hf_search, "get_system", lambda: {"engines": {"llamacpp": {"available": True}}, "accelerators": []})
        assert [r["repo"] for r in hf_search.search("ocr", "")] == ["o/DeepSeek-OCR-GGUF"]
        assert [r["repo"] for r in hf_search.search("llm", "")] == ["o/chat-GGUF"]
        assert hf_search.search("ocr", "")[0]["task"] == "ocr"

    def test_the_recipe_becomes_an_ocr_model_that_follows_free_instructions(self):
        from app.engines import custom

        recipe = {"family": "ocr-gguf", "id": "custom-ocr", "repo": "o/X-OCR-GGUF", "name": "X OCR Q8_0", "file": "x-Q8_0.gguf",
                  "mmproj": "mmproj-x.gguf", "mmproj_gb": 0.4, "size_gb": 1.4, "precision": "Q8_0", "license": "mit"}
        spec = custom.build(recipe)
        assert spec.kind == "ocr" and spec.backend == "llamacpp" and spec.custom and spec.llm.vision and not spec.llm.tools
        assert spec.ocr.free_prompt and spec.ocr.default_task in spec.ocr.tasks
        assert spec.options["files"]["mmproj"] == ("o/X-OCR-GGUF", "mmproj-x.gguf")

    def test_an_ocr_repo_without_a_projector_cannot_be_built(self):
        from app.engines import custom

        recipe = {"family": "ocr-gguf", "id": "custom-ocr", "repo": "o/X-OCR-GGUF", "name": "X", "file": "x-Q8_0.gguf",
                  "size_gb": 1.4, "precision": "Q8_0", "license": "mit"}
        with pytest.raises(ValueError, match="projecteur"):
            custom.build(recipe)
