# Module `audio-studio`

## Rôle

La **bibliothèque de voix** : échantillons de clonage (`clone`) et voix inventées à partir d'une description (`design`),
avec leurs routes `/api/voices*` et leurs fichiers. Le fichier d'échantillon (WAV 24 kHz, `voice_<id>.wav`) reste dans
`<données>/uploads/` ; la base ne garde son nom. **Le moteur prépare le clip et calcule la transcription** (il décode
l'audio et exécute les modèles) ; Nest garde la ligne, le nom, la transcription **modifiable** et supprime le fichier.

État (tâche H4.5) : routes, fichiers, événement `studio.voices.changed`, voix passées aux jobs audio (voir `studio-core`).
Les composeurs, les prises et les galeries audio sont côté front (`front/src/modules/audio-studio`, `voices`) ; les
messages audio sont des messages ordinaires de `studio-core` (conversations de mode `audio`).

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `AudioStudioModule.ts` | Importe `MediaLibraryModule`, déclare `VoiceEntity`, fournit et exporte `VoiceService` et `VoiceFileService`. |
| Entité | `entities/VoiceEntity.ts` | Table `voices`. |
| DTO | `dto/VoiceDto.ts` | Forme publique (identique à `voice_public` de `engine/app/voices.py`). |
| DTO | `dto/VoiceTranscriptionDto.ts` | Réponse de `transcribe` : `{ text, language?, duration?, model }`. |
| Mappeur | `mappers/voiceMapper.ts` | `toVoiceDto`. |
| Service | `services/VoiceService.ts` | `list`, `get`, `findByIds`, `create` (id imposé possible), `update`, `remove` (ligne seulement, renvoyée). |
| Service | `services/VoiceFileService.ts` | `createFromUpload`, `createFromAsset`, `update`, `remove` (ligne puis fichier via `POST /engine/v1/media/purge`), `transcribe` ; publie `voices.changed`. |
| Pures | `services/voiceParams.ts` | Validation des corps (422) : `parseUploadVoice`, `parseVoiceFromAsset`, `parseUpdateVoice`, `parseTranscribeVoice`. |
| Contrôleur | `controllers/VoiceController.ts` | `/api/voices*`. |
| Types | `types/voiceTypes.ts` | Entrées des services, limites (nom : 80 caractères, transcription issue d'une prise : 600). |

Tests : `controllers/VoiceController.spec.ts` (routes sur un faux moteur HTTP : formes, erreurs, événements, fichiers),
`services/VoiceService.spec.ts`, `services/voiceParams.spec.ts` ; parité avec le moteur : `legacy-import/publicShapes.spec.ts`.

## Dépendances

- `media-library` (`AssetService`, `StudioEvents`, `uploadStorage`, `newId`, dossiers de données) ; `engine` (`EngineClient`,
  `engineErrorToHttp`) ; `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`, `AdminOnlyInterceptor`).
- Appels au moteur (`/engine/v1`, réservés à Nest) : `POST /media/voice-reference` (clip mono 24 kHz, bords de silence
  retirés, 1 à 30 s, formes d'onde de 120 valeurs ; la source n'est pas supprimée), `POST /media/transcribe`,
  `POST /media/purge`.

## Endpoints exposés (exhaustif)

Tous **administrateur** (`local-trust` inclus), JSON en clair, mêmes URLs, formes et textes d'erreur que l'ancienne API du
moteur (qui n'a plus de bibliothèque de voix : il ne prépare que le clip de référence).

| Méthode | Endpoint | Réponse | Erreurs |
|---|---|---|---|
| `GET` | `/api/voices` | liste de voix (plus récentes d'abord) | |
| `POST` | `/api/voices` (multipart : `file`, `name?`, `transcript?`, `language?`, `description?`, `kind?` = `clone` \| `design`) | la voix ; publie `voices.changed` | 422 (aucun fichier, clip illisible ou « Extrait trop court : il faut au moins une seconde de parole. ») |
| `POST` | `/api/voices/from-asset` `{ asset_id, name?, description?, transcript?, language?, kind? }` | la voix ; sans `name` : voix de la prise ou « Voix enregistrée » ; sans `transcript` : texte de la prise (600 caractères) ; `kind` : `design` par défaut | 404 « Prise audio introuvable. », 422 |
| `PATCH` | `/api/voices/:id` `{ name?, transcript?, description?, language? }` | la voix ; publie `voices.changed` | 404 « Voix introuvable. », 422 |
| `DELETE` | `/api/voices/:id` | `{ ok: true }` ; la ligne puis le fichier ; publie `voices.changed` | 404 |
| `POST` | `/api/voices/:id/transcribe` `{ language?, model_id? }` | `{ text, language, duration, model }` : **une suggestion, rien n'est enregistré** (l'utilisateur la corrige puis enregistre par `PATCH`) | 404, 409 (aucun modèle de transcription ou moteur absent), 500 |

Nom d'une voix envoyée : `name`, sinon le nom du fichier sans extension, sinon « Ma voix ». Le fichier brut reçu est écrit
dans `<données>/uploads/tmp_<aléa>` (multer, sur disque, 100 Mo au plus) puis **toujours supprimé par Nest** une fois le clip préparé.

## Événement navigateur

`studio.voices.changed` (`type` `voices.changed`, charge utile `{}`) : événement d'**invalidation** (nouveau en H4.5 ; l'ancien
SSE du moteur publiait déjà `voices.changed`). Le client relit `GET /api/voices`.

## Entités

`VoiceEntity` (`voices`) : `id`, `name`, `kind` (`clone` | `design`), `filename` (nullable), `transcript` (modifiable : il
améliore le clonage), `description`, `language`, `duration` (secondes), `peaks` (JSON : 120 valeurs entre 0 et 1),
`createdAt` (secondes, flottant). Forme publique : `id, name, kind, transcript, description, language, duration, peaks,
url (/media/uploads/<fichier> ou null), created_at`. Liste : plus récentes d'abord.

## Points d'extension

- `studio-core` lit `VoiceService.findByIds` pour résoudre les voix d'un job audio (`jobVoices`).
- Une voix sans fichier (`filename` nul) n'est pas transmise au moteur.
