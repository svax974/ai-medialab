# AI MediaLab architecture

Technical entry point of the project: the **shape** of the application (processes, ownership, flows, contracts). The detail of
each component is in the annex that owns it (map below); this file repeats neither constants nor lists of URLs.

## Documentation map

The only authoritative list of the project's annexes and of what each one owns. An annex missing from this map does not
exist; a new annex is added here with its path (rule "one fact, one place").

| File | Owns |
|---|---|
| `README.md` | GitHub front page: what the app is, downloads, first launch, build from source, licence |
| `docs/guide.md` | Launch (development, desktop), engine environment variables, test rules, user guide to models and engines (image, audio, video, measurements, limits), release procedure |
| `CHANGELOG.md` | Changes per released version (source of the GitHub release notes) |
| `CONTRIBUTING.md`, `SECURITY.md` | How to contribute; how to report a vulnerability |
| `FEATURES.md` | Inventory of what is built, per module (and what is not) |
| `ARCHITECTURE.md` (this file) | Processes, Nest ↔ engine contract, event flow, data and migrations, desktop, resting memory, engine plan |
| `back/src/modules/<module>/README.md` | Contract of a server module: role, files, exhaustive endpoints, entities, tests. Modules: `i18n`, `engine`, `settings`, `hardware`, `model-catalog`, `engines`, `updates`, `studio-core`, `chat`, `diagrams`, `ocr`, `private`, `media-library`, `audio-studio`, `legacy-import` |
| `back/src/migrations/README.md` | TypeORM migrations of Nest's database: usage, generation, verification |
| `front/src/modules/<module>/README.md` | Contract of an interface module: components, hooks, locales, parity with the former interface. Modules: `studio-shell`, `studio-core`, `image-studio`, `audio-studio`, `voices`, `video-studio`, `chat`, `diagram-studio`, `ocr-studio`, `private`, `media-library`, `model-catalog`, `engines`, `updates`, `settings`, `hardware` |
| `front/src/themes/chambre-noire/README.md` | "Chambre noire" theme: tokens, MUI overrides |
| `desktop/README.md` | Desktop shell (Tauri): configuration, launch, packaging, signing, CI |
| `engine/openapi.json` | Contract of the engine's internal API (**generated**: `scripts-local/export_engine_openapi.py`) |
| `docs/components/README.md` | Registry of the third-party components integrated and the review procedure; sheets `audiocpp.md`, `llamacpp.md` (chat engine: flags, installation, licences), `pytorch-gpu.md`, `ffmpeg.md` (FFmpeg build and licence), `audiocpp-tests-manuels.md` |
| `THIRD_PARTY_LICENSES.md` | Licences of the components and the models |
| `front/.libs/apptemplate/CLAUDE.md`, `front/.libs/apptemplate/README.md` | Template conventions and launcher (outside this repository: submodules) |

*Last verified against source: 2026-10-24 (memory ceiling, OCR), 2026-10-16 (chat creation tools) and 2026-10-15 (Chat and Private generation modes, update advisor). The sections on chat and private mode describe code tested with fake servers: no real `llama-server` or browser.*

## Overview: four processes

```
browser / Tauri window
        │  HTTP + SSE (/api/v1, /api/…)           (the only entry point of the browser)
        ▼
  Nest (back/, port 3000)  ──── HTTP + X-Engine-Token token ───►  Python engine (engine/, 127.0.0.1:8000)
   · /api routes, SQLite base app.db                               · models, downloads, jobs, media
   · generation queue, event relay                                 · one model loaded at a time (separate worker)
   · serves the compiled front (desktop)                           · has no application database
        ▲
        │ supervises (desktop only)
  Tauri shell (desktop/)  ──►  starts the engine, then Nest, then opens the interface
```

| Process | Role | Listens on | Owns |
|---|---|---|---|
| **Engine** (`engine/`, FastAPI) | Everything that runs models: machine detection, catalogue, downloads, engine installers, planning and execution of generations (image, audio, video), thumbnails and media probing | `127.0.0.1` only, token required | Media files (`uploads/`, `outputs/`, `thumbs/`, `previews/`), the model cache, `engine-state.json`, the installed engines (`engines/`) |
| **Nest** (`back/`, vx-public) | The application: conversations, messages, assets, voices, settings, generation queue, import of the former database, events to the browser | `NODE_PORT` (3000), `LOCAL_TRUST` | The `app.db` database and all application data |
| **Front** (`front/`, React + MUI) | The interface: three studios (image, audio, video), library, models, settings | Vite (5173) in development; served by Nest on desktop | The display state (TanStack Query cache, Zustand) |
| **Shell** (`desktop/`, Tauri 2) | Starts and supervises the engine then Nest, opens the window, manages the data folder | none | The lifecycle of both processes, the shared token, the first-launch secrets |

Ownership rules that structure everything else:

- **The browser only talks to Nest.** Media go through `/api/media/…` (relay, `back/src/modules/engine/README.md`).
- **The engine has no application state.** It knows neither conversation, nor message, nor voice, nor persistent setting: a job
  arrives with everything it needs, the output events describe what was produced, Nest records it.
- **Nest never runs a model.** It delegates to the engine through a typed client.
- **One generation at a time** (the GPU is shared). **Several models may stay loaded together** as long as they fit under one ceiling for the
  whole application (`memory_budget.py`, setting Settings → General): a media worker, the chat model and an OCR model. The queue that
  decides "which message next" is in Nest (`back/src/modules/studio-core/README.md`).

## Nest ↔ engine contract

The engine exposes `/engine/v1` (FastAPI); `engine/openapi.json` is its schema, **generated** (never written by hand):

```sh
engine/.venv/bin/python scripts-local/export_engine_openapi.py          # writes engine/openapi.json
cd back && npm run engine:types                                           # writes back/src/modules/engine/generated/engineApi.d.ts
```

Two tests keep both files up to date (`engine/tests/test_engine_api.py`, `generated/engineApi.contract.spec.ts`), and
`EngineMedia.spec.ts` checks that `ENGINE_API_SEGMENTS` follows the segments of the schema. The typed client (`EngineClient`)
refuses at compile time a route, a parameter or a body absent from the schema.

- **Authentication**: the `X-Engine-Token` header (shared secret, variable `ENGINE_TOKEN` on both sides) is required on all routes
  except `/engine/v1/status` (liveness probe). The files `/media/<folder>/…` are served without token, read-only, on the local loop.
  In development the token is in `back/.env.dev`; on desktop the shell generates it at each launch.
- **API zones** (first segments; exact routes in `engine/openapi.json` and in the README of the Nest module that calls them):
  `models`, `hf` (catalogue, downloads, custom models, Hugging Face search: `model-catalog`), `engines`
  (installers: `engines`), `updates` (detection and launch of updates of the installed engines and models: `updates`), `system`, `status`, `engine` (hardware, state, unloading: `hardware`), `runtime` (settings pushed by Nest: `settings`), `jobs` and `media` (generations and files: `studio-core`, `audio-studio`, `media-library`),
  `events` (engine SSE stream: `engine` module), `llm` (chat server, response SSE stream, unloading: `chat`). Private mode has no engine zone of its own: its jobs go through `jobs` with a `private_dir` field.
- **Jobs**: detailed contract (body, errors, events) in `back/src/modules/engine/README.md`, section "Job contract". Outside the data folder,
  the engine refuses any input, output or voice path.
- **Studio settings**: owned by Nest (`settings` module, module configuration, encrypted Hugging Face token). Nest
  pushes them to the engine via `PUT /engine/v1/runtime/settings` at startup, at each reconnection of the stream and at each change; the
  engine keeps them **in memory only** (never on disk) and applies default values as long as it has received nothing.
- **Errors**: a non-2xx response becomes an `EngineError`, an unreachable engine an `EngineUnavailableError` (502 on the Nest route);
  Nest's health probe switches to `degraded` (HTTP 200) when the engine does not answer: the interface stays usable, only
  generations no longer are.

## Event flow

```
engine: event bus ──SSE /engine/v1/events──► EngineEventRelay (Nest, exponential reconnection)
                                                        │
                       ┌────────────────────────────────┴───────────────────────────┐
                       ▼                                                            ▼
   EventStreamService  topics engine.<name>              GenerationQueueService: job.* → messages, assets (database)
   (downloads, installers, engine state,                                             │
    catalogue change, engine.link)                                                   ▼
                       │                                       EventStreamService  topics studio.<name>
                       └──────────────┬────────────────────────────────────────────┘ (message.updated, job.progress, job.image,
                                      ▼                                               queue.updated, asset.*, conversation.*, voices.changed…)
                     GET /api/v1/events/stream?topics=…  (SSE, shared building block of the template)
                                      ▼
                     front: eventStreamClient → cache effects (studio-shell/lib/eventEffects.ts)
```

- **Engine → Nest**: a single stream; at each connection the engine replays its snapshot (state, active jobs, downloads,
  installations). A slow client is disconnected on the engine side, then reconnects and rereads its state. The relay signals the loss and
  the return of the link (`engine.link`), which makes the settings be sent again and the state be reread on the interface side.
- **Nest → browser**: topics `engine.*` (names and payloads in `back/src/modules/engine/README.md`, section "Event flow")
  and `studio.*` (published by `StudioEvents`, list in `back/src/modules/media-library/services/StudioEvents.ts`).
  Audience: administrator (single-user application, the `local-trust` principal is one).
- **Size**: the size limit of an event of the template is raised to 256 KB for this application (`StudioEventLimitsModule`,
  `back/src/modules/media-library/README.md`), because of the waveforms of audio takes.
- **Browser**: the front subscribes to the useful topics and turns each event into an invalidation or removal of the TanStack
  Query cache, grouped over 250 ms; when the link returns or on the `resync` frame, it reloads everything
  (`front/src/modules/studio-shell/README.md`). Without a stream, it falls back to polling.

## Data and migrations

Data folder shared by Nest and the engine: `APP_DATA_DIR` on the Nest side, **the same folder** read under `IMAGEGEN_DATA_DIR` on the
engine side (set by `scripts-local/dev-services.sh` in development, by the shell on desktop). By default `<repository>/data/` in
development; on desktop the local folder of the OS for the identifier `app.aimedialab.studio` (`desktop/README.md`).

| Element | Owner | Note |
|---|---|---|
| `app.db` (SQLite) | Nest | conversations, messages, references, assets (metadata), voices, chat messages as a tree (`chat_messages`) and their settings, update advisor notices (`update_advisories`), module configuration (settings), import marker; schema versioned by migrations. **Nothing from private mode** |
| `private/<session>/` | engine (files) | folder of the private-mode session (inputs, outputs, previews, thumbnails, temporary files), 0700, erased at the end of the session, after 30 min of inactivity, at shutdown and at startup (leftovers) |
| `video-memory.json` | engine | memory measurements of video passes (cache, not application data; not written in private session) |
| `uploads/`, `outputs/`, `thumbs/`, `previews/` | engine (files) | asset rows only keep relative file names |
| `engine-state.json` | engine | recipes of the custom Hugging Face models (`engines/custom.py` → `engine_state.py`) |
| `engines/` | engine | engines and packs installed from the application (stable-diffusion.cpp, audio.cpp, isolated Python environments for audio and video) |
| `ai-medialab.db.imported` | person | former engine database, kept, never deleted |
| `secrets.json`, `logs/` | shell (desktop) | keys at first launch, logs |
| Hugging Face cache (`HF_HOME`) | Hugging Face | outside the data folder; model weights |

**Migrations of Nest's database**: versioned in `back/src/migrations/` (in development TypeORM builds the schema itself;
on desktop `DB_SCHEMA_MODE=migrations`). Any entity change comes with a migration in the same
commit (procedure and consistency test: `back/src/migrations/README.md`).

**Recovery of former data (versions before the migration)**, three independent steps, in this order at the first
launch of an existing installation:

1. **Former desktop folder** (`app.chambrenoire.studio`): the engine, started first, moves its entries into the current folder when
   `config.py` is imported (`engine/app/legacy_data.py`), unless the current folder already contains a database (including
   `….imported`); nothing is overwritten.
2. **Custom model recipes**: the engine, on first access to its registry, creates `engine-state.json` from the `settings`
   table of the former database (`ai-medialab.db`, `chambre-noire.db` or `….imported`), read-only; only the key `custom_models`
   is taken over (`engine/app/engine_state.py`, tested by `engine/tests/test_engine_state.py`).
3. **Conversations, messages, assets, voices, settings**: Nest, at startup, imports the former database in one transaction with a
   marker (idempotent), then **renames** it `ai-medialab.db.imported` (and its `-wal`, `-shm` files), without ever deleting it
   (`back/src/modules/legacy-import/README.md`). The startup order of engine / Nest does not matter: the engine also reads the
   renamed file.

## Desktop

The template shell (Tauri 2, `desktop/`) is configured by `desktop/desktop.config.json`: an auxiliary process `engine`
(Python interpreter and dependencies **embedded**, `uvicorn app.main:app`, health `/engine/v1/status`) started **before** Nest, then the
Nest server (embedded Node), which also serves the compiled front and whose health includes that of the engine. The `ENGINE_TOKEN` token is
generated at each launch and shared; the ports are allocated free. On closing, the shell stops both groups of
processes, including the generation worker. Build procedure, runtime profiles per GPU, signing and CI:
`desktop/README.md` and the section "Desktop application" of `docs/guide.md`. The packaging hook of the engine is
`scripts-local/desktop-prepare.sh` (called by `scripts/app.sh` and `scripts/bundle.sh`), which runs `scripts-local/build_runtime.py`
with the profile of the target (profiles: `desktop/runtime/profiles.json`).

**PyTorch outside the installer.** The default profiles contain neither PyTorch, nor diffusers, nor mflux: the engine starts and
answers without them (probe `system._probe_torch` in a subprocess, which ignores them if they are missing). The "torch" pack
(`engine/app/audio_packs.py`, family `runtime`) installs them on demand in `<data>/engines/runtime/torch/venv`, a venv built
on the embedded interpreter with the embedded `uv`. Its `site-packages` is added to `sys.path` only by the generation worker
(`activate_overlays`, called at the start of `worker.run_worker`) and by the probe: the server never imports them. The models of
backend `torch` and `mlx` point to this pack (`audio_packs.pack_of`) and the interface offers its installation like that of an engine.

**Components and model installation.** Everything the application downloads outside the models is a *component* (`engine/app/components.py`),
at two levels: the *base data*, shared by several engines (the `torch` pack, the `ffmpeg` pack: PyAV, never embedded because of its
licence, see `docs/components/ffmpeg.md`), and the *runtime engines* (stable-diffusion.cpp, llama.cpp, audio.cpp, the Python packs).
`components_of(spec)` gives those a model requires (FFmpeg for any video). `setup_runner.py` computes the plan (`GET /setup-plan`: only
what is missing, so nothing is downloaded again) and runs it with the existing installers, one at a time, under a single state published by
`setup.progress`; cancellation stops the current step, whose installer deletes the partial files. Deleting a component also deletes
the installed models that depend on it (`components.uninstall`). The server imports `av` only lazily, after having added the FFmpeg add-on
to its `sys.path` (`media.load_av`); without it, sending a video answers 409 with the installation message.

Verification status: the build chain of the shell was written and tested in pieces, **no application has been
assembled or launched end to end** with the template shell.

## Private mode

A private session is **ephemeral** and never goes through `app.db`: Nest keeps it in memory (`back/src/modules/private/`, same public
shapes as normal conversations, so that the front reuses its components), the generation queue is **shared** with normal mode (one generation at a time) and the files of a generation live in `private/<session>/`, served without cache and erased at the end. The engine receives a `private_dir` field on its jobs: it refuses a folder outside the session, keeps no trace of the job and sanitizes its errors. Private chat is **stateless** (the browser sends back the whole history). What the session guarantees, what it cannot guarantee (virtual memory, backups,
SSD, captures) and the detailed design: `back/src/modules/private/README.md` and `front/src/modules/private/README.md`.

## OCR

The OCR tab reads the text of an image or a PDF with a vision model run by llama.cpp (`engine/app/engines/ocr_models.py`), in its own
`llama-server` (`llm.ocr_llm`) so that it stays loaded next to the chat model when both fit under the memory ceiling. The engine owns
the reading (`engine/app/ocr.py`, `POST /engine/v1/ocr/read`, SSE stream: PDF pages rasterized one at a time by pypdfium2, prompt of
the model's task, markers removed); Nest owns what is kept (`back/src/modules/ocr/`: tables `ocr_documents` and `ocr_pages`, files in
`<data>/ocr/<id>/`) and runs a reading in the background, one at a time, holding `EngineBusyGate`; the browser follows it with the
`studio.ocr.updated` events. A reading is not a conversation: it does not go through `studio-core`. Models, tasks, strengths and
limits: `docs/guide.md`, section "OCR"; Hugging Face search: family `ocr-gguf` (`hf_search.py`).

## Chat and generations (creation tools)

The chat model (or a `/image`, `/video`, `/audio` command) can launch a generation of the studios without leaving the conversation. The path
remains that of the studios: the `chat` module never calls the engine for this, it creates a prompt and its generation in `studio-core`
(`GenerationService.create`), **attached to the chat conversation**, and the **queue** sends them to the engine. The chat holds the engine gauge
(`EngineBusyGate`) during its response: the tool gives the hand back at once ("generation launched") and the job leaves when the response has freed
the memory (a single model in memory). The state and files of a card are read from `studio-core` at each read (a single source), the browser is
informed by `studio.*` events; the model of each studio is the one the browser has selected (Nest does not know it: it
sends it with each message). The engine has nothing new. Details and limits (private session): `back/src/modules/chat/README.md`, "Creation tools".

## Interface language

Two languages, `fr` and `en`. **The front owns them**: the choice (Settings > General) is remembered in the browser; without a choice, `LocaleService` takes the system language (French, otherwise English). Each change keeps `<html lang>` and the `Accept-Language` header of the requests up to date (`front/src/locales/registerModuleLocales.ts`, `languageHeaders()` for the `fetch` calls).

- **Nest** reads `Accept-Language` (`back/src/modules/i18n/`) and keeps the last language seen: the application is single-user, a single value also serves what runs outside a request (generation queue). Its messages go through `tr('module.key', [values])`; the dictionaries are `back/src/modules/<module>/i18n/messages.{fr,en}.json`, checked (parity, keys used) by `messages.spec.ts`. A **stored** text (failure of a generation, default title) keeps the language of its writing.
- **The engine** receives the same language (`EngineClient.authHeaders()`). Its texts remain written in French in the code; each JSON response, error detail and event is translated on output by `engine/app/i18n.py` from `engine/app/locales/en/*.json` (French text → English, `{}` for a value). A text added to the code only needs its English entry: `engine/tests/test_i18n.py` fails otherwise (scanner `engine/tests/i18n_scan.py`, which lists the missing texts).
- Texts sent **to a model** (prompts) are not translated; those whose response is displayed to the user require the interface language. The chat response follows the language of the user's message.

## Resting memory

Measured without a loaded model or generation (macOS arm64, Apple Silicon):

| Measure | Engine | Nest | Total | Source |
|---|---|---|---|---|
| H1b, 13/10/2026, `nest build` then `node dist/main.js`, engine started by hand | ≈ 77 MB | ≈ 155 MB | ≈ 232 MB | Nest after connecting to the stream and a few requests; Vite not measured |
| H5, 13/10/2026, same variables as the shell, without Tauri | ≈ 80 MB | ≈ 157 MB | ≈ 235 MB | the Tauri shell and the render window are not counted |

Engine peak at startup: ≈ 0.40 GB (PyTorch probe launched as a subprocess by `warm_up`, which ends); Nest peak
≈ 0.15 GB. During a generation the memory is that of the worker and the model (engine memory planner, `docs/guide.md`).
The H6 measurements (end to end in demonstration mode): peak of ≈ 0.8 GB for the full `studioEngine.e2e.spec.ts` test (Jest, Nest in
memory and engine in a subprocess). They do not replace a measurement of the packaged application, which has not been made.

## The engine: plan

```
engine/app/
  main.py            FastAPI application: routers under /engine/v1 (token), static media under /media/<folder>
  api/               routes: routes.py (models, engines, Hugging Face, status, SSE stream), jobs.py (jobs, ingestion and purge of
                     media), runtime.py (settings pushed), voice_media.py (reference clip, transcription), auth.py (token)
  jobs.py            job queue, worker lifecycle, progress, cancellation, unloading after inactivity
  job_plans.py       JobRequest and pure planning of a generation; job_checks.py, job_outputs.py (description of the outputs)
  worker.py, audio_worker.py, download_worker.py   separate processes: generation, audio, download
  engines/           model registry (specs) and engines: MLX, diffusers, stable-diffusion.cpp, audio, video, custom models
  catalog.py, downloads.py, hf_search.py           catalogue, downloads, Hugging Face search
  system.py          GPU, memory, disk detection; memory planner
  memory_guard.py    memory guard: check before loading, worker monitoring, stop before saturation
  engine_install.py, audio_packs.py, audiocpp.py, llamacpp.py   installers (GGUF engine, audio and video packs, audio.cpp, llama.cpp)
  llm.py             chat and OCR servers (`llama-server`: start, normalized SSE stream); engines/llm_models.py: chat catalogue; engines/ocr_models.py: OCR catalogue
  memory_budget.py   ceiling of the models loaded together and eviction of the least recently used idle one
  ocr.py             reading of an image or a PDF (tasks, prompts, page by page); api/ocr.py: routes
  update_advisor.py, hf_trending.py, private_session.py, video_memory.py   update advisor, Hugging Face novelties, private session, video pass length
  runtime_settings.py  settings pushed by Nest (memory only); engine_state.py  the engine's own state (JSON file)
  legacy_data.py     recovery of the former data folder; events.py  event bus
engine/audio_runtime/, engine/video_runtime/   code run in the isolated environments of the packs
engine/tests/        pytest tests, one file at a time (none loads a model)
```

The worker runs in its own process: the server stays responsive during computation, unloading a model really frees the memory
and a crash (out of memory…) does not take down the application.

### Memory safety nets

On a Mac the processor and the GPU share the same memory: an overflow does not make the program fail, it freezes
or restarts the machine. The protections, from the furthest upstream to the last:

| Net | Where | Effect |
|---|---|---|
| Planner | `system.py` (`memory_plan`) | refuses a model whose weights do not fit in the total memory of the machine ("too heavy" marker, model hidden from the selectors) |
| Check before loading | `memory_guard.preflight`, called by `jobs.py` (`_memory_preflight`) | shared memory only: refuses to load if the **free memory at this moment** does not cover the weights plus the reserve (8 % of RAM, 2.5 GB at least; only 1.5 GB while macOS reports normal pressure, since free + inactive memory is handed out on demand); the message gives the figures; a refused generation, chat reply or OCR reading carries `error_code: memory` (`code: memory` in the chat stream) and offers "Continue anyway" (confirmation, then the same job with `force_memory`: no check, and a watchdog that acts only below 0.6 GB or at critical pressure) |
| Watchdog | `memory_guard.MemoryWatchdog`, thread of the engine's main process, 5 readings per second | as long as a worker lives: below the reserve (the same 1.5 GB under normal pressure), or if macOS signals a critical memory pressure, kills the worker **and its subprocesses** (`sd-cli`); the job fails with "Stopped by the memory protection: …" |
| Former worker stopped before the next | `jobs.py` (`_ensure_worker`, `stop`) | a single model in memory; the stop waits for the end of the process, even when forced |
| Peaks of a generation | `diffusers_engine.py` (`tune_vae`, `_from_pretrained`), `sdcpp_engine.py` (`VAE_TILING_FROM`) | VAE in 512 px tiles, without float32 copy outside float16; weights loaded directly onto the GPU of a Mac; `--vae-tiling` of `sd-cli` from 1 Mpx |
| Ceiling | `memory_budget.py` (setting `memory_limit_gb`, pushed by Nest) | the models loaded together (worker, chat server, OCR server) must fit under one ceiling (80 % of the machine by default, never above what the reserve leaves): before loading, `make_room` unloads the idle models used least recently until the new one fits, or refuses with the figures (a model in use is never unloaded). A separate graphics card cannot be summed: every other model is unloaded as before. A model runs one at a time (no generation while a reply is written) |
| Chat and OCR servers | `llm.py` (`LlmManager`: `llm`, `ocr_llm`), `jobs.py`, `memory_guard.py` | one `llama-server` per role, each watched by its own watchdog; `preflight` (weights + estimated context cache); prompt cache in RAM capped at 1 GiB (`--cache-ram`, 8 GiB by default) |
| Gauge and emergency stop | `memory_stats.py`, `emergency.py`, `components/MemoryMeter.tsx` (left panel) | the share in use is read as the system counts it: on macOS Activity Monitor's "Memory Used" (app + wired + compressed from `vm_stat`, the file cache left out; `psutil`'s figures are not it), elsewhere `total - available`; macOS's own pressure level and the swap come with it; the engine pushes a reading every 2 s (`memory.sample`). The red button (`POST /engine/v1/engine/emergency-stop`) cancels the queued jobs, then kills the worker and the chat and OCR servers (process trees) and leaves each caller the reason; Nest's queues empty their waiting line first (`EmergencyStopService`) |
| Record | engine journal, line `[memory] job …` | free memory at its lowest and peak of the model's processes, for each job |
| Length of video passes | `video_memory.py`, `sdcpp_video_engine.py` (`_generate_chained`) | a long clip of the GGUF image → video models without sound is made in chained passes whose length follows the memory **measured on this machine**: short trial at the first use of a model (a priori cautious), then longer and longer passes (never more than 1.6 times the largest pass already measured) as long as the forecast fits in the available memory minus the reserve. Each pass records the memory actually consumed (`video-memory.json` of the data folder: a cache of measurements, not application data); `sd-cli --max-vram` receives this budget (build 956 or newer, `IMAGEGEN_SDCPP_MAX_VRAM=off` removes it) |

The generations of a single submission (up to 4 images) run one after the other in the same worker, never in parallel.

## Development stack

Launch: `./scripts/run.sh dev` (Nest 3000, Vite 5173, engine 127.0.0.1:8000 via the hook
`scripts-local/dev-services.sh`); details and variables in `docs/guide.md`. Test and memory rules: `docs/guide.md`, section "Tests".
