# Changelog

All notable changes per released version. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (0.x: the interfaces may still change). The section of a version is used as the body
of its GitHub release (`.github/workflows/release.yml`).

## [Unreleased]

### Added

- Share button on images, diagrams, videos and sounds (tiles, viewer, audio takes): the system share sheet attaches the file itself
  (Mail, Messages, WhatsApp, X, Facebook, Instagram when installed); without it, Mail / WhatsApp / iMessage (Apple) / X open with the
  prompt as text.

### Fixed

- Sidebar wider, footer content wraps; the disk-space error separates permanent and temporary space for locally quantized models.

## [0.1.2] - 2026-10-24

### Added

- OCR tab: read the text of an image or a PDF (multi-page) with a local OCR model (GLM-OCR, PaddleOCR-VL 1.6, LightOnOCR 2,
  DeepSeek-OCR, dots.ocr, Qianfan-OCR, Qwen3-VL 2B, or any OCR GGUF found on Hugging Face), with a card of strengths and limits per
  model, tasks (text, Markdown, table, formula, chart, free instruction), export as Markdown, text or JSON, and an
  "Extract the text" button in the viewer. Unverified with a real model.
- FLUX 3 Image Klein (GGUF, up to 4 references) in the image catalogue; stable-diffusion.cpp is now pinned to master-999 (only
  Metal was run). A model may require a minimum build of the engine.
- A GGUF model that needs a newer stable-diffusion.cpp than the installed one (FLUX 3 Klein) is no longer a load error: the model
  card, the picker and the setup prompt offer "Update the engine" and download it (`engine_outdated` in the model list).
- Memory gauge in the left panel (share in use as Activity Monitor counts it on macOS, pressure, swap, models held) and an emergency
  stop button that kills the running jobs and models.
- Setting "Memory ceiling for models" (Settings → General): several models can stay loaded together (generation, chat, OCR) under one
  ceiling, 80 % of the machine by default; the least recently used idle model is unloaded when a new one does not fit.
- A generation refused for lack of free memory shows "Continue anyway" (with a confirmation): the job is retried without that check;
  the memory watchdog still stops it at critical pressure or below 0.6 GB free. Image, audio and video generations, chat replies
  (also in a private session) and OCR readings.

### Changed

- Memory protection under macOS: while the memory pressure is normal, only 1.5 GB (instead of 8 % of the RAM) has to stay free
  next to a model being loaded, so a 9-10 GB model loads on a 36 GB Mac with ≈ 11 GB free + inactive.
- The newest stable-diffusion.cpp build found wins over an older bundled one (an engine updated by the user was ignored in favour of
  the copy shipped with the app).
- Database: column `error_code` on `messages`, `chat_messages` and `ocr_documents` (new migration, existing rows unchanged), and
  the OCR tables (`ocr_documents`, `ocr_pages`).

### Fixed

- The selected period (30 d, 180 d…) of the "What's new" window was unreadable.
- Engine: English text of the diagram-model error; the OpenAPI version follows `engine/pyproject.toml`.
- Release workflow: checksum files named like the GitHub assets, a stalled `apt-get` times out.

## [0.1.1] - 2026-10-23

### Security

- The embedded Python no longer ships pip: its frozen copy (26.1.1) carried CVE-2026-8643 and CVE-2026-13346. The app never
  used it (engine packs are installed with the bundled `uv`).

## [0.1.0] - 2026-10-22

First public release.

### Added

- Image studio: text to image, image to image and instruction-based editing (Qwen Image 2.1 / Edit, Z-Image Turbo,
  Stable Diffusion XL and fine-tunes, LoRA, IP-Adapter face reference) on MLX, PyTorch and GGUF (stable-diffusion.cpp).
- Audio studio: speech synthesis, voice cloning, voice design, dialogue and transcription (Kokoro, Pocket TTS, Qwen3-TTS,
  Chatterbox, Whisper); voice library.
- Video studio: text to video, image to video and editing (Wan 2.2, LTX, HunyuanVideo 1.5, CogVideoX…). Only one real
  trial was run: the other models are unverified (see `FEATURES.md`).
- Chat with local language models (llama.cpp), creation tools (image, video, audio), optional web search, Markdown, code and
  formulas; Diagrams tab; private generation mode that keeps nothing.
- Model catalogue and Hugging Face search, download manager with a pre-install confirmation (base data, runtime engine,
  model), memory planner, update advisor.
- Desktop application (Tauri): macOS Apple Silicon `.dmg`, Windows portable `.zip` and Linux `.AppImage` built by
  `.github/workflows/release.yml`. English and French interface.
- Third-party licence texts shipped in the app (`licenses/`) and a build gate that fails on strong copyleft dependencies
  (`scripts-local/collect_licenses.py`).

### Known limitations

- Packages are not code-signed (Gatekeeper and SmartScreen warn on first launch).
- The Windows and Linux packages were never run on their own hardware; treat them as experimental.
- No real `llama-server`, chat model or browser session was used to verify chat, diagrams, private mode and the update
  advisor: they were tested against fake servers.

[0.1.1]: https://github.com/svax974/ai-medialab/releases/tag/v0.1.1
[0.1.0]: https://github.com/svax974/ai-medialab/releases/tag/v0.1.0
