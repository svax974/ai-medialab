# Module `model-catalog`

## Role

Model catalogue, downloads, custom models and Hugging Face search, **delegated to the Python engine** (the
registry, the memory-fit calculation, hardware compatibility, downloads and search live in
`engine/app/catalog.py`, `downloads.py`, `hf_search.py`, `engines/custom.py`). Nest hosts the routes (same URL, same shape
as the old engine API), applies administrator authentication and translates errors. It persists nothing. Application
module. Task H4.2.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `ModelCatalogModule.ts` | Controller and service (`EngineModule` is global). |
| Controller | `controllers/ModelCatalogController.ts` | The routes below (administrator, plain JSON, `NoTransportCrypt`, excluded from Swagger). `models/custom` is declared before `models/:id/...`. |
| Service | `services/ModelCatalogService.ts` | One typed call of the engine client per route; errors via `engineErrorToHttp`. |
| Types | `types/modelCatalogTypes.ts` | `ModelCatalog`, `ModelInfo`, `DownloadProgress`, `HubResult`, `HubInspect`, `HubTrending`, `TrendingEntry`... (engine shapes). |

## Dependencies

`engine`: `EngineClient` (typed from `engine/openapi.json`), `engineErrorToHttp` (engine status and message relayed; engine
unreachable: 502 `Engine unavailable`). The settings `quantize`, `variant` and `hf_token` are in the `settings` module (pushed to the
engine): changing a quantization goes through `PUT /api/settings`, not through this module.

## Chat models (`kind: 'llm'`)

The engine catalogue contains models with `kind: 'llm'` (engine `llamacpp`); Nest lets them pass without transforming them. Types
(`types/modelCatalogTypes.ts`): `ModelKind` adds `llm`, `ModelInfo.llm` carries `LlmCapabilities` (`context_default`, `context_max`,
`vision`, `tools`, `reasoning`: `none` | `toggle` | `always` | `levels`, `moe`, `params_b`, `active_params_b`), `ModelCatalog.llm` summarizes the type
(`default_model_id`, `recommended_model_id`, `ready`). The `chat` module uses them (`ChatModelService`) to choose the model, know whether it reads
images and whether it calls functions.

## Exposed endpoints (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/models` | Admin | Catalogue: `models[]` (installation, compatibility, memory plan, variants, download in progress) + summaries `default_model_id`, `recommended_model_id`, `ready` (image at the top level, `audio`, `video`, `llm` and `diagram` nested). |
| `POST` | `/api/models/:id/download` | Admin | Starts the download (200, `DownloadProgress`); 404 unknown model, 409 engine refusal (already in progress, no room...). |
| `DELETE` | `/api/models/:id/download` | Admin | Cancels; 409 if nothing is in progress. |
| `DELETE` | `/api/models/:id` | Admin | Deletes the files (response once the space is freed): `{ freed_gb, also_affects }`; 409 if the model is loaded. Timeout 120 s. For a variant quantized locally (MLX, e.g. Qwen Image Edit), only deletes the quantized result: the full copy (bf16) it was produced from is never deleted by this route (see the next route). |
| `DELETE` | `/api/models/:id/source/bf16` | Admin | Frees the full copy (bf16) of an MLX model quantized locally, once at least one quantized variant is installed: `{ freed_gb }`; 404 unknown model, 409 if no quantized variant is installed (otherwise the model would become unusable) or if the model is loaded. Timeout 120 s. |
| `POST` | `/api/models/custom` | Admin | Adds a Hugging Face repository: body `{ repo, option? }` (`option`: `default`), response `{ model_id }`; 400 without `repo`; 422 relayed if the repository is unusable. |
| `DELETE` | `/api/models/:id/custom` | Admin | Removes an added model and its files: `{ freed_gb }`; 404 if it is not a custom model, 409 if it is loaded. |
| `GET` | `/api/hf/search?kind=&q=` | Admin | `{ results: HubResult[] }` (executable formats only, memory fit per machine, `precisions`: quantizations read from the file list, without an extra request; exact sizes: `inspect`); 502 if Hugging Face is unreachable. `kind`: `image` (default), `audio`, `video`, `llm` (chat GGUF models, family `llm-gguf`); any other value: 400 (allowlist `HUB_SEARCH_KINDS`, nothing reaches the engine). |
| `GET` | `/api/hf/trending?kind=&days=&limit=&include_heavy=&refresh=` | Admin | "New": `HubTrending` = recent Hugging Face models **that are successful and compatible with the machine** for a type, best first, at least good (see "New" below). Parameters validated here (allowlist, otherwise 400, nothing reaches the engine): `kind` `image` (default), `audio`, `video`, `llm`; `days` integer 7 to 365 (90); `limit` integer 1 to 30 (12); `include_heavy` and `refresh` `true`/`false` (`false`). 502 if Hugging Face is unreachable. |
| `GET` | `/api/hf/inspect?repo=` | Admin | `HubInspect`: license, notes, quantizations with `fits`/`fit_note` and `download_gb` (file + files shared with the reference model that are absent from the cache, what adding really downloads); 422 relayed if the repository is unreadable; 400 without `repo`. |

These segments (`models`, `hf`) delegate to the engine through `EngineClient`.

## New (`GET /api/hf/trending`)

Nest only relays; the calculation is in `engine/app/hf_trending.py` (route `GET /engine/v1/hf/trending`, segment `hf`), **without a language model**. A repository is listed if it is: created within the window (`days`; the Hub does not filter by date: the filter is on the engine side); "successful" (likes AND downloads over the last 30 days at least equal to the threshold of the type: image 15 / 2,000, audio 8 / 250, video 10 / 2,000, chat 100 / 20,000: heuristics read on the real Hub in October 2026, editable in `THRESHOLDS`); from a family the application knows how to add (`hf_search.classify`) and readable by `hf_search.inspect` (therefore addable); neither restricted access, nor private, nor marked for adults, nor named "uncensored / abliterated / nsfw…"; absent from the catalogue (counted in `hidden.existing`); compatible with the machine (engine of the family available or installable AND proposed variant that fits in memory: same verdicts as the search; the others are counted in `hidden.heavy` and returned only with `include_heavy`). At most 3 repositories per reference model (a popular model gets re-quantized by dozens). Ranking: the Hub's `trendingScore`, then downloads. Each entry carries name, author, family, age, downloads, likes, license (`license_note`: `noncommercial` or `custom` if it is not a common open license), proposed variant (`option`: the same rule as the details of an addition, the smallest when none fits) with its download size, memory verdict and link. The Hub is queried once per family and per sort (`trending_score`, `created_at`, 100 repositories), the survivors (24 at most) are inspected in parallel; the result stays **one hour in the engine's memory** per (type, window); `refresh=true` is ignored if it is less than one minute old (Hub rate limits). The user's Hugging Face token is reused if one exists.

## Events (progress)

Nothing is polled: the engine publishes, `EngineEventRelay` relays, the browser subscribes to `GET /api/v1/events/stream?topics=…`:
`engine.download.progress` (progress of a download: bytes, rate, remaining time), `engine.models.changed` (catalogue to re-read). Payloads and frequency: `back/src/modules/engine/README.md`, "Event stream".

## Entities

None.

## Extension points

`ModelCatalogService` is exported: H4.3+ can read the catalogue (`catalog()`) to validate the model of a job.

## Tests

```sh
../scripts-local/guarded_run.sh 3 npx jest --runInBand src/modules/model-catalog/services/ModelCatalogService.spec.ts
```

Controller and service on the fake HTTP engine (`engine/testing/fakeEngine.ts`): refusal without administrator, catalogue relay,
download (URL encoded), 409/422 refusals relayed with their message, route order (`models/custom`), search and inspection,
engine unreachable (502), "New" (default values, parameters relayed, 11 values refused with 400 before the engine, administrator
required, engine refusal relayed).

**Language.** Parameter validation errors follow the interface language: `i18n/messages.{fr,en}.json`, read by `tr()`.
