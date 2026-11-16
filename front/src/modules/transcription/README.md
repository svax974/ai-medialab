# Module `transcription`

## Rôle

Transcription studio at `/transcriptions` and `/transcriptions/:id`, alongside OCR. Local speech recognition from
video/audio files or a public YouTube link. Persistent history, progress, cancellation, editable plain text, copy and TXT
export. Continues in the background when changing studio. Creation/edits/retry disabled during private mode; stopping
existing work remains available. French and English dictionaries ship in `locales/`.

## Structure et composants

| Component | Description |
|---|---|
| `TranscriptPage` | Home or keyed detail, darkroom theme tokens |
| `TranscriptComposer`, `TranscriptSource` | File drop/picker or YouTube URL, source errors, STT model and language selection, upload state |
| `TranscriptPrerequisites` | Missing media reader installer using existing engine installer/events |
| `TranscriptResult`, `TranscriptActions` | Live status and partial text, plain-text editor, save, copy, TXT, confirmed replacement/deletion, cancellation |
| `TranscriptSidebarList` | Search from shell, sortable title/date headers, progress and current selection |

Hooks: `useTranscriptComposer` owns form/upload state; `useTranscripts`/`useTranscript` use common's `useLiveResource`
for `studio.transcription.updated/deleted`, matching detail by id. Disconnected fallback only. Draft text stays local
until saved. History events/list responses omit full text. `lib/transcriptRules` owns frontend validation and formatting;
the server validates independently. Shell thin page: `studio-shell/pages/TranscriptionHomePage.tsx`.

## Services

Every call goes through the existing Nest studio transport (no browser-to-engine request).

| Method | Endpoint | Description |
|---|---|---|
| `list(query)` | GET `/transcripts?q=` | Recent searchable summaries |
| `get(id)` | GET `/transcripts/:id` | Detail and partial/full text |
| `create(input, progress)` | POST `/transcripts` | Multipart file or YouTube URL, model, language; upload progress |
| `edit(id, text)` | PATCH `/transcripts/:id` | Save plain-text edits |
| `cancel(id)` | POST `/transcripts/:id/cancel` | Stop and retain partial text |
| `retry(id)` | POST `/transcripts/:id/retry` | Confirmed text replacement and new run |
| `remove(id)` | DELETE `/transcripts/:id` | Confirmed history/source deletion |
| `exportUrl(id)` | GET `/transcripts/:id/export` | Download saved text as UTF-8 TXT |

## Types principaux

`Transcript` summary, `TranscriptDetail` (adds text), `TranscriptStatus`, `TranscriptStage`, `CreateTranscript`.
Mirror the backend DTOs. See `back/src/modules/transcription/README.md` for persistence, limits and lifecycle.

## Dépendances

MUI, React Router, TanStack Query (mutations/catalogue), common live-resource/sorting/confirmation, studio-shell
HTTP/i18n/navigation, model-catalog (audio STT models), engines (model setup and reader installation), private state.
No new CSS/color literals or shared-module edits. Existing dark/light Chambre noire tokens are reused.

Last verified against source: 2026-11-16.
