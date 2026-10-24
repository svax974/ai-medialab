# Module `media-library`

## Role

Persistence of **assets**: files known to the application, whether sent by the user (`upload`: reference image, voice sample, source clip) or produced by an engine (`generated`: image, audio take, video). The table only holds metadata; the files stay in the data folder (`uploads/`, `outputs/`, `thumbs/`), and the paths are **relative file names** kept as they were in the former database. Low layer: `studio-core` depends on it, never the reverse.

Status (task H4.3a): entities, DTOs, mapper and service (H2), plus the routes `/api/assets*` (uploads, gallery, favorite, deletion with files) and the `studio.*` event publisher. **Deviation from the plan**: these routes were planned for H4.4; they move to Nest as early as H4.3a for **consistency**: generated assets are now recorded in Nest's database, and a generation referencing an image sent through the old path (`/api/assets` of the engine, the engine's database) would not find it. The front (image gallery, viewer, global drop) is in `front/src/modules/media-library/README.md` (H4.4); the gallery reads `GET /api/assets` page by page (cursor `next_before`).

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `MediaLibraryModule.ts` | Declares `AssetEntity` (`forFeature`), provides and exports `AssetService` and `TypeOrmModule`. |
| Entity | `entities/AssetEntity.ts` | Table `assets`. |
| DTO | `dto/AssetDto.ts` | Public shape of an asset (identical to `asset_public` of the former engine, `engine/app/repo.py` removed in H6). |
| DTO | `dto/AssetListItemDto.ts` | Gallery item (`AssetDto` + conversation title, prompt, model) and page (`items`, `next_before`). |
| Mapper | `mappers/assetMapper.ts` | `toAssetDto`, `toAssetListItemDto`, `mediaUrl` (`/media/<dossier>/<fichier>`). |
| Service | `services/AssetService.ts` | `get`, `getEntity`, `create`, `setFavorite`, `remove` (row only), `purge` (`purge_assets`: row only), `adoptOrphans`, `list` (filters and cursor of the former API). |
| Service | `services/AssetFileService.ts` | `ingest` (upload: the engine decodes and makes the thumbnail, Nest records the row), `purge` / `removeFiles` (files and thumbnails removed by the engine). |
| Service | `services/StudioEvents.ts` | Publishes the `studio.<nom>` events (same names and shapes as the former SSE); also used by `studio-core` and `audio-studio` (`voices.changed`). |
| Module | `StudioEventLimitsModule.ts` | **Global** module that provides `EVENT_STREAM_OPTIONS` to the shared stream: `maxEventBytes` = 256 KB instead of 16 KB (see "Event size"). |
| Utilities | `utils/uploadStorage.ts` | `uploadStorage` (multer on disk, `uploads/tmp_<aléa>`) and `decodeUploadName`, shared with `audio-studio`. |
| Controller | `controllers/AssetController.ts` | `/api/assets*`. |
| Service | `services/AssetExportService.ts` | Light copy of a video (presets `light`, `tiny`). |
| Utilities | `utils/dataDir.ts` | Data folder shared with the engine (`APP_DATA_DIR`, otherwise `IMAGEGEN_DATA_DIR`), `uploadsDir`, `outputsDir`, `assetFilePath`. |
| Types | `types/assetTypes.ts` | `CreateAssetInput`, `ListAssetsQuery`. |
| Utilities | `utils/ids.ts` | `newId()` (sortable id: 11 hex digits of the timestamp in ms + 10 random, format of the former `new_id`), `nowSeconds()` (seconds, float). |

Tests: `services/AssetService.spec.ts` (service, mapper, gallery), `services/AssetFileService.spec.ts` (upload, purge, folders, event publisher); parity with the engine is checked by `legacy-import/publicShapes.spec.ts` and, for the routes, `studio-core/controllers/studioRoutes.spec.ts`.

## Language

Texts shown to the user (errors, default titles, failure states) go through `tr('mediaLibrary.…')` (`src/modules/i18n`) and follow the interface language (`Accept-Language` header). Dictionaries: `media-library/i18n/messages.fr.json` and `messages.en.json` (parity checked by `i18n/messages.spec.ts`).

## Dependencies

- `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`).
- `engine` (global: `EngineClient`, `engineErrorToHttp`), `common` (`EventStreamService`), `multer` (already provided by `@nestjs/platform-express`, disk writing).
- No dependency on `studio-core`: `conversationId` and `messageId` target its entities **by their name** (`@ManyToOne('ConversationEntity')`), and the gallery join uses table names.

## Exposed endpoints (exhaustive)

Administrator (`local-trust` included), plain JSON, same URLs and shapes as the former engine API.

| Method | Endpoint | Response | Errors |
|---|---|---|---|
| `POST` | `/api/assets` (multipart, field `files`, 50 files and 500 MB each at most) | list of `upload` assets | 422 (no file, unreadable image or video: `Image illisible : nom` (unreadable image: name)), 413 |
| `GET` | `/api/assets?kind=&media=&favorites=&q=&before=&limit=` | `{ items, next_before }` (gallery, most recent first) | |
| `PATCH` | `/api/assets/:id` `{ favorite }` | asset; publishes `asset.updated` | 404 `Image introuvable.` (image not found), 422 |
| `POST` | `/api/assets/:id/export` `{ preset: 'light' \| 'tiny' \| 'gif' \| 'gif-tiny' }` | `{ url, width, height, fps, bytes }`: a light MP4 of a video (360p at 15 images/s, or 240p at 12) or a looping GIF of its first 150 images (320p at 12, or 200p at 10, no sound), made by the engine (`POST /engine/v1/media/video-export`) in its `exports` folder, served as `/media/exports/<file>` and reused while the video is unchanged | 404, 422 (not a video, unknown preset, FFmpeg missing) |
| `DELETE` | `/api/assets/:id` | `{ ok: true }`; row, file and thumbnail deleted; publishes `asset.deleted` `{ id, message_id, conversation_id }` | 404 |

**Upload**: multer writes the raw file to `<données>/uploads/tmp_<aléa>` (no copy in memory: a video can weigh 500 MB), then the engine transforms it (`POST /engine/v1/media/ingest`: image re-encoded as PNG, EXIF orientation applied, transparency flattened, 4096 px at most; video kept, dimensions, duration and fps read; WebP thumbnail) and deletes the raw file; Nest records the row with the id and the rendered file names. The original name is re-read as UTF-8 (multer reads it as latin1).

## Event size

`EventStreamService` drops (while logging it) any event larger than 16 KB. A final audio `message.updated` (up to 4 takes, each with 240 waveform peaks, one marker per speech turn and the text) measures **~8 KB** for a short text, **~33 KB** for a 40-line dialogue and **~105 KB** for 8000 characters (measured by `studio-core/services/AudioGeneration.spec.ts`): without a change, the interface would never see the end of a long audio generation. **Chosen solution: raise the limit for this application** (`StudioEventLimitsModule`, 256 KB, i.e. more than twice the worst case; the resume buffer keeps its 500 events). Reasons: the limit protects a multi-user server from content coming from outside, whereas here all events are produced by our own server for a single person; the alternative (invalidation events, REST re-reading) would change the shape of all the `studio.*` events already consumed by the front, would force re-reading each message on every state change, and would leave a window in which the interface is late. The module must be **global** because `EventStreamService` is declared in `CommonModule`, which only sees its own imports and the global modules (`StudioEventLimitsModule.spec.ts` checks it, with the control case without the module).

## Entities

`AssetEntity` (table `assets`): `id` (key), `kind` (`upload` | `generated`), `media` (`image` | `audio` | `video`, default `image`), `conversationId` / `messageId` (nullable, `ON DELETE SET NULL`: deleting a conversation does not delete the asset), `filename`, `thumb`, `originalName`, `width`, `height`, `seed` (31-bit integer), `duration` (seconds), `position` (order in a message's output), `favorite`, `meta` (free JSON: `fps`, `frames`, voice, prompt…), `createdAt` (seconds since the epoch, float: unit of the former database). Indexes: `(kind, created_at)`, `(media, kind, created_at)`, `(message_id)`.

Public shape (`AssetDto`, snake_case fields as in the former API, never omitted: `null` when absent): `id, kind, media, duration, fps (meta.fps, video only), url, thumb_url, width, height, seed, original_name, favorite, meta, conversation_id, message_id, created_at`.

## Extension points

- H4.4 (done): the gallery front; H4.5 and H4.6 reuse the same route with `media=audio` / `media=video`. `StudioEvents` also publishes `studio.queue.updated` (generation queue, see `studio-core`).
- `AssetService.remove` returns the deleted entity so that the caller removes the files; `AssetService.purge` is the equivalent of the engine's `purge_assets` (an asset still referenced by a message only loses its link to the message).
