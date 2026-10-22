# Module `chat`

## Role

The **chat studio**: conversations with a local language model (llama.cpp, driven by the Python engine), organized as a **tree of
messages** (replying, editing a message or regenerating a reply adds a branch; nothing is overwritten), **streamed** replies (SSE),
**attachments** (images for vision models, text files), **web tools** (search and page reading) and **creation tools** (image, video, audio, launched in the studios) for models
that call functions, automatic titling, export, search, and the ✨ prompt-improvement button of the three other studios.

The conversations are those of `studio-core` (`conversations`, `mode = 'chat'`: list, title, pin, deletion and title search
go through `/api/conversations*`); only the **messages** and the **settings** of each conversation live here. The Python engine keeps
no conversation: Nest sends it the whole history on every reply. Application module, wired in `modules/app/AppModule.ts`.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `ChatModule.ts` | Imports `CommonModule`, `MediaLibraryModule`, `AudioStudioModule`, `StudioCoreModule`, `ModelCatalogModule`, `SettingsModule`; declares the two entities, the controller and the services; exports `ChatReplyService`, `EngineLlmClient`, `ChatModelService`, `WebToolsService` and `PromptEnhanceService` (the `private` module's private chat reuses them). |
| Entity | `entities/ChatMessageEntity.ts` | Table `chat_messages`: tree (`parent_id`), `role`, `content`, `reasoning`, `tool_runs`, `generations`, `attachments`, `model_id`, `params`, `status`, `error`, `stats`, `created_at`. |
| Entity | `entities/ChatSettingsEntity.ts` | Table `chat_conversation_settings`: model, system prompt, sampling, context, reasoning, tools, `leaf_id` (leaf of the active branch). |
| Controller | `controllers/ChatController.ts` | `/api/chat/*` (below). Administrator only, plain JSON (`NoTransportCrypt`). |
| Stream | `controllers/SseStream.ts` | SSE response: headers sent with the first event, `: ping` every 15 s, `signal` fires when the client leaves, client that stops reading (more than 1 MB pending) is cut off. `Cache-Control` is chosen by the constructor (`no-cache, no-transform` here, `no-store, no-transform` for the private chat). |
| Service | `services/ChatReplyService.ts` | **Orchestrator of a reply**: creates the messages, queries the engine, relays the stream, tool loop (5 turns at most), batch persistence every 500 ms, cancellation, title. `streamRounds` (the turns of the model and of the tools, storing nothing) is public: the private chat calls it with a `ReplyState` that writes nowhere and `isPrivate = true`. |
| Service | `services/ChatStoreService.ts` | Persistence: tree (siblings, most recent descendant, subtree deletion), settings, search, recovery of interrupted replies. |
| Service | `services/ChatService.ts` | Routes that do not stream: read, settings, branch change, deletion, siblings of a message, model unload, export, search. |
| Service | `services/EngineLlmClient.ts` | Client of the stream `POST /engine/v1/llm/chat` (same URL and token as `EngineClient`, no timeout, cancelled by `AbortSignal`); `complete()` for short replies. The body carries `private: false` (or `true` for a reply of the private chat: the engine then does not write the `[memory] llm` line). |
| Service | `services/ChatModelService.ts` | Which model replies (the requested one, otherwise the conversation's, otherwise the engine default), downloaded, with its engine installed; otherwise a `ChatError` with a text that says what to do. |
| Service | `services/ChatAttachmentService.ts` | Attachments in `<data>/uploads/` (`chat_<16 hex>.<ext>`), type recognized from the bytes, purge, sweep of uploads never used. |
| Service | `services/WebToolsService.ts` | `web_search` (DuckDuckGo, or Brave if a key is entered in the settings) and `fetch_url` (public page as text). |
| Service | `services/CreationToolsService.ts` | The creation tools: `generate_image` / `generate_video` / `generate_audio` schemas built at each reply from the studios' models and their capabilities, execution of a call (generation queued in `studio-core`), `/image` `/video` `/audio` commands, choice card (`confirm`), cleanup when a message is deleted. |
| Service | `services/PromptEnhanceService.ts` | `POST /api/chat/enhance-prompt`: improves an image or video prompt, or a text to be read aloud. |
| Service | `services/ChatBootstrap.ts` | At startup: registers the chat in the mode registry of `studio-core`, ends the replies left `streaming`, sweeps orphan uploads. |
| Pure | `services/chatValidation.ts`, `chatHistory.ts`, `chatExport.ts` | Validation of everything that comes in (allowlists, bounds), history sent to the engine, Markdown / JSON export. |
| Pure | `mappers/chatMapper.ts` | Entities to public shapes (`sibling_ids`, `sibling_index`, preview URL of images). |
| Tools | `tools/ssrfGuard.ts`, `safeFetch.ts`, `htmlText.ts`, `webSearch.ts` | SSRF guard, bounded download of a public page, text extraction, reading of DuckDuckGo and Brave results. |
| Tests | `testing/sse.ts` | Test helpers (engine SSE frames, `Json` type). |

## Dependencies

- `studio-core`: `ConversationEntity`, `ConversationService`, `GenerationService` (`publishConversation`, `create`, `remove`: the creation tools), `MessageService` (state and files of a generation), `ConversationModeRegistry`, `EngineBusyGate`, `GenerationQueueService.occupied`. Not the reverse (see the `studio-core` README, "Modes that keep their messages elsewhere").
- `engine` (global): `EngineClient` (URL, token, `GET /engine/v1/llm/status`), `SseParser`, `EngineSchemas` (type of the body of `POST /engine/v1/llm/chat`, taken from the engine's OpenAPI).
- `model-catalog`: `ModelCatalogService.catalog()` (`llm` capabilities: `tools`, `vision`…; `audio` and `video`: what each creation tool offers). `audio-studio`: `VoiceService` (named voices). `settings`: `SettingsService.braveApiKey()`, `chat_voice_id` (default voice). `media-library`: `uploadStorage`, `uploadsDir`, `newId`, `nowSeconds`.
- `common`: `throttledFetchJson` (every outgoing call of the web tools: spacing per source, retry on 429/5xx, never throws), `AdminOnlyInterceptor`, `NoTransportCrypt`.
- The engine (`engine/app/llm.py`, `api/llm.py`): `POST /engine/v1/llm/chat` (stream), `GET /engine/v1/llm/status`. It refuses an image path outside the data folder.

## Exposed endpoints (exhaustive)

All **administrator** (the `local-trust` principal is one). Nest errors `{ statusCode, message }`: **400** invalid identifier, `q` or `format`;
**404** conversation (absent or from another studio) or message; **409** conflict (`code` in addition: see `enhance-prompt` and deletion during a reply);
**422** invalid body (values out of bounds, unknown attachment, refused file type).

| Method | Endpoint | Body → Response |
|---|---|---|
| `GET` | `/api/chat/conversations/:id` | → `ChatConversation`: `{ conversation: ConversationSummary, settings, messages }` (`messages` = the active branch, root → leaf) |
| `PATCH` | `/api/chat/conversations/:id/settings` | part of `{ model_id, system_prompt, params, context_size, reasoning, tools }` → `ChatSettings`. `params`: `temperature` 0–2, `top_p` 0–1, `top_k` 0–1000, `min_p` 0–1, `repeat_penalty` 0–2, `presence_penalty` and `frequency_penalty` −2–2, `max_tokens` 1–262144, `seed` 0–4294967295, `stop` (8 texts of 64 characters); `context_size` `null` or 256–1048576; `reasoning` `auto` `off` `low` `medium` `high`; `tools` `{ web?: boolean, creation?: boolean }` (merged with the existing ones; `creation` is **enabled by default**). `leaf_id` is not editable here |
| `POST` | `/api/chat/conversations/:id/messages` | `{ content, attachments?: [{ name }], parent_id?, model_id?, creation_models? }` → **SSE stream**. `parent_id` absent: the current leaf; `null`: a new root; otherwise a **reply** message (a user message is refused with 422). `content` may be empty if there is an attachment. `creation_models`: `{ image?, video?, audio? }`, the selected model of each studio (the browser holds it, Nest ignores it otherwise): see "Creation tools". `regenerate` and `edit` take it too |
| `POST` | `/api/chat/conversations/:id/messages/:mid/regenerate` | `{ model_id? }` (`mid` = reply) → **SSE stream**: new reply **sibling** of `mid`, from another model if requested (comparison); the old one stays |
| `POST` | `/api/chat/messages/:mid/generations/:gid/confirm` | `{ seconds? }` or `{ voice_id? }` → `ChatGeneration`: starts the generation of a choice card (`pending`). **422** duration out of the model's bounds, voice gone or absent, generation no longer waiting for a choice; **404** message |
| `POST` | `/api/chat/conversations/:id/messages/:mid/edit` | `{ content, attachments? }` (`mid` = user message) → **SSE stream**: new user message **sibling** of `mid` and its reply. `attachments` omitted: those of the original stay; `[]`: none |
| `POST` | `/api/chat/conversations/:id/leaf` | `{ message_id }` → `ChatConversation`: the leaf becomes the most recent descendant of this message (branch change) |
| `DELETE` | `/api/chat/conversations/:id/messages/:mid` | → `ChatConversation`: deletes the message and its subtree, and the attached files nothing uses any more; the leaf moves to the most recent sibling branch, otherwise to the parent. **409** (`code: busy`) if a reply of this conversation is in progress |
| `GET` | `/api/chat/conversations/:id/messages/:mid/siblings` | → `ChatMessage[]`: the full siblings of `mid` (same parent and same role, itself included, oldest first), whatever the active branch: this is what the reply comparison shows after a page reload |
| `POST` | `/api/chat/model/unload` | → `{ ok: true }`: unloads the chat model from memory (`POST /engine/v1/llm/unload`). **409** (`code: busy`) as long as a reply or a prompt improvement holds the engine (the `EngineBusyGate` gauge), **409** also if the engine refuses it, **502** if it does not answer |
| `POST` | `/api/chat/attachments` | multipart, field `file` (png / jpeg / webp / gif images ≤ 10 MB; UTF-8 text ≤ 1 MB; type checked on the bytes, never on the name or the declared type) → `ChatAttachment` `{ kind, name, original_name, mime, size, url? }` |
| `GET` | `/api/chat/conversations/:id/export?format=md\|json` | → file (`Content-Disposition: attachment`), the active branch |
| `POST` | `/api/chat/enhance-prompt` | `{ kind: 'image'\|'audio'\|'video', prompt, model_id? }` → `{ prompt, model_id }`; **409** with `code` `busy`, `no_model`, `no_engine` or `upstream` |
| `GET` | `/api/chat/search?q=` | → `[{ conversation_id, message_id, snippet }]` (50 at most, case-insensitive substring) |

### SSE stream of a reply

`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (the back's compression and the proxies do not buffer it),
each block `event: <type>` + `data: <json>`, `: ping` every 15 s. The headers leave with **the first event**: a validation error (400, 404, 409, 422)
raised before that is an ordinary HTTP response.

| Event | Data |
|---|---|
| `message` | `{ message: ChatMessage }`: the user message created (not for a regeneration), then the reply created (`status: 'streaming'`, `content: ''`) |
| `loading` | `{ phase: 'starting'\|'loading', model_id, elapsed_s? }`: model loading |
| `delta` / `reasoning` | `{ id, content }`: fragment of the text / of the reasoning of the reply `id` |
| `tool` | `{ id, run: ToolRun }`: start (`running`) and end (`done` or `error`) of a tool call; `run.arguments` shows the request actually sent |
| `usage` | `{ id, stats }`: `prompt_tokens`, `completion_tokens` (cumulated over the tool turns), `tokens_per_second`, `context_size`, `elapsed_ms` |
| `done` | `{ message }`: the final reply (`status: 'done'`, statistics included), emitted **as soon as the reply ends** |
| `title` | `{ title }`: short title found by the model, emitted **after** `done` (see below) |
| `error` | `{ code, message, id? }`: `busy`, `no_model`, `no_engine`, `context_exceeded`, `refused`, `upstream`, `closed`, `invalid` |

A single `done` **or** a single `error` ends the **reply**. The stream closes at `done` when no title is to be produced; otherwise it stays open until `title` (or until failure, cancellation or the title timeout: it then closes without `title`). Refusal **before** any recording (`busy`, `no_model`, `no_engine`, `upstream` from the catalogue): a stream with a single `error` event, no message created.
Cancelling = closing the connection: the engine stops the generation and leaves the model loaded, the message keeps the text received with `status: 'cancelled'` (no event is sent, nobody is listening).

### The automatic title, after `done`

The first exchange of a conversation whose title still comes from the prompt first gets a **provisional title** taken from the prompt (immediately, with the creation of the messages). Once `done` is emitted, a request to the model
(24 tokens, 15 s at most, no reasoning) runs **in the background** and `title` is emitted when it returns, then the stream closes: the interface therefore has the reply, its statistics and its actions from `done`.
During this request the occupancy gauge stays held **but offered** (`EngineBusyGate.setYield`): a new send, a regeneration, an edit, `enhance-prompt` or a generation queued **cancels the title and takes the engine
immediately** (never `busy` because of a title; the queue resumes when the gauge is released). If the client closes the connection after `done`, the title is cancelled silently (the provisional title stays, the reply is untouched).
During the title, `runningIn(conversation)` is false: a message can already be deleted or regenerated.

### Deviations and details relative to the contract agreed with the front end

- `ChatAttachment` has one extra field, **`original_name`** (the name the user chose; `name` is the stored name, the one returned to `POST .../messages`).
- Shape errors (identifier, `q`, `format`) are **400**, those of the body are **422**, as in `studio-core`.
- `edit`: `attachments` omitted keeps the attachments of the original.
- A cancelled or failed reply **stays in the history** (its text is sent back to the model on the next turn); a failed reply without text is dropped from it.
- `usage.prompt_tokens` is that of the **last turn** (the size of the context used), `completion_tokens` the sum of the turns.

## Tree and settings

A message has a `parent_id`; its **siblings** are the messages with the same parent and the same role, in creation order (`sibling_ids`, `sibling_index`: the front shows `‹ 2/3 ›`).
The **active branch** is the path from the root to `leaf_id`. Replying, editing a user message and regenerating a reply create children / siblings;
changing branch moves the leaf. Creation dates are strictly increasing within the process (two messages created in the same millisecond keep their order).
Deleting a conversation deletes everything by cascade (foreign keys) and, through `beforeRemove`, stops the reply in progress and deletes the attached files.

The history sent to the engine: the system prompt (if not empty), then the active branch up to the message being replied to — final texts only (the `tool_runs` are not replayed),
text files at the head of the message in a `<fichier nom="…">…</fichier>` block, images as `image_url` parts with their path under the data folder.

## Arbitration with generations (one model at a time)

The engine holds only one model in memory (unified memory) and answers **409** to the second caller. On the Nest side:

- a chat reply takes `EngineBusyGate` (`tryAcquire('chat')`) for its whole duration, title included, and releases it in every case (end, error, cancellation). During the title it **offers** it (`setYield`): `ReplyService.run`, `PromptEnhanceService` and `GenerationQueueService` call `gate.preempt()`, which cancels the title and gives the engine back on release;
- `GenerationQueueService` submits no job while the gauge is held and resumes on its release (the messages stay `queued`);
- the chat answers `busy` (text: `Une génération d'image, d'audio ou de vidéo est en cours ou en attente…` (an image, audio or video generation is running or queued…)) as long as `GenerationQueueService.occupied` is true, and `busy` (`Une réponse est déjà en cours…` (a reply is already in progress…)) if the gauge is held;
- `enhance-prompt` follows the same rules; it prefers the chat model already loaded (no reloading), otherwise the engine default.

## Web tools

Active only if `settings.tools.web` **and** the model calls functions (`llm.tools`). At most **5 tool turns** per reply (the sixth call no longer offers a tool: the model must answer).
A tool that fails is a `ToolRun` in error whose text is sent back to the model (`Erreur : …` (error: …)), not a failure of the reply.

- `web_search(query, count ≤ 10)`: **DuckDuckGo** (`html.duckduckgo.com/html/`, no key; page read with regular expressions: markup checked on 2026-10-15, unofficial, may change or be rate-limited) or **Brave Search** (API, header `X-Subscription-Token`) when a key is entered in the settings
  (`PUT /api/settings { brave_api_key }`, encrypted, never returned nor logged, never sent to the engine nor put in a `ToolRun`).
- `fetch_url(url)`: text of a public page (20,000 characters at most). **SSRF guard** (`tools/ssrfGuard.ts`, `safeFetch.ts`): `http` / `https` schemes only, no credentials in the address, ports 80 / 443 / 8080 / 8443, local names
  (`localhost`, `*.local`, `*.internal`, names without a dot…) and private, local, reserved or cloud-metadata literal addresses (IPv4 and IPv6, including `::ffff:a.b.c.d`, NAT64, 6to4, Teredo) refused; **all** the addresses of a name must be public
  (a single private one and the name is refused); resolution is done **by the call that opens the connection** (`lookup` of `http.request`): a name that changes its answer between the check and the connection (DNS rebinding) cannot reach a private address;
  the address of the connected socket is checked again; at most 3 redirections, each `Location` revalidated; body limited to 1.5 MB and read only for text types; no script executed (the HTML is never rendered).
- Every outgoing request goes through `throttledFetchJson` (spacing per source: 1.5 s DuckDuckGo, 1 s Brave, 0.5 s pages; one retry on 429 / 5xx).
- Privacy: search requests **leave the machine**. They are visible in the message (`tool_runs[].arguments`), and the tool is disabled by default (per conversation).

## Creation tools (image, video, audio)

Active only if `settings.tools.creation` (by default) **and** the model calls functions, and for each studio whose browser sends a model (`creation_models`, read from the selection of each studio) that is **ready** in the catalogue: without a ready model, the tool is not offered.
The schemas are **rebuilt at each reply** from the model's capabilities (never fixed); they go with the web tools in the same 5-turn loop (`ChatReplyService.streamRounds`, parameter `creation`).

- `generate_image(prompt, aspect?)`: `aspect` among `1:1`, `16:9`, `9:16`, `4:3`, `3:4`; the rest comes from the model's default parameters.
- `generate_video(prompt, seconds?)`: the description gives the bounds of **this** model (`min_seconds`–`max_seconds`, default `default_seconds`). Without `seconds`, **nothing is launched**: the message receives a generation `pending: 'duration'` (choice card, slider bounded by the model) and the model learns it has no need to call the tool again.
- `generate_audio(text, …)`: exposes only what the model accepts (`AudioCaps`): `voice` (names from the library, if the model clones, and the model's predefined voices, listed in the description), `voice_description` if the model creates a voice from a description (`design`), `style` if it takes an instruction (`instruct`), `language` if it has several languages, `text` bounded by `max_chars`. The last two go into `params.instruct` / `params.language`. A model with a `task` other than `tts` (sounds, music: none in the catalogue to date) takes `description` (+ `seconds`) instead of a text and a voice; a transcription model (`stt`) has no tool. The voice is required **only** if the model clones without a predefined voice (`clone = required`): named voice, otherwise the **chat default voice** (`chat_voice_id`, application setting), otherwise a choice card (`pending: 'voice'`). An unknown voice is an error sent back to the model with the list of voices.

A call creates the generation with the model's default parameters via `GenerationService.create`: a prompt and its reply **attached to the chat conversation** (`messages` rows of `studio-core`: the files belong to the conversation, their origin is "chat", deleting the conversation takes them along) and queued. The tool gives the hand back **immediately** (`génération lancée` (generation started)): the chat model holds the gauge, the queue submits the job only when it is released. A refusal by the engine (422 of the `jobs/check` check) is an error readable by the model, as for the web tools.
The model concludes in one sentence (it does not see the result). The conversation stays "busy" (`busy`) as long as the generation waits or runs: the chat does not answer before its end.

**Commands** `/image …`, `/video [Ns] …`, `/audio [voix :] …` (start of the message, no attachment, `tools.creation` active): recognized **before** the model, which is not loaded and does not hold the gauge; reply = a fixed sentence (`Génération lancée…` (Generation started…)). A name before the colon is taken as a voice only if it designates one of the model's or the library's. Without a ready model in the studio: `no_model` error without creating anything; empty text: `invalid`.

**Storage**: `chat_messages.generations` (JSON, nullable) holds, per generation, `{ id, kind, model_id, message_id, prompt, params, pending? }`. The **state side** (`state`, `error`, `assets`) is not copied there: `ChatStoreService` reads it from `studio-core` at each read (`MessageService`, by `message_id`), so a single source; `state: 'pending'` as long as a card waits for a choice, `cancelled` if the studio's message has disappeared. The front is notified through the `studio.*` events already published by the queue (`message.updated`, `job.image`): see the chat README on the front. Deleting a chat message deletes its generations (stopped if they run, files purged: `CreationToolsService.discard`).
**Private chat**: the creation tools are **turned off** there (`creation: false` imposed by `parsePrivateChatBody`): a generation of the private session goes through `PrivateGenerationService` and its memory, which the stateless private chat does not handle yet.

## Entities

- `ChatMessageEntity` (`chat_messages`): `id`, `conversationId` (cascade), `parentId` (cascade), `role` (`user` | `assistant`), `content`, `reasoning`, `toolRuns` (JSON), `generations` (JSON, nullable: `StoredGeneration[]`), `attachments` (JSON: `kind`, `name`, `original_name`, `mime`, `size`), `modelId`, `params` (JSON: sampling and reasoning of the turn), `status` (`done` | `streaming` | `error` | `cancelled`), `error`, `stats` (JSON), `createdAt` (seconds, float). Index `(conversation_id, created_at)` and `(parent_id)`.
- `ChatSettingsEntity` (`chat_conversation_settings`): `conversationId` (primary key, cascade), `modelId`, `systemPrompt`, `params` (JSON), `contextSize`, `reasoning`, `tools` (JSON), `leafId` (no foreign key: a deleted branch moves the leaf in the code). Created at the first setting or the first reply.
- Migrations `1792058442183-ChatTables.ts` (portable columns: `jsonColumnType()`) and `1792070000000-ChatGenerations.ts` (`chat_messages.generations`, nullable).
- `ChatSettingsEntity.tools` is a JSON: `creation` is added to it without migration (absent = active).

Attachments: files `chat_<16 hex>.<ext>` in `<data>/uploads/` (the engine reads them by absolute path, the browser sees the images through `/api/media/uploads/<nom>`) and a description `uploads/chat-meta/<nom>.json`.
An edited message shares the files of the original: a file is deleted only when no message of the conversation uses it. At startup, uploads older than a day and never used are deleted.

## Recovery at startup

A reply left `streaming` (abrupt stop) goes to `error` with `Réponse interrompue par l'arrêt de l'application.` (reply interrupted by the application shutting down), its text kept (`ChatStoreService.failInterrupted`, as `MessageService.failInterrupted`).

## Extension points

- A new tool: its schema in `WEB_TOOL_SCHEMAS` (`WebToolsService.ts`), its execution in `WebToolsService.run`, its name in `ToolRun.name`; the engine and the stream know nothing about it.
- A new creation tool (or the `task` of a new audio model, sounds / music): its schema in `CreationToolsService.schema` / `audioSchema`, its execution in `fromArguments`, its name in `CREATION_TOOL_NAMES` and `ToolRun.name`; the capabilities come from the catalogue, nothing to change in the engine or the stream.
- Another search provider: a parser in `tools/webSearch.ts` and a branch in `WebToolsService.search`.
- `WEB_TOOL_DEPS` (token of `WebToolsService`) replaces the reading of the Brave key, the download and the search transports: this is what the tests inject.
- The ✨ button's instructions: `ENHANCE_INSTRUCTIONS` (`PromptEnhanceService.ts`).

## Tests

One file at a time, from `back/`, under `scripts-local/guarded_run.sh 3` (no real engine: a fake local HTTP engine that broadcasts SSE frames):

```sh
npx jest --runInBand src/modules/chat/controllers/ChatController.spec.ts     # routes: stream, headers, refusals, branches, siblings, unload, attachments, export, search, ✨, client closing
npx jest --runInBand src/modules/chat/controllers/ConversationChatMode.spec.ts # /api/conversations with mode=chat
npx jest --runInBand src/modules/chat/services/ChatReplyService.spec.ts      # reply, title, cancellation, tools, regeneration, edit, gauge
npx jest --runInBand src/modules/chat/services/ChatStoreService.spec.ts      # tree, leaf, deletion, cascade, search, recovery
npx jest --runInBand src/modules/chat/services/EngineLlmClient.spec.ts       # engine stream, refusals, cut, cancellation
npx jest --runInBand src/modules/chat/services/ChatAttachmentService.spec.ts # type by bytes, purge, sweep
npx jest --runInBand src/modules/chat/services/ChatBootstrap.spec.ts        # hook on shared conversations, deletion, recovery
npx jest --runInBand src/modules/chat/services/WebToolsService.spec.ts       # web tools with fake providers
npx jest --runInBand src/modules/chat/services/CreationToolsService.spec.ts  # creation tools: schemas by capabilities, calls, commands, choice cards, cleanup
npx jest --runInBand src/modules/chat/tools/ssrfGuard.spec.ts                # SSRF guard: addresses, URL, resolution, rebinding
npx jest --runInBand src/modules/chat/tools/safeFetch.spec.ts                # redirections, socket address, types, size
npx jest --runInBand src/modules/chat/services/chatValidation.spec.ts        # all validations
```

Also: `mappers/chatMapper.spec.ts` (state of a generation), `studio-core/services/GenerationService.spec.ts` (a generation attached to a chat conversation), `chatHistory`, `chatExport`, `ChatModelService`, `PromptEnhanceService`, `tools/htmlText`, `tools/webSearch` (same folders), `studio-core/services/EngineBusyGate.spec.ts` (gauge and queue), `migrations/tests/migrations.spec.ts`.

**Not verified**: no real `llama-server`, no real image, video or sound model launched by a tool (the catalogue, the queue and the engine are fakes; the reliability of small models (1 to 4 B) in filling the tool arguments is not measured: the `/…` commands are the reliable fallback), nor the time to reload the chat model after a generation; no real model nor real network call was used in these tests (the DuckDuckGo page serving as a model for the parser was read once by hand, on 2026-10-15); the behavior of the stream behind a reverse proxy is not measured
(the headers are those the template documents for its own streams).

## Language

Any text the back shows to the user (HTTP and SSE errors, validation, export labels, status messages of a tool)
goes through `tr('chat.…', [params])` (`src/modules/i18n`) and follows the interface language (`Accept-Language`). The texts are
in `chat/i18n/messages.fr.json` and `messages.en.json` (same keys, same `{0}`), checked by `i18n/messages.spec.ts`. The
outgoing web requests (`web_search`, `fetch_url`) send `Accept-Language` in the order of the interface language
(`tools/acceptLanguage.ts`). Deliberately kept in French, the texts meant for the model (system prompts, tool descriptions
and results): the model answers in the language of the user's message.
