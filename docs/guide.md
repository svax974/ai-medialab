# AI MediaLab — developer and model guide

> Launch (development and desktop), tests, the per-model user guide (image, audio, video, chat), measurements and limits.
> The project overview and the downloads are in the root [README](../README.md).

Local studio for creating images, audio (speech synthesis, voice cloning) and video (generation and editing), in the form of a chat. Open models run on the
machine — Metal (Apple Silicon), NVIDIA (CUDA) or AMD (ROCm) — with no external service. The application embeds the
inference server and the model download manager (Hugging Face).

Three studios (image, audio, video) and a **Chat** with local language models share conversations, the queue, downloads and memory, and a **Private generation** mode keeps nothing. The inventory of what is built is in [FEATURES.md](../FEATURES.md), the shape of the application (processes, contract, flows, data) in
[ARCHITECTURE.md](../ARCHITECTURE.md), which also holds the map of all the documentation.

## Getting started (development)

The application is built on the vx-public template: a **NestJS** server (`back/`), a **React + MUI** interface (`front/`)
and the **Python engine** (`engine/`) that runs the models. A single launcher starts all three:

```sh
git submodule update --init                # template submodules (once)
(cd back && npm install) && (cd front && npm install)
./scripts/run.sh dev                       # Nest (3000) + Vite (5173) + engine (127.0.0.1:8000), Ctrl+C stops everything
```

Then http://localhost:5173. `scripts/` is the template link to `front/.libs/apptemplate/scripts`; the engine is started by the
hook `scripts-local/dev-services.sh` (log: `logs/dev-services.log`). Prerequisites: Node.js ≥ 22, [uv](https://docs.astral.sh/uv/); the
first launch installs the Python dependencies in `engine/.venv` (MLX and PyTorch on Apple Silicon Mac). For a standalone application
(no prerequisites), see "Desktop application" below.

Variables in `back/.env.dev` (not versioned; template: `back/.env.example`, section "ai-medialab"):

| Variable | Role |
|---|---|
| `ENGINE_TOKEN` | Shared secret between Nest and the engine (`openssl rand -hex 32`), required for the hook. The engine requires the `X-Engine-Token` header on all `/engine/v1/*` routes except `/engine/v1/status`; not set on the engine side alone: no check |
| `ENGINE_PORT` | Engine port on `127.0.0.1` (default 8000); Nest calls it at `ENGINE_URL` (default: this port) |
| `APP_DATA_DIR` | Common data folder (`<repo>/data` by default in development). The engine reads it as `IMAGEGEN_DATA_DIR`, set by `dev-services.sh` |
| `DB_PATH` | Nest database (`app.db`, relative to `APP_DATA_DIR`) |
| `IMAGEGEN_DEMO=1` | Adds an instant `Démo` (Demo) model, no GPU, to test the interface (put it in `back/.env.dev`) |
| `HF_HOME` / `HF_HUB_CACHE` | Model location (default `~/.cache/huggingface/hub`, shared with mflux/diffusers) |
| `ENGINE_RELOAD=0` | Disables automatic engine reloading |
| `LEGACY_IMPORT=false` | Disables importing the old database at Nest startup |

Without the launcher: `cd back && npm run start:dev`, `cd front && npm run dev` and `ENGINE_TOKEN=… scripts-local/dev-services.sh`.
Variables specific to the engine and to Nest are described in the README of their modules (`back/src/modules/engine/README.md`).

**Existing data.** An installation from before the migration (old database `ai-medialab.db`, old desktop folder) is picked up
automatically on first start; nothing is deleted: see `ARCHITECTURE.md`, section "Data and migrations".

## Tests

Critical rule: **one test file at a time**, never the full suite, never a real model (an overflow of unified memory has already
restarted the Mac: on macOS an overflow does not slow the machine down, it crashes it, and `ulimit -v` does not protect). Every heavy command goes through the memory guard
`scripts-local/guarded_run.sh <cap_GB> <command>` (recommended cap: 3 GB, 5 GB for a build).

```sh
cd engine && .venv/bin/python -m pytest -q -x -p no:cacheprovider tests/test_core.py      # one file at a time (none loads a model)
cd back   && npx jest --runInBand src/modules/engine/services/EngineClient.spec.ts         # one file at a time
cd back   && npx tsc --noEmit -p tsconfig.json && npm run build                             # types and compilation
cd front  && npx tsc -p tsconfig.app.json && npx vitest run <fichier.spec.ts>              # types, one Vitest file at a time
cd front  && npm run i18n:check && npx eslint src                                          # fr/en locales, lint
```

End-to-end without a model: `back/src/modules/studio-core/e2e/studioEngine.e2e.spec.ts` starts the engine as a subprocess in
demonstration mode (`IMAGEGEN_DEMO=1`) and a full generation (recommended cap: 2 GB). Real image, audio and video models are
never launched by the tests.

## First launch: nothing to find or compile

Nothing is downloaded until you choose a model. On the first selection of a model that needs something, a confirmation window
lists what will be downloaded, with the size of each line and the total: the **Base data** (items shared by several engines:
PyTorch, FFmpeg), the **Runtime engine** (stable-diffusion.cpp, llama.cpp, audio.cpp or a Python pack) and the **Model**. On
confirmation everything installs in one go, with progress and a cancel option (which deletes whatever is not fully downloaded).
What is already installed is never downloaded again: a shared component is fetched only once, by the first model that needs it.
`Réglages > Moteurs` and `Réglages > Modèles` (Settings > Engines and Settings > Models) show the status of each item and let you
delete it (deleting an engine also deletes the installed models that depend on it, after a named confirmation).
The items are:

- **GGUF engine**: if the stable-diffusion.cpp build suited to your GPU is not present, the application downloads it from the
  official release (CUDA on NVIDIA, ROCm on AMD, Metal on Apple, Vulkan otherwise; ≈ 30 MB to 0.9 GB), verifies its SHA-256
  checksum, installs it in `<data>/engines/` (without administrator rights) and checks that it sees a GPU — otherwise it tries
  the next one (fallback to Vulkan).
- **PyTorch + diffusers (and MLX on Mac)**: they are not in the installer. The `torch` pack (`audio_packs.PACKS['torch']`) installs
  them on first need into `<data>/engines/runtime/torch/`: a Python environment built on the embedded interpreter with `uv` (also
  embedded), CUDA / ROCm / Metal wheels chosen according to the GPU (≈ 1.7 GB on Mac, ≈ 4.5 GB elsewhere). Only the generation
  worker loads them; the server never imports them. GGUF models (stable-diffusion.cpp) and the chat (llama.cpp) work without this pack.
- **FFmpeg**: PyAV, required by every video model (reading uploaded videos, thumbnails, writing the MP4). It is not in the
  installer (its PyPI wheel embeds GPL libraries, see `docs/components/ffmpeg.md`): the `ffmpeg` pack downloads it to your machine
  with the first video model (≈ 50 MB).
- **Model**: the home screen recommends the model best suited to the machine and installs it with the engine (`Tout installer`
  (Install all)); the model selector and the `Modèles` (Models) window offer the download wherever a model is missing.
- **Disk space and memory**: checked before any download; models that do not fit are flagged with the reason.

The default profiles of packaged versions only include what is strictly necessary: the interpreter, the server libraries, `uv`
and, for stable-diffusion.cpp, Metal on Mac or Vulkan elsewhere (`scripts-local/publish.sh` excludes the CUDA and ROCm variants,
`DESKTOP_SKIP_SDCPP_VARIANTS`). Everything else is downloaded on demand, on first need for a model. The profiles `win-cuda`,
`win-rocm`, `linux-cuda`, `linux-rocm` and `mac-arm64-full` keep PyTorch embedded (offline from installation).

## Engines and models

Three inference engines, chosen according to the machine and the model:

| Engine | Hardware | Note |
|---|---|---|
| **MLX** (mflux) | Apple Silicon (native Metal) | 4/6/8-bit quantized models: the most memory-efficient on Mac |
| **PyTorch + diffusers** | NVIDIA (CUDA), AMD (ROCm), Apple (MPS) | Full-precision bf16; automatic CPU offloading if VRAM is insufficient |
| **GGUF** ([stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)) | Apple (Metal), NVIDIA (CUDA), AMD (ROCm), any Vulkan GPU (NVIDIA, AMD, Intel) | Quantized weights: 3 to 5 times less memory than PyTorch; binary of 30 to 340 MB, without PyTorch |

The GGUF engine drives the `sd-cli` program (one process per generation: immediate cancellation, memory fully released). The
backend is chosen from the detected GPU — CUDA on NVIDIA, ROCm on AMD, Metal on Apple, Vulkan otherwise
(`IMAGEGEN_SDCPP_VARIANT=vulkan` forces a backend, useful for comparing speeds). Official binaries are fetched with
`python3 scripts-local/fetch_sdcpp.py --variant metal|vulkan|cuda|rocm [--os windows|linux]` (SHA-256 checksum verified) into
`engines/sdcpp/<variant>/`; the desktop application embeds them.

| Model | Engine | Usage | References | Download |
|---|---|---|---|---|
| **Qwen Image 2.1** | MLX | Text → image, img2img | 1 starting image | 9.6 GB (4 bits) or 24 GB (8 bits) |
| **Qwen Image 2.1** | **GGUF** | Text → image, **editing** by instruction | up to 4 images | **11 GB** |
| **Qwen Image 2.1** | PyTorch | Text → image, **editing**, RGBA | up to 10 images | 33 GB (32 GB of bf16 weights) |
| **Z-Image Turbo** (Apache 2.0) | **GGUF** | Fast text → image (8 steps) | — | **6.7 GB** |
| **Z-Image Turbo** (Apache 2.0) | PyTorch | same, full precision | — | 33 GB |
| **FLUX 3 Image Klein** (FLUX Kommunity) | **GGUF** | Text → image (16 steps), editing by description | up to 4 images | **7.3 GB** |
| **Stable Diffusion XL** | PyTorch | Text → image, img2img; fits on 8 GB | 1 starting image | 6.5 GB |
| **Pixel Art XL**, **Pixel Art Redmond** (LoRA on SDXL) | PyTorch | Pixel art, `Pixels nets` (sharp pixels) | 1 starting image | SDXL + 0.16 GB |
| **Pixel Art XL · Visage** (LoRA + IP-Adapter on SDXL) | PyTorch | Pixel art portrait from a photo | face + optional starting image | SDXL + 3.3 GB |
| **RealVisXL V5**, **Juggernaut XL v9** (fine-tuned SDXL) | PyTorch | Photorealism | 1 starting image | 6.5 GB each |
| **DreamShaper XL Turbo** (fine-tuned SDXL) | PyTorch | Illustration, fantasy, 6 steps | 1 starting image | 6.5 GB |
| **Animagine XL 4.0** (fine-tuned SDXL) | PyTorch | Anime, manga (tag-style prompt) | 1 starting image | 6.5 GB |
| **Qwen Image Edit** (Apache 2.0) | **GGUF** | Editing by instruction, composition | 1 to 3 images | **19 GB** |
| **Qwen Image Edit** | MLX | Editing by instruction | 1 to 3 images | 58 GB |

Measured on an M3 Max (36 GB) with Metal, Q4_K weights: Z-Image Turbo, 3.2 s per step at 512×512 (45 s per 560×560 image,
loading included); Qwen Image 2.1, 5.8 s per step at 576×576 (129 s for 20 steps, text rendered correctly in the image) and 149 s
when editing with guidance 1 — which does not follow the instruction well: the application therefore applies a guidance of 4 when
editing (338 s, instruction followed). No Vulkan/CUDA/ROCm measurement could be made here.

FLUX 3 Image Klein GGUF (AD-Q5_K + Qwen3-VL 4B encoder AD-Q4_K, Metal, 512×512, 16 steps, CFG 1, measured on 2026-10-24 on the
same M3 Max with `master-999`): 49 s of sampling (≈ 3 s per step), 61 s per image in all, peak 7.3 GB. Editing with one reference:
103 to 179 s on three runs (6 to 11 s per step), peak 7.6 to 8.0 GB. Following the instruction is uneven (three tests, one seed
each): a short instruction ("the same fox, now in a desert") returned the reference almost unchanged; a caption describing the whole
final scene replaced the background and kept the subject (fox in a desert); the same kind of caption for a cat moved to a red sofa
changed only a corner of the picture. Creation needs a full-scene caption too (a short prompt gives a generic picture), so the
composers' ✨ button is the way to write prompts for this model. Needs stable-diffusion.cpp `master-968` or newer (`master-956`
fails at load with `get sd version from file failed`); FlashAttention, 1024×1024 and more than one reference were not measured.
Licence (read in the `LICENSE.md` of the GGUF repository): commercial use of the images only under US$5M of annual revenue (affiliates
included), with a content filter or a review of the outputs; military, surveillance and biometric uses are prohibited. The
application downloads the files from Hugging Face on the user's machine and redistributes nothing.

Qwen Image Edit GGUF (Q4_K_M, Metal, 576×576): 935 s in 20 steps, **479 s in 12 steps** (equivalent quality, default value), i.e.
about 40 s per step — 3 to 4 times slower than Qwen Image 2.1 (a 20-billion-parameter model versus 7). Memory: ≈ 18 GB for
`sd-cli`, when editing with one or two references; do not run another heavy computation in parallel on a 36 GB machine. With two
references (384×384, 12 steps: ≈ 320 s), the model reads both images well (it faithfully reproduces the second one on request), but
a composition instruction ("add the lighthouse from image 2 into image 1") did not succeed in my test with this definition: to be
validated with more steps.

**Specialized SDXL models (added 2026-10-14, unverified: no real generation done).** Fine-tuned models download only their diffusers
components in fp16 (never the large single file placed alongside) and use the scheduler recommended by their authors (DPM++ 2M
Karras for RealVisXL and Juggernaut, Euler a for Animagine). A **LoRA** is a small file (≈ 160 MB) applied to Stable Diffusion XL,
downloaded once for all LoRAs; its `Force du style` (Style strength) is adjustable (0 = SDXL alone, 1 = value intended by the
author), and its trigger words ("pixel art"…) are added to the prompt when it does not contain them. Pixel art LoRAs have the
**`Pixels nets`** (Sharp pixels) option (checked by default): the image is reduced 8 times then enlarged without smoothing, which
places it on a true pixel grid, as recommended by the authors of Pixel Art XL. Stable Diffusion 1.5 pixel art models
(All-In-One-Pixel-Model, SD_PixelArt_SpriteSheet_Generator) are not offered: they only exist in the `.ckpt` / `.bin` formats, which
can execute code on loading, whereas the application only accepts the safetensors format. Other SDXL LoRAs can be added through
the Hugging Face search (family "LoRA SDXL"). **Pixel Art XL · Visage** adds the "plus face" IP-Adapter from `h94/IP-Adapter`
(Apache 2.0, ≈ 3 GB with its image encoder): image 1 provides the face to follow (`Ressemblance du visage` (Face likeness), 0.6 by
default), image 2, optional, serves as the starting image and gives the format. Likeness is not guaranteed. With a starting image,
that image is resized to the requested size before being redrawn (same rule for all PyTorch models that start from an image).

Only repositories without restricted access are offered (no Hugging Face account required; an optional token is entered in
`Modèles` (Models)). Each model shows whether it is installed, incomplete or incompatible with the machine (memory planner:
everything on the GPU, components loaded one by one, layer by layer, or refusal with an explanation). The Hugging Face search
applies the same engine rule: results that the machine cannot run (for example a PyTorch model without a CUDA, ROCm or Metal GPU)
are listed after the others, marked `incompatible avec cette machine` (incompatible with this machine), with the reason, and
cannot be added. When opening a result, each variant (quantization) is also tested against the machine's memory, with the same
rule as the models in the list: those that do not fit are struck through with the numbers, the preselection is a variant that
fits, and the server refuses to add a variant that does not fit.

Only one model is loaded at a time; it stays in memory between two generations, then is unloaded after an adjustable delay
(`Réglages → Mémoire` (Settings → Memory)) or on demand (indicator at the bottom of the sidebar).

**Memory saving (MLX, enabled by default).** The text encoder of Qwen Image 2.1 (≈ 15 GB) is loaded only while encoding the prompt,
then released; VAE decoding is done in tiles. Measured on a 36 GB Mac: ≈ 9 GB resident (transient peak ≈ 24 GB while encoding a new
prompt), versus ≈ 31 GB without these measures — which makes the machine swap. It can be disabled in Settings on a machine with a
lot of memory.

### Adding a model

- **Diffusers model** (the most common): add a `ModelSpec` in `engine/app/engines/torch_models.py` — Hugging Face repository,
  file patterns to download, pipeline class, exposed parameters. No engine code to write: unknown pipeline arguments are ignored.
- **Other engine**: an `Engine` class (`load()` + `generate()`) in `engine/app/engines/`, see `qwen21.py` for MLX. Then register it
  in `engine/app/engines/__init__.py`.

The interface adapts on its own: selector, sliders, rules on reference images, installation status.

## Audio: speech synthesis, cloning, scenarios

The **Image / Audio** switch (top of the left panel) toggles the application between the two studios; conversations, downloads,
queue and memory are shared (only one model loaded at a time).

- **Voices**: built-in voices per model, **cloning** from a recording (browser microphone or file), **voice creation from a
  description** (Qwen3-TTS VoiceDesign). Voices are kept in *Mes voix* (My voices); any generated take can be added to them
  (`Garder comme voix de référence` (Keep as reference voice)).
- **Automatic transcription** (Whisper, optional) of the reference clip: it improves cloning fidelity.
- **Scenarios**: `Alice : …` / `Marc : …` — each character gets its voice, assembly with clickable markers on the waveform.
- **Long texts** split by sentences (progress per chunk), several takes (seeds) per request, player with waveform, speed,
  favorites, WAV export.

| Model | Cloning | Languages | Weights | License | Verified (M3 Max) |
|---|---|---|---|---|---|
| Kokoro 82M | no (54 voices) | fr, en, es, it, pt | 0.4 GB | Apache-2.0 | yes, ≈ 4× real time on CPU |
| Pocket TTS (FR/EN, + DE/ES/IT/PT/NL) | yes | 7 | 0.6 / 1.5 GB | CC-BY-4.0 | yes, ≈ 7× real time on CPU |
| Qwen3-TTS Voice & style 1.7B / 0.6B | no (9 voices + style instruction) | 10 | 4.5 / 2.5 GB | Apache-2.0 | 0.6B yes (MPS, bfloat16) |
| Qwen3-TTS Voice creation 1.7B | described voice | 10 | 4.5 GB | Apache-2.0 | yes |
| Qwen3-TTS Cloning 1.7B / 0.6B | yes | 10 | 4.5 / 2.5 GB | Apache-2.0 | 0.6B yes |
| Whisper Small / Large v3 Turbo | — (transcription) | multi | 0.5 / 1.6 GB | MIT | Small yes (Metal via mlx-whisper on Mac; faster-whisper on CPU elsewhere) |

Outputs were verified by transcribing them back with Whisper. Not tested: CUDA / ROCm / Vulkan for audio (PyTorch installations
target `cu128` / `rocm6.4` / CPU, never run here), Windows and Linux.

**Engine packs.** Audio libraries pin mutually incompatible versions (Qwen3-TTS requires `transformers==4.57.3`, the image engine
`>=5.17`). Each family therefore runs in its **own Python environment**, created on demand from the application (`uv` if present,
otherwise `venv` + `pip` on Python 3.12) under `<data>/engines/audio/<pack>/`, and driven by `engine/audio_runtime/worker.py`
(line-by-line JSON protocol). Adding a model = a class in `audio_runtime/engines/` + a spec in `app/engines/audio_specs.py` (+ a
pack if the dependencies differ).
**Native audio.cpp pack.** A pack can also be a precompiled program without Python: `audiocpp` installs the build of audio.cpp
suited to the machine (Metal, CUDA, Vulkan or CPU, verified by checksum) and runs GGUF models on **any GPU**, including AMD and
Intel. The corresponding models are displayed next to their PyTorch equivalents. Details, measurements, limits and candidates:
`docs/components/audiocpp.md`. The registry of all third-party components and the periodic review procedure are in
`docs/components/README.md`.

Pitfall encountered: eSpeak-ng (Kokoro's phonemizer) truncates its data path at 160 characters; the engine copies the data under a
short path when the venv is deep.

## Video: generation and editing

The **Image / Audio / Video** switch opens the video studio, built like the image studio: conversations, queue, progress and
cancellation, gallery, downloads and memory shared (only one model loaded at a time).

- **Compose**: prompt, starting image (and ending image for models that support it), source video to edit, duration, format,
  definition, steps, seed, number of clips (1–2). The number of frames is rounded to what the model accepts.
- **Results**: built-in player (with sound when the model produces it), vary, rerun, reuse settings, use a clip as the source
  video, **last frame as start** to chain a shot, favorites, MP4 download.
- **Hugging Face models**: the model manager's search also offers video repositories in diffusers format (Wan, CogVideoX,
  HunyuanVideo 1.5, LTX-2) and the GGUF quantizations of Wan 2.2 TI2V 5B.

| Model | Specialty | Engine | Download | License |
|---|---|---|---|---|
| **Wan 2.2 TI2V 5B** | Versatile, the best open quality (text → video, image → video) | **GGUF** (Metal, CUDA, ROCm, Vulkan) or PyTorch | 8.5 GB (Q4_K_M) / 34 GB (PyTorch) | Apache 2.0 |
| **Wan 2.2 14B** (T2V, I2V) | Maximum quality, start and end at choice (I2V); slow | GGUF (two experts) | 21 GB (Q4_K_S) | Apache 2.0 |
| **LTX-2.3 Distilled 1.1** | Fast, high definition, synchronized sound | GGUF | 24.5 GB (Q4_K_S; Q3_K_M: 22 GB) | LTX-2 license (free under $10M in annual revenue) |
| **LTX-2.5 Distilled** | Latest version of LTX: Gemma 4 encoder, synchronized sound | GGUF | 25.5 GB | LTX-2 license; **restricted-access repositories** (Hugging Face token required) |
| **HunyuanVideo 1.5** (T2V, I2V) | Careful realism and motion, 480p | GGUF or PyTorch | 12.7 GB (Q4_K_M) | Tencent Hunyuan: **excluded in the EU, the UK and South Korea** (warning in the interface) |
| **CogVideoX 2B** (5B, 5B I2V) | Lightweight, short 480p clips | PyTorch | 14 GB (5B: 22 GB) | Apache 2.0 (5B: CogVideoX license) |
| **Kiwi-Edit 5B** | Instruction-based video editing (+ reference image) | isolated pack, NVIDIA | 20 GB | MIT (code); weights with no declared license |
| **Bernini-R 1.3B** | Video generation and editing (render only, no scheduler) | isolated pack, NVIDIA | 29 GB | Apache 2.0 |

Each model is taken in its **latest open version** (checked on 12/10/2026): no open Wan 2.5+, LTX-2.5 is the most recent of its
family (LTX-2.3 `distilled-1.1` remains available without an account), full Bernini v2 (scheduler + render, ≈ 48 GB even in int4)
is too heavy, so we keep the render-only version.

**Engines.** Video preferably goes through the **GGUF** engine (`sd-cli -M vid_gen`, stable-diffusion.cpp, pinned version
`master-999`), hence on Metal, CUDA, ROCm and Vulkan with 4-bit quantized weights; `sd-cli` does not produce MP4, so the
application converts its output (and LTX's sound) into MP4 H.264 + AAC with FFmpeg (PyAV; on Mac, the VideoToolbox hardware
encoder; build and license: `docs/components/ffmpeg.md`). On Mac, an `sd-cli` build older than `master-745` is refused (Wan did
not work on it). PyTorch + diffusers versions remain as an alternative (CogVideoX exists only there). **Kiwi-Edit and Bernini** need
the official code and pinned dependencies: they run in an **isolated Python environment** ("pack", created on demand in
`<data>/engines/video/`) and require an NVIDIA card (or AMD on Linux); otherwise they are listed as incompatible, with the reason.

The memory planner refuses a model that does not fit (on Mac, GPU and CPU share the same memory: no "free" offloading). On a 36 GB
machine: Wan 5B (Q4 or Q8), HunyuanVideo 1.5 480p and CogVideoX pass; Wan 14B, LTX and LTX-2.5 require 48 GB or more (LTX-2.3 in
Q3_K_M just barely passes).

**Measured on an M3 Max (36 GB), the only real test to date**: Wan 2.2 TI2V 5B Q4_K_M via `sd-cli` (Metal), text → video, 480×832.
9 frames, 20 steps: sampling ≈ 6 s per step, 7 GB resident memory, valid H.264 MP4, coherent image. 33 frames: ≈ 20 s per step and
free system memory dropped below 6 GB (test interrupted by the safeguard); a single pass is therefore limited to 1 s on this model.
**Long clips (up to 20 s)**: the GGUF image → video models (Wan 2.2 5B, Wan 2.2 I2V 14B, HunyuanVideo 1.5 I2V) chain passes one after
the other, each starting from the last frame of the previous one. The length of a pass is not fixed in advance: it follows the
memory **measured on the machine** (the first attempt with a model starts with a short pass of 9 frames, then the following ones
grow according to the memory actually consumed, up to the model's 5 s; see `ARCHITECTURE.md`, "Memory safety nets"). Memory stays
that of a single pass, the time is multiplied and the motion may change from one slice to another.
**Not measured on real hardware**: this chaining has only been tested with a fake `sd-cli`, and the prior (≈ 8 GB for 9 frames of
Wan 5B at 480p) comes from a single real test. Text → video only models (Wan T2V 14B, HunyuanVideo T2V) and LTX (with sound) remain at
their original duration. At 384×256 the model produces only abstract noise: nothing below 480p is offered.
Full VAE decoding is the bottleneck on Metal (150 to 170 s even for 9 frames, tiling has no effect): the **`Décodage rapide`**
(Fast decoding) option (TAEHV, 23 MB downloaded on first use, verified by SHA-256, enabled by default on Mac) brings it below one second.

**Unverified.** Everything else has never really run: image → video, Wan 14B, LTX, HunyuanVideo, CogVideoX, both packs, the
demuxing of the `.webm` produced by `sd-cli`. They rest on reading the upstream code and on tests with a fake `sd-cli`. Sizes come
from the Hugging Face API; memory requirements are estimated. Specific points: LTX's "distilled" settings (8 steps, diffusers sigmas)
are an inference; the Gemma 4 GGUF of LTX-2.5 is not confirmed loadable by `sd-cli` (otherwise convert it with `sd-cli -M convert`);
HunyuanVideo's I2V is not documented on the `sd-cli` side; the effect of `--offload-to-cpu` on Metal is unknown
(`IMAGEGEN_SDCPP_OFFLOAD=on|off`). LTX-2.3 in PyTorch uses the bf16 copy of Gemma 3 `Lightricks/gemma-3-12b-it-qat-q4_0-unquantized`
(same 1065 tensors, sampled values identical). The packs were reviewed against the upstream code (estimated confidence: Kiwi-Edit
≈ 75%, Bernini ≈ 65%).

**To try for real, from smallest to largest** (watch memory pressure at each step): Wan 5B image → video (text → video is done);
Wan 5B at 720p; HunyuanVideo 480p; LTX-2.3 Q3_K_M; on 48 GB or more only, Wan 14B and LTX-2.5.

## Chat: local language models

The Chat runs on **llama.cpp** (`llama-server`, GGUF models), installed on demand from the `Moteurs` (Engines) screen: an
invitation appears at launch as long as it is missing (checkbox `Ne plus me le proposer` (Don't offer it again), reminded in
Settings). The catalog offers 11 models from 0.7 to 17.7 GB (Qwen3 1.7B, 4B Instruct and 8B, LFM2.5 1.2B and 8B-A1B, Ministral 3 8B,
Gemma 4 E4B, 12B and 26B-A4B, gpt-oss-20b, Qwen3.8 27B), including vision, reasoning and MoE models; sizes and licenses measured on
Hugging Face on 2026-10-15, and any GGUF repository can be added from the "LLM" search. The recommended model for small tasks
(update analysis, prompt improvement) is Qwen3 4B Instruct (2.33 GB).

- **Memory**: only one model at a time for the whole application: launching an image, audio or video generation unloads the chat
  model, and vice versa; the default context is 16,384 tokens, and changing it **reloads the model**; the in-memory prompt cache is
  capped at 1 GB.
- **Web search** (optional, per conversation): DuckDuckGo with no key, or Brave Search with a key entered in Settings (stored
  encrypted, never returned). Queries then leave the machine; internal addresses are refused.
- **Private generation**: padlock button in the sidebar. No conversation, result or prompt is kept (neither database, nor files
  outside a session folder erased on exit, nor logs, nor drafts); not covered: the OS virtual memory, backups, secure erasure of an
  SSD, screenshots, files you save yourself, and the text of `audio.cpp` still passed on the command line.
- **Updates**: `Vérifier les mises à jour` (Check for updates) compares installed engines and models; a small local model can
  summarize release notes and discussions (GitHub, Hugging Face) to flag possible regressions: advisory opinion, never blocking,
  recorded and to be verified.
- **Not verified**: no real `llama-server` or chat model has been launched; the described behavior was tested with fake servers.
  The first real test will confirm server startup, streaming and GPU detection.

## Repository structure

```
engine/     Python engine (FastAPI): models, downloads, jobs, media; openapi.json = contract with Nest (generated)
back/       NestJS server (vx-public template, SQLite, local trust mode): modules `engine`, `studio-core`, `media-library`,
            `audio-studio`, `settings`, `hardware`, `model-catalog`, `engines`, `legacy-import`
front/      React + MUI interface (vx-public template): modules `studio-shell`, `studio-core`, `image-studio`, `audio-studio`, `voices`,
            `video-studio`, `media-library`, `model-catalog`, `engines`, `settings`, `hardware`; theme `chambre-noire`
desktop/    desktop application (Tauri shell of the template)
scripts/    link to the template scripts (launcher `run.sh`); scripts-local/: project-specific scripts (engine dev hook,
            engine packaging, OpenAPI export, component review, stable-diffusion.cpp retrieval)
docs/       components/ (third-party component registry), (no migration notes: kept local)
data/       development data folder (created at startup, not versioned)
```

The template submodules (`back/.libs/vx-public`, `front/.libs/vx-public`, `front/.libs/apptemplate`) must be initialized after a
clone (`git submodule update --init`). The engine plan, the Nest ↔ engine contract (regenerating `engine/openapi.json` and the types:
`engine/.venv/bin/python scripts-local/export_engine_openapi.py` then `cd back && npm run engine:types`) and the event flow are in
[ARCHITECTURE.md](../ARCHITECTURE.md). Working rules (unified memory, guarded commands): section "Tests" above.

## Desktop application

Standalone application: [Tauri](https://tauri.app) v2 shell **of the template** (`desktop/`, documented in `desktop/README.md`),
which supervises **two processes**: the Python engine (side process `engine`, interpreter and dependencies **embedded**) and the
Nest server (embedded Node), which also serves the front. No installation of Python, Node or uv is needed to use it; dark theme
interface.

Everything specific to ai-medialab lives in `desktop/desktop.config.json`:

| Process | Command | Health | Variables |
|---|---|---|---|
| `engine` (started **before** Nest) | `engine-runtime/python`: `-m uvicorn app.main:app --host 127.0.0.1 --port {port}` | `/engine/v1/status` (240 s max) | `ENGINE_TOKEN` (launch token), `IMAGEGEN_DATA_DIR={dataDir}`, `IMAGEGEN_ENGINES_DIR={resources}/engines`, `IMAGEGEN_LEGACY_DATA_DIRS`, `PYTHONPATH` |
| `server` (Nest) | `runtime/node/node dist/main.js` | `/api/v1/health` | `ENGINE_URL=http://127.0.0.1:{port:engine}`, `ENGINE_TOKEN` (same value), then everything the shell injects (`APP_DATA_DIR`, `DB_PATH=<data>/app.db`, `SERVE_FRONT_DIR`, `LOCAL_TRUST`, etc.) |

The shell shows the waiting page (dark "chambre noire" theme: `desktop/splash/`), allocates two free ports, generates the token,
starts the engine, waits for `/engine/v1/status`, starts Nest, waits for its health (which includes that of the engine), then
navigates to `http://127.0.0.1:<port>/`. On closing it stops both groups of processes (engine, generation worker, Nest); a sentinel
also stops them if the shell dies abruptly.

Runtime profiles (one installer = one profile; the PyTorch build depends on the GPU), in `desktop/runtime/profiles.json`:

| Profile | Target | Status |
|---|---|---|
| `mac-arm64` | macOS Apple Silicon, Metal: lightweight runtime (≈ 0.3 GB), PyTorch and MLX as an on-demand pack | runtime built and its startup verified (2026-10-16); real `torch` pack **not installed here** |
| `mac-arm64-full` | macOS Apple Silicon — Metal (MLX) and PyTorch/MPS embedded (≈ 1.5 GB) | assembled and tested with the old shell; **the template shell chain has not been rebuilt** |
| `win-universal` | Windows, all GPUs: lightweight runtime, GGUF (CUDA, ROCm, Vulkan), PyTorch as a pack | scripted, **not verified** |
| `linux-universal` | Linux, all GPUs: same principle | scripted, **not verified** |
| `win-cuda` | Windows + NVIDIA (CUDA 12.8), PyTorch embedded | scripted, **not verified** |
| `linux-cuda` | Linux + NVIDIA (CUDA 12.8) | scripted, **not verified** |
| `linux-rocm` | Linux + AMD (ROCm 7.2) | scripted, **not verified** |
| `win-rocm` | Windows + AMD Radeon (ROCm 7.2.1, AMD preview) | scripted, **experimental, not verified** |

### Building and running

Prerequisites: [uv](https://docs.astral.sh/uv/), Node.js ≥ 22, Rust (`rustup`), Xcode Command Line Tools, network access (standalone
Python, wheels, official Node, better-sqlite3 and stable-diffusion.cpp binaries). Disk space: ~15 GB for the macOS target, the same
per Windows or Linux target.

```sh
./scripts/app.sh                  # builds the app for this machine and opens it (--no-run, --no-build, --clean)
./scripts/bundle.sh               # packages in desktop/dist/: .dmg + zip win-x64 + tar.gz linux-x64
./scripts/bundle.sh --targets darwin-arm64        # the .dmg only
./scripts/install.sh macos        # builds, then copies AI MediaLab.app into /Applications
```

These scripts come from the template (`desktop/README.md`, section "Build and package scripts"): back and front build, project hook,
assembly (`scripts/desktop/build-desktop.mjs`), `tauri build`. `cd back && npm run desktop:build` = `app.sh --no-run`. The hook
`scripts-local/desktop-prepare.sh <target>` builds the embedded engine (`scripts-local/build_runtime.py`, into
`desktop/build/engine-bundle/` = `engine/`, `engine-runtime/{python,site-packages}`, `engines/sdcpp/<variant>`) with the profile of
the target: `darwin-arm64` → `mac-arm64`, `win-x64` → `win-universal`, `linux-x64` → `linux-universal`;
`DESKTOP_PROFILE=win-cuda|win-rocm|linux-cuda|linux-rocm|mac-arm64-full` selects another one (embedded PyTorch). It only redoes the
copy of the engine code (`--refresh-app`, a few seconds) as long as the profile, `engine/pyproject.toml`, `engine/uv.lock` and
`profiles.json` have not changed; changing profile (hence target) rebuilds everything.

Results: `app.sh` opens `desktop/src-tauri/target/release/bundle/macos/AI MediaLab.app` (logs in
`~/Library/Application Support/app.aimedialab.studio/logs`); `bundle.sh` copies `AI MediaLab_<version>_aarch64.dmg` and the portable
archives into `desktop/dist/`. Windows from the Mac requires `brew install mingw-w64`; Linux, Docker started; otherwise the target is
skipped with the reason. Windows and Linux packages are cross-built and **not verified** on their hardware. The workflow
`.github/workflows/release.yml` does the same chain on each OS.

### Publishing a release

**Recommended path (CI).** Bump the version everywhere it lives (`back/package.local.json` and `front/package.local.json` with
their generated `package.json`, `desktop/package.json`, the root entry of the three `package-lock.json`,
`desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` and `Cargo.lock`, `engine/pyproject.toml` and `uv.lock`,
`engine/openapi.json`, the `README.md` badge), add the `CHANGELOG.md` entry (it becomes the release notes), commit,
push, then `git tag v0.1.0 && git push origin v0.1.0`. `.github/workflows/release.yml` builds the macOS `.dmg`, the Windows portable
`.zip` (cross-built from Linux with mingw-w64) and the Linux `.AppImage` + `.deb`, collects the third-party licences into the app (`licenses/`, see
`scripts-local/collect_licenses.py`; the build fails on GPL/AGPL/SSPL dependencies) and attaches everything, with `.sha256` files, to a
**draft** release (pre-release while the version is 0.x). Review the draft, test the packages, then publish it by hand
(`gh release edit v<version> --draft=false`). Used for v0.1.0 and v0.1.1. A job stuck on `apt-get` (Ubuntu mirror) times out
after 15 min: re-run it with `gh run rerun <run id> --failed`, the jobs that succeeded are kept.

**Local path.** The script below builds on this machine and uploads the release itself.

```sh
scripts-local/publish.sh                      # mac + Windows build, GitHub release v<project version> as a pre-release
scripts-local/publish.sh --targets darwin-arm64,win-x64,linux-x64 --version 0.1.0
scripts-local/publish.sh --dry-run            # the plan only; --no-upload (build only), --skip-build (upload only)
```

The script (project, not template: `scripts/` is the shared link) refuses a modified tree, an unpushed HEAD or an existing tag.
Each target runs under `scripts-local/guarded_run.sh` (`GUARD_GB`, 5 by default). Publication-specific slimming:
stable-diffusion.cpp's CUDA and ROCm variants are not embedded (`DESKTOP_SKIP_SDCPP_VARIANTS`, downloaded on first launch), and the
back's production dependencies without code (`@base-org/account`, `typescript`; `stripe` stays: `DonationService` of the template requires it) are then removed from `node_modules`.
GitHub refuses a file larger than 2 GiB: a larger package is split into `<name>.part-aa`, `.part-ab`… (`cat` to reassemble it,
procedure in the release notes). The release is created as a draft, filled, then published. The `v*` tag also triggers
`.github/workflows/release.yml`.

To iterate without packaging: `cd back && npm run desktop:dev` (the repository root serves as resources: `back/dist`, `front/dist`,
`engine/.venv` created by `uv sync`, system Node; `DESKTOP_RESOURCES`).

### Data and first launch

- Data folder = the OS local folder of the identifier `app.aimedialab.studio` (macOS:
  `~/Library/Application Support/app.aimedialab.studio/`), **the same as the old application's**: the shell exports it as
  `APP_DATA_DIR` to Nest, and the engine reads it as `IMAGEGEN_DATA_DIR` (`{dataDir}`). Contents, owner of each item, reuse of the
  old "Chambre noire" folder (`app.chambrenoire.studio`) and import of the old database on first launch: `ARCHITECTURE.md`, section
  "Data and migrations" (nothing for the user to do, nothing is deleted). Logs: `logs/` (`shell.log`, `engine.log`, `server.log`,
  `*.previous.log`). Models stay in the usual Hugging Face cache.
- **Ad hoc** signing only: a downloaded application is quarantined by Gatekeeper (right-click, Open, or
  `xattr -dr com.apple.quarantine "/Applications/AI MediaLab.app"`). Public distribution: Developer ID and notarization (described
  in `desktop/README.md`, not automated).
- Cleanup (≈ 10 GB): `rm -rf desktop/build desktop/src-tauri/target`.
- Idle memory: `ARCHITECTURE.md`, section "Idle memory".

## Quantizations

Each MLX and GGUF model offers several quantizations (`Modèles → carte du modèle → Quantification` (Models → model card → Quantization)): only the one you choose is downloaded, never the full-precision version. Qwen Image 2.1 MLX: 4 bits (default,
≈ 10 GB of measured peak memory at 1024²) or 8 bits. GGUF: from Q2_K to Q8_0. PyTorch models have only one precision (bf16 / fp16).

## Adding a model from Hugging Face

`Modèles → Chercher sur Hugging Face` (Models → Search on Hugging Face), or "Search for a
model…" (`Chercher un modèle…`) at the bottom of the model selector): the search only offers formats the application can run, and
re-reads the repository before adding it.

| Family | What is accepted | Run by |
|---|---|---|
| Image · GGUF | other quantizations or fine-tunes of Z-Image Turbo, Qwen Image 2.1, Qwen Image Edit (choice: Q2_K … Q8_0) | stable-diffusion.cpp |
| Image · diffusers | Stable Diffusion 1.x and XL in safetensors (fp16 preferred) | PyTorch |
| Audio · Qwen3-TTS | bf16 voice & style variants, voice creation, cloning | `qwen3` pack |
| Audio · Whisper | faster-whisper models (CTranslate2) | `speech` pack |

Refused with an explanation: restricted-access repositories, `.bin`/`.ckpt` formats, unloadable quantized models (GGUF/MLX/ONNX of
Qwen3-TTS), unsupported architectures (Flux other than the catalogue's FLUX 3 Image Klein, SD3…). A "recipe" (repository, file, family) is saved in the engine's own state
(`engine-state.json`, data folder); the model appears in the lists with the mention *Hugging Face* and can be removed.
The **precision** shown (Q4_K, bf16, fp16…) comes from the GGUF file name or the safetensors header, read remotely without
downloading the file.

## License

Code under [MIT license](../LICENSE). Downloaded models keep their own license: see [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).
