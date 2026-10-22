# Module `private` (private generation)

## Role

A **private generation session**: the application stores **no** prompt, result, history, parameter, reference file nor draft of
what is created there (images, audio, video) nor any chat conversation. A session lives in the memory of the Nest process and in a
random folder `<données>/private/<id>`; it is erased on request, when the page is closed, after an inactivity delay
and when the server stops. Nothing is written to `app.db`: no `conversations`, `messages`, `message_refs`, `assets` row.
Results are shown with the studio components (same public shapes); the user can still
download them himself, nothing is kept automatically.

The **private chat** is **stateless**: the conversation lives in the browser page (never `localStorage`, never the server), which sends the whole
history with each request to `POST /api/private/chat`; Nest keeps no message, no title built from what was said, no log. See "Private chat".

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `PrivateModule.ts` | Imports `studio-core`, `media-library`, `audio-studio`, `chat` (its reply, model and prompt improvement services, exported); registered in `AppModule`. |
| Controller | `controllers/PrivateController.ts` | `/api/private/*`: session, conversations, messages, queue, references. Administrator; all responses in `Cache-Control: no-store` (`NoStoreInterceptor`). |
| Multer storage | `controllers/privateUpload.ts` | Raw uploads in `<session>/tmp` (never `uploads/`). |
| Service | `services/PrivateSessionService.ts` | Lifecycle: start (folder 0700, `.metadata_never_index`), end (hooks, memory, folder), inactivity delay, cleanup on process exit and on SIGINT/SIGTERM, sweep at server startup. |
| Service | `services/PrivateStore.ts` | Conversations, messages and assets **in memory**, and their public shapes. |
| Service | `services/PrivateGenerationService.ts` | Creation, retry, cancellation, deletion; submission to the engine with `private_dir`; queue shared with the normal generations. |
| Service | `services/PrivateUploadService.ts` | References: the engine decodes them into `<session>/inputs`, the row stays in memory. |
| Controller | `controllers/PrivateChatController.ts` | `/api/private/chat/*`: streamed reply, prompt improvement, chat attachments. Same prohibitions as the rest (`no-store`, administrator). |
| Service | `services/PrivateChatService.ts` | A stateless reply: validates, takes the engine gauge (`private-chat`), runs the same rounds as the normal chat (`ChatReplyService.streamRounds`, tools included) with a state that writes nowhere, unloads the model at the end of the session. |
| Service | `services/PrivateChatAttachmentService.ts` | Chat attachments in `<session>/inputs/chat_<16 hex>.<ext>` (type recognised by the bytes, same limits as the normal chat), with no description file. |
| Pure | `services/privateChatValidation.ts` | Validation of the body of `POST /api/private/chat` (allow-lists, bounds). |
| Service | `services/PrivateEvents.ts` | Browser event `private.changed`: a kind and identifiers, never content. |
| Pure | `services/privateFiles.ts`, `services/privateMappers.ts` | Session folders, safe names; public shapes (URL `/media/private/<session>/<dossier>/<fichier>`). |
| Test | `testing/privateHarness.ts` | The session wired by hand next to the normal studio (same scripted engine, same relay), on a new data folder. |

No TypeORM entity, hence no migration.

## Language

The texts shown to the user (errors, default titles, failure states) go through `tr('private.…')` (`src/modules/i18n`) and follow the interface language (`Accept-Language` header). Dictionaries: `private/i18n/messages.fr.json` and `messages.en.json` (parity checked by `i18n/messages.spec.ts`).

## Dependencies

- `chat`: `ChatReplyService` (`streamRounds`, `ReplyState`), `ChatModelService`, `PromptEnhanceService`, `buildHistory`, `SseStream`, `chatValidation`, `sniffImage` / `decodeText` / `cleanName`.
- `studio-core`: `parseCreateMessage`, `parseRetry`, `seedsFor`, `titleFromPrompt`, `jobVoices`, event mappers, `GenerationQueueService` (`occupied`, `idle$`), `EngineBusyGate`, DTOs.
- `media-library`: `mediaUrl`, `newId`, `StudioEvents` (`job.progress` only: without content), `studioDataDir`.
- `audio-studio`: `VoiceService` (the voice library is read, never written).
- `engine`: `EngineClient`, `EngineEventRelay`.
- Environment variable: `PRIVATE_SESSION_TTL_MINUTES` (default 30; `0` disables the delay).

## Exposed endpoints (exhaustive)

All **administrator** (the `local-trust` principal is one), plain JSON, `no-store` responses. Without an open session, any route other than those of the session answers **409**.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/private/session` | `{ active, created_at, last_activity, expires_at, conversations, results }` (counts as an activity). |
| `POST` | `/api/private/session` | Opens the session (no effect if it is open). |
| `DELETE` | `/api/private/session` | Ends it: jobs cancelled then awaited, memory forgotten, folder deleted. |
| `POST` | `/api/private/session/leave` | Same, 204 (browser's last word, `sendBeacon`). |
| `GET` | `/api/private/conversations?q=&mode=` | Conversations of the session (same summaries as `/api/conversations`). |
| `POST` | `/api/private/conversations` | `{ title?, mode? }`; mode `image`, `audio`, `video` or `chat` (a chat conversation shell: generic title `Conversation privée` (Private conversation), never built from a message; the content is that of the browser). |
| `GET`, `PATCH`, `DELETE` | `/api/private/conversations/:id` | Detail, title and pin, deletion (files erased). `PATCH` also accepts `message_count` (integer 0 to 100000, chat conversation: the number displayed in the list; a number, never a content). |
| `POST` | `/api/private/messages` | Same as `POST /api/messages` (same validations); the engine is consulted (`jobs/check`) first. |
| `POST` | `/api/private/messages/:id/retry`, `/cancel` | Same as the normal routes. |
| `DELETE` | `/api/private/messages/:id` | Deletes the message and its results (files erased). |
| `GET` | `/api/private/queue` | `{ current, queue }` of the session. |
| `POST` | `/api/private/assets` | Upload of references (field `files`) → `AssetDto[]` (private URLs). |
| `PATCH`, `DELETE` | `/api/private/assets/:id` | Favourite (in memory); deletion (file erased). |

| `POST` | `/api/private/chat` | `{ reply_id, messages: [{ role: user\|assistant, content, attachments?: [{ name, original_name? }] }], settings? }` → **SSE stream** (below). 409 without session, 422 invalid body (including an attachment absent from the session). |
| `POST` | `/api/private/chat/enhance-prompt` | Same as `POST /api/chat/enhance-prompt` (nothing is kept). |
| `POST` | `/api/private/chat/attachments` | Multipart, field `file` (images ≤ 10 MB, text ≤ 1 MB) → `ChatAttachment` (`url`: preview under `/media/private/<session>/inputs/…`). |
| `DELETE` | `/api/private/chat/attachments/:name` | Removes an attachment taken off before sending (the rest is erased with the session). |

Files are served by the engine under `/media/private/<session>/…` (relay `/api/media/…`), `no-store`, without `ETag`.

## Private chat

`POST /api/private/chat`: the browser sends **all** the history (the branch up to the last question, final texts) and the settings; Nest keeps none of it.
SSE stream (`Cache-Control: no-store, no-transform`), the events of the normal chat without `message` nor `title`:

| Event | Data |
|---|---|
| `accepted` | `{ id }`: the reply starts (the browser then adds its messages to its conversation). Before it, a refusal (`busy`, `no_model`, `no_engine`, `upstream`) is an `error` **without** `id`: nothing to undo. |
| `loading`, `reasoning`, `delta`, `tool`, `usage` | as the normal chat (`id` = the `reply_id` of the request). |
| `done` | `{ id, stats, tool_runs }` (the text, the browser already received it). |
| `error` | `{ code, message, id? }`: `id` only if the reply had started. General text for an unexpected error; nothing is logged. |

Cancelling = closing the connection (nothing is emitted). The creation tools (image, video, sound) are **off** in a private session (`parsePrivateChatBody` forces `tools.creation = false`): a private generation goes through `PrivateGenerationService` and its memory, which the stateless chat does not hold. The web tools are **off** unless `settings.tools.web` (the browser asks for it after a confirmation) and a model that calls functions;
the SSRF guard and `throttledFetch` of the chat apply. Attachments live in the session folder. At the end of the session the chat model is **unloaded** (the prompt cache of
`llama-server` lives in its memory) if it was used. The engine gauge is taken under the owner `private-chat` (distinct from `private`, the one of the generations).

**What the engine does not keep** (verified in `engine/app/llm.py` and in `tools/server` of llama.cpp at the pinned tag `b11317`): the command line of `llama-server` contains only the model, the port and settings (the prompt
goes through the HTTP body); the API key goes through the environment; request and response bodies are logged only at *debug* level (`server-http.cpp`), and the engine passes `--log-verbosity 2` so that an environment variable
(`LLAMA_ARG_LOG_VERBOSITY`, `-v`) cannot bring them into the log lines kept for error messages; `--log-prompts-dir`, `--log-file`, `--slot-save-path` are not used (`--no-slots`);
the line `[memory] llm …` is not written when a private reply took place. What stays in the memory of `llama-server`: the prompt cache (setting `--cache-ram`, 8 GB by default), emptied on unloading.

## Shared queue and memory

A private generation **waits** for the normal queue to be empty (`GenerationQueueService.idle$`) then takes `EngineBusyGate` (owner `private`) for the duration of its job: the normal queue and the chat submit nothing during that time, and the private generation does not start during a normal generation or a chat reply. One model in memory at a time, as everywhere.

## What persists or leaks, and what private mode does about it (audit)

| Where | Normal | In private mode |
|---|---|---|
| `app.db` (+ `-wal`, `-shm`) | conversations, messages, references, assets | **nothing** (memory store; tested: row counts unchanged) |
| `uploads/`, `outputs/`, `thumbs/`, `previews/` | references, outputs, thumbnails, previews | **unchanged**: everything goes to `private/<session>/{inputs,outputs,thumbs,previews}` (tested: folders empty after a full stream) |
| Raw multer upload | `uploads/tmp_*` | `private/<session>/tmp`, consumed by the engine |
| Temporary files of the workers (`sdcpp-*`, images, videos, WAV) | OS temporary folder | `private/<session>/tmp` (the worker receives `tmp_dir`) |
| History of the engine jobs (last 100, in memory) | yes, with paths and prompt of the outputs | **no entry** |
| Description of a produced file (`meta`) | contains the prompt | **without prompt** |
| Model errors (`job.failed`) | raw text (cites the prompt, the files) | only the first memory message of the engine is kept, otherwise a generic text |
| Engine log (`engine.log`) | failure trace, line `[memory] job <id>` | **no line** (the job does not appear) |
| Nest log (`back-*.log`, `server.log`) | queue errors | no line from the private module (not even the start or end of a session); engine errors never copied |
| Browser events (replay buffer in memory) | full messages | `private.changed` with ids only; progress without content |
| `video-memory.json` | measurements per model (volume, memory), no prompt | **not written** nor read for writing (`SdcppVideoEngine._generate_chained`: the measurements of a private clip live only for the length of the clip); no `[video-memory]` line; existing measurements are still read |
| Command line of `sd-cli` | contains `-p <prompt>` (visible to other processes during the job) | the prompt and the negative prompt go through **files** (`--prompt-file`, `--negative-prompt-file`, 0600, in the session temporary folder, erased with it) when the build knows them (720 or newer, checked in the sources); otherwise `-p` as before |
| Command line of `audio.cpp` | contains `--text`, `--instruct`, `--reference-text` | **unchanged**: the CLI of the pinned version (v0.9.1) has no "file" option for a single request (only batch modes, `--batch-text-file`, whose output differs); remains a risk listed below |
| `llama-server` (chat) | HTTP body, never the command line; logs without content at the default level | log level fixed at 2; model unloaded at the end of the session; see "Private chat" |
| Private chat: conversation | tables `chat_messages`, `chat_conversation_settings` | **nothing**: the conversation is that of the browser; only the shell (generic title, count) is in Nest's memory |
| Usage counters of the models | computed from `messages` | **not incremented** (nothing in the database) |
| Browser: drafts and remembered settings (`cn-composer`, `cn-video-composer`, `cn-audio-composer`, chat) | `localStorage` | neither read nor written (tested with real stores) |
| Browser: request cache, progress, viewer | memory | emptied on entry and exit |
| Browser: HTTP cache of the media | browser cache | `Cache-Control: no-store`, no `ETag` |
| Page address | `/c/<id>` | same: the id no longer means anything after the session |

## Real guarantees and limits

**Guaranteed** (by tests): no database row, no file outside the session folder, no prompt in the captured events nor logs, drafts not written, counters untouched, shared queue.

**Not guaranteed**: a deleted file is not irrecoverably erased (APFS, SSD); the system memory and swap file are not cleaned; backups (Time Machine) may copy the session folder while it exists (exclusion requested from `tmutil` at startup, at best); the command line of `audio.cpp` contains the text to read as long as it runs (and that of `sd-cli` on an engine older than build 720), visible to the other processes of the user; the prompt cache of `llama-server` stays in memory until the model is unloaded; the chat's web search requests, if enabled, leave the machine; screenshots, clipboard, and what the user saves himself.

## Design decisions

- **Session folder under the data folder** (`<données>/private/<id>`, 0700, never indexed by Spotlight, Time Machine exclusion requested at startup) rather than the OS temporary folder: the engine refuses any path outside the data folder (rule kept, no exception to write nor test) and a single place is to be swept.
- **RAM disk (not retained by default)**: `hdiutil attach -nomount ram://…` (macOS) or `/dev/shm` (Linux) would prevent files from touching the SSD, but they count in the unified memory that the models compete for (critical rule of the project: an overflow freezes the machine). To be reconsidered only with a bounded size and a refusal if free memory does not follow.
- **Inactivity delay of 30 minutes** (`PRIVATE_SESSION_TTL_MINUTES`): any request from the interface pushes it back (the server has no other way to know that the page is open); the page is warned by the `session` event and returns to normal mode.
- **One session at a time**, tied to the server and not to a tab: a page that opens erases that of a previous page ("closing the page erases it"), at the price of not being able to reload the page without losing everything. On closing, `sendBeacon`; at server startup, sweep of `private/` (a session never survives a restart).
- **End of session during a job**: the job is cancelled, the service waits (8 s at most) for the engine to release its files, then deletes the folder; anything recreated after that is swept at the next startup.
- **Page address**: `/c/<id>` stays in the browser history (a random identifier with no content, with no effect after the session).

## Tests

`services/privateFlow.spec.ts` (the proof: full flow, failure that cites the prompt, shared queue, end during a job, deletion), `PrivateSessionService.spec.ts`, `privateMappers.spec.ts` (same fields as the public shapes), `controllers/PrivateController.spec.ts` (routes, 409 without session, reference upload, `no-store`). `services/privateChat.spec.ts` (the private chat: ordered stream, nothing in the database nor outside the session folder, no witness phrase in the logs even when the engine repeats it, cancellation, occupancy, attachments, unloading at the end of the session, validation), `PrivateModule.spec.ts` (wiring). Engine: `engine/tests/test_private_jobs.py`, `test_llm.py` (`TestPrivateReplies`), `test_sdcpp.py` (`TestPromptArguments`, image engine), `test_sdcpp_video.py` (prompt files, measurements not written). Front: `front/src/modules/private/lib/*.spec.ts`.
