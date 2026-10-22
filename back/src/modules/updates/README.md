# Module `updates`

## Role

Checking for updates of the **installed** engines and models, and launching one update at a time. **Delegated to the Python engine** (`engine/app/updates.py`, routes `engine/app/api/updates.py`): it is the engine that knows what is installed and how to compare it. An update is not one more mechanism: it is the existing installer run again (model download, engine or pack installation), whose progress arrives through the usual events. Nothing is updated without a request (no automatic update). **Advisor**: on request, the local chat model reads structured public sources (GitHub for an engine, Hugging Face for a model) and lists the problems reported about the update; Nest **records** the advice (`update_advisories`) and returns it afterwards, even offline. The advice is advisory: it never blocks an update. Application module.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `UpdatesModule.ts` | Controller, services, advisory entity; imports `StudioCoreModule` (engine gauge and generation queue). |
| Controller | `controllers/UpdatesController.ts` | The routes below (administrator, plain JSON). |
| Service | `services/UpdatesService.ts` | One typed call per route; errors via `engineErrorToHttp`; 120 s timeout for the check (reads the Hugging Face and GitHub APIs), 360 s for an analysis. `check` merges the recorded advice; `advise` asks the engine for the analysis, holds the `EngineBusyGate` gauge (owner `update-advice`) and records it. |
| Service | `services/UpdateAdvisoryService.ts` | Records the advice, keeps the 5 most recent per item (`ADVISORY_HISTORY`), attaches them to the rows of a report (`merge`), flags those no longer concerning the proposed version (`stale`). |
| Entity | `entities/UpdateAdvisoryEntity.ts` | Table `update_advisories` (migration `1792061048743-UpdateAdvisories.ts`). |
| DTO | `dto/AdviseBody.ts` | `parseAdviseBody`: validated `{ kind, id, target? }` (allow-list, identifier pattern, 400 otherwise). |
| Mapper | `mappers/advisoryMapper.ts` | Entity to public shape (snake_case). |
| Types | `types/updatesTypes.ts` | `UpdatesReport`, `EngineUpdate`, `ModelUpdate`, `UpdateStarted`, `UpdateAdvisory`, `EngineAdvice`, `AdviceFinding`. |

## Dependencies

`engine`: `EngineClient`, `engineErrorToHttp` (segment `updates` of `ENGINE_API_SEGMENTS`). `studio-core`: `EngineBusyGate`, `GenerationQueueService` (an analysis loads the chat model: not during a generation or a chat reply, and vice versa). `media-library`: `newId`, `nowSeconds`. `dto/UpdateEngineBody.ts`: `parseUpdateEngineBody` (allow-list of the body; keys added by the authentication layer are ignored). Types only: `engines` (`EngineInstallState`, `PackInstallState`) and `model-catalog` (`DownloadProgress`, `ModelKind`).

## Exposed endpoints (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/updates/check` | Admin | Installed engines and installed models, each `current`, `update` or (models) `error`: `UpdatesReport`. Reads the network: several seconds. |
| `POST` | `/api/updates/models/:id` | Admin | Re-downloads the model files that changed on Hugging Face (200, `DownloadProgress`); 404 unknown model, 409: already up to date, not installed, loaded in memory, another download in progress, check in error. |
| `POST` | `/api/updates/engines/:id` | Admin | Reinstalls an engine: `sdcpp`, `audiocpp` or the identifier of a pack (200, installer state). Optional body `{ target }`, allow-list `pinned` (default: the version tested by the application, or a return to it from a more recent build) or `latest` (the latest upstream release, untested: `sdcpp` and `audiocpp` only); any other value: 400. 404 engine not installed; 409: already up to date, no more recent version known (`latest`), generation in progress, engine used by the loaded model, another installation in progress. |
| `GET` | `/api/updates/advisories` | Admin | All recorded advice, from most recent to oldest: `UpdateAdvisory[]`. `stale` is `null` as long as no check has been seen since startup, otherwise `true` when the advice concerns a version that is no longer the proposed one. Displayed before or without a check (offline). |
| `POST` | `/api/updates/advise` | Admin | Body `{ kind: 'engine' \| 'model', id, target?: 'pinned' \| 'latest' }` (400 if invalid; `target`: `latest` only makes sense for an engine). The engine reads the sources and the local model extracts the problems from them (about one minute); the response is recorded and returned: `UpdateAdvisory` (200). 409 with `{ code, message }`: `busy` (generation, chat reply or another analysis in progress), `no_engine` (llama.cpp absent), `no_model` (no chat model installed), `nothing_to_analyse`, `unsupported`; 404 `not_installed`; 502 `no_sources`, `llm_output`; 504 `llm`. |
| `DELETE` | `/api/updates/advisories/:id` | Admin | Deletes an advice (`{ ok: true }`); 404 if it does not exist. |

## The advice (see `engine/app/update_advisor.py`, sole owner of these rules)

`UpdateAdvisory`: `kind`, `item_id`, `from_version` (installed build, or short revision of the cache), `to_version` (targeted release, or fingerprint of what changed on the Hub for a model), `verdict` (`none` | `caution` | `discouraged`, **computed by the code** from the retained findings and the known regressions, never given by the model), `summary`, `findings` (`severity`, `title`, `quote`: an extract copied and **verified** in the source, `url`, `source_kind`), `sources`, `notes` (what could not be read), `llm_model_id`, `created_at`, `stale`. One row per analysis, the last five per item; for a same version, the most recent prevails. `check` merges them into `advice` (engine: the release the update installs) and `latest.advice` (the untested upstream release), and into the `advice` of models (linked to the `fingerprint`); an up-to-date row does not carry one; an advice for another version is returned with `stale: true`.

## What counts as an update (see `engine/app/updates.py`, sole owner of these rules)

Model: a file the model downloads and already owns has a different identifier on Hugging Face. Engine sd.cpp / audio.cpp: an installed build older than the version pinned by the application = recommended and tested update (`state`); an upstream release more recent than the installed and the pinned one is additionally proposed as **`latest`** (untested, with the known regressions of this repository that affect it: table `KNOWN_REGRESSIONS`), which the user can choose after confirmation; a build more recent than the pinned one (installed as `latest`) is never downgraded automatically, but `rollback` allows a return to the tested version. Python pack: dependencies pinned by the application changed since installation. Each engine row carries `advice` and `latest.advice` (the recorded advice, or `null`), each model row `advice`, `revision` and `fingerprint` (what the advice is linked to).

## Events (progress)

No event of its own: `engine.download.progress` (models), `engine.engine.install` (stable-diffusion.cpp), `engine.pack.install` (packs and audio.cpp), then `engine.models.changed`. Payloads: `back/src/modules/engine/README.md`, "Event stream". Each installer runs only one at a time: whoever launches several updates chains them (the front, `updates` module).

## Entities

`update_advisories` (`UpdateAdvisoryEntity`): `id`, `kind`, `item_id`, `from_version`, `to_version`, `verdict`, `summary`, `findings` (JSON), `sources` (JSON), `notes` (JSON), `llm_model_id`, `created_at` (seconds, strictly increasing); index `(kind, item_id, created_at)`. Portable column types (`jsonColumnType()`).

## Tests

```sh
../scripts-local/guarded_run.sh 3 npx jest --runInBand src/modules/updates/services/UpdatesService.spec.ts
../scripts-local/guarded_run.sh 3 npx jest --runInBand src/modules/updates/services/UpdateAdvisoryService.spec.ts
../scripts-local/guarded_run.sh 3 npx jest --runInBand src/modules/updates/UpdatesModule.spec.ts
```

Controller and service on the fake engine HTTP server: refusal without administrator, report relayed, launch (encoded identifier), default `target`, `latest` and refused values (400, nothing reaches the engine), 409 and 404 refusals relayed, engine unreachable (502).

`UpdateAdvisoryService.spec.ts` (in-memory SQLite database): recording and order, history bounded to five per item, deletion, merge into a report (tested release and `latest` without mixing, stale advice, up-to-date item, model fingerprint), `stale` flag of the list. `UpdatesService.spec.ts`, "advice" section: the requested advice is recorded and returned, body validated (eight bodies refused with 400), refusal during a generation or a chat reply, engine refusals relayed with their `code` and gauge still returned, only one analysis at a time. `UpdatesModule.spec.ts`: container wiring.

**Language.** Errors, conflicts (`busy`) and body validations follow the interface language: `i18n/messages.{fr,en}.json`, read by `tr()`. The text of an advice is the one rendered by the engine at the time of the analysis and is kept as is in the database (it does not change language afterwards); the engine has no language parameter for the advisor yet.
