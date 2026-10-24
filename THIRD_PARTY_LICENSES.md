# Third-party licences

AI MediaLab is published under the MIT licence (see `LICENSE`). It redistributes no model: the
models and engines are downloaded or installed on demand, and **keep their own licence**,
which the application displays in the model selector. Check it before any commercial use.

## Engines and libraries (installed on demand)

| Component | Licence | Remark |
|---|---|---|
| stable-diffusion.cpp | MIT | GGUF engine (images, video) |
| llama.cpp (`llama-server`) | MIT | engine for the chat models (GGUF; Metal, CUDA, ROCm, Vulkan, CPU), see `docs/components/llamacpp.md` |
| audio.cpp | Apache-2.0 | GGUF audio engine (Metal, CUDA, Vulkan, CPU); its models keep their original licence, see `docs/components/audiocpp.md` |
| MLX / mflux | MIT | Apple Silicon engine |
| PyTorch, diffusers, transformers | BSD-3 / Apache-2.0 | torch engine |
| kokoro, misaki | Apache-2.0 | "speech" audio pack |
| **eSpeak-ng** | **GPL-3.0** | phonemizer of Kokoro, installed in a separate environment; to isolate or to ship with its sources if a distribution embeds it |
| pocket-tts | MIT (code) | see model below |
| qwen-tts | Apache-2.0 | "qwen3" audio pack |
| faster-whisper | MIT | transcription of reference voices |

## Embedded Python engine (`engine/pyproject.toml`)

Installed by `uv` (development) or embedded in the desktop application (`scripts-local/build_runtime.py`). Licences read from
the metadata of the packages in `engine/.venv` (installed version on 2026-10-13).

| Component | Licence | Remark |
|---|---|---|
| FastAPI, python-multipart | MIT, Apache-2.0 | internal interface `/engine/v1`; `python-multipart` is no longer used since H6 (no more file upload to the engine) |
| Uvicorn, Starlette | BSD-3-Clause | server and ASGI base |
| Pillow | MIT-CMU (HPND) | thumbnails, image decoding |
| huggingface_hub | Apache-2.0 | model download and search |
| psutil | BSD-3-Clause | memory, processes |
| NumPy, SoundFile | BSD-3-Clause | audio, arrays |
| PyAV (`av`) | BSD-3-Clause | video encoding and decoding; the PyPI wheel embeds an **FFmpeg linked to libx264 and libx265 (GPL)**: the installer does not contain it, it is downloaded on the user's machine at the first video model (`ffmpeg` pack), see `docs/components/ffmpeg.md` |
| diffusers, transformers, accelerate, peft | Apache-2.0 | torch engine (`torch` extra); `peft` loads LoRAs |
| PyTorch, torchvision | BSD-3-Clause (and licences of the embedded components, see the package) | `torch` extra |
| gguf, safetensors, sentencepiece, protobuf | MIT, Apache-2.0, Apache-2.0, BSD-3-Clause | model formats |

## Server and interface (npm: `back/package.json`, `front/package.json`)

Licences read on 2026-10-13 in `node_modules/<package>/package.json` (direct dependencies; `back/` and `front/` start from the
vx-public template, some dependencies of which are not used by ai-medialab: they are listed because they are
installed and, for the server, packaged into the desktop application).

| Component | Licence | Role in ai-medialab |
|---|---|---|
| React, React DOM | MIT | interface |
| **MUI** (`@mui/material`, `@mui/icons-material`) | MIT | components and the "darkroom" theme |
| **Emotion** (`@emotion/react`, `@emotion/styled`) | MIT | style engine of MUI |
| **TanStack Query** | MIT | data cache fed by the event stream |
| **Zustand** | MIT | local interface state |
| **Fontsource**: Hanken Grotesk, JetBrains Mono, Instrument Serif | OFL-1.1 (packages) | embedded fonts (no request to Google Fonts); the OFL licence ships with the font files |
| React Router, React Toastify | MIT | routes, notifications |
| Vite, Vitest, ESLint, typescript-eslint | MIT | tooling |
| TypeScript | Apache-2.0 | compiler |
| **NestJS** (`@nestjs/*`), RxJS, `reflect-metadata` | MIT, Apache-2.0 | application server |
| **TypeORM**, `@nestjs/typeorm` | MIT | data access |
| **better-sqlite3** | MIT | Nest's SQLite database, reading of the old database |
| `class-validator`, `class-transformer`, Helmet, compression | MIT | validation and headers |
| openapi-typescript (dev) | MIT | types of the Nest ↔ engine contract |
| Jest, ts-jest, supertest | MIT | tests |
| **react-markdown** 10 (MIT), `remark-gfm` 4 (MIT), `rehype-highlight` 7 (MIT, with `lowlight` 3), `highlight.js` 11 (BSD-3-Clause) | MIT, BSD-3-Clause | Markdown rendering of chat answers and syntax-highlighted code (`front/src/modules/chat`, loaded on demand) |
| **KaTeX** 0.16 (MIT), `remark-math` 6 (MIT), `rehype-katex` 7 (MIT) | MIT | formulas in chat answers; a chunk loaded only when an answer contains a formula; the package ships its fonts (60 files, 1.1 MB, three formats): their licence is **SIL OFL-1.1** (read on 2026-10-22 in the `name` table of the font files: Design Science / Khan Academy, reserved font name `KaTeX_*`); the package `LICENSE` (MIT) covers the code only |
| Tauri (`tauri`, `tauri-build`, `tauri-plugin-single-instance`, `@tauri-apps/cli`) | Apache-2.0 OR MIT | desktop shell (`desktop/`) |
| Template dependencies unused by the ai-medialab interface: TipTap, Chart.js, lightweight-charts, react-datepicker, html-to-image, **DOMPurify** (MPL-2.0 OR Apache-2.0), **Pyodide** (MPL-2.0) | MIT, Apache-2.0, MPL-2.0 | present in `front/package.json` (no import in ai-medialab's `front/src/`); MPL-2.0 is a weak copyleft at file level. Checked on 2026-10-22 in the built front: only DOMPurify is embedded (in the `vendor-markdown` chunk, under its Apache-2.0 option); no Pyodide, TipTap or Chart.js |
| Server: Stripe, AWS SDK S3, ioredis, pg, nodemailer, pdfkit, elliptic, bs58, prom-client, `@base-org/account` | MIT, MIT-0, Apache-2.0 | server template dependencies, not used by the ai-medialab modules |

## What the installers redistribute (checked 2026-10-22)

`scripts-local/collect_licenses.py` runs in every desktop build (`scripts-local/desktop-prepare.sh`). It scans the Python packages of the
embedded engine and the production dependencies of `back/` (from `back/package-lock.json`), **fails the build on a strong copyleft
licence (GPL, AGPL, SSPL)**, and writes their licence texts, plus `LICENSE` and this file, to the `licenses/` folder of the app.
Result on the macOS bundle: 36 Python packages and 525 npm packages, all permissive (MIT, BSD, ISC, Apache-2.0, PSF, MIT-CMU,
0BSD, BlueOak), with these notes:

| Item | Licence | Note |
|---|---|---|
| `tqdm` (Python) | MPL-2.0 AND MIT | weak copyleft, file level; shipped unmodified |
| DOMPurify (front) | MPL-2.0 OR Apache-2.0 | used under Apache-2.0 |
| `png-js`, `busboy`, `streamsearch` (npm) | no `license` field | each ships a `LICENSE` file (MIT text), copied to `licenses/npm/` |
| Node.js runtime, Python interpreter (python-build-standalone) | MIT and bundled notices; PSF-2.0 | texts in `licenses/node/` and `licenses/python/` |
| stable-diffusion.cpp, ggml (Metal/Vulkan builds) | MIT | licence files sit next to the binaries in `engines/sdcpp/` |
| `uv` | MIT OR Apache-2.0 | used by the app to build the on-demand environments |
| Fontsource fonts, KaTeX fonts | OFL-1.1 | embedded; the licence texts accompany the packages |

**Not redistributed** (installed on the user's machine on demand, so outside the installers): PyTorch, MLX, diffusers, the audio packs,
**eSpeak-ng (GPL-3.0)**, the PyAV wheel with its **GPL FFmpeg**, llama.cpp, audio.cpp and every model. The app never links to them
at build time; the user's machine downloads them from their own publishers.

The Windows and Linux installers are assembled by the same chain; their npm and Python sets differ only by platform binaries.
The scan runs again on each of them in CI and fails on a strong copyleft licence.

## Models (downloaded from Hugging Face)

| Model | Licence |
|---|---|
| Kokoro 82M | Apache-2.0 |
| Pocket TTS (Kyutai) | CC-BY-4.0 (attribution required) |
| Qwen3-TTS (0.6B / 1.7B), including the GGUF conversions of audio.cpp | Apache-2.0 |
| Chatterbox (Resemble AI), GGUF conversion of audio.cpp | MIT (the original implementation watermarks its outputs, not the audio.cpp port) |
| Whisper (small, large-v3-turbo) | MIT |
| LoRA Pixel Art XL, Pixel Art Redmond; RealVisXL V5, Juggernaut XL v9 (and SDXL itself) | CreativeML Open RAIL-M / RAIL++-M (commercial use permitted with the usage restrictions of the licence) |
| DreamShaper XL Turbo, Animagine XL 4.0 | CreativeML Open RAIL++-M |
| IP-Adapter "plus face" SDXL and its ViT-H encoder (`h94/IP-Adapter`) | Apache-2.0 |
| Chat models: Qwen3 1.7B, Qwen3 4B Instruct 2507, Qwen3 8B, Qwen3.8 27B; Gemma 4 (E4B, 12B, 26B A4B); Ministral 3 8B; gpt-oss 20B | Apache-2.0 (licences read in the metadata of the Hugging Face repositories on 2026-10-15) |
| Chat models: LFM 2.5 1.2B and 8B A1B (Liquid AI) | LFM Open License v1.0: free commercial use under USD 10 million annual revenue (threshold read in the `LICENSE` file of the repository; the details of section 5 have not been re-read) |
| Chat models added from Hugging Face | that of the repository, read when added and displayed in the selector |
| OCR models: GLM-OCR (Z.ai), dots.ocr (Rednote), DeepSeek-OCR | MIT (licences read in the metadata of the Hugging Face repositories of the models on 2026-10-24; GGUF conversions by ggml-org) |
| OCR models: PaddleOCR-VL 1.6 (Baidu, official GGUF), LightOnOCR 2 1B (LightOn), Qianfan-OCR (Baidu), Qwen3-VL 2B (Qwen) | Apache-2.0 (same source and date) |
| pypdfium2 (PDF page rendering of the OCR tab), with PDFium | BSD-3-Clause / Apache-2.0 |
| FLUX 3 Image Klein (Black Forest Labs), GGUF conversion by AtomicChat | FLUX Kommunity License (text read in the `LICENSE.md` of the repository on 2026-10-24): non-commercial use, or commercial use of the outputs under US$5M of annual revenue with a content filter or a review of the outputs; the weights are downloaded by the user, not redistributed; its Qwen3-VL-4B-Instruct text encoder is Apache-2.0 |
| Image models | variable: see the licence indicated per model (some are non-commercial, e.g. Qwen Image 2.1 "Research") |

This document is informative and does not constitute legal advice.

*Last verified against source: 2026-10-22 (macOS bundle, `scripts-local/collect_licenses.py`; npm and Python sets of the other platforms: to be re-read from the CI logs of the first release).*
