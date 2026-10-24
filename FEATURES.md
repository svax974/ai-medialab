# AI MediaLab features

Inventory of what is **built** (not a change log), by module. Each section is updated in the
same commit as the feature. The detail of a module (files, endpoints, tests) is in its README, the general shape in
`ARCHITECTURE.md` (documentation map), the model guide for the user in `docs/guide.md`.

*Last verified against source: 2026-10-19. What has never really been run is marked "unverified". No real `llama-server`, chat model or browser was used to verify the Chat mode, the Diagrams mode, the private mode and the update advisor: everything was tested with fake servers.*

## Studios (interface, `front/src/modules/`)

### `studio-shell`: shell
- Sidebar (collapsible): switch between chat / image / audio / video / diagrams modes, "Private generation" button (`Génération privée`), mode pages, search, conversations pinned and
  grouped by period (`Sélectionner` mode: delete several conversations at once), engine card, access to models and settings, "Check for updates" (`Vérifier les mises à jour`) (modal: installed engines then installed models, update per row, per section or global, with progress bars; image / audio / video filter; nothing is updated without a click), dark or light theme.
- Routes: `/`, `/c/:id`, `/galerie`, `/audio`, `/audio/voix`, `/audio/bibliotheque`, `/video`, `/video/bibliotheque`,
  `/chat`, `/diagrammes`; shortcuts ⌘B, ⌘⇧O, ⌘K, `/`.
- **Memory gauge** in the left panel: share of memory in use (macOS: as Activity Monitor counts it, app + wired + compressed, never the file cache), system pressure, swap, the models held against the ceiling, updated every 2 s by the engine; **emergency stop** button (with confirmation) that cancels what is queued and kills the running generation, chat and OCR processes to give the memory back. **Unverified** on a real runaway.
- Subscription to the event stream and translation into cache updates (TanStack Query); fallback to reloading when the
  stream is cut.
- "Camera darkroom" theme (`front/src/themes/chambre-noire/`): dark "warm black / inactinic red" by default, light
  "paper", thin borders, film grain, embedded fonts. Visual parity with the former interface: **to be checked by eye**.

### `studio-core`: conversation thread (shared by the three studios)
- Open conversation: editable title, counter, scrolling; user messages and assistant generations.
- Live progress (model loading, steps, remaining time, queue position, intermediate previews), retry,
  "vary", reuse of settings, cancellation, deletion, thumbnails, full-screen viewer, engine status card.
- Model settings and seed (`GenerationParams`), shared by the three composers.

### `image-studio`
- Home (first launch, "hero" composer, starter prompts, latest prints); composer: prompt, reference images
  (click, paste, drop on the window, drag from a thumbnail; reorderable, the first one gives the format and the resolution
  "Reference", kept for the following images once the references are removed), model, aspect ratios and definition, number of images (1 to 4),
  steps, guidance, negative prompt (an "À éviter" line under the prompt), strength, seed; image gallery (`/galerie`).

### `audio-studio`
- Composer: text or dialogue with voice assignment (`Alice : …`), voice, language, style instruction or description of a
  voice, model settings, seed, number of takes, autoplay.
- Takes with a shared player, waveform, character markers, speed, favourite, WAV export; audio library
  (`/audio/bibliotheque`).

### `voices`
- Voice library (`/audio/voix`): microphone recording with a reading text, file import, name, language,
  **suggested transcription then editable**, preview, editing, deletion; creation of a voice from a description;
  "keep as reference voice" from any take. Microphone and listening: **to be validated by the user**.

### `video-studio`
- Composer with three slots (source video, start image, end image), duration (up to 20 s on GGUF
  image-to-video models: chained passes whose length follows the memory measured on the machine; see the README), format and definition, settings, seed,
  number of clips (1 to 2), licence and restricted-access notices; clips with a native player and actions (vary, retry,
  use as source video, **last frame as start**, favourite, download (original, light 360p / 240p MP4 or animated GIF to send), share); image and video drop; video
  library.

### `chat`
- **Chat** mode (tab next to image, audio and video) on local language models (llama.cpp): thread with streamed answers,
  safe Markdown (remote images blocked), coloured code with copy, LaTeX formulas (loaded on demand), collapsible "Reasoning" block,
  tool calls displayed (requests sent, sources), statistics per answer (tokens, tokens/s) and a context gauge.
- **Tree-structured** conversations: branch navigator, editing a message (new branch), regeneration, side-by-side comparison of
  two models (one after the other), deletion; system instruction with personas; settings (temperature, top-p, top-k, min-p,
  penalties, length, seed, context, reasoning) with presets; notice when changing the context reloads the model; attachments
  (images for vision models, text files); optional web search per conversation (DuckDuckGo, or Brave with a key); **creation tools** (enabled by default): the chat model launches an image, a video or a sound with the selected model of each studio (default settings, only what each model accepts), the result is shown in the answer and in the media library, "Open in studio" (`Ouvrir dans le studio`); choice cards (duration of a video, voice of a model that requires one, default chat voice in the settings); commands `/image`, `/video [5s]`, `/audio [voix :]` without the chat model (absent from the private session);
  automatic title; Markdown / JSON export; full-text search; draft per conversation; loaded-model indicator with
  "Unload" (`Décharger`).
- **Send to Image / Video / Audio / Diagrams** from an answer (selection or whole text, without markup) and a **✨ Improve the prompt** (`Améliorer le prompt`) button in
  the three media composers (can be reverted). **Unverified**: real rendering, real model.

### `diagram-studio`
- Org charts, flowcharts, sequences, architectures (grouped into blocks), state diagrams, mind maps: a local language model (the same GGUF files as the Chat tab, separate catalogue, no duplicate download) answers in JSON
  constrained by a schema (never free Mermaid syntax to parse), converted to Mermaid and rendered in the browser with a theme
  of choice (light, dark, colourful, minimal — applied without asking the model again). The render (PNG) joins the gallery and the thread
  like a normal image; the Mermaid source stays attached to restyle later.
- Home (first installation, "hero" composer, four starter prompts, one per type), composer: prompt, model,
  diagram type, theme. No job queue: a generation is a one-off call (text, then render), like the
  "Improve the prompt" button of the chat. **Unverified**: real rendering, real model.

### `ocr-studio`
- **OCR** tab (`/ocr`): drop or paste an image or a PDF (200 MB at most), pick a model, a task (text, Markdown document, table, formula,
  chart, or a free instruction for the models that follow one), the pages of a PDF ("1-3, 5"), and start. The reading runs in the background,
  page by page, with progress; the original sits next to the text of the page chosen; copy a page or everything, export as
  Markdown, text or JSON, run again (another model, task or pages), cancel, delete. The readings are kept (sidebar list with search on title
  and text). "Extract the text" button in the viewer for an image of the library.
- Each model has a card with its **strengths and limits**, its languages and licence; models not downloaded yet are offered and installed
  on demand like the others; Hugging Face search for other OCR models. **Unverified**: no real model, no browser. The `/ocr` command of the chat
  is not built.

### `private`: private generation
- "Private generation" button (padlock, purple banner and frame): ephemeral session for image, audio, video **and chat** with no history, result or
  prompt kept (no database row, files in a session folder erased on exit, after 30 min of inactivity, on shutdown and on the startup sweep; media without cache; drafts and usage counters not written; logs without content; video measurements not recorded; `sd-cli` prompts passed by file when the binary allows it). Limits announced in the interface: OS memory and swap file,
  backups, non-secure erasure on SSD, screenshots, `audio.cpp` text still on the command line. Reloading the page erases the session.

### `updates`: checking for updates
- "Check for updates" (`Vérifier les mises à jour`) modal: installed engines (stable-diffusion.cpp, audio.cpp, Python packs) then installed models; update per
  row, per section or global, progress bars, filter by type, pinned version recommended or **latest upstream version, untested**
  (warning + confirmation; known regressions cited), return to the tested version.
- **Advisor**: a small local model summarises structured sources (release notes, GitHub issues and commits; commits, discussions and Hugging Face card); each finding must quote an extract found in the source, otherwise it is rejected; the verdict is computed by the code; advisory, never blocking, **recorded** (`update_advisories`) and shown on opening; optional automatic analysis. **Unverified**: quality
  of a small model's findings, real GitHub / Hugging Face requests.

### `media-library` (front)
- Generic gallery (filters, cursor pagination, favourites, live updates), viewer list, file drop overlay and
  drop rules per mode.

### `model-catalog`
- "Models" (`Modèles`) dialog: catalogue by type, installed / incomplete / incompatible with the reason (memory planner),
  download with progress, throughput, remaining time, resume, cancellation, deletion, variants (quantisations);
  reusable model selector (description indented under the title; most used first, then the other
  installed ones, then the rest; models too heavy for the machine hidden by default; the preselected model is, absent a remembered choice,
  the most used installed one); Hugging Face search with quantisations
  offered per result, memory fit and compatibility markers, adding and removing custom models, including
  SDXL LoRAs.
- **"What's new?"** button (`Nouveautés`, "What's new ?") in the composers: recent models (90 days by default) and popular ones from Hugging Face, addable from the
  app and compatible with the machine, without an LLM; "Chat models" tab (vision / tools / reasoning / MoE badges, context) and Hugging Face
  "LLM" search.

### `engines`
- **Installation on first selection of a model**: a confirmation window lists what will be downloaded ("Base data" (`Données de base`)
  shared: PyTorch, FFmpeg; "Runtime engine" (`Moteur d'exécution`); "Model" (`Modèle`)), with sizes and the total; a single run on the engine side,
  progress, cancellation that deletes what is partial; an item already installed is never downloaded again.
- "Engines" cards: installation of stable-diffusion.cpp (SHA-256 verified) and of the audio and video packs
  (isolated Python environments), cancellation; llama.cpp card (chat engine);
  **launch invitation** (window to close, "Don't suggest this again" checkbox (`Ne plus me le proposer`), recalled in the Settings) while llama.cpp is missing: chat, analysed updates,
  improved prompts, option of the recommended model.

### Language (French, English)
- Choice in Settings > General; on first launch, the system language (French, otherwise English). The interface, Nest error messages, engine texts
  (model descriptions and notes, parameters, progress, errors) and update advisories follow this choice. Date and number formats according to the language.
  Flow and rules: `ARCHITECTURE.md`, section "Interface language".

### `settings` and `hardware`
- "Settings" (`Réglages`) dialog in three tabs. **Engines**: all downloadable components (base data, engines) with their state,
  the space used, and deletion (which also deletes the installed models that depend on them, named in the confirmation). **Models**:
  the catalogue by category (chat, audio, image, video) with state and deletion. **General**: interface language (French or English; on first launch, the system one, English by default), model unload delay, memory ceiling for the models loaded together (automatic = 80 % of the machine, or a slider), previews, memory saving, optional Hugging Face token and Brave Search key, default chat voice, "Local AI at launch" invitation, reminder
  of the shortcuts; each setting has a tooltip. "This machine" card (chip or GPU, memory, models disk, unusable GPUs).

## Server (`back/src/modules/`)

| Module | Built |
|---|---|
| `engine` | Typed HTTP client of the engine (types generated from `engine/openapi.json`), relay of the engine event stream with reconnection, relay of media `/api/media`, health probe (`degraded` if the engine does not answer) |
| `studio-core` | Conversations and messages (image, audio, video and chat modes; a chat conversation can receive generations: creation tools), FIFO queue of generations (one at a time), message state machine, retry, cancellation, deletion with file purge, resume at startup, `studio.*` events, published queue |
| `media-library` | Assets (uploads and outputs), favourites, paginated list, ingestion and purge of files by the engine, event size limit raised to 256 KB |
| `audio-studio` | Voices (cloning, design), reference clip prepared by the engine, suggested transcription, voices passed to audio jobs |
| `settings` | Studio settings (module configuration, encrypted Hugging Face token), pushed to the engine at each (re)connection |
| `hardware` | Machine and engine state, model unloading (delegated to the engine) |
| `model-catalog` | Catalogue, downloads, custom models, Hugging Face search (delegated to the engine) |
| `engines` | Engine and pack installers (delegated to the engine) |
| `chat` | Message tree (`chat_messages`, settings per conversation), SSE response stream to the LLM engine, web tools (DuckDuckGo / Brave, guard against internal addresses), automatic title, prompt improvement, export, search, attachments, unloading and siblings of a message; occupancy gauge shared with the generation queue |
| `ocr` | Readings of images and PDFs by an OCR model: background queue (one at a time, engine gauge), `ocr_documents` and `ocr_pages`, files `<data>/ocr/<id>/`, export, search, `studio.ocr.*` events |
| `diagrams` | Diagram generation by one-off LLM call (schema-constrained JSON → Mermaid, never a job), generic messages of `studio-core` (`diagram` mode), PNG render attached as a generated asset once received from the front |
| `private` | In-memory private session (conversations and messages without database), session folder, shared queue, stateless private chat, cleanup (end of session, delay, startup) |
| `updates` | Update detection (engines, models), launch, untested version, advisor and recorded advisories (`update_advisories`) |
| `legacy-import` | Idempotent import of the former engine database at first startup, then renaming to `.imported` |

Foundation (vx-public template, not detailed here): SQLite, local trust mode (`LOCAL_TRUST`), event stream, fr and en locales,
TypeORM migrations.

## Engine (`engine/`)

- **Images**: MLX (Apple Silicon), PyTorch + diffusers (CUDA, ROCm, MPS; installed on demand by the "torch" pack, outside the
  installer), GGUF through stable-diffusion.cpp (Metal, CUDA, ROCm,
  Vulkan); text to image, image to image, instruction-based editing (GGUF catalogue: Z-Image Turbo, Qwen Image 2.1, Qwen Image
  Edit, FLUX 3 Image Klein: text to image and editing with up to 4 references, licence FLUX Kommunity, `min_build` 968 of
  stable-diffusion.cpp, refused with a reinstall hint on an older build); "Demo" model without GPU (`IMAGEGEN_DEMO=1`).
- **Specialised SDXL**: LoRAs loaded on SDXL (adjustable strength, trigger words added to the prompt), including two pixel-art
  ones with "Crisp pixels" post-processing, including "Pixel Art XL · Face" which follows the face of a photo (IP-Adapter, optional start image); fine-tuned models RealVisXL, Juggernaut XL, DreamShaper XL Turbo, Animagine XL with
  their recommended scheduler. **Unverified**: no real generation.
- **Audio**: speech synthesis, cloning, voice creation from a description, dialogue, transcription (Whisper, Qwen3-ASR); isolated packs
  and native audio engine audio.cpp; Kokoro, Pocket TTS, Qwen3-TTS, Chatterbox, Whisper.
- **Video**: text to video, image to video, video editing; Wan 2.2, LTX, HunyuanVideo 1.5, CogVideoX, Kiwi-Edit,
  Bernini-R. **Only one real trial** (Wan 2.2 TI2V 5B text to video, M3 Max) was done: the rest is **unverified** (see
  `docs/guide.md`).
- **Chat (LLM)**: llama.cpp engine installed from the application (`llama-server`, GGUF, 127.0.0.1 only, API key per launch), 11 models
  verified on Hugging Face (from 0.7 to 17.7 GB: Qwen3, Gemma 4, Ministral 3, gpt-oss, LFM2.5…), Hugging Face "LLM" search, normalised SSE stream
  (reasoning, tool calls, statistics), several models in memory together under a ceiling (chat, OCR, generation), prompt cache capped at 1 GB. **Unverified**: no real
  `llama-server`.
- **Diagrams**: reuses the same models and GGUF files as Chat under a separate catalogue (`diagram_models.py`,
  `kind="diagram"`), via `/engine/v1/llm/chat` (schema-constrained JSON, no diffusion job); no
  Hugging Face search nor dedicated "What's new" section (they are the same models). **Unverified**: no real `llama-server`.
- **OCR**: 7 models (GLM-OCR, PaddleOCR-VL 1.6, LightOnOCR 2, DeepSeek-OCR, dots.ocr, Qianfan-OCR, Qwen3-VL 2B) run by llama.cpp in a server of their own, PDF pages rasterized by pypdfium2, prompts and markers per model (`ocr_models.py`, `ocr.py`), Hugging Face "OCR" search (`ocr-gguf` family). **Unverified**: no real `llama-server`.
- Hugging Face novelties (`hf_trending.py`), update advisor (`update_advisor.py`), private session of jobs (`private_session.py`).
- Memory planner (argued refusal of a model that does not fit), memory guard (refusal to load when free memory
  is missing, model stopped before the machine saturates, measurement per job: `ARCHITECTURE.md`), models loaded together under a global ceiling (least recently used idle one unloaded first), unloading after
  inactivity, immediate cancellation, downloads in a dedicated process (resume, cancellation).
- Custom Hugging Face models (recipes in `engine-state.json`), thumbnails and media polling.

## Desktop (`desktop/`)

- Tauri shell of the template: `engine` sidecar process (embedded Python) then Nest, shared token, "camera darkroom" waiting page, OS data folder, resume of the former `app.chambrenoire.studio` folder.
- Light installer: Python runtime + `uv` + Metal/Vulkan only; PyTorch + diffusers (and MLX), the CUDA/ROCm builds of
  stable-diffusion.cpp and the models are downloaded on first need. Publication: `scripts-local/publish.sh` (GitHub release).
- Run profiles: macOS Apple Silicon (light runtime built, startup verified; assembled into the full version with the former
  shell); Windows and Linux (universal, CUDA, ROCm) scripted, **unverified**. No application has been built with the template shell.
