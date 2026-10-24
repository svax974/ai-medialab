# Bundled third-party components: registry and review procedure

This folder describes **every external component the application installs or drives**, so they can be reviewed from time to
time: a fixed version, an improved model, a new family, a changed license.

*Last verified against source: 2026-10-13 (pins and paths re-read after the migration: the engine is in `engine/`).*

Rule of this folder: **one fact, one place**. Pinned versions are never copied here; we cite the
file that holds them (the code does not lie, a copy always ends up lying). Model licenses are in
`THIRD_PARTY_LICENSES.md` (summary) and in the component's sheet (detail and upstream status).

## Review procedure (every 3 to 4 weeks, or before a release)

1. Run the report (network required, changes nothing):
   `engine/.venv/bin/python scripts-local/review_components.py`
   It compares what is pinned with the latest upstream version (native engines, audio pack libraries, **web stack of
   `front/` and `back/`**, Tauri) and lists, for audio.cpp, the new families or those whose status or license has changed
   since the last snapshot.
2. For each line "NEW VERSION" or each new family: read the upstream release notes, then the
   "To check at review" section of the component's sheet.
3. If we update a pin: change the constant (file given in the registry), rerun the component's tests
   **one file at a time, never the full suite at once** (on a Mac, an overflow of unified memory reboots the machine; run under memory monitoring of free memory), then update the sheet (review date, results).
4. Refresh the family snapshot: `… review_components.py --snapshot`, then commit the JSON.
5. Note the date in the "Last review" column below.

## Registry

| Component | Role | Where the pin is | License | Sheet | Last review |
|---|---|---|---|---|---|
| **audio.cpp** (ggml) | GGUF speech synthesis on Metal, CUDA, Vulkan or CPU (then transcription, see sheet) | `engine/app/audiocpp.py` (`PINNED_TAG`) | Apache-2.0 | [audiocpp.md](audiocpp.md); manual tests to run by hand: [audiocpp-tests-manuels.md](audiocpp-tests-manuels.md) | 2026-10-13 |
| **llama.cpp** (`llama-server`) | GGUF chat models (Metal, CUDA, ROCm, Vulkan, CPU) | `engine/app/llamacpp.py` (`PINNED_TAG`) | MIT | [llamacpp.md](llamacpp.md) | 2026-10-15 |
| **pypdfium2** (PDFium) | rasterizes the pages of a PDF for the OCR tab | `pypdfium2` in `engine/pyproject.toml`; `engine/app/ocr.py` (`RENDER_LONG_SIDE`) | BSD-3-Clause or Apache-2.0 (the wheel bundles PDFium, BSD-3 / Apache-2.0) | to write | – |
| **OCR models** (GLM-OCR, PaddleOCR-VL 1.6, LightOnOCR 2, DeepSeek-OCR, dots.ocr, Qianfan-OCR, Qwen3-VL 2B) | read text with llama.cpp | `engine/app/engines/ocr_models.py` (repo, files, prompts, markers) | MIT / Apache-2.0, see `THIRD_PARTY_LICENSES.md` | `docs/guide.md`, section OCR | 2026-10-24 |
| **PyTorch acceleration** (CUDA, ROCm, XPU, Vulkan) | which GPUs the PyTorch audio packs can use, and the "slow · processor" marker | `engine/app/audio_packs.py` (`torch_acceleration`, `_torch_index`) | – | [pytorch-gpu.md](pytorch-gpu.md) | 2026-10-13 |
| **stable-diffusion.cpp** | GGUF images and video (Metal, CUDA, ROCm, Vulkan, CPU) | `engine/app/engine_install.py` (`PINNED_TAG`); reason for the pin in the comment above it; per-model minimum build: `min_build` (`engine/app/engines/gguf_models.py`) | MIT | to write | 2026-10-24 (`master-999`, Metal only) |
| **FFmpeg** (via PyAV) | MP4 encoding (H.264 + AAC), decoding of uploaded videos | `ffmpeg` extra of `engine/pyproject.toml` and `ffmpeg` pack (`engine/app/audio_packs.py`), downloaded on the user's machine; H.264 encoders: `H264_ENCODERS` (`engine/app/media.py`) | de facto GPL PyPI wheel (x264, x265): not redistributed, downloaded by the user | [ffmpeg.md](ffmpeg.md) | 2026-10-13 |
| **mflux / MLX** | images on Apple Silicon | `engine/pyproject.toml` | MIT | to write | – |
| **PyTorch, diffusers, transformers, peft** | torch engine (images, video, packs); `peft` loads the SDXL LoRAs | `engine/pyproject.toml`, `engine/app/audio_packs.py` | BSD-3 / Apache-2.0 | to write | – |
| **qwen-tts** | Qwen3-TTS in PyTorch | `engine/app/audio_packs.py` (`qwen3` pack) | Apache-2.0 | to write | – |
| **Kokoro, Pocket TTS, faster-whisper, mlx-whisper** | "speech" audio pack | `engine/app/audio_packs.py` (`speech` pack) | see `THIRD_PARTY_LICENSES.md` | to write | – |
| **MUI, Emotion, TanStack Query, Zustand, Fontsource fonts** | interface (components and theme, data cache, state, embedded fonts) | `front/package.json` (ranges), `front/package.local.json` (deviations from the template) | MIT (MUI, Emotion, TanStack, Zustand), OFL-1.1 (fonts) | to write | – |
| **NestJS, TypeORM, better-sqlite3** | application server, data access, SQLite database | `back/package.json` (ranges), `back/package.local.json` | MIT | to write | – |
| **openapi-typescript** | types of the Nest ↔ engine contract (`engine/openapi.json`) | `back/package.json` (`devDependencies`) | MIT | to write | – |
| **Tauri 2** | desktop shell | `desktop/src-tauri/Cargo.toml`, `desktop/package.json` | Apache-2.0 OR MIT | to write | – |

The "to write" lines do not have a detailed sheet yet: the review script already checks them (installed versions against the
latest published version), the sheet will come when we revisit them. For the web stack, a major version bump of MUI or
TypeORM is read in their release notes before widening the range in `package.json`. Do not copy here what `THIRD_PARTY_LICENSES.md` already says.

## Adding a component

1. A sheet `docs/components/<name>.md` modeled on `audiocpp.md` (why, what is integrated, how it runs, measured
   limits, candidates not integrated, to check at review).
2. A line in the registry above and one in `THIRD_PARTY_LICENSES.md`.
3. If the component has upstream versions or a model catalogue, add it to `scripts-local/review_components.py`.
