# Local media transcription

Validated scope: a dedicated **Transcription** studio alongside OCR, accepting a YouTube URL or an uploaded
video/audio file. Choose an installed speech-to-text model and automatic or explicit language. Jobs run in the
background with progress and cancellation. Keep history and editable text, with copy and TXT export.

## Ownership and execution

- `transcription` Nest module owns job records, source files, the queue and edited results. New tables only, with a
  portable TypeORM migration. The browser talks only to Nest. Events carry summaries, never a whole long transcript.
- The queue respects `EngineBusyGate` and the media generation queue, and registers with emergency stop.
  Interrupted jobs retain partial text and may be retried; queued jobs restart at bootstrap.
- The engine exposes an internal SSE transcription operation. It prepares a bounded audio chunk at a time with the
  existing PyAV component and uses the existing Whisper/audio.cpp model selection. No full media decoding in RAM.
  Model subprocesses are cancellable and checked against the application's memory budget.
- YouTube accepts canonical public video links only (watch, shortened and Shorts links), without playlists or account
  cookies. `yt-dlp` retrieves the audio. Its JavaScript solver uses the Node executable already available to the app;
  the desktop runtime must resolve it without requiring a system installation.

## Interface

Reuse the Chambre noire theme and the OCR document workflow. A source card switches between file and YouTube;
model/language controls explain unavailable prerequisites. Results show the source, model, progress and errors,
then an editable transcript. History belongs to this studio, not to generation conversations. Keep the seven mode
tabs usable in the existing sidebar. French and English translations ship together.

## Verification

Targeted Python tests use fake transcribers/downloaders and small synthetic audio, never real model weights.
Nest tests cover SQLite persistence/migrations, validation, stream events, queue exclusion, cancellation, editing,
cleanup and retry. Front tests cover source rules, event cache updates, history and server rendering.
Regenerate the engine OpenAPI and TypeScript contract. Check types, locales, lint, theme tokens and database
portability. Record observable import, queue, completion, refusal and cancellation outcomes without media content.

Last verified against source: 2026-11-16.
