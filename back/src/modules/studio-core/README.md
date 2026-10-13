# Module `studio-core`

## Rôle

Persistance des **conversations** et des **messages** (prompts de l'utilisateur et générations de l'assistant), avec les
liens vers leurs assets de référence. Les trois studios (image, audio, vidéo) partagent ces tables ; `mode` distingue
la conversation. C'est la base de la file « quel message ensuite », qui arrive en H4.3.

État (tâche H2) : entités, DTO, mappeurs et services de lecture/écriture de base. **Aucun contrôleur** : l'ancienne API
(`/api/conversations`, `/api/messages`) est servie par le proxy transitoire du module `engine`.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `StudioCoreModule.ts` | Importe `MediaLibraryModule`, déclare les trois entités, fournit et exporte les services. |
| Entité | `entities/ConversationEntity.ts` | Table `conversations` (avec `mode`). |
| Entité | `entities/MessageEntity.ts` | Table `messages`. |
| Entité | `entities/MessageRefEntity.ts` | Table `message_refs` (assets de référence d'un prompt). |
| DTO | `dto/ConversationDto.ts` | Résumé public (identique à `conversation_summary` de `engine/app/repo.py`). |
| DTO | `dto/ConversationDetailDto.ts` | Résumé + `messages`. |
| DTO | `dto/MessageDto.ts` | Forme publique d'un message (identique à `message_public`). |
| Mappeurs | `mappers/conversationMapper.ts`, `mappers/messageMapper.ts` | Entités vers formes publiques. |
| Service | `services/ConversationService.ts` | `list`, `get`, `getSummary`, `create`, `update`, `touch`, `remove`. |
| Service | `services/MessageService.ts` | `get`, `listByConversation`, `create`, `update`, `remove`, `failInterrupted`, `toDtos`. |
| Types | `types/studioTypes.ts` | Entrées des services, constantes (`BUSY_STATUSES`, titre par défaut). |

Tests : `services/StudioCoreServices.spec.ts` (services) ; parité des formes publiques avec le moteur :
`legacy-import/publicShapes.spec.ts`.

## Dépendances

- `media-library` (`AssetEntity`, `toAssetDto`, `newId`, `nowSeconds`). Pas l'inverse.
- `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`).

## Endpoints exposés (exhaustif)

Aucun pour l'instant (H4.3).

## Entités

- `ConversationEntity` (`conversations`) : `id`, `title`, `pinned`, `mode` (`image` | `audio` | `video`, défaut
  `image`), `createdAt`, `updatedAt` (secondes, flottant). Index `(mode, updated_at)`.
- `MessageEntity` (`messages`) : `id`, `conversationId` (suppression en cascade), `parentId` (le prompt auquel répond une
  génération, cascade), `role` (`user` | `assistant`), `prompt`, `modelId`, `params` (JSON libre : contrat avec le
  moteur), `status` (`queued`, `loading`, `running`, `done`, `error`, `cancelled`), `error`, `createdAt`, `startedAt`,
  `finishedAt`. Index `(conversation_id, created_at)`. Les contraintes `CHECK` de l'ancienne base (`role`, `kind`)
  ne sont pas reprises : les valeurs sont typées en TypeScript et normalisées par l'importateur.
- `MessageRefEntity` (`message_refs`) : clé `(messageId, assetId)`, `position` ; supprimée avec le message ou l'asset.

Formes publiques (snake_case, champs absents à `null`) :

- Conversation : `id, title, pinned, created_at, updated_at, mode, cover, generation_count, busy`. `cover` : dernier asset
  généré image ou vidéo (jamais audio) ; `generation_count` : nombre de messages `assistant` ; `busy` : un message
  `queued`, `loading` ou `running`. Détail : + `messages` (du plus ancien au plus récent).
- Message : `id, conversation_id, parent_id, role, prompt, model_id, params, status, error, created_at, started_at,
  finished_at, references, outputs` (`references` : assets de référence dans l'ordre ; `outputs` : assets générés,
  par `position`).
- Liste : épinglées d'abord, puis `updated_at` décroissant ; filtres `mode` et `q` (titre ou prompt d'un message).

## Points d'extension

- H4.3 : contrôleurs, file des messages, relance, annulation, publication SSE ; création d'une conversation à partir du
  premier prompt (titre tiré du prompt) ; suppression avec purge des assets et des fichiers (`purge_assets` du moteur ;
  `ConversationService.remove` et `MessageService.remove` ne suppriment que les lignes et leurs cascades).
- `MessageService.failInterrupted()` reprend le balayage de démarrage de l'ancien `init_db` (une génération interrompue
  par un arrêt n'est pas reprise) ; à appeler au démarrage quand Nest possédera la file (H4.3).
