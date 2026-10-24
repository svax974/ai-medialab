# Module `studio-shell`

## Role

Shell of the studio in the new front: sidebar (image / audio / video / chat mode, pages of the mode, search and list of
pinned conversations grouped by period, engine card, models, settings, light/dark theme; the language is changed in the Settings), layout, keyboard shortcuts, routes kept from the former interface, server data cache (TanStack Query), client state (Zustand) and
subscriptions to the event stream (`engine.*` from the engine, `studio.*` from Nest). The screens themselves are **thin pages**: the home and the conversation
are those of the image studio (modules `image-studio` and `studio-core`, H4.3b); the image gallery is that of `media-library` (H4.4); the audio home, the audio library and the voices are those of the modules `audio-studio` and `voices` (H4.5); the video remains "coming soon" until task H4.6;
six modes (chat, image, audio, video, diagrams, OCR; `ocr` is not a conversation mode: `ConversationMode` excludes it and its sidebar list is the module `ocr-studio`'s, routes `/ocr` and `/ocr/:id`); the Settings dialog is that of the module `settings` (H4.1), the Models dialog that of the module `model-catalog` with the installers of the module `engines` (H4.2).

Application module (`front/src/modules/`), not a shared module. Theme: `front/src/themes/chambre-noire/README.md`.

## Structure

```
studio-shell/
  index.ts                 exports: StudioShell, StudioProviders, studioRoutes, matchStudioRoute
  StudioProviders.tsx      QueryClientProvider (client: state/queryClient.ts)
  routes.tsx               studioRoutes (PluginRoute[], layout 'fullscreen') for components/Router.tsx
  types.ts                 StudioMode, ConversationSummary, Conversation, ConversationPatch
  components/              StudioShell, Sidebar, ModeSwitch, NavItem, SearchField, ConversationList, ConversationItem, SelectionBar,
                           SidebarFooter, Mark, modeIcons
  pages/                   HomePage (ImageHome), GalleryPage (ImageGallery), AudioHomePage, AudioLibraryPage, VoicesPage (VoicesLibrary), VideoHomePage, VideoLibraryPage, ChatHomePage (ChatHome, loaded on demand), ConversationPage (ConversationView + image, audio and video adapters; the chat thread when the conversation is in `chat` mode, loaded on demand), ComingSoonPage (fallback page of a route without a page)
  hooks/                   useConversations (queries + actions), useEngineEventSync, useModeSync, useShortcuts, useT
  lib/                     pure logic: periods, shortcuts, routes, eventEffects, queryKeys, focusRegistry
  services/                studioHttp (routes `/api/<segment>` of Nest, media; `StudioApiError` carries the `code` that the route adds to a refusal, e.g. `busy`; in private generation, the studio routes go under `/private`, see the `private` module), conversationsApi
  state/                   studioStore (Zustand), queryClient
  locales/                 locales.fr.json, locales.en.json (+ registry: src/locales/registerModuleLocales.ts)
```

Mounting: `App.tsx` (`AppMuiTheme` > ... > `StudioProviders`), `components/Router.tsx` (`...studioRoutes`),
`components/PageLayout.tsx` (a studio page is rendered inside `StudioShell`, without the template's header nor sidebar; the shell stays mounted from one page to another, so the search and the list persist).

## Routes

| Path | Page | Mode | Task that fills it |
|---|---|---|---|
| `/` | Image studio home (`ImageHome`) | image | H4.3b (done) |
| `/c/:id` | Conversation (`ConversationView`, or `ChatConversationView` of the `chat` module for chat mode) | of the conversation | H4.3b (done), audio: H4.5 (done), video: H4.6 (done), chat (done) |
| `/galerie` | Gallery (`ImageGallery`) | image | H4.4 (done) |
| `/audio` | Audio home (`AudioHome`) | audio | H4.5 (done) |
| `/audio/voix` | My voices (`VoicesLibrary`) | audio | H4.5 (done) |
| `/audio/bibliotheque` | Audio library (`AudioGallery`) | audio | H4.5 (done) |
| `/video` | Video home (`VideoHome`) | video | H4.6 (done) |
| `/video/bibliotheque` | Video library (`VideoGallery`) | video | H4.6 (done) |
| `/chat` | Chat home (`ChatHome`, module `chat`, loaded on demand) | chat | Chat mode (done) |

Single table: `lib/routes.ts` (`STUDIO_ROUTES`, `studioPaths`, `matchStudioRoute`). To replace a page: change the `element`
of its route in `routes.tsx` (or pass a `lazy`).

## Services

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/conversations?mode=&q=` | List of the mode, filtered by the search (Nest module `studio-core`). |
| `GET` | `/api/conversations/:id` | Conversation and messages (mode of the page, title). |
| `PATCH` | `/api/conversations/:id` | Pin (`pinned`) or rename (`title`). |
| `DELETE` | `/api/conversations/:id` | Delete. |
| `POST` | (`studioUpload`) | Added in H4.3b: multipart send with progress (`HttpService.upload`), for `POST /api/assets` (module `studio-core`). |
| `PUT`/`POST` | (`studioRequest`) | Added in H4.1 for the modules `settings` and `hardware` (`GET/PUT /api/settings`, `GET /api/system`, `GET /api/status`, `POST /api/engine/unload`, Nest routes). |
| `GET` | `/api/v1/events/stream?topics=studio.message.updated,…` | Event stream (common building block `eventStreamClient`). |

Calls go through `httpService` (`skipTransport: true`: these routes answer plain JSON); the base URL is that of
`configurationService.getApiUrl()` without the `/v1` suffix (`studioApiBase()`), because the studio routes are under `/api/<segment>`, next to `/api/v1`
(Nest modules, see their READMEs; media: `back/src/modules/engine/README.md`, "Media relay").
The engine's media (`/media/...`) are served under `/api/media/...`: `resolveMediaUrl`.

## Data and real time

- **TanStack Query** (deliberate deviation from the template, work package H): keys in `lib/queryKeys.ts` (`conversations`, `conversation`).
  Defaults: `staleTime` 30 s, no reload on focus (the event stream invalidates), one retry.
- **Event stream**: `hooks/useStudioEvents` of the `studio-core` module (mounted by `StudioShell`) follows the `studio.*` topics published by Nest for conversations, messages, images,
  assets and progress, and writes directly to the cache (see its README). `hooks/useEngineEventSync.ts` (mounted by `StudioShell`): subscription to the topics
  `engine.engine.status`, `engine.models.changed`, `engine.download.progress`, `engine.engine.install`, `engine.pack.install`, `engine.llamacpp.install` (keys `['engine-status']` and
  `['system']` of the `hardware` module, `['models']` of the `model-catalog` module; the ongoing progress invalidates nothing, it feeds the `model-catalog` and `engines` stores), `engine.link` (engine relay by Nest). `lib/eventEffects.ts` translates each event into invalidations/removals from the cache
  (grouped over 250 ms); `engine.link` back to `connected: true` and the `resync` frame reload everything. When the stream is
  unavailable (`fallback`), the list is reread on mount; the H4 components add their topics to `ENGINE_TOPICS` and their effects.
- **Actions** (`useConversationActions`): pin/rename with optimistic update, rollback and an error message
  (react-toastify); delete with confirmation (`confirm()` of `common`), then back to the home of the mode if the conversation was open. `remove` and `removeMany` also forget the message tree of a private chat conversation (`private/lib/privateChatMemory.ts`). `removeMany` deletes several conversations one by one
  (existing `DELETE` route, no grouped route) and returns `{ done, failed }`; a partial failure is reported with its count.
- **Zustand** (`state/studioStore.ts`): `mode`, `lastPathByMode` (last page per mode, for switching), `sidebarOpen`
  (persisted under `cn-prefs`, as before), `settingsOpen`, `modelsOpen`, `modelsSearchKind` (opening the dialog on the Hugging Face search of a type: `openModelSearch(kind)`). The H4 modules add their slices there.

## Shortcuts (`lib/shortcuts.ts`, `hooks/useShortcuts.ts`)

| Key | Action |
|---|---|
| ⌘B / Ctrl+B | Hide / show the panel |
| ⌘⇧O / Ctrl+Shift+O | New creation of the current mode, then focus on the composer |
| ⌘K / Ctrl+K | Reopen the panel if needed and focus the search |
| `/` | Focus the composer (ignored in a field or when a dialog is open) |

The composer and the search register through `registerFocusTarget('composer' | 'search', element)` (`lib/focusRegistry.ts`).
The H4 composers only have to call `registerFocusTarget('composer', textarea)`.

## Components

| Name | Description |
|---|---|
| `StudioShell` | Layout (328 px collapsible sidebar + page), shortcuts, mode tracking, event subscriptions (`engine.*`, `studio.*`), update runner (`useUpdateRunner`, module `updates`), dialogs, viewer (`StudioLightbox`), image drop on the window in image mode (`ImageDropLayer`), `ConfirmHost`, banner and guards of private generation (`PrivateBanner`, `PrivateHost`, module `private`; its button is in `SidebarFooter`). |
| `Sidebar` | Brand (`custom.app.name`), hiding, `ModeSwitch`, mode pages (`NavItem`; chat only has "Nouvelle conversation" (New conversation)), `SearchField`, `ConversationList` (in chat mode, the excerpts of the messages that contain the search, `chat/ChatSearchHits`), `SidebarFooter`. |
| `ModeSwitch` | MUI `Tabs` as a segmented control (image, audio, video, chat), icon above the label and no minimum width (the four fit in the sidebar); returns to the last page of the mode. |
| `NavItem` | Navigation entry (link), shortcut visible on hover. |
| `SearchField` | Search field, 200 ms wait, Esc clears, ⌘K focuses. |
| `ConversationList` / `ConversationItem` | Groups by period (pinned, today, yesterday, 7 and 30 days, months), thumbnail or icon, "busy" dot, menu (pin, rename, delete), renaming by double click. `SelectionBar` (`Sélectionner` (Select)) switches the list to selection mode: checkboxes, counter, select/deselect all, grouped deletion after confirmation; only the conversations still listed count (search or mode change deletes nothing out of sight). States: loading, empty (per mode), no result, error with `Réessayer` (Retry). |
| `StudioShell` (mounts) | Adds `SetupDialog` (module `engines`): the confirmation and progress modal of a model installation, opened by `startSetup`. |
| `SidebarFooter` | Engine card (`EngineCard`, module `studio-core`), Models (`ModelsDialog`), `Vérifier les mises à jour` (Check for updates) (`UpdatesDialog`, module `updates`), `Réglages` (Settings) (`SettingsDialog`), light/dark switch. |
| `ComingSoonPage` | Temporary page (the `ComingSoonDialog` disappeared with H4.2: no temporary dialog left). |

The generic components come from the template (work package I): `TipIconButton`, `Kbd`, `confirm`/`ConfirmHost`.

## Main types

`StudioMode` (`'image' | 'audio' | 'video' | 'chat'`), `ConversationSummary` (engine shape: `updated_at` in seconds, `cover.thumb_url`,
`generation_count`, `busy`, `pinned`), `Conversation<TMessage>` (+ `messages`, typed by `studio-core`: `ConversationDetail`), `ConversationPatch`,
`StudioRouteDef`, `PeriodKey`, `ShortcutAction`, `CacheEffect`.

## Internationalization

All strings are in `locales/locales.{fr,en}.json` (keys `studio.*`); the French takes up the former interface
identically, the English is written. The template only loads the locales of `modules_shared`: `src/locales/registerModuleLocales.ts`
(imported by `main.tsx`) loads `src/modules/*/locales` and `src/themes/*/locales` (`i18n.add` merges with the remote locales).
No `defaultLabel`: a missing key is displayed as is. The components use `useT()` (re-rendered on language change).
Check: `npm run i18n:check` (front); `locales/locales.spec.ts` checks the fr/en parity and the `{n}` markers.

## Correspondence with the former interface

| Former (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `App.tsx` (layout, shortcuts, `useModeSync`) | `components/StudioShell`, `hooks/useShortcuts`, `hooks/useModeSync` |
| `App.tsx` (`useFileDrop`, drop overlay) | image: `image-studio` (`ImageDropLayer`, H4.3b); audio: `voices` (`VoiceDropLayer`, H4.5); video: `video-studio` (`VideoDropLayer`, H4.6) |
| `App.tsx` (`Toaster` sonner) | `ToastZone` (react-toastify) of the template, in `Router` |
| `components/Sidebar.tsx`: `Sidebar` | `components/Sidebar` |
| `Sidebar.tsx`: `ModeSwitch` | `components/ModeSwitch` |
| `Sidebar.tsx`: `NavButton` | `components/NavItem` |
| `Sidebar.tsx`: search (+ ⌘K) | `components/SearchField` |
| `Sidebar.tsx`: list, groups (`periodOf`) | `components/ConversationList`, `lib/periods` |
| `Sidebar.tsx`: `ConversationItem` (+ Radix menu) | `components/ConversationItem` (MUI menu) |
| `Sidebar.tsx`: footer (`EngineCard`, Models, Settings, theme) | `components/SidebarFooter`; `EngineCard`: module `studio-core` (H4.3b) |
| `components/ui.tsx`: `IconButton`, `Tip`, `Kbd`, `InfoTip`, `HelpBody` | `TipIconButton`, `Tooltip`, `Kbd`, `InfoTip`, `HelpBody` of `common` (work package I) |
| `ui.tsx`: `Button`, `Spinner` | `Button`, MUI `CircularProgress` (theme) |
| `ui.tsx`: `Mark` | `components/Mark` |
| `components/Confirm.tsx` | `confirm()` / `ConfirmHost` of `common` |
| `lib/router.ts` (History API) | `react-router-dom` + `lib/routes.ts` |
| `lib/store.ts` (shell part) | `state/studioStore.ts` (rest: H4) |
| `lib/queries.ts`: `useConversations`, `useConversation`, stream | `hooks/useConversations`, `hooks/useEngineEventSync`, `lib/eventEffects`; conversation events: `studio-core` (`useStudioEvents`) |
| `lib/format.ts`: `periodOf`, `formatTime`, `cx` | `lib/periods`; `cx`: useless (`sx`); other formats: H4 |
| `lib/composer.ts`: `focusComposer`, `registerComposer` | `lib/focusRegistry` |
| `components/SettingsDialog.tsx` | module `settings` (H4.1) |
| `components/ModelsDialog.tsx` | module `model-catalog` (`ModelsDialog`, H4.2) |
| `styles.css` | `front/src/themes/chambre-noire/` |

## Dependencies

`react-router-dom`, `@mui/material`, `@mui/icons-material`, `@tanstack/react-query`, `zustand`, `react-toastify` (error messages);
from `common`: `core/events` (`eventStreamClient`), `core/http/HttpService`, `core/i18n`, `components/ui/{iconbutton,kbd,confirm,theme,languages}`.

## Tests

One file at a time, from `front/`, under memory guard:

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/studio-shell/lib/periods.spec.ts
```

`lib/{periods,shortcuts,routes,eventEffects}.spec.ts`, `services/studioHttp.spec.ts`, `state/studioStore.spec.ts`,
`locales/locales.spec.ts`, and for the theme `themes/chambre-noire/{tokens,muiTheme}.spec.ts`, `themes/modeStorage.spec.ts`,
`locales/mergeLocaleFiles.spec.ts`. Pure logic only (Node environment, no DOM): the rendering of the components is not tested.

## Extension points

- Replace a page: `routes.tsx` (`pageOf`); a mode adds its adapter in `pages/ConversationPage.tsx`. Add a route: `STUDIO_ROUTES` (+ title key in the locales).
- New event topics: `ENGINE_TOPICS` and `effectOfEvent` (`lib/eventEffects.ts`, with test).
- Client state: slices added to `useStudioStore`.
