# Module `studio-core`

## Rôle

Les **conversations** et les **messages** (prompts de l'utilisateur et générations de l'assistant), avec les liens vers leurs
assets de référence, **et la file des générations** (« quel message ensuite ») qui pilote le moteur. Les trois studios
(image, audio, vidéo) partagent ces tables ; `mode` distingue la conversation. Le mode **`chat`** réutilise la table `conversations` (liste, titre,
épingle, suppression) mais garde ses messages dans le module `chat` (`chat_messages`) : voir « Modes qui gardent leurs messages ailleurs ».

État (tâche H4.3a) : persistance (H2), routes `/api/conversations*` et `/api/messages*` (mêmes URLs et mêmes formes publiques
que l'ancienne API du moteur), file des générations, relais des événements du moteur vers les messages, les assets et le
navigateur, reprise au démarrage. Le moteur ne connaît pas les conversations : Nest lui soumet un job par message
(`/engine/v1/jobs`, `job_id` = id du message) et reçoit ses événements par `EngineEventRelay`.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `StudioCoreModule.ts` | Importe `MediaLibraryModule`, déclare les trois entités, fournit et exporte les services. |
| Entité | `entities/ConversationEntity.ts` | Table `conversations` (avec `mode`). |
| Entité | `entities/MessageEntity.ts` | Table `messages`. |
| Entité | `entities/MessageRefEntity.ts` | Table `message_refs` (assets de référence d'un prompt). |
| DTO | `dto/ConversationDto.ts` | Résumé public (identique à `conversation_summary` de l'ancien moteur, `engine/app/repo.py` supprimé en H6). |
| DTO | `dto/ConversationDetailDto.ts` | Résumé + `messages`. |
| DTO | `dto/MessageDto.ts` | Forme publique d'un message (identique à `message_public`). |
| Mappeurs | `mappers/conversationMapper.ts`, `mappers/messageMapper.ts` | Entités vers formes publiques. |
| Contrôleur | `controllers/ConversationController.ts` | `/api/conversations*` (liste, création, détail, titre et épingle, suppression). |
| Contrôleur | `controllers/MessageController.ts` | `/api/messages*` (création, relance, annulation, suppression, usage des modèles). |
| Contrôleur | `controllers/QueueController.ts` | `GET /api/queue` : la file des générations (état initial d'un navigateur). |
| Service | `services/ConversationService.ts` | `list`, `get`, `getSummary`, `create`, `update`, `touch`, `remove`, `beforeRemove`. |
| Service | `services/ConversationModeRegistry.ts` | Registre où un mode qui garde ses messages ailleurs (le chat) déclare ses chiffres de résumé, sa recherche de contenu et ce qui précède sa suppression. |
| Service | `services/EngineBusyGate.ts` | Jauge d'occupation du moteur partagée avec le chat : tenue pendant une réponse, la file ne soumet aucun job tant qu'elle l'est. |
| Service | `services/MessageService.ts` | `get`, `listByConversation`, `create`, `update`, `remove`, `removeMany`, `failInterrupted`, `toDtos`, requêtes de la file et de la purge (`referencesOf`, `assetsOfMessages`, `assetsOfConversation`, `busyIds`, `childIds`). |
| Service | `services/GenerationService.ts` | Création, relance, annulation et suppression des générations ; suppression d'une conversation (assets et fichiers purgés). |
| Service | `services/GenerationQueueService.ts` | **File et exécuteur** : une génération à la fois, soumission au moteur, machine d'état des messages, événements navigateur, reprise. `occupied` et `idle$` (émis quand plus rien n'est en cours ni en attente) servent au module `private`, dont les générations attendent cette file et tiennent `EngineBusyGate` pendant leur job. |
| Service | `services/JobRequestBuilder.ts` | Message vers corps de `POST /engine/v1/jobs` (chemins absolus des références, dossier de sortie). |
| Pures | `services/generationParams.ts` | `parseCreateMessage`, `parseRetry` (422), `titleFromPrompt`, `seedsFor`. |
| Pures | `mappers/jobEventMapper.ts` | Fusion de la progression, forme navigateur de `job.progress`, `job.output` vers une ligne d'asset. |
| Types | `types/studioTypes.ts`, `types/jobTypes.ts` | Entrées des services, constantes (`BUSY_STATUSES`, titre par défaut), types du contrat de jobs (générés depuis l'OpenAPI du moteur). |

Tests : voir « Tests » plus bas.

## Langue

Les textes montrés à l'utilisateur (erreurs, titres par défaut, états d'échec) passent par `tr('studioCore.…')` (`src/modules/i18n`) et suivent la langue de l'interface (en-tête `Accept-Language`). Dictionnaires : `studio-core/i18n/messages.fr.json` et `messages.en.json` (parité contrôlée par `i18n/messages.spec.ts`).
Les textes enregistrés (échec d'un message, titre par défaut d'une conversation) le sont dans la langue du moment ; `isDefaultConversationTitle` / `isDefaultChatTitle` reconnaissent le titre par défaut dans les deux langues.

## Dépendances

- `audio-studio` (`VoiceService`, pour les `voices` des jobs audio) ; `media-library` (`AssetEntity`, `AssetService`, `AssetFileService`, `StudioEvents`, `toAssetDto`, `newId`, `nowSeconds`, dossiers de données). Pas l'inverse.
- `engine` (global) : `EngineClient` (typé), `EngineEventRelay` (`events$`, `linkChanges$`), `engineErrorToHttp`.
- `typeorm`, `@nestjs/typeorm`, `common` (`jsonColumnType()`, `EventStreamService` via `StudioEvents`).
- Variable d'environnement : `APP_DATA_DIR` (ou `IMAGEGEN_DATA_DIR`), le dossier de données que le moteur lit aussi
  (`uploads/`, `outputs/`, `thumbs/`) ; sans lui, aucune génération ne peut être soumise (erreur explicite).

## Endpoints exposés (exhaustif)

Tous **administrateur** (le principal `local-trust` l'est), JSON en clair (`NoTransportCrypt`), même URL et même forme publique
que l'ancienne API du moteur (comparées, dans `controllers/studioRoutes.spec.ts`, aux sorties de `repo.py` capturées une fois, figées dans `legacy-import/testing/expectedPublic.json`). Les
erreurs ont la forme de Nest (`{ statusCode, message }`) avec les mêmes statuts et les mêmes textes qu'avant.

| Méthode | Endpoint | Réponse | Erreurs |
|---|---|---|---|
| `GET` | `/api/conversations?q=&mode=` | liste de résumés (épinglées d'abord, puis `updated_at` décroissant) ; `mode` : `image`, `audio`, `video`, `chat` (autre valeur : pas de filtre) ; `q` cherche aussi dans le texte des messages de chat | |
| `POST` | `/api/conversations` `{ title?, mode? }` | détail (`messages: []`) ; `mode` `audio`, `video` ou `chat` (sinon `image`) ; titre par défaut `Nouvelle création`, `Nouvelle conversation` pour le chat ; publie `conversation.updated` | 422 types |
| `GET` | `/api/conversations/:id` | détail avec `messages` | 404 |
| `PATCH` | `/api/conversations/:id` `{ title?, pinned? }` | résumé ; publie `conversation.updated` | 404, 422 |
| `DELETE` | `/api/conversations/:id` | `{ ok: true }` ; arrête les générations, supprime messages, assets et fichiers ; publie `conversation.deleted` | (idempotent) |
| `POST` | `/api/messages` `{ conversation_id?, prompt, model_id, params?, reference_ids?, count? }` | `{ conversation_id, user_message, assistant_message }` (le message de l'assistant est `queued`) | 404 conversation, 422 (prompt vide ou > 8000, modèle inconnu, référence introuvable, refus du moteur : « a besoin d'une image de référence »…) |
| `GET` | `/api/messages/model-usage` | `{ counts: { "<model id>": n } }` : générations terminées (`done`) par modèle, pour classer les sélecteurs de modèles | – |
| `POST` | `/api/messages/:id/retry` `{ model_id?, params?, keep_seed? }` | le nouveau message `queued` ; publie `message.updated` | 404, 422 |
| `POST` | `/api/messages/:id/cancel` | `{ ok: true }` | 409 « Cette génération n'est plus en cours. » |
| `DELETE` | `/api/messages/:id` | `{ ok: true, deleted: [ids] }` (un prompt emporte ses générations) ; publie `message.deleted` et `conversation.updated` | 404 |
| `GET` | `/api/queue` | `{ current, queue }` : le message en cours et les messages en attente dans l'ordre d'exécution (H4.4) | |

Création : le moteur dit si le modèle sait faire (`POST /engine/v1/jobs/check` : modèle connu, références exigées, tâche
vocale, image de départ ou vidéo source), renvoie `max_count` et les paramètres par défaut du modèle ; Nest fusionne
`{ ...défauts, ...params, count }` et tire les graines (`seed` fixe : `seed + i`, sinon aléatoires, 31 bits). **Tout est vérifié
avant la première écriture** (pas de transaction : les validations précèdent les insertions).

## File des générations et machine d'état

Une génération à la fois côté moteur ; les autres attendent **dans Nest** (`GenerationQueueService`, FIFO global) et le suivant
est soumis quand le précédent a fini (`job.done`, `job.failed` ou `job.cancelled`). Les événements du moteur sont traités un par un,
dans l'ordre (chaîne de promesses) ; ceux d'un job qui n'est pas le courant (ancienne interface, événement tardif) sont ignorés.

```
            soumission                job.started              1er job.progress phase=running
 queued ─────────────────▶ queued ──────────────▶ loading ───────────────────────────▶ running
   │  (en file ou soumis)      │                      │                                     │
   │ annulation en file        │ refus du moteur      │ job.cancelled                       │ job.done      ▶ done
   ▼                           ▼ (422, 409, injoignable) ▼                                  │ job.failed    ▶ error
 cancelled                    error                 cancelled / error                      │ job.cancelled ▶ cancelled
```

| Événement du moteur | Effet sur le message | Événements navigateur |
|---|---|---|
| `job.started` (`params` résolus : dimensions, graines, étapes) | `loading`, `started_at`, `params` remplacés | `message.updated` |
| `job.progress` (`phase`, `count`, `index`, `step`, `total`, `eta`, `seconds_per_step`, `stage`, `preview_url`, `load_started_at`) | première fois avec `phase = running` : `running` | `message.updated` (une fois), `job.progress` |
| `job.preview` (`url`) | | `job.progress` (avec `preview_url`) |
| `job.output` (fichier produit) | ligne d'asset `generated` (id choisi par le moteur, `position` = index) ; ignoré s'il existe déjà ; fichier supprimé si le message a disparu | `job.image` |
| `job.done` / `job.failed` / `job.cancelled` | `done` / `error` (+ `error`) / `cancelled`, `finished_at` ; le suivant est soumis | `message.updated` |

Annulation : un message en file est annulé tout de suite (le moteur n'en sait rien) ; le message courant est annulé auprès du
moteur (`POST /engine/v1/jobs/{id}/cancel`) et se règle sur `job.cancelled` (en cours de chargement du modèle, le moteur arrête
le worker ; `sd-cli` est arrêté par son moteur). Une annulation demandée pendant la remise du job au moteur est appliquée juste
après. Supprimer un message en cours l'annule d'abord ; l'événement de fin d'un message supprimé libère la file sans bruit.

**Reprise au démarrage** (`onApplicationBootstrap`) : tout message encore `queued`, `loading` ou `running` passe en `error`
« Interrompu par l'arrêt du serveur » (`failInterrupted`, comme l'ancien balayage de `init_db` : une génération n'est jamais
reprise). **À la (re)connexion du flux du moteur** (`linkChanges$`) : Nest relit `GET /engine/v1/jobs` ; il annule les jobs
actifs d'une exécution précédente dont le message existe dans sa base (les jobs inconnus de Nest, ceux de l'ancienne interface,
ne sont pas touchés) ; si le job courant n'est plus connu du moteur (redémarré), le message passe en `error` « Le moteur
s'est arrêté pendant la génération. » ; s'il a fini pendant la coupure, ses fichiers sont enregistrés et le message réglé
d'après `GET /engine/v1/jobs/{id}` (le moteur garde les 100 derniers jobs terminés) ; puis la file repart.
Moteur injoignable à la soumission : le message passe en `error` « Le moteur est injoignable. » et la file continue.

## Événements navigateur

Publiés par `StudioEvents` (module `media-library`) sur `EventStreamService`, audience administrateur, sujet **`studio.<nom>`**,
`type` = nom. **Mêmes noms et mêmes charges utiles que l'ancien SSE du moteur** (`GET /api/v1/events/stream?topics=studio.message.updated,studio.job.progress,…`) :

| Sujet | Charge utile |
|---|---|
| `studio.job.progress` | `{ message_id, conversation_id, phase, count?, index?, step?, total?, eta?, seconds_per_step?, stage?, preview_url?, load_started_at? }` |
| `studio.job.image` | `{ message_id, conversation_id, asset }` (`asset` : forme publique) |
| `studio.message.updated` | message public complet (`references`, `outputs` inclus) |
| `studio.message.deleted` | `{ conversation_id, ids }` |
| `studio.conversation.updated` | résumé public (`cover`, `generation_count`, `busy`) |
| `studio.conversation.deleted` | `{ id }` |
| `studio.asset.updated` / `studio.asset.deleted` | asset public / `{ id, message_id, conversation_id }` (publiés par `media-library`) |
| `studio.queue.updated` | `{ current, queue }` : `current` = message en cours de génération (ou `null`), `queue` = ids des messages en attente, **dans l'ordre d'exécution, tous modes et toutes conversations** (le message en cours n'y figure pas). Publié à chaque changement (ajout, annulation, passage au suivant, fin), jamais deux fois de suite la même file. **Nouveau en H4.4** : l'ancien SSE n'avait pas cet événement, l'ancienne interface lisait `queue` dans le statut du moteur (`GET /api/status`, liste `pending`) ; le client en déduit « position N » (rang dans `queue`, la première en attente n'affiche pas de position) et « N en attente » (taille de `queue`) |

Limite du flux : le défaut de 16 Ko est relevé à 256 Ko pour cette application (`StudioEventLimitsModule` de `media-library`,
mesures dans son README) : un `message.updated` de plusieurs prises audio avec formes d'onde dépasse 16 Ko (33 Ko pour un
dialogue de 40 répliques, 105 Ko au pire). La file est un événement à part (et non un champ de `message.updated`) parce qu'un changement de file touche tous les messages en attente à la fois, pas seulement celui qui change d'état. Les événements du moteur (`engine.job.*`, `engine.engine.status`…)
restent relayés tels quels par le module `engine` : les composants migrés consomment `studio.*`.

## Entités

- `ConversationEntity` (`conversations`) : `id`, `title`, `pinned`, `mode` (`image` | `audio` | `video` | `chat`, défaut
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
- Liste : épinglées d'abord, puis `updated_at` décroissant ; filtres `mode` et `q` (titre, prompt d'un message ou, pour le chat, texte d'un message).

## Modes qui gardent leurs messages ailleurs

Le chat (module `chat`) dépend de `studio-core`, jamais l'inverse. Il se branche par deux points d'extension, sans que ce module n'importe rien de lui :

**Générations lancées depuis le chat** (outils de création) : `GenerationService.create({ conversationId })` accepte la conversation d'un **autre mode**, celle du chat : le prompt et sa génération y sont des lignes `messages` comme ailleurs (la file, les événements `studio.*`, les assets et leur purge sont ceux du studio), la conversation garde son titre et son mode. Le chat n'a donc rien à ajouter ici ; il lit l'état par `MessageService.get` et supprime par `GenerationService.remove` (`back/src/modules/chat/README.md`, « Outils de création »).

- **`ConversationModeRegistry`** : au démarrage, `ChatBootstrap` y inscrit `{ mode: 'chat', stats, matching, beforeRemove }`. `ConversationService` lui demande
  `generation_count` (messages de la branche active) et `busy` d'une conversation de ce mode (`cover` reste `null`), les identifiants des conversations
  dont un message contient `q` (recherche de la liste, plafonnée à 500), et `GenerationService.removeConversation` appelle `beforeRemove` avant de
  supprimer la ligne (le chat arrête sa réponse en cours et supprime les fichiers joints ; les lignes partent par cascade). Sans inscription, rien ne change.
- **`EngineBusyGate`** : le moteur ne tient qu'un modèle à la fois. Pendant une réponse de chat le chat tient la jauge (`tryAcquire('chat')`) ;
  `GenerationQueueService` ne soumet alors aucun job (les messages restent `queued`) et reprend à `released$`. Un détenteur peut **offrir** la jauge (`setYield`) : le chat le fait pendant qu'il écrit un titre automatique ; la file, un nouvel envoi du chat et `enhance-prompt` appellent alors `preempt()`, qui annule le titre et attend la libération (jamais de `busy` à cause d'un titre). Dans l'autre sens le chat refuse (`busy`)
  tant que `GenerationQueueService.occupied` est vrai (un job court ou attend). Le moteur répond 409 de toute façon à celui qui arrive second : c'est la
  ceinture, la jauge la bretelle. Les deux dépendances sont `@Optional()` du constructeur (un montage sans chat fonctionne comme avant).

## Points d'extension

- `ConversationService.remove` et `MessageService.remove` ne suppriment que les lignes et leurs cascades ; la purge des assets
  et des fichiers est faite par `GenerationService` (`AssetFileService.purge`).
- Audio (H4.5, fait) : `JobRequestBuilder` joint aux jobs `audio` la clé `voices` : pour chaque voix de la bibliothèque utilisée
  (`params.voice` et `params.cast` de la distribution d'un dialogue, `{ source: 'library', id }`), `{ id: { path, transcript, name } }`
  (`services/jobVoices.ts`, lecture par `VoiceService.findByIds` du module `audio-studio`). Un `voices` vide (aucune voix de la
  bibliothèque) dit au moteur de **ne pas** consulter sa propre base ; une voix supprimée est absente et le moteur répond « Cette
  voix n'existe plus dans votre bibliothèque. ».
- Vidéo (H4.6, fait, **aucun code ajouté côté Nest** : le contrat de jobs couvre déjà tous les cas ; vérifié et testé par `services/VideoGeneration.spec.ts`) : les références du prompt
  sont jointes au job dans l'ordre du composeur (image de départ, image de fin, vidéo source : `message_refs.position`) ; le moteur choisit la tâche (`i2v`, `v2v`, `t2v`) d'après ce qui est joint et ce que le modèle accepte,
  ignore ce qu'il ne sait pas utiliser et refuse ce qu'il exige (`engine/app/job_checks.py`, `job_plans.py` : « a besoin d'une image de départ / d'une vidéo source », renvoyé en 422 à la création) ;
  `count` est borné à 2 par `max_count` ; les réglages résolus (taille, nombre d'images, durée réelle, définition, tâche) remplacent les paramètres du message au `job.started` ; les étapes du moteur
  (`stage` : `fetch`, `sampling`, `decode`, `encode`) passent par `studio.job.progress` ; chaque clip est enregistré avec son **affiche** (`thumb`), sa durée, ses dimensions, la graine et `meta` (`fps`, `frames`, `has_audio`, `task`,
  `strength`…) ; la relance relit le type de chaque référence pour interroger le moteur. Les images extraites d'une vidéo (« dernière image comme départ ») sont prises dans le navigateur puis envoyées comme n'importe quelle image (`POST /api/assets`) :
  le moteur n'a pas de route d'extraction. Lecture : les fichiers passent par `/api/media` avec `Range` (test `engine/services/EngineMedia.spec.ts`).
- Plusieurs moteurs en parallèle : non prévu (un seul GPU) ; la file est globale.

## Tests

Un fichier à la fois, depuis `back/`, sous `docs/migration/tools/guarded_run.sh 3` (2 pour le bout en bout) :

```sh
npx jest --runInBand src/modules/studio-core/services/GenerationQueueService.spec.ts   # file, machine d'état, reprise, rapprochement, événement de file et GET /api/queue
npx jest --runInBand src/modules/studio-core/services/GenerationService.spec.ts        # création, relance, annulation, suppressions
npx jest --runInBand src/modules/studio-core/services/generationParams.spec.ts         # validation, titre, graines
npx jest --runInBand src/modules/studio-core/services/AudioGeneration.spec.ts           # voix des jobs audio, mesure de la taille des événements audio
npx jest --runInBand src/modules/studio-core/services/VideoGeneration.spec.ts           # jobs vidéo : entrées dans l'ordre, clips bornés à 2, étapes, affiche, durée et fps de l'asset, relance
npx jest --runInBand src/modules/studio-core/mappers/jobEventMapper.spec.ts            # correspondance des événements
npx jest --runInBand src/modules/studio-core/services/EngineBusyGate.spec.ts            # jauge d'occupation et file qui attend la fin d'une réponse de chat
npx jest --runInBand src/modules/studio-core/controllers/studioRoutes.spec.ts          # formes publiques identiques à l'ancienne API
npx jest --runInBand src/modules/studio-core/e2e/studioEngine.e2e.spec.ts              # bout en bout avec le vrai moteur (démo)
```

- `src/testing/studioHarness.ts` : services câblés à la main sur une base SQLite en mémoire, avec un moteur scripté
  (`ScriptedEngine`), un relais factice (`relay.events$`) et la capture des événements publiés (`published`, et `queueEvents` à part pour `studio.queue.updated`, afin que les listes exactes assertées ailleurs restent celles des messages et des assets).
- `studioRoutes.spec.ts` charge la base de démonstration de `legacy-import` et compare les réponses HTTP aux sorties de l'ancien moteur
  capturées une fois (fixture figée ; le script de capture a été supprimé avec `repo.py`).
- `studioEngine.e2e.spec.ts` lance le **moteur Python en sous-processus** (`IMAGEGEN_DEMO=1` : images synthétiques, aucun modèle,
  **sonde matérielle coupée donc sans torch**), puis exerce Nest contre lui par HTTP et le vrai flux d'événements : génération,
  files d'attente, annulation en file et en cours, relance, suppression (fichiers retirés par le moteur), envoi d'une référence.
  Ignoré si `engine/.venv` est absent. Pic mesuré : 0,75 Go (Jest, moteur et worker).
- Parité des formes publiques avec le moteur : aussi `legacy-import/publicShapes.spec.ts`.
