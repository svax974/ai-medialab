# Module `media-library`

## Rôle

Persistance des **assets** : fichiers connus de l'application, qu'ils soient envoyés par l'utilisateur (`upload` : image
de référence, échantillon de voix, clip source) ou produits par un moteur (`generated` : image, prise audio, vidéo).
La table ne contient que des métadonnées ; les fichiers restent dans le dossier de données
(`uploads/`, `outputs/`, `thumbs/`), les chemins sont des **noms de fichiers relatifs** conservés tels quels depuis
l'ancienne base. Couche basse : `studio-core` en dépend, jamais l'inverse.

État (tâche H2) : entités, DTO, mappeur et service de lecture/écriture de base. **Aucun contrôleur** : l'ancienne API
(`/api/assets`) est encore servie par le proxy transitoire du module `engine`. Les routes (envois, favoris, galerie,
suppression avec fichiers) arrivent en H4.4.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `MediaLibraryModule.ts` | Déclare `AssetEntity` (`forFeature`), fournit et exporte `AssetService` et `TypeOrmModule`. |
| Entité | `entities/AssetEntity.ts` | Table `assets`. |
| DTO | `dto/AssetDto.ts` | Forme publique d'un asset (identique à `asset_public` de `engine/app/repo.py`). |
| DTO | `dto/AssetListItemDto.ts` | Élément de galerie (`AssetDto` + titre de la conversation, prompt, modèle) et page (`items`, `next_before`). |
| Mappeur | `mappers/assetMapper.ts` | `toAssetDto`, `toAssetListItemDto`, `mediaUrl` (`/media/<dossier>/<fichier>`). |
| Service | `services/AssetService.ts` | `get`, `create`, `setFavorite`, `remove` (ligne seulement), `list` (filtres et curseur de l'ancienne API). |
| Types | `types/assetTypes.ts` | `CreateAssetInput`, `ListAssetsQuery`. |
| Utilitaires | `utils/ids.ts` | `newId()` (id triable : 11 chiffres hexa de l'horodatage en ms + 10 aléatoires, format de l'ancien `new_id`), `nowSeconds()` (secondes, flottant). |

Les tests : `services/AssetService.spec.ts` (service, mappeur, galerie) ; la parité avec le moteur est vérifiée par
`legacy-import/publicShapes.spec.ts`.

## Dépendances

- `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`).
- Aucune dépendance vers un autre module de l'application : `conversationId` et `messageId` visent les entités de
  `studio-core` **par leur nom** (`@ManyToOne('ConversationEntity')`), la jointure de la galerie utilise les noms de tables.

## Endpoints exposés (exhaustif)

Aucun pour l'instant (H4.4).

## Entités

`AssetEntity` (table `assets`) : `id` (clé), `kind` (`upload` | `generated`), `media` (`image` | `audio` | `video`,
défaut `image`), `conversationId` / `messageId` (nullables, `ON DELETE SET NULL` : supprimer une conversation ne supprime
pas l'asset), `filename`, `thumb`, `originalName`, `width`, `height`, `seed` (entier 31 bits), `duration` (secondes),
`position` (ordre dans la sortie d'un message), `favorite`, `meta` (JSON libre : `fps`, `frames`, voix, prompt…),
`createdAt` (secondes depuis l'époque, flottant : unité de l'ancienne base). Index : `(kind, created_at)`,
`(media, kind, created_at)`, `(message_id)`.

Forme publique (`AssetDto`, champs en snake_case comme l'ancienne API, jamais omis : `null` si absent) :
`id, kind, media, duration, fps (meta.fps, vidéo seulement), url, thumb_url, width, height, seed, original_name,
favorite, meta, conversation_id, message_id, created_at`.

## Points d'extension

- H4.4 : contrôleur (envois, `PATCH` favori, `DELETE`, galerie), suppression des fichiers et des vignettes, purge des
  assets orphelins (l'équivalent de `purge_assets` du moteur : un asset encore référencé par un message n'est pas supprimé).
- `AssetService.remove` renvoie l'entité supprimée pour que l'appelant retire les fichiers.
