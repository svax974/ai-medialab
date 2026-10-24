# Module `chat` (front)

## Role

The **Chat mode**: conversation with a local language model (run by llama.cpp on the engine side). The home page (`/chat`), the **thread** of a conversation (`/c/:id` when `mode = 'chat'`),
the **composer** (attachments, model, system instruction and personas, settings, web search, **creation tools** and their `/…` commands, context gauge, send / stop), the **rendering** of answers (safe Markdown, coloured code,
model reasoning, tool calls, **generation cards** (image, video, sound), statistics), the **branches** (regenerate, edit a message, compare two models), the export, the search in messages and the state of the model
in memory. Back: `back/src/modules/chat/README.md` (routes `/api/chat/*`, SSE stream); engine: `engine/app/llm.py`, `engine/app/api/llm.py`. Conversations (list, title, pin, deletion)
are those of `studio-core` with `mode = 'chat'`; chat messages are in the tables of `back/src/modules/chat` (tree: `parent_id`).

## Structure

```
chat/
  index.ts                          exports: ChatHome, ChatConversationView, LlmStatusChip, useLlmEvents, useChatSearch, chatApi, useChatLiveStore, types
  types.ts                          ChatMessage, ChatGeneration, CreationModels, ChatSettings, ChatConversation, ToolRun, ChatStreamEvent, LlmStatus... (public shape of Nest, snake_case)
  services/chatApi.ts               REST routes (studioRequest); `streamAnswer`: fetch + SSE stream (read by `readSse` of the template); paths of the three ways of requesting an answer
  services/privateChatBackend.ts    the chat of a **private session**: the conversation (settings and message tree) kept in the page's memory (`private/lib/privateChatMemory.ts`), never `localStorage` nor server; `privateChatApi` answers what `chatApi` reads/writes, `streamPrivateAnswer` replaces `streamAnswer` (calls `POST /api/private/chat`, same events)
  lib/privateTree.ts                the message tree in memory (siblings, active branch, last leaf, deletion of a subtree, history sent to the server, export): pure, tested
  services/answerRunner.ts          `startAnswer` / `stopAnswer`: starts an answer and writes it into the TanStack cache as the stream goes; only one answer at a time; continues if the page is left
  state/chatLiveStore.ts            per conversation: model loading, error, stop controller; and the chat model state (`llm.status`) (Zustand)
  state/chatDraftStore.ts           draft per conversation (`cn-chat-drafts`, text only), attachments in progress, send handed over by the home page, messages already seen (comparison)
  state/chatDefaultsStore.ts        home page settings = starting settings of new conversations (`cn-chat-defaults`)
  hooks/useChat.ts                  conversation (query; re-read while a message remains `streaming` without an answer read here), settings (saved 500 ms after the last change), model of the conversation, full-text search
  hooks/useSiblings.ts              reads the sibling answers never seen (`GET …/siblings`) so that the comparison survives a reload; hooks/useElapsedSeconds.ts: clock of a wait
  hooks/useChatActions.ts           regenerate (same model or another), edit, change branch, delete, stop
  hooks/useCreationModels.ts        the active model of each studio (image, video, audio; those that are ready): `creation_models` of each send, regeneration and edit
  hooks/useGenerationSync.ts        re-reads the conversation when a `studio.*` event concerns the job of a card (state, files, deletion), coalesced, never while an answer is being written
  hooks/useChatSubmit.ts            sending from the composer; from the home page: creates the conversation, gives it the home page settings, opens it
  hooks/useAttachments.ts           attachments: check, upload (`/api/chat/attachments`), removal
  hooks/useLlmEvents.ts             subscription to `engine.llm.status`; hooks/useThrottled.ts, hooks/useModelName.ts
  lib/creation.ts                   commands offered after the `/`, displayed state of a card, `creation_models` of a request (`withCreation`), bounds of the duration slider; lib/generationEvents.ts: which studio events concern the cards; lib/settingsMerge.ts: merging of settings (partial `tools`)
  lib/sse.ts                        `toChatEvent`: SSE block -> typed event (an unreadable block is ignored)
  lib/streamReducer.ts              applies an event to the cached conversation (pure); `placeMessage`: a new branch replaces the continuation of the old sibling
  lib/branches.ts                   position among siblings (‹ 2/3 ›), answers to compare
  lib/context.ts                    context filling, requested context, "does the context change?" (reload), loading text
  lib/presets.ts                    server defaults, presets, settings form schema, thinking levels, personas
  lib/attachments.ts, errors.ts, markdownSafety.ts, estimate.ts, chatKeys.ts   attachment rules (stored names, displayed name `displayName`, server limits); error code -> text and action (`memory`: "Continue anyway" after a confirmation); safe links and images; token estimate; query keys
  lib/math.ts                       `normalizeMath`: `\( \)`, `\[ \]` and `$x$` written as `$$…$$` (never inside code, even an unclosed block; amounts stay text)
  lib/handoff.ts, selection.ts      answer (or selection) -> prompt without Markdown markup; text selected in an answer
  lib/enhance.ts                    failure codes of ✨ (409 `busy` / `no_model` / `no_engine`, otherwise engine), button state, return to the original
  components/                       ChatHome, ChatConversationView, ChatThread, UserMessageView, AssistantMessageView, AssistantBody, CompareView, GenerationCard (+ Generations), GenerationChoice (DurationChoice, VoiceChoice), MessageParts (BranchNav, ReasoningBlock, ToolRuns, StatsLine,
                                    AttachmentList), Markdown (+ MarkdownRenderer, loaded on demand, and MathMarkdownRenderer: KaTeX, loaded only if an answer has a formula), SendToMenu, EnhancePromptButton, ChatComposer, ChatSettingsPopover, ContextField, SystemPromptPopover, ContextGauge, ChatStatusLine,
                                    ChatErrorNotice, ChatSuggestions, LlmStatusChip, ExportMenu, ChatSearchHits
  locales/                          locales.fr.json, locales.en.json (keys chat.*)
```

Mounting: `studio-shell/routes.tsx` (the `/chat` route is loaded on demand: `pages/ChatHomePage.tsx`), `pages/ConversationPage.tsx` (renders `ChatConversationView`, loaded on demand, when the conversation is in chat mode),
`StudioShell` (mounts `useLlmEvents`), `ConversationList` (in chat mode, `ChatSearchHits` under the titles). The model picker is `StudioModelPicker` of `studio-core` (type `llm`), which also carries the "New" button (`Nouveautés`).
The chat model cards, the llama.cpp engine card and the Hugging Face search `kind=llm` are in `model-catalog` and `engines`; the Brave Search key and the default chat voice are in `settings`.

## Services

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/conversations` `{ mode: 'chat' }` | creates the conversation (home page) |
| `GET` | `/api/chat/conversations/:id` | `ChatConversation`: conversation, settings, messages of the active branch |
| `PATCH` | `/api/chat/conversations/:id/settings` | settings (model, system instruction, parameters, context, thinking, tools) |
| `POST` | `/api/chat/conversations/:id/messages` | send: **SSE stream** (user message then answer) |
| `POST` | `/api/chat/conversations/:id/messages/:mid/regenerate` | new sibling answer, possibly from another model: **SSE stream** |
| `POST` | `/api/chat/conversations/:id/messages/:mid/edit` | new sibling user message and its answer: **SSE stream** |
| `POST` | `/api/chat/conversations/:id/leaf` | changes branch |
| `DELETE` | `/api/chat/conversations/:id/messages/:mid` | deletes the message and what follows it |
| `POST` | `/api/chat/attachments` | uploads an attachment (multipart) |
| `GET` | `/api/chat/conversations/:id/export?format=md\|json` | export (download by link) |
| `GET` | `/api/chat/search?q=` | full-text search in messages |
| `GET` | `/api/chat/conversations/:id/messages/:mid/siblings` | `chatApi.siblings`: the complete siblings of an answer (comparison after a reload) |
| `POST` | `/api/chat/messages/:mid/generations/:gid/confirm` | `chatApi.confirmGeneration`: starts the generation of a choice card (`{ seconds }` or `{ voice_id }`) |
| `POST` | `/api/chat/model/unload` | `chatApi.unloadModel`: unloads the chat model (⏏ button of the status indicator; 409 `busy` during an answer) |
| `POST` | `/api/chat/enhance-prompt` | `chatApi.enhancePrompt`: improvement of a generation prompt, ✨ button `EnhancePromptButton` of the image, audio and video composers |

The stream: `message` (user, then assistant created), `loading`, `delta`, `reasoning`, `tool`, `usage`, then a single `done` **or** `error`. A stream that stops without either of them gives a `closed` error
on the client side. **`done` ends the answer**: the interface considers it finished at this event (final message and statistics in the thread, actions, send button re-enabled: `answerRunner` sets the stream "finished" and
`anyStreaming` becomes false again). The stream, however, **is read until it closes** when the server writes an automatic title (first exchange, title still derived from the prompt): `title` arrives **after** `done`, updates the title in the
thread and in the list (`studioKeys.conversations`), then the stream closes. This residual stream never blocks a new send: `startAnswer` aborts it (`AbortController`), which makes the server cancel the title, and the end of the aborted stream
touches neither the next answer (`isCurrent`) nor the conversation cache (no re-read after a `done`). A connection cut after `done` leaves the finished answer as it is. Stopping = closing the connection (`AbortController`): the server keeps the text received and marks the message `cancelled`. Stream requests are sent without an access token: the application runs in `LOCAL_TRUST`
(an `Authorization` header is only added by `HttpService`, which cannot read a refusal with its message). A refusal before the stream (`400` identifier, `422` body, `409`) gives a `ChatError` whose code is the one
the server adds to the refusal (`code`) when it sets one, otherwise guessed from the status; `StudioApiError.code` (`studio-shell/services/studioHttp.ts`) carries that same code for JSON calls.

## Behaviours

- **One answer at a time.** `startAnswer` refuses (with a message) when another answer is in progress, in any conversation; the engine has only one model in memory. The composer replaces "Send" with "Stop" for the conversation that is writing, and warns when an image, audio or video generation is running (the engine then answers `busy`).
- **Changing the context reloads the model.** The context cache is allocated at loading: the default context is 16,384 tokens (`context_default` of the model) and changing it reloads the model. In the settings popover,
  the "Context" field shows under it a notice (icon + text, role `status`) *as long as the entered value differs from the context of the model currently loaded* (`llm.status.context_size`, same model as the conversation's;
  the value is bounded as the engine does it: `lib/context.ts` `requestedContext`, `contextChangeReloads`). The notice has no memory figure (no route exposes it; the engine computes it for the planner) and
  blocks nothing. At the next send that reloads the model, the status line says "Reloading the model with a context of N tokens…" (phase `loading`, `chat.status.reloadContext`) instead of "Loading the model…".
- **Answer in progress.** The Markdown is rendered at most ~12 times per second (`useThrottled`); the thread follows the bottom as long as the reader has not scrolled up. Screen readers receive one announcement per answer
  (`aria-live` off on the thread), not one per token.
- **Branches.** The server only sends the active branch. `‹ n/m ›` changes branch (`/leaf`). The **comparison** shows side by side (tabs below 900 px) the sibling answers of different models **that this browser has seen**
  (`chatDraftStore.seen`, fed by each loaded conversation and each stream); after a page reload, `useSiblingsSync` reads once the siblings never seen (`GET …/siblings`, valid for one minute)
  so that the comparison reappears.
- **An answer that does not end.** Stopping closes the connection and the server sets the message (`cancelled`) a moment later; an answer still `streaming` on the server while this browser does not read it
  (stop not yet settled, page reloaded in the middle of an answer) is re-read every 1.5 s, about forty times at most, until it is settled: it is never stuck.
- **Send to Image / Video / Audio.** `SendToMenu` (on each answer) sends the answer, or the text selected in it, without Markdown markup (`lib/handoff.ts`), to the composer of the chosen studio through
  `usePromptHandoffStore` (`studio-core`, in memory only), then opens that studio; its composer takes it on display (`usePromptHandoff`).
- **✨ Improve the prompt.** `EnhancePromptButton` is mounted in the image, audio and video composers (direct import of this file: the `chat` module never imports these studios). It rewrites the prompt with the
  chat model (a clock is shown if the model has to load), keeps the original (`Rétablir` (Restore) as long as the prompt is the improved one) and, on refusal, explains why (generation or answer
  in progress, no chat model, llama.cpp engine missing) with the button that opens the models; disabled as long as no chat model is installed; a result that arrives after the user has retyped is ignored.
- **Creation tools.** Each send, regeneration and edit carries `creation_models` (`useCreationModels`: the **active** model of each studio, that is its selection, otherwise the most used or the default; only if it is ready) when the 🎨 switch of the conversation is on (`settings.tools.creation`, on by default; greyed out for a model that does not call tools; absent from a private session, which does not have these tools). The chat model can then launch an image, a video or a sound; `/image …`, `/video [Ns] …` and `/audio [voice:] …` do it **without** the chat model (help under the composer as soon as you type `/`).
  Each generation is a **card** (`GenerationCard`) in the answer: waiting for the engine (the job starts when the chat answer has freed the memory), loading then progress (`useLiveStore`, Cancel button), then the result (image: thumbnail that opens the common viewer; video and sound: native player), or the failure; `Ouvrir dans le studio` (Open in studio) hands the prompt back to the composer of that studio (`usePromptHandoffStore`). The files are also in the media library (origin: the chat conversation). Without a duration, a video displays a **choice card** (`DurationChoice`: slider bounded by the model, default pre-filled); a model that requires a voice without having received one displays `VoiceChoice` (list of voices with a sample); the generation starts on validation (`confirm`).
  The state and files of a card come from the server (never copied into the chat cache): `useGenerationSync` re-reads the conversation on the `studio.*` events of its jobs.
- **Draft.** Unsent text is kept per conversation (`cn-chat-drafts`); it is cleared when the server has saved the message. Attachments in progress are not kept.
- **Home page.** Its settings (system instruction, parameters, context, thinking, web search, creation tools) are the starting settings of new conversations. The first send creates the conversation, applies these settings to it, opens it;
  the conversation page takes the send over (`pending`) once the conversation is loaded, so that the stream writes into a cache that exists.
- **Markdown safety.** No raw HTML (react-markdown does not render it), `http(s)` and `mailto` links only, opened outside the application (`rel="noopener noreferrer nofollow"`), **remote images blocked**:
  a "Load image" button (`Charger l'image`) shows the host. The code is coloured by a subset of highlight.js (22 languages). **Formulas**: KaTeX (`remark-math` + `rehype-katex`, `trust` disabled: no link or image in a formula; an unreadable formula is shown in error colour without breaking the answer),
  in a separate chunk loaded only when the text contains some (`mayHaveMath`); `\( \)`, `\[ \]` and `$x$` are brought back to `$$…$$` outside code, and an amount (`5$`, `$6`) remains text.

## Dependencies

`react-markdown` (already in the template), `remark-gfm` 4.0.1 (MIT), `rehype-highlight` 7.0.2 (MIT, with `lowlight` 3), `highlight.js` 11.12 (BSD-3-Clause), `katex` 0.16.47, `remark-math` 6.0.0 and `rehype-katex` 7.0.1 (MIT; `katex` is pinned to 0.16 as `rehype-katex` requires): declared in `front/package.local.json`. The Markdown and the coloured code are in the
`MarkdownRenderer` chunk, the formulas in `MathMarkdownRenderer`, both loaded on demand (weight not measured: no `vite build` in development). `@/modules/model-catalog` (models, `ModelPicker`), `@/modules/engines` (`SetupPrompt`, `WelcomeSetup`),
`@/modules/settings` (Brave key), `@/modules/studio-core` (`StudioModelPicker`, `TitleEditor`, `copyText`, scrolling), `@/modules/studio-shell` (conversations, routes, focus, HTTP), `@/modules_shared/common` (SSE, confirm, help, form from schema).

## Tests

`lib/*.spec.ts` (SSE stream cut byte by byte, reducer, branches, context, attachments, settings, errors, safe links, formulas, sending to a studio, prompt improvement), `services/chatApi.spec.ts` (simulated fetch: stream, refusal, interrupted stream, cancellation),
`services/chatContract.spec.ts` (**freezes the contract with the Nest module**: the real shapes and order of the events of a send, a refusal, an error, a regeneration, an edit and a stop, the calls, the limits and the bounds of the settings),
`services/answerRunner.spec.ts` (the cache written as the stream goes, draft cleared, one answer at a time, context reload, error, stop), `state/chatDraftStore.spec.ts`, `hooks/useLlmEvents.spec.ts`,
`components/render.smoke.spec.ts` (server-side rendering without DOM: home page, composer, thread, comparison, context notice, errors; store states are not read at server rendering: the presentational parts
take their data as props), `locales/locales.spec.ts`. No test in a browser: the real rendering of windows, scrolling and the stream against a real server are not verified.

## Known limits

- The content of a message is limited to 200,000 characters (the server refuses beyond that: error message on the client side before sending); the KaTeX font weighs 1.1 MB in three formats in the package: not measured in the bundle (no `vite build` in development).
- External links open with `target="_blank"` (like the rest of the application): in the Tauri shell their behaviour has not been verified.

## Chat in a private session (`private` module)

During a private session (`isPrivateMode()`), `chatApi` and `streamAnswer` send to `services/privateChatBackend.ts`: **nothing of the chat goes through the routes that record** (`/api/chat/conversations/*`, refused by
`private/lib/privateRouting.ts`). The conversation is a tree of messages in the page's memory (same shapes as `ChatMessage`, so the thread, the composer, the branches, the comparison, the regeneration and the edit
are those of the normal chat); each answer goes to `POST /api/private/chat` with **the whole** history of the branch and the settings, and comes back as events (`accepted`: the messages are added; `loading`, `delta`,
`reasoning`, `tool`, `usage`, `done` / `error`). A refusal before `accepted` (an `error` without `id`) creates nothing. Cancelling keeps the text received as `cancelled`.

- **Shell**: the creation (`POST /api/conversations` → `/api/private/conversations`, mode `chat`) gives a shell on the server side (generic title, message count updated by `PATCH … { message_count }`) for the sidebar list; no automatic title. Renaming, pinning, deleting go through the private conversation routes; deleting also forgets the tree (`forgetPrivateChat`).
- **Attachments, ✨**: `/chat/attachments` and `/chat/enhance-prompt` are routed to `/api/private/chat/*` (session folder, nothing kept); an attachment removed before sending is deleted from the session; "Send to" stays in memory (`usePromptHandoffStore`).
- **Search** in private conversations: in memory (`privateChatApi.search`). **Export**: a file built in the page (`blob:` link revoked with the session), never downloaded from the server.
- **Web search**: off by default; enabling it in private asks for a confirmation (`chat.web.private.*`: the requests leave the machine).
- **End of session** (quit, clear all, expiry, server unreachable): `forgetPrivateChats()` aborts the answers in progress, empties the conversations and the sent files, the answer read state, the "sent to" text and the export links.
- **Limits**: the conversation exists only in the page (reloading the page loses it, and so does the private session); the chat model stays loaded until the end of the session (the server unloads it then), its prompt cache is in `llama-server`'s memory.
