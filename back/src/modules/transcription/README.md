# Module `transcription`

## Rôle

Persistent, local transcription of one uploaded video/audio file or one public YouTube video. Nest owns sources,
history, edited text and the queue; the internal Python engine owns decoding and speech recognition. Independent
from conversations and OCR. Browser routes are documented in the front module.

## Architecture

| Element | Responsibility |
|---|---|
| `TranscriptEntity`, `dto/Transcript*Dto` | `transcripts` table, summary and full-text detail |
| `TranscriptController` | Multipart boundary, validated fields, actions and UTF-8 TXT download |
| `TranscriptService` | Creation, edits, retry, deletion and bootstrap recovery; refuses creation/edit/retry during private mode |
| `TranscriptStore`, `transcriptDto` | Portable TypeORM queries; search title/text, at most 100 recent summaries; never full text in lists/events |
| `TranscriptQueue` | Serial execution, shared `EngineBusyGate`, generation queue priority, engine-link readiness, emergency stop and cleanup |
| `TranscriptEngineClient` | Internal SSE reader, abort and acknowledged worker shutdown |
| `lib/transcriptRules` | Canonical YouTube URL, supported extensions, language and safe export name |

## Dépendances

`MediaLibraryModule` (uploads/data folder/events), `StudioCoreModule` (gate and generation queue), `ModelCatalogModule`
(installed STT selection), `PrivateModule` (server-side persistence refusal), global engine and common modules, TypeORM.
Application module: wired explicitly in `AppModule`, no shared library modified.

## Endpoints exposés

All routes below require administrator access, including the loopback `LOCAL_TRUST` principal. Prefix `/api` is
rewritten by the application to `/api/v1`; both spellings follow the existing studio transport. No transport encryption
for these routes; sources never travel to a transcription cloud.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/transcripts?q=` | Admin | Search title/text, recent summaries |
| GET | `/api/transcripts/:id` | Admin | Detail including complete or partial text |
| POST | `/api/transcripts` | Admin | Multipart: exactly one `file` or `url`, optional `model_id`, `language` (`auto` or language code); enqueue |
| PATCH | `/api/transcripts/:id` | Admin | `{ text }`, save edits only while idle |
| POST | `/api/transcripts/:id/cancel` | Admin | Cancel waiting/running job; await worker, preserve partial text |
| POST | `/api/transcripts/:id/retry` | Admin | Validate installed model, replace existing text and enqueue again (UI confirms replacement) |
| DELETE | `/api/transcripts/:id` | Admin | Stop worker before removing row and all source/temporary files |
| GET | `/api/transcripts/:id/export` | Admin | UTF-8 plain text attachment |

Limits and extensions: `lib/transcriptRules.ts` (500 MiB input, up to one million text characters; the common HTTP parser already permits 5 MiB JSON bodies). Engine duration limit: 12 hours. Multer stores files on disk under the same data volume, then moves
one into `transcripts/<id>/source.<ext>`; retained until deletion to permit retry. YouTube stores the canonical video
URL; each retry downloads again. Decoded WAV chunks and downloaded audio are disposable `transcribe-*` folders.
Normal completion/cancellation cleans them after the engine stops; bootstrap sweeps all temporary transcript folders, including terminal jobs and retains
partial text. Queued jobs resume when the engine link is available (lightweight status fallback if the relay is disabled). Interrupted running jobs become `failed`.

## Entités

`transcripts`: id, title, source kind/URL/relative filename, chosen model id/name, language, status/stage, progress,
duration/processed seconds, text, error, creation/update timestamps. New table only, portable migration
`1794800000000-TranscriptTable.ts`. Status: `queued → running → done | failed | cancelled`; retry returns to `queued`.
No existing table is changed.

## Points d’extension et flux moteur

`studio.transcription.updated` carries a summary; `studio.transcription.deleted` carries `{ id }`. Audience: admin.
The interface fetches detail after matching events, with common's disconnected polling fallback. Internal calls:
`POST /engine/v1/transcripts/read` (SSE `progress`, `prepared`, `segment`, `heartbeat`, `done`/`error`) and
`POST /engine/v1/transcripts/stop` (acknowledges release before another job acquires the gate).

Whisper uses one speech-pack worker across all chunks; native Qwen3-ASR uses the existing audio.cpp CLI per chunk.
Bounded PCM decoding uses PyAV; memory ceiling, preflight and watchdog protect the process tree. The worker is
unloaded after each transcript. YouTube dependency and security restrictions: `docs/components/yt-dlp.md`.

## Tests et observation

Targeted tests cover source validation, SQLite lifecycle, exclusion, cancellation, bootstrap, private-mode refusal,
export, deletion and migration parity. Engine tests use fake workers/downloaders and synthetic audio, never weights.
`validation/checks.json` observes outcomes with non-secret IDs only; no text, filename or URL in validation traces.
Real model accuracy and YouTube availability remain observations from real use, not claims of the mock tests.

Last verified against source: 2026-11-16.
