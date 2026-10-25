# Module `audio-studio`

## Role

The **voice library**: cloning samples (`clone`) and voices invented from a description (`design`), with their routes `/api/voices*` and their files. The sample file (WAV 24 kHz, `voice_<id>.wav`) stays in `<données>/uploads/`; the database only keeps its name. **The engine prepares the clip and computes the transcription** (it decodes the audio and runs the models); Nest keeps the row, the name, the **editable** transcription and deletes the file.

Status (task H4.5): routes, files, event `studio.voices.changed`, voices passed to the audio jobs (see `studio-core`). The composers, takes and audio galleries are on the front side (`front/src/modules/audio-studio`, `voices`); audio messages are ordinary `studio-core` messages (conversations in `audio` mode).

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `AudioStudioModule.ts` | Imports `MediaLibraryModule`, declares `VoiceEntity`, provides and exports `VoiceService` and `VoiceFileService`. |
| Entity | `entities/VoiceEntity.ts` | Table `voices`. |
| DTO | `dto/VoiceDto.ts` | Public shape (identical to `voice_public` in `engine/app/voices.py`). |
| DTO | `dto/VoiceTranscriptionDto.ts` | Response of `transcribe`: `{ text, language?, duration?, model }`. |
| Mapper | `mappers/voiceMapper.ts` | `toVoiceDto`. |
| Service | `services/VoiceService.ts` | `list`, `get`, `findByIds`, `create` (forced id possible), `update`, `remove` (row only, returned). |
| Service | `services/VoiceFileService.ts` | `transcribeUpload` (transcript of a sample not yet saved), `createFromUpload`, `createFromAsset`, `update`, `remove` (row then file via `POST /engine/v1/media/purge`), `transcribe`; publishes `voices.changed`. |
| Pure functions | `services/voiceParams.ts` | Body validation (422): `parseUploadVoice`, `parseVoiceFromAsset`, `parseUpdateVoice`, `parseTranscribeVoice`. |
| Controller | `controllers/VoiceController.ts` | `/api/voices*`. |
| Types | `types/voiceTypes.ts` | Service inputs, limits (name: 80 characters, transcription from a take: 600). |

Tests: `controllers/VoiceController.spec.ts` (routes on a fake engine HTTP server: shapes, errors, events, files), `services/VoiceService.spec.ts`, `services/voiceParams.spec.ts`; parity with the engine: `legacy-import/publicShapes.spec.ts`.

## Language

Texts shown to the user (errors, default titles, failure states) go through `tr('audioStudio.…')` (`src/modules/i18n`) and follow the interface language (`Accept-Language` header). Dictionaries: `audio-studio/i18n/messages.fr.json` and `messages.en.json` (parity checked by `i18n/messages.spec.ts`).

## Dependencies

- `media-library` (`AssetService`, `StudioEvents`, `uploadStorage`, `newId`, data folders); `engine` (`EngineClient`, `engineErrorToHttp`); `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`, `AdminOnlyInterceptor`).
- Calls to the engine (`/engine/v1`, reserved to Nest): `POST /media/voice-reference` (mono 24 kHz clip, leading and trailing silence removed, 1 to 30 s, 120-value waveforms; the source is not deleted), `POST /media/transcribe`, `POST /media/purge`.

## Exposed endpoints (exhaustive)

All **administrator** (`local-trust` included), plain JSON, same URLs, shapes and error texts as the former engine API (which no longer has a voice library: it only prepares the reference clip).

| Method | Endpoint | Response | Errors |
|---|---|---|---|
| `GET` | `/api/voices` | list of voices (most recent first) | |
| `POST` | `/api/voices` (multipart: `file`, `name?`, `transcript?`, `language?`, `description?`, `kind?` = `clone` \| `design`) | the voice; publishes `voices.changed` | 422 (no file, unreadable clip, or `Extrait trop court : il faut au moins une seconde de parole.` (clip too short: at least one second of speech is needed)) |
| `POST` | `/api/voices/from-asset` `{ asset_id, name?, description?, transcript?, language?, kind? }` | the voice; without `name`: the take's voice or `Voix enregistrée` (recorded voice); without `transcript`: the take's text (600 characters); `kind`: `design` by default | 404 `Prise audio introuvable.` (audio take not found), 422 |
| `PATCH` | `/api/voices/:id` `{ name?, transcript?, description?, language? }` | the voice; publishes `voices.changed` | 404 `Voix introuvable.` (voice not found), 422 |
| `DELETE` | `/api/voices/:id` | `{ ok: true }`; the row then the file; publishes `voices.changed` | 404 |
| `POST` | `/api/voices/:id/transcribe` `{ language?, model_id? }` | `{ text, language, duration, model }`: **a suggestion, nothing is saved** (the user corrects it, then saves through `PATCH`) | 404, 409 (no transcription model or engine absent), 500 |
| `POST` | `/api/voices/transcribe-sample` (multipart: `file`, `language?`, `model_id?`) | `{ text, language, duration, model }`: the suggestion for a sample **not saved yet** (the engine prepares the same reference clip, transcribes it, then the clip and the upload are removed; no voice is created) | 409 (no transcription model or engine absent), 422 (no file, unreadable clip), 500 |

Name of a sent voice: `name`, otherwise the file name without extension, otherwise `Ma voix` (My voice). The raw received file is written to `<données>/uploads/tmp_<aléa>` (multer, on disk, 100 MB at most) then **always deleted by Nest** once the clip is prepared.

## Browser event

`studio.voices.changed` (`type` `voices.changed`, payload `{}`): an **invalidation** event (new in H4.5; the former engine SSE already published `voices.changed`). The client re-reads `GET /api/voices`.

## Entities

`VoiceEntity` (`voices`): `id`, `name`, `kind` (`clone` | `design`), `filename` (nullable), `transcript` (editable: it improves cloning), `description`, `language`, `duration` (seconds), `peaks` (JSON: 120 values between 0 and 1), `createdAt` (seconds, float). Public shape: `id, name, kind, transcript, description, language, duration, peaks, url (/media/uploads/<fichier> or null), created_at`. List: most recent first.

## Extension points

- `studio-core` reads `VoiceService.findByIds` to resolve the voices of an audio job (`jobVoices`).
- A voice without a file (`filename` null) is not passed to the engine.
