# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video: frame/size math, specs, Hugging Face recipes, job plans, uploads and Range serving (no model is run)."""

import os

import numpy as np
import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")

from app import db, hf_search  # noqa: E402
from app.engines import MODELS, custom, get_spec, video_specs  # noqa: E402
from app.engines.base import with_variant  # noqa: E402
from app.media import encode_mp4, probe_video, video_frame_count, video_size  # noqa: E402


class TestMath:
    @pytest.mark.parametrize("seconds,fps,step,frames", [
        (5, 24, 4, 121), (5, 16, 4, 81), (6, 8, 4, 49), (5, 24, 8, 121), (1, 24, 8, 25),
    ])
    def test_frame_count_is_n_step_plus_one(self, seconds, fps, step, frames):
        assert video_frame_count(seconds, fps, step, 1.0, 10.0) == frames
        assert (frames - 1) % step == 0

    def test_duration_is_clamped(self):
        assert video_frame_count(60, 24, 4, 1.0, 5.0) == 121
        assert video_frame_count(0.1, 24, 4, 1.0, 5.0) == 25

    def test_size_follows_aspect_and_multiple(self):
        assert video_size("16:9", 704, 1280, 32) == (1248, 704)  # capped by the multiple, never beyond long side
        assert video_size("9:16", 704, 1280, 32) == (704, 1248)
        assert video_size("1:1", 480, 832, 16) == (480, 480)
        w, h = video_size("4:3", 480, 832, 16)
        assert w % 16 == 0 and h % 16 == 0 and w > h and w <= 832

    def test_long_side_caps_the_ratio(self):
        w, h = video_size("16:9", 512, 768, 32)
        assert w == 768 and h == 448


class TestSpecs:
    def test_every_spec_is_complete(self):
        assert len(video_specs.SPECS) >= 8
        for spec in video_specs.SPECS:
            v = spec.video
            assert spec.kind == "video" and spec.backend == "torch" and v is not None
            assert v.fps > 0 and v.frame_step in (4, 8) and v.min_seconds <= v.default_seconds <= v.max_seconds
            assert v.resolutions and v.default_resolution in {r.id for r in v.resolutions}
            assert all(r.short_side <= r.long_side for r in v.resolutions)
            assert spec.size_multiple in (16, 32) and spec.description.endswith((".", "…")) and "\n" not in spec.description
            assert spec.weights_gb and spec.largest_component_gb and spec.download_size_gb and spec.memory_hint
            assert set(v.tasks) <= {"t2v", "i2v", "v2v"}
            assert ("i2v" in v.tasks) == (v.image_input != "none") or "v2v" in v.tasks
            assert (v.video_input != "none") == ("v2v" in v.tasks)

    def test_variants_are_valid(self):
        for spec in video_specs.SPECS:
            if not spec.variants:
                assert spec.all_sources()
                continue
            assert spec.default_variant in {v.key for v in spec.variants}
            for variant in spec.variants:
                resolved = with_variant(spec, variant.key)
                assert resolved.all_sources() and variant.size_gb > 0
                assert abs(sum(s.size_gb for s in resolved.sources) - variant.size_gb) < 0.05
                gguf = resolved.options.get("gguf")
                if gguf:
                    wanted = {f for _, f in gguf.values()}
                    patterns = {p for s in resolved.sources for p in (s.patterns or [])}
                    assert wanted <= patterns  # the GGUF files are downloaded
                    assert resolved.options["transformer_class"]

    def test_default_variant_is_four_bit_where_available(self):
        for mid in ("wan-2.2-ti2v-5b", "wan-2.2-t2v-a14b", "wan-2.2-i2v-a14b", "ltx-2.3-distilled"):
            assert with_variant(MODELS[mid], None).options["gguf"], mid
        assert not MODELS["wan-2.2-t2v-a14b"].variants[0].key == "bf16"
        assert {v.key for v in MODELS["wan-2.2-t2v-a14b"].variants} == {"Q4_K_S", "Q4_K_M"}  # never the 126 GB original

    def test_hunyuan_carries_the_licence_warning_and_is_not_a_starter(self):
        from app.catalog import VIDEO_STARTER_ORDER

        for mid in ("hunyuan-video-1.5-t2v", "hunyuan-video-1.5-i2v"):
            assert "Union européenne" in MODELS[mid].video.license_warning and mid not in VIDEO_STARTER_ORDER
        assert not MODELS["cogvideox-2b"].video.license_warning
        assert VIDEO_STARTER_ORDER[0] == "cogvideox-2b"

    def test_public_serialization(self):
        d = MODELS["ltx-2.3-distilled"].to_public()
        assert d["kind"] == "video" and d["video"]["audio_out"] and d["video"]["english_only"]
        assert d["video"]["resolutions"][0] == {"id": "512p", "label": "512p", "short_side": 512, "long_side": 768}
        assert MODELS["z-image-turbo"].to_public()["video"] is None


class TestRecipes:
    def test_classify_video_repos(self):
        c = hf_search.classify
        assert c("a/w", ["diffusers", "diffusers:WanPipeline"])[0] == "video-diffusers"
        assert c("a/h", ["diffusers:HunyuanVideo15ImageToVideoPipeline"])[1]["pipeline"] == "HunyuanVideo15ImageToVideoPipeline"
        assert c("a/l", ["diffusers:LTX2Pipeline"])[0] == "video-diffusers"
        g = c("a/g", ["gguf", "base_model:quantized:Wan-AI/Wan2.2-TI2V-5B"])
        assert g[0] == "video-gguf" and g[1]["template"] == "wan-2.2-ti2v-5b"
        assert c("a/f", ["gguf", "base_model:quantized:Wan-AI/Wan2.2-I2V-A14B"]) is None  # two-file GGUF: not supported

    def test_template_picks_a14b_by_files(self):
        assert custom.video_template_id("WanPipeline", ["transformer/x.safetensors"]) == "wan-2.2-ti2v-5b"
        assert custom.video_template_id("WanPipeline", ["transformer_2/x.safetensors"]) == "wan-2.2-t2v-a14b"
        assert custom.video_template_id("WanImageToVideoPipeline", ["transformer_2/x"]) == "wan-2.2-i2v-a14b"

    def test_diffusers_recipe(self):
        files = ["model_index.json", "transformer/diffusion_pytorch_model.safetensors", "vae/config.json"]
        spec = custom.build({"family": "video-diffusers", "id": "custom-v", "repo": "u/cog", "name": "cog fine-tune",
                             "pipeline": "CogVideoXPipeline", "template": "cogvideox-2b", "files": files,
                             "size_gb": 12.0, "weights_gb": 12.0, "largest_gb": 9.5, "precision": "bf16"})
        assert spec.kind == "video" and spec.custom and spec.hf_repo == "u/cog"
        assert spec.options["pipeline"] == "CogVideoXPipeline" and spec.video.tasks == ["t2v", "v2v"]
        assert spec.sources[0].repo == "u/cog" and spec.sources[0].patterns == files
        assert MODELS["cogvideox-2b"].hf_repo == "zai-org/CogVideoX-2b"  # the template is untouched

    def test_i2v_repo_requires_a_start_image(self):
        spec = custom.build({"family": "video-diffusers", "id": "custom-i", "repo": "u/wan-i2v", "name": "i2v",
                             "pipeline": "WanImageToVideoPipeline", "template": "wan-2.2-ti2v-5b",
                             "files": ["model_index.json"], "size_gb": 30, "weights_gb": 24, "largest_gb": 11, "precision": "bf16"})
        assert spec.video.tasks == ["i2v"] and spec.video.image_input == "required"
        assert not spec.options.get("gguf")  # a full repo: nothing GGUF about it

    def test_t2v_repo_of_a_t2v_only_template_has_no_image_input(self):
        spec = custom.build({"family": "video-diffusers", "id": "custom-h", "repo": "u/hy", "name": "hy",
                             "pipeline": "HunyuanVideo15Pipeline", "template": "hunyuan-video-1.5-t2v",
                             "files": ["model_index.json"], "size_gb": 50, "weights_gb": 34, "largest_gb": 17, "precision": "bf16"})
        assert spec.video.image_input == "none" and spec.video.license_warning

    def test_gguf_recipe_swaps_only_the_transformer(self):
        spec = custom.build({"family": "video-gguf", "id": "custom-g", "repo": "u/Wan-GGUF", "template": "wan-2.2-ti2v-5b",
                             "file": "wan-Q5_K_M.gguf", "size_gb": 3.81, "precision": "Q5_K_M", "name": "u Q5_K_M"})
        assert spec.options["gguf"] == {"transformer": ("u/Wan-GGUF", "wan-Q5_K_M.gguf")}
        assert spec.sources[-1].repo == "u/Wan-GGUF" and spec.sources[0].repo == video_specs.WAN_5B_REPO
        assert round(spec.download_size_gb, 1) == round(14.2 + 3.81, 1)


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    return tmp_path


def _asset(conn, media, filename, kind="upload"):
    aid = db.new_id()
    conn.execute("INSERT INTO assets (id, kind, media, filename, created_at) VALUES (?, ?, ?, ?, ?)",
                 (aid, kind, media, filename, db.now()))
    return aid


class TestPlan:
    def _plan(self, model_id, params, refs=(), tmp=None):
        from app.config import UPLOADS_DIR
        from app.jobs import JobManager

        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        with db.connect() as conn:
            conn.execute("INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES ('c', 't', 'video', 0, 0)")
            conn.execute("INSERT INTO messages (id, conversation_id, role, prompt, created_at) VALUES ('u', 'c', 'user', 'p', 0)")
            for pos, (media, name) in enumerate(refs):
                aid = _asset(conn, media, name)
                conn.execute("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('u', ?, ?)", (aid, pos))
        msg = {"id": "m", "conversation_id": "c", "parent_id": "u", "prompt": "un chat qui court", "model_id": model_id,
               "params": params}
        return JobManager()._build_video_plan(msg, get_spec(model_id))

    def test_text_to_video_plan(self, database):
        plan = self._plan("wan-2.2-ti2v-5b", {"seeds": [1, 2, 3]})
        p = plan["params"]
        assert plan["kind"] == "video" and p["task"] == "t2v" and p["frames"] == 121 and p["fps"] == 24
        assert (p["width"], p["height"]) == (1248, 704) and len(plan["items"]) == 2  # capped at 2 clips
        assert plan["items"][0]["output"].endswith("m_0.mp4") and plan["items"][0]["request"]["extra"]["frames"] == 121

    def test_aspect_resolution_and_seconds(self, database):
        p = self._plan("cogvideox-2b", {"aspect": "9:16", "resolution": "480p", "seconds": 3, "seeds": [5]})["params"]
        assert p["frames"] == 25 and (p["width"], p["height"]) == (400, 720)  # 9:16 capped by the long side

    def test_start_image_makes_image_to_video(self, database, tmp_path):
        from app.config import UPLOADS_DIR
        from PIL import Image

        Image.new("RGB", (64, 64)).save(UPLOADS_DIR / "start.png")
        plan = self._plan("wan-2.2-ti2v-5b", {"seeds": [1]}, [("image", "start.png")])
        assert plan["params"]["task"] == "i2v" and plan["items"][0]["request"]["references"][0].endswith("start.png")

    def test_required_inputs(self, database):
        with pytest.raises(ValueError, match="image de départ"):
            self._plan("hunyuan-video-1.5-i2v", {"seeds": [1]})

    def test_video_edits_with_cogvideox(self, database):
        from app.config import UPLOADS_DIR

        encode_mp4(np.zeros((9, 32, 48, 3), np.uint8), 8, UPLOADS_DIR / "src.mp4")
        plan = self._plan("cogvideox-2b", {"seeds": [1], "strength": 0.6}, [("video", "src.mp4")])
        item = plan["items"][0]["request"]
        assert plan["params"]["task"] == "v2v" and item["strength"] == 0.6 and item["extra"]["video"].endswith("src.mp4")


class TestFilesAndServing:
    def test_encode_and_probe_with_audio(self, tmp_path):
        frames = np.random.randint(0, 255, (9, 32, 48, 3), dtype=np.uint8)
        audio = np.random.uniform(-0.3, 0.3, (2, 16000)).astype(np.float32)
        encode_mp4(frames, 8, tmp_path / "a.mp4", audio, 16000)
        info = probe_video(tmp_path / "a.mp4")
        assert (info["width"], info["height"], info["fps"], info["has_audio"]) == (48, 32, 8.0, True)

    def test_upload_video_and_range_requests(self, database, tmp_path):
        from fastapi.testclient import TestClient

        from app.main import app

        src = tmp_path / "clip.mp4"
        encode_mp4(np.random.randint(0, 255, (17, 64, 96, 3), dtype=np.uint8), 8, src)
        client = TestClient(app)
        r = client.post("/api/assets", files=[("files", ("clip.mp4", src.read_bytes(), "video/mp4"))])
        assert r.status_code == 200, r.text
        a = r.json()[0]
        assert a["media"] == "video" and a["width"] == 96 and a["height"] == 64 and abs(a["duration"] - 2.125) < 0.2
        assert a["fps"] == 8.0 and a["thumb_url"].endswith(".webp") and a["url"].endswith(".mp4")
        assert client.get(a["thumb_url"]).status_code == 200
        ranged = client.get(a["url"], headers={"Range": "bytes=0-99"})
        assert ranged.status_code == 206 and len(ranged.content) == 100
        assert client.get("/api/assets", params={"kind": "upload", "media": "video"}).json()["items"][0]["id"] == a["id"]
        assert client.post("/api/assets", files=[("files", ("bad.mp4", b"not a video", "video/mp4"))]).status_code == 422

    def test_video_conversation_mode(self, database):
        from fastapi.testclient import TestClient

        from app.main import app

        client = TestClient(app)
        cid = client.post("/api/conversations", json={"mode": "video"}).json()["id"]
        assert [c["id"] for c in client.get("/api/conversations", params={"mode": "video"}).json()] == [cid]
        assert client.get("/api/conversations", params={"mode": "image"}).json() == []


class TestLtx:
    def test_memory_numbers_add_up(self):
        spec = MODELS["ltx-2.3-distilled"]
        for v in spec.variants:
            assert v.weights_gb == pytest.approx(sum(s.size_gb for s in v.sources), abs=0.1), v.key
            assert v.size_gb == pytest.approx(v.weights_gb, abs=0.1)
        bf16 = next(v for v in spec.variants if v.key == "bf16")
        assert bf16.largest_component_gb >= 37  # the bf16 transformer, not the text encoder
        q4 = with_variant(spec, "Q4_K_S")
        assert q4.weights_gb == pytest.approx(45.8, abs=0.1) and q4.largest_component_gb == 24.4

    def test_text_encoder_is_the_bf16_copy_not_the_fp32_one(self):
        q4 = with_variant(MODELS["ltx-2.3-distilled"], "Q4_K_S")
        gemma = [s for s in q4.sources if s.repo == q4.options["text_encoder_repo"]]
        assert gemma and gemma[0].size_gb < 30  # the fp32 copy is 48.7 GB

    def test_gguf_converter_patch_renames_prompt_adaln(self):
        torch = pytest.importorskip("torch")
        pytest.importorskip("diffusers")
        from diffusers.loaders import single_file_model as sfm

        from app.engines.video_engine import _patch_ltx2_converter

        _patch_ltx2_converter()
        _patch_ltx2_converter()  # idempotent
        fn = sfm.SINGLE_FILE_LOADABLE_CLASSES["LTX2VideoTransformer3DModel"]["checkpoint_mapping_fn"]
        meta = lambda *shape: torch.empty(*shape, device="meta")  # noqa: E731
        out = fn({
            "prompt_adaln_single.linear.weight": meta(4, 2), "audio_prompt_adaln_single.linear.bias": meta(4),
            "adaln_single.linear.weight": meta(4, 2), "patchify_proj.weight": meta(4, 2),
            "video_embeddings_connector.x": meta(1),
        })
        assert set(out) == {"prompt_adaln.linear.weight", "audio_prompt_adaln.linear.bias", "time_embed.linear.weight",
                            "proj_in.weight"}

    def test_offload_guard_for_quantized_models(self):
        from app.engines.video_engine import _offload_overflow

        gpu = lambda gb, unified=False: {"accelerators": [{"memory_gb": gb, "unified": unified}]}  # noqa: E731
        assert "24 Go" in _offload_overflow(24.4, gpu(24))  # Gemma alone would not fit a 24 GB card
        assert _offload_overflow(24.4, gpu(32)) == ""
        assert _offload_overflow(24.4, gpu(8, unified=True)) == ""
        assert _offload_overflow(None, gpu(8)) == "" and _offload_overflow(9, {"accelerators": []}) == ""
