# Module `private` (génération privée)

## Rôle

Une **session de génération privée** : l'application ne stocke **aucun** prompt, résultat, historique, paramètre, fichier de
référence ni brouillon de ce qu'on y crée (images, audio, vidéo) ni conversation de chat. Une session vit dans la mémoire du processus Nest et dans un
dossier aléatoire `<données>/private/<id>` ; elle s'efface à la demande, à la fermeture de la page, après un délai d'inactivité
et à l'arrêt du serveur. Rien n'est écrit dans `app.db` : pas de ligne `conversations`, `messages`, `message_refs`, `assets`.
Les résultats sont affichés avec les composants du studio (mêmes formes publiques) ; l'utilisateur peut toujours les
télécharger lui-même, rien n'est conservé automatiquement.

Le **chat privé** est **sans état** : la conversation vit dans la page du navigateur (jamais `localStorage`, jamais le serveur), qui envoie tout
l'historique avec chaque requête à `POST /api/private/chat` ; Nest ne garde ni message, ni titre fabriqué d'après ce qui a été dit, ni journal. Voir « Chat privé ».

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `PrivateModule.ts` | Importe `studio-core`, `media-library`, `audio-studio`, `chat` (ses services de réponse, de modèle et d'amélioration de prompt, exportés) ; enregistré dans `AppModule`. |
| Contrôleur | `controllers/PrivateController.ts` | `/api/private/*` : session, conversations, messages, file, références. Administrateur ; toutes les réponses en `Cache-Control: no-store` (`NoStoreInterceptor`). |
| Stockage multer | `controllers/privateUpload.ts` | Envois bruts dans `<session>/tmp` (jamais `uploads/`). |
| Service | `services/PrivateSessionService.ts` | Cycle de vie : démarrage (dossier 0700, `.metadata_never_index`), fin (crochets, mémoire, dossier), délai d'inactivité, nettoyage à la sortie du processus et sur SIGINT/SIGTERM, balayage au démarrage du serveur. |
| Service | `services/PrivateStore.ts` | Conversations, messages et assets **en mémoire**, et leurs formes publiques. |
| Service | `services/PrivateGenerationService.ts` | Création, relance, annulation, suppression ; soumission au moteur avec `private_dir` ; file partagée avec les générations normales. |
| Service | `services/PrivateUploadService.ts` | Références : le moteur les décode dans `<session>/inputs`, la ligne reste en mémoire. |
| Contrôleur | `controllers/PrivateChatController.ts` | `/api/private/chat/*` : réponse en flux, amélioration de prompt, pièces jointes du chat. Mêmes interdits que le reste (`no-store`, administrateur). |
| Service | `services/PrivateChatService.ts` | Une réponse sans état : valide, prend la jauge du moteur (`private-chat`), fait tourner les mêmes tours que le chat normal (`ChatReplyService.streamRounds`, outils compris) avec un état qui n'écrit nulle part, décharge le modèle à la fin de la session. |
| Service | `services/PrivateChatAttachmentService.ts` | Pièces jointes du chat dans `<session>/inputs/chat_<16 hex>.<ext>` (type reconnu par les octets, mêmes limites que le chat normal), sans fichier de description. |
| Pures | `services/privateChatValidation.ts` | Validation du corps de `POST /api/private/chat` (listes blanches, bornes). |
| Service | `services/PrivateEvents.ts` | Évènement navigateur `private.changed` : un genre et des identifiants, jamais de contenu. |
| Pures | `services/privateFiles.ts`, `services/privateMappers.ts` | Dossiers de session, noms sûrs ; formes publiques (URL `/media/private/<session>/<dossier>/<fichier>`). |
| Test | `testing/privateHarness.ts` | La session câblée à la main à côté du studio normal (même moteur scripté, même relais), sur un dossier de données neuf. |

Aucune entité TypeORM, donc aucune migration.

## Dépendances

- `chat` : `ChatReplyService` (`streamRounds`, `ReplyState`), `ChatModelService`, `PromptEnhanceService`, `buildHistory`, `SseStream`, `chatValidation`, `sniffImage` / `decodeText` / `cleanName`.
- `studio-core` : `parseCreateMessage`, `parseRetry`, `seedsFor`, `titleFromPrompt`, `jobVoices`, mappeurs d'évènements, `GenerationQueueService` (`occupied`, `idle$`), `EngineBusyGate`, DTO.
- `media-library` : `mediaUrl`, `newId`, `StudioEvents` (`job.progress`, seulement : sans contenu), `studioDataDir`.
- `audio-studio` : `VoiceService` (la bibliothèque de voix est lue, jamais écrite).
- `engine` : `EngineClient`, `EngineEventRelay`.
- Variable d'environnement : `PRIVATE_SESSION_TTL_MINUTES` (défaut 30 ; `0` désactive le délai).

## Endpoints exposés (exhaustif)

Tous **administrateur** (le principal `local-trust` l'est), JSON en clair, réponses `no-store`. Sans session ouverte, toute route autre que celles de la session répond **409**.

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/private/session` | `{ active, created_at, last_activity, expires_at, conversations, results }` (compte comme une activité). |
| `POST` | `/api/private/session` | Ouvre la session (sans effet si elle l'est). |
| `DELETE` | `/api/private/session` | La termine : jobs annulés puis attendus, mémoire oubliée, dossier supprimé. |
| `POST` | `/api/private/session/leave` | Idem, 204 (dernier mot du navigateur, `sendBeacon`). |
| `GET` | `/api/private/conversations?q=&mode=` | Conversations de la session (mêmes résumés que `/api/conversations`). |
| `POST` | `/api/private/conversations` | `{ title?, mode? }` ; mode `image`, `audio`, `video` ou `chat` (une coquille de conversation de chat : titre générique « Conversation privée », jamais fabriqué d'après un message ; le contenu est celui du navigateur). |
| `GET`, `PATCH`, `DELETE` | `/api/private/conversations/:id` | Détail, titre et épingle, suppression (fichiers effacés). `PATCH` accepte aussi `message_count` (entier 0 à 100000, conversation de chat : le nombre affiché dans la liste ; un nombre, jamais un contenu). |
| `POST` | `/api/private/messages` | Comme `POST /api/messages` (mêmes validations) ; le moteur est consulté (`jobs/check`) avant tout. |
| `POST` | `/api/private/messages/:id/retry`, `/cancel` | Comme les routes normales. |
| `DELETE` | `/api/private/messages/:id` | Supprime le message et ses résultats (fichiers effacés). |
| `GET` | `/api/private/queue` | `{ current, queue }` de la session. |
| `POST` | `/api/private/assets` | Envoi de références (champ `files`) → `AssetDto[]` (URL privées). |
| `PATCH`, `DELETE` | `/api/private/assets/:id` | Favori (en mémoire) ; suppression (fichier effacé). |

| `POST` | `/api/private/chat` | `{ reply_id, messages: [{ role: user\|assistant, content, attachments?: [{ name, original_name? }] }], settings? }` → **flux SSE** (ci-dessous). 409 sans session, 422 corps invalide (dont une pièce jointe absente de la session). |
| `POST` | `/api/private/chat/enhance-prompt` | Comme `POST /api/chat/enhance-prompt` (rien n'est gardé). |
| `POST` | `/api/private/chat/attachments` | Multipart, champ `file` (images ≤ 10 Mo, texte ≤ 1 Mo) → `ChatAttachment` (`url` : aperçu sous `/media/private/<session>/inputs/…`). |
| `DELETE` | `/api/private/chat/attachments/:name` | Retire une pièce jointe ôtée avant l'envoi (le reste s'efface avec la session). |

Les fichiers sont servis par le moteur sous `/media/private/<session>/…` (relais `/api/media/…`), `no-store`, sans `ETag`.

## Chat privé

`POST /api/private/chat` : le navigateur envoie **tout** l'historique (la branche jusqu'à la dernière question, textes finaux) et les réglages ; Nest n'en garde rien.
Flux SSE (`Cache-Control: no-store, no-transform`), les évènements du chat normal sans `message` ni `title` :

| Évènement | Données |
|---|---|
| `accepted` | `{ id }` : la réponse démarre (le navigateur ajoute alors ses messages à sa conversation). Avant lui, un refus (`busy`, `no_model`, `no_engine`, `upstream`) est un `error` **sans** `id` : rien à défaire. |
| `loading`, `reasoning`, `delta`, `tool`, `usage` | comme le chat normal (`id` = le `reply_id` de la requête). |
| `done` | `{ id, stats, tool_runs }` (le texte, le navigateur l'a déjà reçu). |
| `error` | `{ code, message, id? }` : `id` seulement si la réponse avait démarré. Texte général pour une erreur inattendue ; rien n'est journalisé. |

Annuler = fermer la connexion (rien n'est émis). Les outils de création (image, vidéo, son) sont **éteints** dans une session privée (`parsePrivateChatBody` impose `tools.creation = false`) : une génération privée passe par `PrivateGenerationService` et sa mémoire, que le chat sans état ne tient pas. Les outils web sont **éteints** sauf `settings.tools.web` (le navigateur le demande après une confirmation) et un modèle qui appelle des fonctions ;
la garde SSRF et `throttledFetch` du chat s'appliquent. Les pièces jointes vivent dans le dossier de session. À la fin de la session le modèle de chat est **déchargé** (le cache de prompt de
`llama-server` vit dans sa mémoire) s'il a servi. La jauge du moteur est prise sous le propriétaire `private-chat` (distinct de `private`, celui des générations).

**Ce que le moteur ne garde pas** (vérifié dans `engine/app/llm.py` et dans `tools/server` de llama.cpp au tag épinglé `b11317`) : la ligne de commande de `llama-server` ne contient que le modèle, le port et des réglages (le prompt
passe par le corps HTTP) ; la clé d'API passe par l'environnement ; les corps de requête et de réponse ne sont journalisés qu'au niveau *debug* (`server-http.cpp`), et le moteur passe `--log-verbosity 2` pour qu'une variable d'environnement
(`LLAMA_ARG_LOG_VERBOSITY`, `-v`) ne puisse pas les faire entrer dans les lignes de journal gardées pour les messages d'erreur ; `--log-prompts-dir`, `--log-file`, `--slot-save-path` ne sont pas utilisés (`--no-slots`) ;
la ligne `[memory] llm …` n'est pas écrite quand une réponse privée a eu lieu. Reste en mémoire de `llama-server` : le cache de prompt (réglage `--cache-ram`, 8 Go par défaut), vidé au déchargement.

## File partagée et mémoire

Une génération privée **attend** que la file normale soit vide (`GenerationQueueService.idle$`) puis prend `EngineBusyGate` (propriétaire `private`) pour la durée de son job : la file normale et le chat ne soumettent rien pendant ce temps, et la génération privée ne démarre pas pendant une génération normale ou une réponse de chat. Un seul modèle en mémoire à la fois, comme partout.

## Ce qui persiste ou fuit, et ce que le mode privé en fait (audit)

| Où | Normal | En mode privé |
|---|---|---|
| `app.db` (+ `-wal`, `-shm`) | conversations, messages, références, assets | **rien** (magasin mémoire ; testé : comptes de lignes inchangés) |
| `uploads/`, `outputs/`, `thumbs/`, `previews/` | références, sorties, vignettes, aperçus | **inchangés** : tout va dans `private/<session>/{inputs,outputs,thumbs,previews}` (testé : dossiers vides après un flux complet) |
| Envoi brut multer | `uploads/tmp_*` | `private/<session>/tmp`, consommé par le moteur |
| Fichiers temporaires des workers (`sdcpp-*`, images, vidéos, WAV) | dossier temporaire de l'OS | `private/<session>/tmp` (le worker reçoit `tmp_dir`) |
| Historique des jobs du moteur (100 derniers, en mémoire) | oui, avec chemins et prompt des sorties | **aucune entrée** |
| Description d'un fichier produit (`meta`) | contient le prompt | **sans prompt** |
| Erreurs d'un modèle (`job.failed`) | texte brut (cite le prompt, les fichiers) | seul le premier message de mémoire du moteur est gardé, sinon un texte générique |
| Journal du moteur (`engine.log`) | trace d'échec, ligne `[memory] job <id>` | **aucune ligne** (le job n'apparaît pas) |
| Journal de Nest (`back-*.log`, `server.log`) | erreurs de la file | aucune ligne du module privé (même pas le début ou la fin d'une session) ; erreurs du moteur jamais recopiées |
| Évènements navigateur (tampon de rejeu en mémoire) | messages complets | `private.changed` avec ids seulement ; progression sans contenu |
| `video-memory.json` | mesures par modèle (volume, mémoire), pas de prompt | **non écrit** ni lu pour l'écriture (`SdcppVideoEngine._generate_chained` : les mesures d'un clip privé ne vivent que le temps du clip) ; ni ligne `[video-memory]` ; les mesures existantes restent lues |
| Ligne de commande de `sd-cli` | contient `-p <prompt>` (visible des autres processus pendant le job) | le prompt et le prompt négatif passent par des **fichiers** (`--prompt-file`, `--negative-prompt-file`, 0600, dans le dossier temporaire de la session, effacés avec lui) quand le build les connaît (720 ou plus récent, vérifié dans les sources) ; sinon `-p` comme avant |
| Ligne de commande de `audio.cpp` | contient `--text`, `--instruct`, `--reference-text` | **inchangée** : la CLI de la version épinglée (v0.9.1) n'a pas d'option « fichier » pour une requête seule (seulement des modes par lots, `--batch-text-file`, dont la sortie diffère) ; reste un risque listé ci-dessous |
| `llama-server` (chat) | corps HTTP, jamais la ligne de commande ; journaux sans contenu au niveau par défaut | niveau de journal fixé à 2 ; modèle déchargé à la fin de la session ; voir « Chat privé » |
| Chat privé : conversation | tables `chat_messages`, `chat_conversation_settings` | **rien** : la conversation est celle du navigateur ; seule la coquille (titre générique, nombre) est en mémoire de Nest |
| Compteurs d'usage des modèles | calculés depuis `messages` | **non incrémentés** (rien en base) |
| Navigateur : brouillons et réglages mémorisés (`cn-composer`, `cn-video-composer`, `cn-audio-composer`, chat) | `localStorage` | ni lus ni écrits (testé avec des stores réels) |
| Navigateur : cache des requêtes, progression, visionneuse | mémoire | vidés à l'entrée et à la sortie |
| Navigateur : cache HTTP des médias | cache du navigateur | `Cache-Control: no-store`, pas d'`ETag` |
| Adresse de la page | `/c/<id>` | idem : l'id n'a plus de sens après la session |

## Garanties réelles et limites

**Garanti** (par des tests) : aucune ligne en base, aucun fichier hors du dossier de session, aucun prompt dans les évènements ni les journaux capturés, brouillons non écrits, compteurs non touchés, file partagée.

**Non garanti** : un fichier supprimé n'est pas effacé de façon irrécupérable (APFS, SSD) ; la mémoire et le fichier d'échange du système ne sont pas nettoyés ; les sauvegardes (Time Machine) peuvent copier le dossier de session pendant qu'il existe (exclusion demandée à `tmutil` au démarrage, au mieux) ; la ligne de commande de `audio.cpp` contient le texte à lire tant qu'il tourne (et celle de `sd-cli` sur un moteur plus ancien que le build 720), visible des autres processus de l'utilisateur ; le cache de prompt de `llama-server` reste en mémoire jusqu'au déchargement du modèle ; les requêtes de la recherche web du chat, si on l'active, sortent de la machine ; captures d'écran, presse-papiers, et ce que l'utilisateur enregistre lui-même.

## Décisions de conception

- **Dossier de session sous le dossier de données** (`<données>/private/<id>`, 0700, jamais indexé par Spotlight, exclusion Time Machine demandée au démarrage) plutôt que le dossier temporaire de l'OS : le moteur refuse tout chemin hors du dossier de données (règle conservée, aucune exception à écrire ni à tester) et un seul endroit est à balayer.
- **Disque en mémoire (non retenu par défaut)** : `hdiutil attach -nomount ram://…` (macOS) ou `/dev/shm` (Linux) éviteraient que les fichiers touchent le SSD, mais ils comptent dans la mémoire unifiée que les modèles se disputent (règle critique du projet : un débordement fige la machine). À réétudier seulement avec une taille bornée et un refus si la mémoire libre ne suit pas.
- **Délai d'inactivité de 30 minutes** (`PRIVATE_SESSION_TTL_MINUTES`) : toute requête de l'interface le repousse (le serveur n'a pas d'autre moyen de savoir que la page est ouverte) ; la page est avertie par l'évènement `session` et revient au mode normal.
- **Une session à la fois**, liée au serveur et non à un onglet : une page qui s'ouvre efface celle d'une page précédente (« fermer la page efface »), au prix de ne pas pouvoir recharger la page sans tout perdre. À la fermeture, `sendBeacon` ; au démarrage du serveur, balayage de `private/` (une session ne survit jamais à un redémarrage).
- **Fin de session pendant un job** : le job est annulé, le service attend (8 s au plus) que le moteur ait lâché ses fichiers, puis supprime le dossier ; ce qui aurait été recréé est balayé au démarrage suivant.
- **Adresse de la page** : `/c/<id>` reste dans l'historique du navigateur (un identifiant aléatoire sans contenu, sans effet après la session).

## Tests

`services/privateFlow.spec.ts` (la preuve : flux complet, échec qui cite le prompt, file partagée, fin pendant un job, suppression), `PrivateSessionService.spec.ts`, `privateMappers.spec.ts` (mêmes champs que les formes publiques), `controllers/PrivateController.spec.ts` (routes, 409 sans session, envoi de référence, `no-store`). `services/privateChat.spec.ts` (le chat privé : flux ordonné, rien en base ni hors du dossier de session, aucune phrase témoin dans les journaux même quand le moteur la répète, annulation, occupation, pièces jointes, déchargement à la fin de session, validation), `PrivateModule.spec.ts` (câblage). Moteur : `engine/tests/test_private_jobs.py`, `test_llm.py` (`TestPrivateReplies`), `test_sdcpp.py` (`TestPromptArguments`, moteur image), `test_sdcpp_video.py` (fichiers de prompt, mesures non écrites). Front : `front/src/modules/private/lib/*.spec.ts`.
