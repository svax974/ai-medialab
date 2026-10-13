# Module `media-library`

## Rôle

Persistance des **assets** : fichiers connus de l'application, qu'ils soient envoyés par l'utilisateur (`upload` : image
de référence, échantillon de voix, clip source) ou produits par un moteur (`generated` : image, prise audio, vidéo).
La table ne contient que des métadonnées ; les fichiers restent dans le dossier de données
(`uploads/`, `outputs/`, `thumbs/`), les chemins sont des **noms de fichiers relatifs** conservés tels quels depuis
l'ancienne base. Couche basse : `studio-core` en dépend, jamais l'inverse.

État (tâche H4.3a) : entités, DTO, mappeur et service (H2), plus les routes `/api/assets*` (envois, galerie, favori,
suppression avec fichiers) et l'éditeur d'événements `studio.*`. **Écart au plan** : ces routes étaient prévues en H4.4 ; elles
passent à Nest dès H4.3a par **cohérence** : les assets générés sont maintenant enregistrés dans la base de Nest, et une
génération qui référence une image envoyée par l'ancien chemin (`/api/assets` du moteur, base du moteur) ne la trouverait pas.
Le front (galerie d'images, visionneuse, dépôt global) est dans `front/src/modules/media-library/README.md` (H4.4) ; la galerie lit `GET /api/assets` page par page (curseur `next_before`).

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `MediaLibraryModule.ts` | Déclare `AssetEntity` (`forFeature`), fournit et exporte `AssetService` et `TypeOrmModule`. |
| Entité | `entities/AssetEntity.ts` | Table `assets`. |
| DTO | `dto/AssetDto.ts` | Forme publique d'un asset (identique à `asset_public` de l'ancien moteur, `engine/app/repo.py` supprimé en H6). |
| DTO | `dto/AssetListItemDto.ts` | Élément de galerie (`AssetDto` + titre de la conversation, prompt, modèle) et page (`items`, `next_before`). |
| Mappeur | `mappers/assetMapper.ts` | `toAssetDto`, `toAssetListItemDto`, `mediaUrl` (`/media/<dossier>/<fichier>`). |
| Service | `services/AssetService.ts` | `get`, `getEntity`, `create`, `setFavorite`, `remove` (ligne seulement), `purge` (`purge_assets` : ligne seulement), `adoptOrphans`, `list` (filtres et curseur de l'ancienne API). |
| Service | `services/AssetFileService.ts` | `ingest` (envoi : le moteur décode et fait la vignette, Nest enregistre la ligne), `purge` / `removeFiles` (fichiers et vignettes retirés par le moteur). |
| Service | `services/StudioEvents.ts` | Publie les événements `studio.<nom>` (mêmes noms et formes que l'ancien SSE) ; utilisé aussi par `studio-core` et `audio-studio` (`voices.changed`). |
| Module | `StudioEventLimitsModule.ts` | Module **global** qui fournit `EVENT_STREAM_OPTIONS` au flux partagé : `maxEventBytes` = 256 Ko au lieu de 16 Ko (voir « Taille des événements »). |
| Utilitaires | `utils/uploadStorage.ts` | `uploadStorage` (multer sur disque, `uploads/tmp_<aléa>`) et `decodeUploadName`, partagés avec `audio-studio`. |
| Contrôleur | `controllers/AssetController.ts` | `/api/assets*`. |
| Utilitaires | `utils/dataDir.ts` | Dossier de données partagé avec le moteur (`APP_DATA_DIR`, sinon `IMAGEGEN_DATA_DIR`), `uploadsDir`, `outputsDir`, `assetFilePath`. |
| Types | `types/assetTypes.ts` | `CreateAssetInput`, `ListAssetsQuery`. |
| Utilitaires | `utils/ids.ts` | `newId()` (id triable : 11 chiffres hexa de l'horodatage en ms + 10 aléatoires, format de l'ancien `new_id`), `nowSeconds()` (secondes, flottant). |

Les tests : `services/AssetService.spec.ts` (service, mappeur, galerie), `services/AssetFileService.spec.ts` (envoi, purge,
dossiers, éditeur d'événements) ; la parité avec le moteur est vérifiée par `legacy-import/publicShapes.spec.ts` et, pour les routes,
`studio-core/controllers/studioRoutes.spec.ts`.

## Dépendances

- `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`).
- `engine` (global : `EngineClient`, `engineErrorToHttp`), `common` (`EventStreamService`), `multer` (déjà fourni par
  `@nestjs/platform-express`, écriture sur disque).
- Aucune dépendance vers `studio-core` : `conversationId` et `messageId` visent ses entités **par leur nom**
  (`@ManyToOne('ConversationEntity')`), la jointure de la galerie utilise les noms de tables.

## Endpoints exposés (exhaustif)

Administrateur (`local-trust` inclus), JSON en clair, mêmes URLs et formes que l'ancienne API du moteur.

| Méthode | Endpoint | Réponse | Erreurs |
|---|---|---|---|
| `POST` | `/api/assets` (multipart, champ `files`, 50 fichiers et 500 Mo chacun au plus) | liste d'assets `upload` | 422 (aucun fichier, image ou vidéo illisible : « Image illisible : nom »), 413 |
| `GET` | `/api/assets?kind=&media=&favorites=&q=&before=&limit=` | `{ items, next_before }` (galerie, plus récents d'abord) | |
| `PATCH` | `/api/assets/:id` `{ favorite }` | asset ; publie `asset.updated` | 404 « Image introuvable. », 422 |
| `DELETE` | `/api/assets/:id` | `{ ok: true }` ; ligne, fichier et vignette supprimés ; publie `asset.deleted` `{ id, message_id, conversation_id }` | 404 |

**Envoi** : multer écrit le fichier brut dans `<données>/uploads/tmp_<aléa>` (pas de copie en mémoire : une vidéo peut peser 500 Mo),
puis le moteur le transforme (`POST /engine/v1/media/ingest` : image réencodée en PNG, orientation EXIF appliquée, transparence
aplatie, 4096 px au plus ; vidéo conservée, dimensions, durée et fps lus ; vignette WebP) et supprime le brut ; Nest enregistre la
ligne avec l'id et les noms de fichiers rendus. Le nom d'origine est relu en UTF-8 (multer le lit en latin1).

## Taille des événements

`EventStreamService` abandonne (en le journalisant) tout événement de plus de 16 Ko. Un `message.updated` audio final
(jusqu'à 4 prises, chacune avec 240 pics de forme d'onde, un marqueur par tour de parole et le texte) mesure **~8 Ko** pour
un texte court, **~33 Ko** pour un dialogue de 40 répliques et **~105 Ko** pour 8000 caractères (mesuré par
`studio-core/services/AudioGeneration.spec.ts`) : sans réglage, l'interface ne verrait jamais la fin d'une génération
audio longue. **Solution retenue : relever la limite pour cette application** (`StudioEventLimitsModule`, 256 Ko, soit plus de
deux fois le pire cas ; le tampon de reprise garde ses 500 événements). Raisons : la limite protège un serveur multi-utilisateur
d'un contenu venu de l'extérieur, or ici tous les événements sont produits par notre propre serveur pour une seule personne ;
l'alternative (événements d'invalidation, relecture REST) changerait la forme de tous les événements `studio.*` déjà
consommés par le front, obligerait à relire chaque message à chaque changement d'état et laisserait une fenêtre où l'interface
est en retard. Le module doit être **global** parce que `EventStreamService` est déclaré dans `CommonModule`, qui ne voit
que ses propres imports et les modules globaux (`StudioEventLimitsModule.spec.ts` le vérifie, avec le cas témoin sans le module).

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

- H4.4 (fait) : le front des galeries ; H4.5 et H4.6 réutilisent la même route avec `media=audio` / `media=video`. `StudioEvents` publie aussi `studio.queue.updated` (file des générations, voir `studio-core`).
- `AssetService.remove` renvoie l'entité supprimée pour que l'appelant retire les fichiers ; `AssetService.purge` est
  l'équivalent de `purge_assets` du moteur (un asset encore référencé par un message restant perd seulement son lien au message).
