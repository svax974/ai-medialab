# Module `studio-core`

## Role

The **conversations** and **messages** (user prompts and assistant generations), with the links to their
reference assets, **and the generation queue** ("what next") that drives the engine. The three studios
(image, audio, video) share these tables; `mode` distinguishes the conversation. The **`chat`** mode reuses the `conversations` table (list, title,
pin, deletion) but keeps its messages in the `chat` module (`chat_messages`): see "Modes that keep their messages elsewhere".

Status (task H4.3a): persistence (H2), routes `/api/conversations*` and `/api/messages*` (same URLs and same public shapes
as the former engine API), generation queue, relay of engine events to messages, assets and the browser, resume at startup. The engine does not know about conversations: Nest submits a job per message
(`/engine/v1/jobs`, `job_id` = message id) and receives its events through `EngineEventRelay`.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `StudioCoreModule.ts` | Imports `MediaLibraryModule`, declares the three entities, provides and exports the services. |
| Entity | `entities/ConversationEntity.ts` | Table `conversations` (with `mode`). |
| Entity | `entities/MessageEntity.ts` | Table `messages`. |
| Entity | `entities/MessageRefEntity.ts` | Table `message_refs` (reference assets of a prompt). |
| DTO | `dto/ConversationDto.ts` | Public summary (identical to `conversation_summary` of the former engine, `engine/app/repo.py` removed in H6). |
| DTO | `dto/ConversationDetailDto.ts` | Summary + `messages`. |
| DTO | `dto/MessageDto.ts` | Public shape of a message (identical to `message_public`). |
| Mappers | `mappers/conversationMapper.ts`, `mappers/messageMapper.ts` | Entities to public shapes. |
| Controller | `controllers/ConversationController.ts` | `/api/conversations*` (list, creation, detail, title and pin, deletion). |
| Controller | `controllers/MessageController.ts` | `/api/messages*` (creation, retry, cancellation, deletion, model usage). |
| Controller | `controllers/QueueController.ts` | `GET /api/queue`: the generation queue (initial state of a browser). |
| Service | `services/ConversationService.ts` | `list`, `get`, `getSummary`, `create`, `update`, `touch`, `remove`, `beforeRemove`. |
| Service | `services/ConversationModeRegistry.ts` | Registry where a mode that keeps its messages elsewhere (the chat) declares its summary figures, its content search and what precedes its deletion. |
| Service | `services/EngineBusyGate.ts` | Engine occupancy gauge shared with the chat: held during a response, the queue submits no job while it is held. |
| Service | `services/MessageService.ts` | `get`, `listByConversation`, `create`, `update`, `remove`, `removeMany`, `failInterrupted`, `toDtos`, queue and purge queries (`referencesOf`, `assetsOfMessages`, `assetsOfConversation`, `busyIds`, `childIds`). |
| Service | `services/GenerationService.ts` | Creation, retry, cancellation and deletion of generations; deletion of a conversation (assets and files purged). |
| Service | `services/GenerationQueueService.ts` | **Queue and executor**: one generation at a time, submission to the engine, state machine of messages, browser events, resume. `occupied` and `idle$` (emitted when nothing is running or waiting any more) serve the `private` module, whose generations wait for this queue and hold `EngineBusyGate` during their job. |
| Service | `services/JobRequestBuilder.ts` | Message to body of `POST /engine/v1/jobs` (absolute paths of the references, output folder). |
| Pure | `services/generationParams.ts` | `parseCreateMessage`, `parseRetry` (422), `titleFromPrompt`, `seedsFor`. |
| Pure | `mappers/jobEventMapper.ts` | Merge of progress, browser shape of `job.progress`, `job.output` to an asset row. |
| Types | `types/studioTypes.ts`, `types/jobTypes.ts` | Service inputs, constants (`BUSY_STATUSES`, default title), types of the jobs contract (generated from the engine's OpenAPI). |

Tests: see "Tests" below.

## Language

The texts shown to the user (errors, default titles, failure states) go through `tr('studioCore.…')` (`src/modules/i18n`) and follow the interface language (`Accept-Language` header). Dictionaries: `studio-core/i18n/messages.fr.json` and `messages.en.json` (parity checked by `i18n/messages.spec.ts`).
Texts that are stored (failure of a message, default title of a conversation) are stored in the language of the moment; `isDefaultConversationTitle` / `isDefaultChatTitle` recognise the default title in both languages.

## Dependencies

- `audio-studio` (`VoiceService`, for the `voices` of audio jobs); `media-library` (`AssetEntity`, `AssetService`, `AssetFileService`, `StudioEvents`, `toAssetDto`, `newId`, `nowSeconds`, data folders). Not the reverse.
- `engine` (global): `EngineClient` (typed), `EngineEventRelay` (`events$`, `linkChanges$`), `engineErrorToHttp`.
- `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`, `EventStreamService` via `StudioEvents`).
- Environment variable: `APP_DATA_DIR` (or `IMAGEGEN_DATA_DIR`), the data folder that the engine also reads
  (`uploads/`, `outputs/`, `thumbs/`); without it, no generation can be submitted (explicit error).

## Endpoints exposed (exhaustive)

All **administrator** (the `local-trust` principal is one), plain JSON (`NoTransportCrypt`), same URL and same public shape
as the former engine API (compared, in `controllers/studioRoutes.spec.ts`, with the outputs of `repo.py` captured once, frozen in `legacy-import/testing/expectedPublic.json`). Errors
have Nest's shape (`{ statusCode, message }`) with the same statuses and the same texts as before.

| Method | Endpoint | Response | Errors |
|---|---|---|---|
| `GET` | `/api/conversations?q=&mode=` | list of summaries (pinned first, then `updated_at` descending); `mode`: `image`, `audio`, `video`, `chat` (other value: no filter); `q` also searches the text of chat messages | |
| `POST` | `/api/conversations` `{ title?, mode? }` | detail (`messages: []`); `mode` `audio`, `video` or `chat` (otherwise `image`); default title `Nouvelle création`, `Nouvelle conversation` for the chat; publishes `conversation.updated` | 422 types |
| `GET` | `/api/conversations/:id` | detail with `messages` | 404 |
| `PATCH` | `/api/conversations/:id` `{ title?, pinned? }` | summary; publishes `conversation.updated` | 404, 422 |
| `DELETE` | `/api/conversations/:id` | `{ ok: true }`; stops the generations, deletes messages, assets and files; publishes `conversation.deleted` | (idempotent) |
| `POST` | `/api/messages` `{ conversation_id?, prompt, model_id, params?, reference_ids?, count? }` | `{ conversation_id, user_message, assistant_message }` (the assistant message is `queued`) | 404 conversation, 422 (empty prompt or > 8000, unknown model, reference not found, engine refusal: `a besoin d'une image de référence` (needs a reference image)…) |
| `GET` | `/api/messages/model-usage` | `{ counts: { "<model id>": n } }`: generations completed (`done`) per model, to rank the model selectors | – |
| `POST` | `/api/messages/:id/retry` `{ model_id?, params?, keep_seed? }` | the new `queued` message; publishes `message.updated` | 404, 422 |
| `POST` | `/api/messages/:id/cancel` | `{ ok: true }` | 409 `Cette génération n'est plus en cours.` (this generation is no longer running) |
| `DELETE` | `/api/messages/:id` | `{ ok: true, deleted: [ids] }` (a prompt takes its generations with it); publishes `message.deleted` and `conversation.updated` | 404 |
| `GET` | `/api/queue` | `{ current, queue }`: the message in progress and the waiting messages in execution order (H4.4) | |

Creation: the engine says whether the model can do it (`POST /engine/v1/jobs/check`: known model, references required, voice task,
starting image or source video), returns `max_count` and the model's default parameters; Nest merges
`{ ...defaults, ...params, count }` and draws the seeds (fixed `seed`: `seed + i`, otherwise random, 31 bits). **Everything is checked
before the first write** (no transaction: validations precede insertions).

## Generation queue and state machine

One generation at a time on the engine side; the others wait **in Nest** (`GenerationQueueService`, global FIFO) and the next one is
submitted when the previous one has finished (`job.done`, `job.failed` or `job.cancelled`). The engine's events are processed one by one,
in order (promise chain); those of a job that is not the current one (old interface, late event) are ignored.

```
            submission                job.started              1st job.progress phase=running
 queued ─────────────────▶ queued ──────────────▶ loading ───────────────────────────▶ running
   │  (queued or submitted)    │                      │                                     │
   │ cancellation while queued │ engine refusal       │ job.cancelled                       │ job.done      ▶ done
   ▼                           ▼ (422, 409, unreachable) ▼                                  │ job.failed    ▶ error
 cancelled                    error                 cancelled / error                      │ job.cancelled ▶ cancelled
```

| Engine event | Effect on the message | Browser events |
|---|---|---|
| `job.started` (`params` resolved: dimensions, seeds, steps) | `loading`, `started_at`, `params` replaced | `message.updated` |
| `job.progress` (`phase`, `count`, `index`, `step`, `total`, `eta`, `seconds_per_step`, `stage`, `preview_url`, `load_started_at`) | first time with `phase = running`: `running` | `message.updated` (once), `job.progress` |
| `job.preview` (`url`) | | `job.progress` (with `preview_url`) |
| `job.output` (file produced) | `generated` asset row (id chosen by the engine, `position` = index); ignored if it already exists; file deleted if the message has disappeared | `job.image` |
| `job.done` / `job.failed` / `job.cancelled` | `done` / `error` (+ `error`) / `cancelled`, `finished_at`; the next one is submitted | `message.updated` |

Cancellation: a queued message is cancelled right away (the engine knows nothing about it); the current message is cancelled with the
engine (`POST /engine/v1/jobs/{id}/cancel`) and is settled on `job.cancelled` (while the model is loading, the engine stops the
worker; `sd-cli` is stopped by its engine). A cancellation requested while the job is being handed to the engine is applied
right after. Deleting a message in progress cancels it first; the end event of a deleted message frees the queue silently.

**Resume at startup** (`onApplicationBootstrap`): any message still `queued`, `loading` or `running` becomes `error`
`Interrompu par l'arrêt du serveur` (interrupted by server shutdown) (`failInterrupted`, like the former sweep of `init_db`: a generation is never resumed). **On (re)connection of the engine's stream** (`linkChanges$`): Nest re-reads `GET /engine/v1/jobs`; it cancels the
active jobs of a previous run whose message exists in its database (jobs unknown to Nest, those of the old interface,
are not touched); if the current job is no longer known to the engine (restarted), the message becomes `error` `Le moteur
s'est arrêté pendant la génération.` (the engine stopped during the generation); if it finished during the outage, its files are recorded and the message settled
from `GET /engine/v1/jobs/{id}` (the engine keeps the last 100 finished jobs); then the queue resumes.
Engine unreachable at submission: the message becomes `error` `Le moteur est injoignable.` (the engine is unreachable) and the queue continues.

## Browser events

Published by `StudioEvents` (module `media-library`) on `EventStreamService`, administrator audience, topic **`studio.<name>`**,
`type` = name. **Same names and same payloads as the former engine SSE** (`GET /api/v1/events/stream?topics=studio.message.updated,studio.job.progress,…`):

| Topic | Payload |
|---|---|
| `studio.job.progress` | `{ message_id, conversation_id, phase, count?, index?, step?, total?, eta?, seconds_per_step?, stage?, preview_url?, load_started_at? }` |
| `studio.job.image` | `{ message_id, conversation_id, asset }` (`asset`: public shape) |
| `studio.message.updated` | complete public message (`references`, `outputs` included) |
| `studio.message.deleted` | `{ conversation_id, ids }` |
| `studio.conversation.updated` | public summary (`cover`, `generation_count`, `busy`) |
| `studio.conversation.deleted` | `{ id }` |
| `studio.asset.updated` / `studio.asset.deleted` | public asset / `{ id, message_id, conversation_id }` (published by `media-library`) |
| `studio.queue.updated` | `{ current, queue }`: `current` = message being generated (or `null`), `queue` = ids of the waiting messages, **in execution order, all modes and all conversations** (the current message is not in it). Published at each change (addition, cancellation, moving on, end), never the same queue twice in a row. **New in H4.4**: the former SSE did not have this event; the former interface read `queue` in the engine status (`GET /api/status`, `pending` list); the client derives "position N" (rank in `queue`, the first waiting one shows no position) and "N waiting" (size of `queue`) |

Stream limit: the default of 16 KB is raised to 256 KB for this application (`StudioEventLimitsModule` of `media-library`,
measurements in its README): a `message.updated` of several audio takes with waveforms exceeds 16 KB (33 KB for a
dialogue of 40 lines, 105 KB at worst). The queue is a separate event (and not a field of `message.updated`) because a change of queue touches all the waiting messages at once, not only the one whose state changes. The engine's events (`engine.job.*`, `engine.engine.status`…)
are still relayed as they are by the `engine` module: the migrated components consume `studio.*`.

## Entities

- `ConversationEntity` (`conversations`): `id`, `title`, `pinned`, `mode` (`image` | `audio` | `video` | `chat`, default
  `image`), `createdAt`, `updatedAt` (seconds, float). Index `(mode, updated_at)`.
- `MessageEntity` (`messages`): `id`, `conversationId` (cascade deletion), `parentId` (the prompt a generation answers to, cascade), `role` (`user` | `assistant`), `prompt`, `modelId`, `params` (free JSON: contract with the engine), `status` (`queued`, `loading`, `running`, `done`, `error`, `cancelled`), `error`, `createdAt`, `startedAt`,
  `finishedAt`. Index `(conversation_id, created_at)`. The `CHECK` constraints of the former database (`role`, `kind`)
  are not carried over: the values are typed in TypeScript and normalised by the importer.
- `MessageRefEntity` (`message_refs`): key `(messageId, assetId)`, `position`; deleted with the message or the asset.

Public shapes (snake_case, absent fields set to `null`):

- Conversation: `id, title, pinned, created_at, updated_at, mode, cover, generation_count, busy`. `cover`: last generated image or video asset (never audio); `generation_count`: number of `assistant` messages; `busy`: a message
  `queued`, `loading` or `running`. Detail: + `messages` (from oldest to newest).
- Message: `id, conversation_id, parent_id, role, prompt, model_id, params, status, error, created_at, started_at,
  finished_at, references, outputs` (`references`: reference assets in order; `outputs`: generated assets,
  by `position`).
- List: pinned first, then `updated_at` descending; filters `mode` and `q` (title, prompt of a message or, for the chat, text of a message).

## Modes that keep their messages elsewhere

The chat (module `chat`) depends on `studio-core`, never the reverse. It plugs in through two extension points, without this module importing anything from it:

**Generations launched from the chat** (creation tools): `GenerationService.create({ conversationId })` accepts the conversation of **another mode**, that of the chat: the prompt and its generation are `messages` rows as elsewhere (the queue, the `studio.*` events, the assets and their purge are those of the studio), the conversation keeps its title and its mode. The chat therefore has nothing to add here; it reads the state through `MessageService.get` and deletes through `GenerationService.remove` (`back/src/modules/chat/README.md`, "Creation tools").

- **`ConversationModeRegistry`**: at startup, `ChatBootstrap` registers `{ mode: 'chat', stats, matching, beforeRemove }` there. `ConversationService` asks it for
  `generation_count` (messages of the active branch) and `busy` of a conversation of this mode (`cover` stays `null`), the identifiers of the conversations
  one of whose messages contains `q` (search of the list, capped at 500), and `GenerationService.removeConversation` calls `beforeRemove`
  before deleting the row (the chat stops its current response and deletes the attached files; the rows go by cascade). Without registration, nothing changes.
- **`EngineBusyGate`**: the engine holds only one model at a time. During a chat response the chat holds the gauge (`tryAcquire('chat')`);
  `GenerationQueueService` then submits no job (the messages stay `queued`) and resumes at `released$`. A holder can **offer** the gauge (`setYield`): the chat does so while it writes an automatic title; the queue, a new chat send and `enhance-prompt` then call `preempt()`, which cancels the title and waits for the release (never `busy` because of a title). In the other direction the chat refuses (`busy`)
  as long as `GenerationQueueService.occupied` is true (a short job runs or waits). The engine answers 409 to whoever arrives second anyway: this is the belt, the gauge the braces. Both dependencies are `@Optional()` in the constructor (a setup without chat works as before).

## Extension points

- `ConversationService.remove` and `MessageService.remove` only delete the rows and their cascades; the purge of the assets
  and files is done by `GenerationService` (`AssetFileService.purge`).
- Audio (H4.5, done): `JobRequestBuilder` attaches to `audio` jobs the key `voices`: for each voice of the library used
  (`params.voice` and `params.cast` of the distribution of a dialogue, `{ source: 'library', id }`), `{ id: { path, transcript, name } }`
  (`services/jobVoices.ts`, read by `VoiceService.findByIds` of the `audio-studio` module). An empty `voices` (no voice from the library) tells the engine **not** to consult its own database; a deleted voice is absent and the engine answers `Cette voix n'existe plus dans votre bibliothèque.` (this voice no longer exists in your library).
- Video (H4.6, done, **no code added on the Nest side**: the jobs contract already covers all cases; verified and tested by `services/VideoGeneration.spec.ts`): the references of the prompt
  are attached to the job in the order of the composer (starting image, ending image, source video: `message_refs.position`); the engine chooses the task (`i2v`, `v2v`, `t2v`) from what is attached and what the model accepts,
  ignores what it cannot use and refuses what it requires (`engine/app/job_checks.py`, `job_plans.py`: `a besoin d'une image de départ / d'une vidéo source` (needs a starting image / a source video), returned as 422 at creation);
  `count` is capped at 2 by `max_count`; the resolved settings (size, number of frames, actual duration, definition, task) replace the parameters of the message at `job.started`; the engine's steps
  (`stage`: `fetch`, `sampling`, `decode`, `encode`) go through `studio.job.progress`; each clip is recorded with its **poster** (`thumb`), its duration, its dimensions, the seed and `meta` (`fps`, `frames`, `has_audio`, `task`,
  `strength`…); the retry re-reads the type of each reference to query the engine. The images extracted from a video ("last frame as starting point") are taken in the browser then sent like any image (`POST /api/assets`):
  the engine has no extraction route. Reading: the files go through `/api/media` with `Range` (test `engine/services/EngineMedia.spec.ts`).
- Several engines in parallel: not planned (a single GPU); the queue is global.

## Tests

One file at a time, from `back/`, under `scripts-local/guarded_run.sh 3` (2 for the end-to-end test):

```sh
npx jest --runInBand src/modules/studio-core/services/GenerationQueueService.spec.ts   # queue, state machine, resume, reconciliation, queue event and GET /api/queue
npx jest --runInBand src/modules/studio-core/services/GenerationService.spec.ts        # creation, retry, cancellation, deletions
npx jest --runInBand src/modules/studio-core/services/generationParams.spec.ts         # validation, title, seeds
npx jest --runInBand src/modules/studio-core/services/AudioGeneration.spec.ts           # voices of audio jobs, measurement of the size of audio events
npx jest --runInBand src/modules/studio-core/services/VideoGeneration.spec.ts           # video jobs: inputs in order, clips capped at 2, steps, poster, duration and fps of the asset, retry
npx jest --runInBand src/modules/studio-core/mappers/jobEventMapper.spec.ts            # event matching
npx jest --runInBand src/modules/studio-core/services/EngineBusyGate.spec.ts            # occupancy gauge and queue waiting for the end of a chat response
npx jest --runInBand src/modules/studio-core/controllers/studioRoutes.spec.ts          # public shapes identical to the former API
npx jest --runInBand src/modules/studio-core/e2e/studioEngine.e2e.spec.ts              # end-to-end with the real engine (demo)
```

- `src/testing/studioHarness.ts`: services wired by hand on an in-memory SQLite database, with a scripted engine
  (`ScriptedEngine`), a fake relay (`relay.events$`) and the capture of the published events (`published`, and `queueEvents` apart for `studio.queue.updated`, so that the exact lists asserted elsewhere remain those of the messages and assets).
- `studioRoutes.spec.ts` loads the demonstration database of `legacy-import` and compares the HTTP responses with the outputs of the former engine
  captured once (frozen fixture; the capture script was removed with `repo.py`).
- `studioEngine.e2e.spec.ts` launches the **Python engine as a subprocess** (`IMAGEGEN_DEMO=1`: synthetic images, no model,
  **hardware probe cut off so no torch**), then exercises Nest against it over HTTP and the real event stream: generation,
  queues, cancellation while queued and while running, retry, deletion (files removed by the engine), sending a reference.
  Skipped if `engine/.venv` is absent. Measured peak: 0.75 GB (Jest, engine and worker).
- Parity of the public shapes with the engine: also `legacy-import/publicShapes.spec.ts`.
