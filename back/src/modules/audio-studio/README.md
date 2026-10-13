# Module `audio-studio`

## Rôle

Persistance de la **bibliothèque de voix** : échantillons de clonage (`clone`) et voix inventées à partir d'une
description (`design`). Le fichier d'échantillon (WAV 24 kHz, `voice_<id>.wav`) reste dans `<données>/uploads/` ;
la base ne garde son nom. Le composeur audio, les prises, la transcription et les routes arrivent en H4.5.

État (tâche H2) : entité, DTO, mappeur, service de lecture/écriture de base. **Aucun contrôleur** : l'ancienne API
(`/api/voices`) est servie par le proxy transitoire du module `engine`.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `AudioStudioModule.ts` | Déclare `VoiceEntity`, fournit et exporte `VoiceService`. |
| Entité | `entities/VoiceEntity.ts` | Table `voices`. |
| DTO | `dto/VoiceDto.ts` | Forme publique (identique à `voice_public` de `engine/app/voices.py`). |
| Mappeur | `mappers/voiceMapper.ts` | `toVoiceDto`. |
| Service | `services/VoiceService.ts` | `list`, `get`, `create`, `update`, `remove` (ligne seulement, renvoyée pour effacer le fichier). |
| Types | `types/voiceTypes.ts` | `CreateVoiceInput`, `UpdateVoiceInput`, limites (nom : 80 caractères). |

Tests : `services/VoiceService.spec.ts` ; parité avec le moteur : `legacy-import/publicShapes.spec.ts`.

## Dépendances

- `media-library` (`newId`, `nowSeconds`) ; `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`).

## Endpoints exposés (exhaustif)

Aucun pour l'instant (H4.5).

## Entités

`VoiceEntity` (`voices`) : `id`, `name`, `kind` (`clone` | `design`), `filename` (nullable), `transcript` (modifiable : il
améliore le clonage), `description`, `language`, `duration` (secondes), `peaks` (JSON : 120 valeurs entre 0 et 1),
`createdAt` (secondes, flottant). Forme publique : `id, name, kind, transcript, description, language, duration, peaks,
url (/media/uploads/<fichier> ou null), created_at`. Liste : plus récentes d'abord.

## Points d'extension

- H4.5 : contrôleur, création depuis un envoi ou une prise (le moteur prépare le clip : `prepare_reference`), suggestion de
  transcription, effacement du fichier d'échantillon après `VoiceService.remove`.
