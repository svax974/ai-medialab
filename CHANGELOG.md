# Changelog

All notable changes per released version. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (0.x: the interfaces may still change). The section of a version is used as the body
of its GitHub release (`.github/workflows/release.yml`).

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

[0.1.0]: https://github.com/svax974/ai-medialab/releases/tag/v0.1.0
