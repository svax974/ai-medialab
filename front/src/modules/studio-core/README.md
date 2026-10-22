# Module `studio-core` (front)

## Role

The **conversation thread** shared by the three studios and what surrounds it: open conversation (editable title, counter, scrolling),
user messages and assistant generations, live progress with previews, states of the message state machine (queued, loading, computing, done, error, cancelled), retry (new variants or same seeds), cancellation, deletion, thumbnails and their actions, image viewer, engine state card in the sidebar, and **application of the `studio.*` events to the cache**.
Only the **image** generation is drawn here (`AssistantMessage`); audio (`audio-studio`, H4.5) and video (`video-studio`, H4.6) bring their own `ModeAdapter`. The **model settings and the seed** (`GenerationParams`, H4.6) are shared by the three composers.
Back: `back/src/modules/studio-core/README.md` (routes, generation queue, state machine, events). Task H4.3b.

## Structure

```
studio-core/
  index.ts                         exports
  types.ts                         Asset, Message, MessageStatus, GenParams, JobProgress, ConversationDetail, SendMessageRequest/Response...
  services/messagesApi.ts          POST /messages, POST /messages/:id/retry, POST /messages/:id/cancel, DELETE /messages/:id, GET /queue,
                                   GET /messages/model-usage
  services/assetsApi.ts            (moved to `media-library` in H4.4; types `Asset`, `AssetPage` re-exported by `types.ts`)
  hooks/useStudioEvents.ts         subscription to the studio.* topics and application to the cache (mounted by StudioShell)
  hooks/useMessageActions.ts       retry, cancel, delete (confirmation)
  hooks/useAssetActions.ts         favorite, delete from the viewer
  components/StudioModelPicker.tsx model picker of the composers, sorted by usage (`ModelPicker` + `useModelUsage` of `model-catalog`; the `model-usage` key is invalidated here at the end or on deletion of a generation), follows the `Nouveautés` button (`WhatsNewButton` of `model-catalog`) (`onSelect`: what a choice does in addition, for example the chat that keeps the model in the conversation settings; the chat also uses it, for the `llm` type)
  components/NegativePromptField.tsx line `À éviter` (avoid) under the prompt (image, video) for the models that have a `negative_prompt`,
                                   which `toParamsSchema` then removes from the settings panel (`NEGATIVE_PROMPT`)
  hooks/useNow.ts                  clock (seconds) refreshed every second while a loading lasts
  lib/messageState.ts              pure logic: states, cells of a generation, layout, status line, queue position (`queueIndex`),
                                   settings reused, file name (tested)
  lib/studioEvents.ts              pure logic: studio.* event to cache operations (tested)
  lib/engineState.ts               pure logic: what the engine card shows (tested)
  lib/viewerDetails.ts             pure logic: `Détails` rows of the viewer (tested)
  lib/paramHelp.ts                 tooltips of the generic parameters (PARAM_HELP) + paramHelp(spec, kind, t) (tested)
  lib/paramsSchema.ts              schema of the common form from a model's parameters, known values, detection of `Valeurs par défaut` (default values) (tested)
  lib/viewerActionsMode.ts         mode whose viewer actions apply to an asset (tested)
  lib/draftActions.ts              actions on the draft: use as reference, reuse a prompt, reuse settings (tested)
  lib/scroll.ts                    thread scrolling, title editing (tested)
  lib/format.ts, clipboard.ts, assetDrag.ts, studioKeys.ts, modeAdapter.ts
  state/liveStore.ts               live progress per message (Zustand)
  state/queueStore.ts              generation queue (current message, pending messages), kept up to date by studio.queue.updated (Zustand)
  (lightboxStore: moved to `media-library`, the gallery opens the same viewer)
  state/imageDraftStore.ts         image composer draft (Zustand, persisted under `cn-composer`)
  state/promptHandoffStore.ts      text that one studio leaves to the composer of another (chat → image, video, audio; in memory only); hooks/usePromptHandoff.ts: the target composer takes it on display
  components/                      ConversationView, TitleEditor, UserMessage, AssistantMessage, StatusLine, MessageFooter, ImageTile (+ TileActions,
                                   DevelopingTile), StudioLightbox, GenerationParams (settings + seed, shared by the three modes), EngineCard, HelpTooltip (+ LabelTooltip)
  locales/                         locales.fr.json, locales.en.json (keys thread.*)
```

## Public API

`ConversationView({ id, adapters })` (does not draw the chat mode: its thread is that of the `chat` module, chosen by `ConversationPage`), `AssistantMessage`, `EngineCard`, `StudioLightbox({ modeActions })`, `GenerationParams`, `toParamsSchema` / `paramValues` / `isFullReset`, `useStudioEvents`, `useModelUsage` (re-exported from `model-catalog`, which owns it), `StudioModelPicker`, `NegativePromptField`, `useToggleFavorite`,
`addAsReference` / `reuseUserMessage` / `reuseGenerationSettings` (actions on the draft), `PARAM_HELP` / `paramHelp`, `HelpTooltip` / `LabelTooltip`,
`messagesApi`, `upsertMessage`, `useImageDraftStore`, `usePromptHandoff`, `usePromptHandoffStore`, `useLiveStore`, `useQueueStore` (`assetsApi`, `assetKeys` and `useLightboxStore` are in `media-library`), `ModeAdapter`, types.

`ModeAdapter` (`lib/modeAdapter.ts`): what a mode plugs into the thread: `Composer`, `AssistantMessage`, `reuseUserMessage`. The page
`/c/:id` (`studio-shell/pages/ConversationPage.tsx`) passes `{ image: imageStudioAdapter, audio: audioStudioAdapter, video: videoStudioAdapter }`; a conversation of a mode without an adapter
shows `Ce type de conversation sera repris…` (this type of conversation will be supported later) without composer.

## Data and events

- **Conversation**: `useConversation(id)` (module `studio-shell`, key `['conversation', id]`); 404: message `Conversation introuvable.` (conversation not found) and return to home.
- **`studio.*` topics** (published by Nest; payloads in `back/src/modules/studio-core/README.md`): `lib/studioEvents.ts` translates them into operations,
  `hooks/useStudioEvents.ts` applies them:

  | Topic | Effect |
  |---|---|
  | `studio.job.progress` | merge into `liveStore` (step, total, current image, time left, preview) |
  | `studio.message.updated` | message inserted or replaced in the cached conversation (sorted by date then id); outside `queued`/`loading`/`running`: progress cleared and lists re-read |
  | `studio.job.image` | image added to the message (no duplicate, in order of production); assets re-read |
  | `studio.message.deleted` | messages removed from the conversation |
  | `studio.conversation.updated` | summary merged (title, pin, thumbnail, counter, busy) without touching the messages; lists re-read |
  | `studio.conversation.deleted` | conversation removed from the cache; lists and assets re-read |
  | `studio.asset.updated` | asset replaced everywhere it appears (references, outputs, asset lists including the gallery pages, viewer) |
  | `studio.asset.deleted` | asset removed from the lists and the viewer; conversation and assets re-read |
  | `studio.queue.updated` | `queueStore`: `{ current, queue }` (pending messages in execution order, all conversations); also read at loading and after a stream resume (`GET /api/queue`) |

  List re-reads are grouped over 250 ms. An impossible stream resume (`resync`) re-reads conversations and assets. The cache is only written
  for an already loaded conversation. `engine.*` (models, installers, engine status) is still handled by `studio-shell/lib/eventEffects.ts`: the engine
  no longer knows the conversations, the topics `engine.conversation.*` and `engine.message.*` are no longer listened to.
- **Sending**: see `image-studio` (`useSendMessage`); the server response is written to the cache without waiting for the event.

## Message states (`lib/messageState.ts`)

| State | Display |
|---|---|
| `queued` | `en file d'attente` (queued) (+ `position N` (position N) from the second one: rank in Nest's queue, all conversations), cells `en attente` (waiting), Cancel button |
| `loading` | `chargement du modèle en mémoire · m:ss` (loading the model into memory) (+ `téléchargement possible` (download possible) if the model is not installed), Cancel |
| `running` | `étape n/total` (step n/total) (or `préparation…` (preparing)), `image i/n` (image i/n) if there are several, `~durée restantes` (~time remaining); the current cell `se développe` (developing) (blurred and tinted preview that clears with the fraction, thin bar), the following ones wait; Cancel |
| `done` | size, steps, references, duration, time; images with a `développement` (development) animation if they took less than 8 s; `Varier` (vary), `mêmes graines` (same seeds), more actions |
| `error` | red box with the server message (or `Erreur inconnue.` (unknown error)) |
| `cancelled` | `Génération annulée.` (generation cancelled) if no image was produced; the images produced remain |

Footer actions: **Varier** (vary) (new seeds), **mêmes graines** (same seeds), "more" menu (reuse these settings: model, parameters, number of images and first seed fixed;
copy the prompt; copy the seeds; delete with confirmation). User message: copy the prompt, reuse in the composer (prompt and references), delete
(takes the generations with it).

## Thumbnails and viewer

A thumbnail (`ImageTile`): thumbnail (the full file for large screens), click to open the viewer, draggable to the window (becomes a reference), and on hover: favorite
(top left), use as reference / download / enlarge (top right), seed (bottom left).
`StudioLightbox` (mounted by `StudioShell`): `Lightbox` component of `common`; actions: use as reference, favorite (`F`), download; details panel (toggle `I`): prompt (copyable),
model, file, size, seed (copyable, with tooltip), steps, guidance, strength, computation time, date; open the conversation; delete the image (confirmation).
The full gallery is in `media-library` (H4.4): it opens this viewer on the loaded assets. `I` acts by pressing the `Détails` (details) button of the shared `Lightbox` (which has no shortcut of its own).

## Engine card (`EngineCard`)

In the footer of the sidebar (`studio-shell/SidebarFooter`): status dot, model name, detail. Loading (`Chargement du modèle` (loading the model) + clock), generation (`en cours` (in progress), `rendu vidéo en cours` (video rendering in progress)),
ready (`N bits · en mémoire` (N bits · in memory) or `en mémoire` (in memory); button `Décharger le modèle` (unload the model) with a confirmation message), nothing loaded (`chargé à la demande` (loaded on demand)); `N en attente` (N waiting) = messages pending in Nest's queue (all conversations) plus the jobs that the engine alone lists (former interface), counted once.
Hooks `useEngineStatus` / `useUnloadEngine` of the `hardware` module; the status is re-read at each `engine.engine.status`.

## Tooltips

Texts of `frontend/src/lib/help.ts` (removed in H6) taken over identically in French (`thread.help.*`: `steps`, `guidance`, `negative_prompt`, `strength`, `seed`, `fast_decode`, `count_images`); `paramHelp(spec, kind, t)` adds the
model's remark (`Ce modèle : …` (this model: …), written by the engine, hence not translated) except when it repeats the generic text. The image-specific texts are in `image-studio`
(`imageStudio.help.*`); those of the audio: `thread.help.{speed,temperature,count_takes}` (H4.5) and `audioStudio.help.*`; those of the video: `thread.help.strength_video` (the strength of the source video, H4.6) and `videoStudio.help.*`. Thread tooltips: `Nouvelles variantes (graines aléatoires)` (new variants (random seeds)), `Relancer avec les mêmes graines` (rerun with the same seeds) (with explanation).

## Mapping to the former interface

| Former (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `components/ConversationView.tsx`: view, `TitleEditor`, scrolling | `components/ConversationView`, `TitleEditor`, `lib/scroll` |
| `components/Message.tsx`: `UserMessage` | `components/UserMessage` |
| `Message.tsx`: `AssistantMessage`, `StatusLine`, `MessageFooter` | `components/AssistantMessage`, `StatusLine`, `MessageFooter`, `lib/messageState` |
| `Message.tsx`: `ImageTile`, `TileActions`, `DevelopingTile` | `components/ImageTile` |
| `Message.tsx`: `copy`, `download` | `lib/clipboard` (`copyText`, `downloadAsset`), `lib/messageState` (`downloadName`) |
| `components/EngineCard.tsx` | `components/EngineCard`, `lib/engineState` (`useNow`: `hooks/useNow`) |
| `components/Lightbox.tsx` | `components/StudioLightbox` on the `Lightbox` of `common`; the action bar specific to a mode (video: source, last frame, start image) is provided by `modeActions` (`StudioShell` passes `VideoViewerActions`) |
| `components/ParamsPopover.tsx` | `components/GenerationParams` + `lib/paramsSchema` (moved up from `image-studio` in H4.6; the button shows the steps for the image and `Réglages` (settings) for audio and video, the seed and the padlock everywhere) |
| `lib/queries.ts`: `upsertMessage`, `useServerEvents` (conversations part) | `lib/studioEvents`, `hooks/useStudioEvents` |
| `engine.queue` (engine status) | `state/queueStore` (`studio.queue.updated`) |
| `lib/store.ts`: `progress`, `lightbox`, image composer draft | `state/liveStore`, `state/lightboxStore`, `state/imageDraftStore` |
| `lib/composer.ts`: `addAsReference`, `uploadFiles` | `lib/draftActions`, `image-studio/lib/uploadReferences` |
| `lib/help.ts` (generic parameters) | `lib/paramHelp`, locales `thread.help.*` |
| `lib/api.ts`: `send`, `retry`, `cancel`, `deleteMessage`, `assets`, `patchAsset`, `deleteAsset`, `upload` | `services/messagesApi`, `services/assetsApi` |

## Deviations from the former interface

- **Position in the queue**: exact since H4.4. Nest publishes the queue (`studio.queue.updated`); `position N` is the rank of the message in the global queue (the first pending one shows no position, as before); as long as the queue is not known (first loading), no position is displayed.
- Error messages are those of the server (French, not translated into English); the `Ce modèle : …` remarks come from the engine.
- Messages (`toast`) go through react-toastify; the viewer is that of `common` (action bar and side panel of the shared component; the thumbnail index, zoom on click and arrows are there too).
- Label of the viewer's favorite: `Ajouter aux favoris` (add to favorites) / `Retirer des favoris` (remove from favorites) (the former said `Favori` (favorite)).
- Audio has its thread since H4.5 (`audio-studio`) and video since H4.6 (`video-studio`).
- The gallery and the viewer list are in `media-library` (H4.4); the viewer actions specific to video (source, last frame) are in `video-studio` (`VideoViewerActions`), plugged in through the `modeActions` property of `StudioLightbox`: a clip always receives the video actions, an image receives those of the displayed mode (`use as reference` (utiliser comme référence) by default).

## Tests

One file at a time, from `front/`, under the memory guard:

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/studio-core/lib/messageState.spec.ts
```

`lib/{messageState,studioEvents,engineState,viewerDetails,paramHelp,draftActions,scroll,format,assetDrag}.spec.ts`, `services/services.spec.ts`, `state/stores.spec.ts` (live, queue, draft),
`locales/locales.spec.ts`; the server-side rendering of the screen is checked by `image-studio/components/render.smoke.spec.ts` (no DOM: see the README of `image-studio`).
