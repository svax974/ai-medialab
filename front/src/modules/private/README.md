# Module `private` (private generation, interface)

## Role

The "Private generation" mode as seen from the browser: the sidebar button, the banner and the coloured frame that say
the user is in private mode, the routing of studio requests to the private routes of Nest (module `private` of the back, see its
README for the full audit of what is or is not guarded), and above all what prevents the interface itself from writing
content into the browser (`localStorage`).

The mode is **never persisted**: a page that opens always starts in normal mode, and erases the private session that a
previous page may have left (reload, closing without warning the server).

## Structure

```
index.ts                      PrivateBanner, PrivateHost, PrivateToggle, usePrivateSession, privacyStorage, registerPrivacyStore, privatePath, isPrivateMode, usePrivateStore
types.ts                      PrivateSessionInfo (`GET /api/private/session`)
state/privateStore.ts         `active` flag (never persisted), `busy`, `info`; `isPrivateMode()` for code outside React
lib/privateRouting.ts         `privatePath` (studio routes → `/private/…`), `isPersistingRequest` (writes refused: voices, conversations of the persistent chat), `isLibraryListing` (empty gallery)
lib/privateChatMemory.ts      memory of the private chat (conversations, sent files, responses in progress) and the registry of end-of-session cleanups; emptied at each transition
lib/privacyStorage.ts         `localStorage` of the stores that keep content: neither read nor written in private session; registry, emptying and reloading
lib/privateTransition.ts      emptying of the caches on the side being left (conversations, lists, lightbox, progress, queue)
lib/privateSession.ts         `enterPrivate`, `leavePrivate`, `eraseNow`, `leaveLocally`
lib/ttl.ts                    minutes of inactivity announced by the server
services/privateApi.ts        `/api/private/session` (info, open, end, exit beacon)
hooks/usePrivateSession.ts    enter / leave / erase everything, with confirmations and navigation
hooks/usePrivateEvents.ts     topic `private.changed`: rereading of what changed; session ended by the server → back to normal mode
hooks/usePrivateGuards.ts     orphan session erased at startup, warning before closing if there are results, `sendBeacon` on closing
components/                   PrivateToggle (foot of the sidebar), PrivateBanner, PrivateHost (frame and `data-private` attribute)
locales/                      fr, en
```

## Services

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/private/session` | State of the session (without content). |
| `POST` | `/api/private/session` | Opens the session. |
| `DELETE` | `/api/private/session` | Ends it and erases everything. |
| `POST` | `/api/private/session/leave` | Beacon (`sendBeacon`) when the page is closed. |

During the session, `studioRequest` and `studioUpload` (module `studio-shell`) call `/api/private` + the path for
`/conversations`, `/messages` (except `/messages/model-usage`), `/queue`, `/assets` and, for the chat, `/chat/attachments` and `/chat/enhance-prompt`; they refuse (409, code `private`) any
write to `/voices` and `/chat/conversations` (private chat does not need them: its conversation is the page's, `chat/services/privateChatBackend.ts`); they do not request the list of assets (empty gallery).

## Entering, leaving (order matters)

- **Enter**: the flag switches to true BEFORE anything; the composers are emptied (in memory only: writes are ignored);
  the caches of the normal side are deleted; the server opens the session; on failure everything goes back.
- **Leave**: the server erases; the composers are emptied while the flag is still true, the flag switches to false, then
  the stores reread `localStorage` (which has never been touched): the earlier drafts come back. Emptying a store AFTER lowering
  the flag would overwrite the drafts (a test guards it).

Stores concerned (`registerPrivacyStore` + `storage: privacyStorage()`): `useImageDraftStore`, `useVideoDraftStore`,
`useAudioDraftStore`, `useChatDraftStore`, `useChatDefaultsStore`. Kept as they are, without content: `cn-prefs` (sidebar
open), `cn-models` (model chosen per type), the theme and the language.

## Components

| Name | Description |
|---|---|
| `PrivateToggle` | "Private generation" button (padlock) at the foot of the sidebar; tooltip that says what is and is not guarded; confirmation on entry (guarantees and limits) and on exit. |
| `PrivateBanner` | Sticky banner at the top of the page: "nothing is saved", number of results in memory, "Erase everything now", "Leave". Reminds on the gallery and library pages that they are empty in private mode. |
| `PrivateHost` | Mounted once in `StudioShell`: guards, events, purple frame around the window (never clickable), `data-private` on `<html>`. |

## Dependencies

`studio-shell` (`studioRequest`, `studioHttp`, `queryKeys`, `useT`, routes), `studio-core` (progress and queue stores, `messagesApi`),
`media-library` (lightbox, asset keys), the template (`confirm`, `eventStreamClient`). `studio-shell`, `studio-core` and `chat` in turn import
`lib/privateRouting`, `state/privateStore` and `lib/privacyStorage` (deep paths, without file cycles).

## Guarantees and limits

See the README of the back module `private` (audit, guarantees, limits). On the interface side: nothing is written to `localStorage` during the
session; progress, queue and lists are in memory; a displayed file is served `no-store`. Closing the window without
confirmation erases the session on a best-effort basis (`sendBeacon`); the server erases it anyway after the inactivity delay.

## Tests

`lib/privateRouting.spec.ts`, `lib/privacyStorage.spec.ts` (real stores, simulated `localStorage` with a witness phrase: never written, drafts rendered
intact), `lib/privateSession.spec.ts` (entry, failure, exit, server unreachable, erase everything), `lib/privateHttp.spec.ts` (routing, refusals, empty gallery).
Nothing has been seen in a browser.

## Private chat

The conversation of a private chat is held by the page (`chat/services/privateChatBackend.ts`, documented in `front/src/modules/chat/README.md`, "Chat in private session"); this module keeps only
the **memory** (`lib/privateChatMemory.ts`: conversations, sent files, ongoing streams) and the **cleanup registry** (`registerPrivateCleanup`, used by the chat, the "sent to" text…):
`dropStudioCaches` calls `forgetPrivateChats()` at each entry, exit, "erase everything" or local return, which abandons the streams, empties the memory and runs the cleanups.
Deleting a conversation from the list calls `forgetPrivateChat(id)` (`studio-shell/hooks/useConversations.ts`). The entry confirmation texts say that the chat is private too, that the conversation
stays on the page, that the chat's web search stays off until it is turned on, and that the text of a voice synthesis goes through the command line of the computation program.
