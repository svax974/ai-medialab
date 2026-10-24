# Module `engine`

## Role

Connects Nest to the Python engine (`engine/`, internal FastAPI: models, downloads, jobs, media): a **typed HTTP client**,
a **relay of the engine's event stream** to the browser, a **health probe** and a **media relay**
(`/api/media/*`). The browser only talks to Nest; the engine only listens on `127.0.0.1` and requires the
`X-Engine-Token` header (except `/engine/v1/status` and the `/media/*` files).

Application module (not a shared module); wired in `modules/app/AppModule.ts`, `@Global()`.

## Architecture

| Element | File | Role |
|---|---|---|
| `EngineModule` | `EngineModule.ts` | Declares the providers, provides `HEALTH_CONTRIBUTORS`, exports `EngineClient`, `EngineEventRelay`, `ENGINE_CONFIG`. |
| `engineConfig` | `engineConfig.ts` | `resolveEngineConfig(env)`: URL, token, timeouts (variables below). |
| Generated types | `generated/engineApi.d.ts` | `paths`/`operations` types produced by `openapi-typescript` from `engine/openapi.json`. **Do not edit**: `npm run engine:types`. |
| Type helpers | `types/engineTypes.ts` | `EnginePath<M>`, `EngineRequestOptions`, `EngineResponse`: request, parameters, body and response typed from the schema. |
| `EngineClient` | `services/EngineClient.ts` | Typed client (`get/post/put/patch/delete/request`, `openEventStream`, `buildUrl`, `authHeaders`). |
| `EngineError`, `EngineUnavailableError` | `services/EngineError.ts` | Non-2xx response (`status`, FastAPI `detail`) / engine unreachable or timed out. |
| `EngineEventRelay` | `services/EngineEventRelay.ts` | Subscription to `/engine/v1/events` with reconnection; relays to `EventStreamService`; server stream `events$`. |
| `EmergencyStopService` | `services/EmergencyStopService.ts` | Lets the generation queue and the OCR queue register what they do on the emergency stop (empty their waiting line); `HardwareService.emergencyStop` announces it, then asks the engine. Exported; global module. |
| `SseParser` | `services/sseParser.ts` | Incremental parser of an SSE stream (`event:` / `data:` frames). Exported: the response client of the `chat` module (`EngineLlmClient`) reads the `POST /engine/v1/llm/chat` stream with it. |
| `EngineHealthContributor` | `services/EngineHealthContributor.ts` | The `engine` contribution to `GET /api/v1/health`. |
| `engineErrorToHttp` | `services/engineHttpError.ts` | Engine error to HTTP error of a Nest route (status and message relayed; unreachable: 502). |
| `EngineMediaService`, `EngineMediaController` | `services/`, `controllers/` | Relay of `GET`/`HEAD /api/media/<folder>/<file>` to the engine's `/media/...` (`Range` headers passed through, no token). |
| Test fake engine | `testing/fakeEngine.ts` | Local HTTP server that plays the engine in tests. |

## Dependencies

- `common`: `EventStreamService` (publishing), `HEALTH_CONTRIBUTORS`, `AdminOnlyInterceptor`, `NoTransportCrypt`.
- Dev: `openapi-typescript` (added by `back/package.local.json`; justified because the contract is between two languages).
- No other dependency: native `fetch` for the client and the event relay, `http` for the media relay.

**Why not `throttledFetch`.** This helper of `common` protects third-party APIs with quotas (spacing between calls, retries
with backoff on 5xx, stale responses). For a local process that we own, it would delay calls that must go out immediately
(status, jobs, downloads) and would hide 5xx errors; the client therefore calls `fetch` directly,
with a timeout (`ENGINE_TIMEOUT_MS`) and typed errors.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `ENGINE_TOKEN` | empty | Shared secret, sent as `X-Engine-Token` (the engine reads the same variable). Empty: no header. |
| `ENGINE_PORT` | `8000` | Engine port on `127.0.0.1`. |
| `ENGINE_URL` | `http://127.0.0.1:<ENGINE_PORT>` | Base URL (takes precedence over `ENGINE_PORT`). |
| `ENGINE_TIMEOUT_MS` | `30000` | Timeout of a typed call (overridable per call: `timeoutMs`). |
| `ENGINE_EVENTS_RELAY` | `true` | `false`: do not subscribe to the event stream at startup. |
| `ENGINE_RECONNECT_MIN_MS` / `ENGINE_RECONNECT_MAX_MS` | `1000` / `15000` | Stream reconnection: delay doubled at each failure, capped, +-20% jitter. |
| `ENGINE_IDLE_TIMEOUT_MS` | `45000` | The engine sends `: ping` every 15 s; without any byte for this duration the connection is cut and re-established. |
| `APP_DATA_DIR` | not set | Common data folder: the engine reads it as `IMAGEGEN_DATA_DIR` (set by `scripts-local/dev-services.sh`). |

Development launch: `scripts-local/dev-services.sh` (root README, "Development with the NestJS server").

## Typed client

```ts
constructor(private readonly engine: EngineClient) {}

const status = await this.engine.get('/engine/v1/status');
const system = await this.engine.get('/engine/v1/system', { query: { refresh: true } });
await this.engine.delete('/engine/v1/models/{model_id}', { params: { model_id: id } });
await this.engine.post('/engine/v1/jobs', { body: job });
```

Paths, methods, path and query parameters, JSON body and response type are checked at compile time.
A route missing from the schema, a missing parameter or an incomplete body do not compile. The `{param}` placeholders of the path are
replaced (values encoded). Errors: `EngineError` (the engine answered with a non-2xx status), `EngineUnavailableError`
(unreachable, timeout). Empty or non-JSON response: `undefined`.

**Regenerate the types** after any change to the engine API:

```sh
engine/.venv/bin/python scripts-local/export_engine_openapi.py   # engine/openapi.json
cd back && npm run engine:types                                   # generated/engineApi.d.ts
```

A test (`generated/engineApi.contract.spec.ts`) fails if `engineApi.d.ts` is no longer the one the schema produces; a
Python test (`engine/tests/test_engine_api.py`) fails if `engine/openapi.json` is stale.

## Event stream

`EngineEventRelay` opens `GET /engine/v1/events` at startup (unless `ENGINE_EVENTS_RELAY=false`), reads the stream, and for each
engine event publishes on `EventStreamService`:

- topic **`engine.<event name>`** (e.g. `engine.job.progress`, `engine.engine.status`, `engine.models.changed`,
  `engine.conversation.updated`), `type` = event name, `data` = engine payload;
- audience **`{ admin: true }`**: single-user application, and the principal of local trust mode (`local-trust`)
  is `{ id: 0, admin: true }`, so it receives these events (verified: `matchesAudience` only tests `admin`);
- `linkChanges$` (server) emits `true` at each (re)connection and `false` on disconnection (`SettingsEngineSync` pushes the settings back to it);
- topic **`engine.link`**: `{ connected: boolean }`, published at each state change of the stream (the front re-reads the engine
  state when `connected` goes back to `true`, the engine sending its snapshot at each connection).

**Topics relayed for models and installers** (H4.2; the front subscribes to these, checked in `engine/app/downloads.py`,
`engine_install.py`, `audio_packs.py` and the `/engine/v1/events` stream):

| Topic (browser) | Engine event | Payload | When |
|---|---|---|---|
| `engine.download.progress` | `download.progress` | `DownloadProgress`: `model_id`, `state` (`running`, `done`, `error`, `cancelled`), `done`, `total` (bytes), `rate` (bytes/s), `eta` (s or `null`), `error` | at most every 0.4 s during a download, then at the end; replayed at each connection for downloads in progress |
| `engine.engine.install` | `engine.install` | `EngineInstallState` (stable-diffusion.cpp): `state` (`idle`, `running`, `done`, `error`, `cancelled`), `variant`, `done`, `total` (bytes), `message`, `error` | every 0.4 s during the installation; the current state is replayed at each connection |
| `engine.pack.install` | `pack.install` | `PackInstallState` (audio/video): `state`, `pack`, `name`, `message`, `detail`, `started_at` (s epoch), `size_mb`, `error` | at each step of a pack installation (no percentage); replayed at each connection |
| `engine.setup.progress` | `setup.progress` | `SetupState`: `state`, `model_id`, `steps[]` (`kind` base/engine/model, `state`), `current`, `message`, `detail`, `done`, `total`, `rate`, `eta`, `error` | during the installation of what a model requires (one run: base data, engine, model); the current state is replayed at each connection |
| `engine.llamacpp.install` | `llamacpp.install` | `EngineInstallState` (llama.cpp, the chat engine): same shape as `engine.engine.install` | during the installation; the current state is replayed at each connection |
| `engine.llm.status` | `llm.status` | `LlmStatus`: `state` (`idle`, `loading`, `ready`, `generating`), `model_id`, `variant`, `context_size`, `vision`, `pid`, `started_at`, `last_error` | at each state change of the chat model; replayed at each connection |
| `engine.memory.sample` | `memory.sample` | `MemoryLive` (see `hardware`): memory, models held, ceiling, what runs | every 2 s while the engine runs (`emergency.monitor`) |
| `engine.ocr.status` | `ocr.status` | same shape as `llm.status`, for the OCR model's own server | at each state change of the OCR model; replayed at each connection |
| `engine.models.changed` | `models.changed` | `{}` | end of the PyTorch probe at startup, of a download, of a deletion, of adding or removing a custom model, of a pack or engine (un)installation: the catalogue and `/api/system` must be re-read |

The name `engine.engine.install` is not a typo: prefix `engine.` + event `engine.install`. The relay is generic: every engine event
(so `llamacpp.install` and `llm.status` too) reaches the browser without code specific to the `chat` module.

## Job contract (H4.3a)

The engine is **stateless with respect to application data** for the jobs submitted by Nest: it neither reads nor writes conversations, messages or assets. Routes
reserved for Nest (`X-Engine-Token` header):

| Route | Role |
|---|---|
| `POST /engine/v1/jobs/check` `{ model_id, reference_media }` | Refuses (422, message to display as is) a generation the model cannot do; returns `{ kind, name, max_count, default_params }`. |
| `POST /engine/v1/jobs` `{ job_id, kind, model_id, prompt, params, inputs, output_dir, voices?, private_dir? }` (202) | Queues the job. `private_dir` (private generation, `private` module): the session folder `<data>/private/<id>` where the job keeps ALL its files (outputs, thumbnails, previews, temporary files); `output_dir` must be inside it (422 otherwise), and the engine then keeps no trace of the job (no entry in the history of finished jobs, sanitized errors, no log line, outputs' `meta` without prompt). `inputs`, `output_dir` and the paths of `voices`: absolute and **inside the data folder** (422 otherwise). `job_id` already active: 409. The content (empty prompt, missing reference, model not installed...) is checked at execution time and reported by `job.failed`. `voices` (audio): the caller's library; given, even empty, the engine does not query its own database. |
| `GET /engine/v1/jobs` / `GET /engine/v1/jobs/{id}` | Active jobs / state of a job (`queued`, `loading`, `running`, `done`, `failed`, `cancelled`, `outputs`, `error`); the last 100 finished jobs remain queryable (404 otherwise). |
| `POST /engine/v1/jobs/{id}/cancel` | A queued job stops at once; a running job stops after the current step (while the model is loading, the worker is killed; `sd-cli` is stopped by its engine). 409 if it is no longer running, 404 if unknown. |
| `POST /engine/v1/media/ingest` `{ source_path, asset_id, original_name, content_type, private_dir? }` | Turns a raw upload into a stored reference (PNG or kept video, thumbnail); returns `{ media, filename, thumb, width, height, duration, meta }`; consumes the source file. |
| `POST /engine/v1/media/purge` `{ files: [{ folder, filename, thumb? }] }` | Deletes media files and their thumbnails (names only). |
| `POST /engine/v1/media/voice-reference` `{ source_path, voice_id }` (H4.5) | Prepares a reference clip (mono, 24 kHz, edge silences removed, 1 to 30 s) in `uploads/voice_<id>.wav`; returns `{ filename, duration, peaks }` (120 values); 422 (unreadable, too short, outside the data folder); the source is not deleted. |
| `POST /engine/v1/media/transcribe` `{ path, language?, model_id? }` (H4.5) | Transcription suggestion by the first installed model (Whisper, then Qwen3-ASR): `{ text, language, duration, model }`; 409 with the reason to display if no model or engine is installed, 500 if the model fails. |

Job events (on `/engine/v1/events`, all with `job_id`):

| Event | Payload (in addition to `job_id`) |
|---|---|
| `job.started` | `kind`, `model_id`, `params` (resolved: dimensions, seeds, steps, video task...), `started_at` |
| `job.progress` | `phase` (`loading` while the model loads, `running`), `count`, `index`, `step`, `total`, `eta`, `seconds_per_step`, `stage`, `preview_url`, `load_started_at` (replayed at connection for active jobs) |
| `job.preview` | `index`, `path`, `filename`, `url` (`/media/previews/…`) |
| `job.output` | one produced file: `index`, `media` (`image`, `audio`, `video`), `asset_id` (chosen by the engine: the thumbnail bears the same name), `path`, `filename`, `thumb`, `width`, `height`, `seed`, `duration`, `meta` (model, prompt, steps, seed, compute time; fps, voice, waveforms, markers depending on the media) |
| `job.done` | `outputs` (number of files) |
| `job.failed` | `error` (text to display) |
| `job.cancelled` | `outputs` |

A private job (`private_dir`) publishes the same events, with `/media/private/<session>/…` URLs (previews) and no `prompt` in `meta`.

Safeguards kept: one model loaded at a time, one generation at a time, unloading after inactivity (`keep_alive_minutes`),
cancellation. Thumbnails and media polling stay in the engine (`media.py`, `job_outputs.py`).

Browser side: `GET /api/v1/events/stream?topics=engine.job.progress,engine.link`. Server side, `events$` gives the
events (`{ name, data }`) to a Nest service (H4.3 depends on it to update the messages). Reconnection: delay `min * 2^n` capped,
+-20% jitter, reset after a successful opening; a silent cut is detected by the idle timeout. A prolonged unavailability is logged only once per series.

Limits: an event larger than 16 KB is dropped by `EventStreamService` (logged); `events$` still receives it.

## Media relay

The engine serves its files (`uploads/`, `outputs/`, `thumbs/`, `previews/`) read-only on `/media/<folder>/<file>`,
without a token, on `127.0.0.1`. Nest relays them to the browser under **`/api/media/<folder>/<file>`** (`GET` and `HEAD`, `Range`,
`If-None-Match` and `If-Modified-Since` headers passed through: reading and seeking in audio and video). The `/api` prefix
prevents the SPA fallback of `serveFrontend` (which serves `index.html` for any `GET` accepting HTML outside `/api`) from masking
a media opened in a tab.

- **Security**: `AdminOnlyInterceptor` (the `local-trust` principal is an administrator). No principal or non-admin: 401.
  The browser's `Authorization` header is never passed on. Engine unreachable: 502
  `{ statusCode: 502, message: 'Engine unavailable' }`. The controller is excluded from Swagger.
- Only this path is relayed: the rest of the engine API goes through `EngineClient`, called by the Nest modules.
- **Contract coverage**: `ENGINE_API_SEGMENTS` (`engineConfig.ts`) lists the first segments of `engine/openapi.json`;
  `EngineMedia.spec.ts` fails if the schema gains or loses a segment, so that a new engine area is a conscious decision on the Nest side.
- Known limit: an `<img>` or `EventSource` does not send `Authorization`; outside local trust mode, these resources
  are only reachable with another mechanism (not applicable to this local application).

## Exposed endpoints (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/health` | Public | Route of `common`; this module adds `checks.engine` there: `{ status, events, engine }`. |
| `GET`, `HEAD` | `/api/media/<folder>/<file>` | Admin (`local-trust` included) | Relay of the engine's media (`/media/...`). |

Health: `status: ok` if `/engine/v1/status` answers within 2 s, otherwise **`degraded`** (HTTP 200: the server and the interface
work, only generation is unavailable; the engine is supervised by the launcher or the desktop shell); `events` tells whether the event stream is open.

## Entities

None (persistence lives in `studio-core`, `media-library`, `audio-studio` and `settings`).

## Extension points

- Inject `EngineClient` (full typing) or subscribe to `EngineEventRelay.events$` from an application module.
- A route added to the engine: regenerate `engine/openapi.json` and the types, then update `ENGINE_API_SEGMENTS` if the segment is new.
- `HEALTH_CONTRIBUTORS` is provided here as an array: another contributor must be added to this array (a single
  provider of the token per project).

## Tests

One file at a time, from `back/` (under `scripts-local/guarded_run.sh 3`):

```sh
npx jest --runInBand src/modules/engine/services/EngineClient.spec.ts      # same for the other files of the folder
```

Files: `engineConfig.spec.ts`, `services/{EngineClient,EngineEventRelay,EngineHealthContributor,engineHttpError,EngineMedia,sseParser}.spec.ts`
(local fake HTTP engine, `testing/fakeEngine.ts`), `generated/engineApi.contract.spec.ts` (types up to date).

**Language.** The client sends `Accept-Language` to the engine, which writes its messages in that language; the back's "engine unavailable" text is in `i18n/messages.{fr,en}.json` (`tr()`).
