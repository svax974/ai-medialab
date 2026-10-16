# Module `chat`

## Rôle

Le **studio de chat** : conversations avec un modèle de langage local (llama.cpp, piloté par le moteur Python), sous forme d'un **arbre de
messages** (répondre, modifier un message ou régénérer une réponse ajoute une branche, rien n'est écrasé), réponses **en flux** (SSE),
**pièces jointes** (images pour les modèles de vision, fichiers texte), **outils web** (recherche et lecture de pages) et **outils de création** (image, vidéo, son lancés dans les studios) pour les modèles qui
appellent des fonctions, titre automatique, export, recherche, et le bouton ✨ d'amélioration de prompt des trois autres studios.

Les conversations sont celles de `studio-core` (`conversations`, `mode = 'chat'` : liste, titre, épingle, suppression et recherche de titre
passent par `/api/conversations*`) ; seuls les **messages** et les **réglages** de chaque conversation vivent ici. Le moteur Python ne garde
aucune conversation : Nest lui envoie tout l'historique à chaque réponse. Module d'application, branché dans `modules/app/AppModule.ts`.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `ChatModule.ts` | Importe `CommonModule`, `MediaLibraryModule`, `AudioStudioModule`, `StudioCoreModule`, `ModelCatalogModule`, `SettingsModule` ; déclare les deux entités, le contrôleur et les services ; exporte `ChatReplyService`, `EngineLlmClient`, `ChatModelService`, `WebToolsService` et `PromptEnhanceService` (le chat privé du module `private` les réutilise). |
| Entité | `entities/ChatMessageEntity.ts` | Table `chat_messages` : arbre (`parent_id`), `role`, `content`, `reasoning`, `tool_runs`, `generations`, `attachments`, `model_id`, `params`, `status`, `error`, `stats`, `created_at`. |
| Entité | `entities/ChatSettingsEntity.ts` | Table `chat_conversation_settings` : modèle, instruction système, échantillonnage, contexte, raisonnement, outils, `leaf_id` (feuille de la branche active). |
| Contrôleur | `controllers/ChatController.ts` | `/api/chat/*` (ci-dessous). Administrateur seulement, JSON en clair (`NoTransportCrypt`). |
| Flux | `controllers/SseStream.ts` | Réponse SSE : en-têtes envoyés avec le premier évènement, `: ping` toutes les 15 s, `signal` qui s'abat quand le client part, client qui ne lit plus (plus de 1 Mo en attente) coupé. `Cache-Control` au choix du constructeur (`no-cache, no-transform` ici, `no-store, no-transform` pour le chat privé). |
| Service | `services/ChatReplyService.ts` | **Orchestrateur d'une réponse** : crée les messages, interroge le moteur, relaie le flux, boucle d'outils (5 tours au plus), persistance par lots de 500 ms, annulation, titre. `streamRounds` (les tours du modèle et des outils, sans rien stocker) est public : le chat privé l'appelle avec un `ReplyState` qui n'écrit nulle part et `isPrivate = true`. |
| Service | `services/ChatStoreService.ts` | Persistance : arbre (frères, descendant le plus récent, suppression de sous-arbre), réglages, recherche, reprise des réponses interrompues. |
| Service | `services/ChatService.ts` | Routes qui ne diffusent pas : lecture, réglages, changement de branche, suppression, sœurs d'un message, déchargement du modèle, export, recherche. |
| Service | `services/EngineLlmClient.ts` | Client du flux `POST /engine/v1/llm/chat` (même URL et même jeton que `EngineClient`, sans délai, annulé par `AbortSignal`) ; `complete()` pour les réponses courtes. Le corps porte `private: false` (ou `true` pour une réponse du chat privé : le moteur n'écrit alors pas la ligne `[memory] llm`). |
| Service | `services/ChatModelService.ts` | Quel modèle répond (demandé, sinon celui de la conversation, sinon le défaut du moteur), téléchargé, avec son moteur installé ; sinon une `ChatError` avec un texte qui dit quoi faire. |
| Service | `services/ChatAttachmentService.ts` | Pièces jointes dans `<données>/uploads/` (`chat_<16 hex>.<ext>`), type reconnu par les octets, purge, balayage des envois jamais utilisés. |
| Service | `services/WebToolsService.ts` | `web_search` (DuckDuckGo, ou Brave si une clé est saisie dans les réglages) et `fetch_url` (page publique en texte). |
| Service | `services/CreationToolsService.ts` | Les outils de création : schémas `generate_image` / `generate_video` / `generate_audio` construits à chaque réponse d'après les modèles des studios et leurs capacités, exécution d'un appel (génération mise en file de `studio-core`), commandes `/image` `/video` `/audio`, carte de choix (`confirm`), nettoyage à la suppression d'un message. |
| Service | `services/PromptEnhanceService.ts` | `POST /api/chat/enhance-prompt` : améliore un prompt d'image, de vidéo ou un texte à lire à voix haute. |
| Service | `services/ChatBootstrap.ts` | Au démarrage : inscrit le chat au registre des modes de `studio-core`, termine les réponses restées `streaming`, balaie les envois orphelins. |
| Pures | `services/chatValidation.ts`, `chatHistory.ts`, `chatExport.ts` | Validation de tout ce qui entre (listes blanches, bornes), historique envoyé au moteur, export Markdown / JSON. |
| Pures | `mappers/chatMapper.ts` | Entités vers formes publiques (`sibling_ids`, `sibling_index`, URL d'aperçu des images). |
| Outils | `tools/ssrfGuard.ts`, `safeFetch.ts`, `htmlText.ts`, `webSearch.ts` | Garde SSRF, téléchargement borné d'une page publique, extraction de texte, lecture des résultats DuckDuckGo et Brave. |
| Tests | `testing/sse.ts` | Aides des tests (trames SSE du moteur, type `Json`). |

## Dépendances

- `studio-core` : `ConversationEntity`, `ConversationService`, `GenerationService` (`publishConversation`, `create`, `remove` : les outils de création), `MessageService` (état et fichiers d'une génération), `ConversationModeRegistry`, `EngineBusyGate`, `GenerationQueueService.occupied`. Pas l'inverse (voir le README de `studio-core`, « Modes qui gardent leurs messages ailleurs »).
- `engine` (global) : `EngineClient` (URL, jeton, `GET /engine/v1/llm/status`), `SseParser`, `EngineSchemas` (type du corps de `POST /engine/v1/llm/chat`, tiré de l'OpenAPI du moteur).
- `model-catalog` : `ModelCatalogService.catalog()` (capacités `llm` : `tools`, `vision`… ; `audio` et `video` : ce que chaque outil de création propose). `audio-studio` : `VoiceService` (voix nommées). `settings` : `SettingsService.braveApiKey()`, `chat_voice_id` (voix par défaut). `media-library` : `uploadStorage`, `uploadsDir`, `newId`, `nowSeconds`.
- `common` : `throttledFetchJson` (tout appel sortant des outils web : espacement par source, reprise sur 429/5xx, ne lève jamais), `AdminOnlyInterceptor`, `NoTransportCrypt`.
- Le moteur (`engine/app/llm.py`, `api/llm.py`) : `POST /engine/v1/llm/chat` (flux), `GET /engine/v1/llm/status`. Il refuse un chemin d'image hors du dossier de données.

## Endpoints exposés (exhaustif)

Tous **administrateur** (le principal `local-trust` l'est). Erreurs de Nest `{ statusCode, message }` : **400** identifiant, `q` ou `format` invalide ;
**404** conversation (absente ou d'un autre studio) ou message ; **409** conflit (`code` en plus : voir `enhance-prompt` et la suppression pendant une réponse) ;
**422** corps invalide (valeurs hors bornes, pièce jointe inconnue, type de fichier refusé).

| Méthode | Endpoint | Corps → Réponse |
|---|---|---|
| `GET` | `/api/chat/conversations/:id` | → `ChatConversation` : `{ conversation: ConversationSummary, settings, messages }` (`messages` = la branche active, racine → feuille) |
| `PATCH` | `/api/chat/conversations/:id/settings` | partie de `{ model_id, system_prompt, params, context_size, reasoning, tools }` → `ChatSettings`. `params` : `temperature` 0–2, `top_p` 0–1, `top_k` 0–1000, `min_p` 0–1, `repeat_penalty` 0–2, `presence_penalty` et `frequency_penalty` −2–2, `max_tokens` 1–262144, `seed` 0–4294967295, `stop` (8 textes de 64 caractères) ; `context_size` `null` ou 256–1048576 ; `reasoning` `auto` `off` `low` `medium` `high` ; `tools` `{ web?: boolean, creation?: boolean }` (fusionné avec l'existant ; `creation` est **actif par défaut**). `leaf_id` n'est pas modifiable ici |
| `POST` | `/api/chat/conversations/:id/messages` | `{ content, attachments?: [{ name }], parent_id?, model_id?, creation_models? }` → **flux SSE**. `parent_id` absent : la feuille courante ; `null` : une nouvelle racine ; sinon un message **de réponse** (un message utilisateur est refusé en 422). `content` peut être vide s'il y a une pièce jointe. `creation_models` : `{ image?, video?, audio? }`, le modèle sélectionné de chaque studio (le navigateur le tient, Nest l'ignore sinon) : voir « Outils de création ». `regenerate` et `edit` le prennent aussi |
| `POST` | `/api/chat/conversations/:id/messages/:mid/regenerate` | `{ model_id? }` (`mid` = réponse) → **flux SSE** : nouvelle réponse **sœur** de `mid`, d'un autre modèle si demandé (comparaison) ; l'ancienne reste |
| `POST` | `/api/chat/messages/:mid/generations/:gid/confirm` | `{ seconds? }` ou `{ voice_id? }` → `ChatGeneration` : lance la génération d'une carte de choix (`pending`). **422** durée hors des bornes du modèle, voix disparue ou absente, génération qui n'attend plus de choix ; **404** message |
| `POST` | `/api/chat/conversations/:id/messages/:mid/edit` | `{ content, attachments? }` (`mid` = message utilisateur) → **flux SSE** : nouveau message utilisateur **sœur** de `mid` et sa réponse. `attachments` omis : ceux de l'original restent ; `[]` : aucun |
| `POST` | `/api/chat/conversations/:id/leaf` | `{ message_id }` → `ChatConversation` : la feuille devient le descendant le plus récent de ce message (changement de branche) |
| `DELETE` | `/api/chat/conversations/:id/messages/:mid` | → `ChatConversation` : supprime le message et son sous-arbre, les fichiers joints que plus rien n'utilise ; la feuille passe à la branche sœur la plus récente, sinon au parent. **409** (`code: busy`) si une réponse de cette conversation est en cours |
| `GET` | `/api/chat/conversations/:id/messages/:mid/siblings` | → `ChatMessage[]` : les sœurs complètes de `mid` (même parent et même rôle, lui compris, plus ancienne d'abord), quelle que soit la branche active : c'est ce qu'affiche la comparaison de réponses après un rechargement de page |
| `POST` | `/api/chat/model/unload` | → `{ ok: true }` : décharge le modèle de chat de la mémoire (`POST /engine/v1/llm/unload`). **409** (`code: busy`) tant qu'une réponse ou une amélioration de prompt tient le moteur (la jauge `EngineBusyGate`), **409** aussi si le moteur le refuse, **502** s'il ne répond pas |
| `POST` | `/api/chat/attachments` | multipart, champ `file` (images png / jpeg / webp / gif ≤ 10 Mo ; texte UTF-8 ≤ 1 Mo ; type vérifié sur les octets, jamais sur le nom ou le type déclaré) → `ChatAttachment` `{ kind, name, original_name, mime, size, url? }` |
| `GET` | `/api/chat/conversations/:id/export?format=md\|json` | → fichier (`Content-Disposition: attachment`), la branche active |
| `POST` | `/api/chat/enhance-prompt` | `{ kind: 'image'\|'audio'\|'video', prompt, model_id? }` → `{ prompt, model_id }` ; **409** avec `code` `busy`, `no_model`, `no_engine` ou `upstream` |
| `GET` | `/api/chat/search?q=` | → `[{ conversation_id, message_id, snippet }]` (50 au plus, sous-chaîne sans casse) |

### Flux SSE d'une réponse

`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (la compression du back et les proxys ne le tamponnent pas),
chaque bloc `event: <type>` + `data: <json>`, `: ping` toutes les 15 s. Les en-têtes partent avec **le premier évènement** : une erreur de validation (400, 404, 409, 422)
levée avant est une réponse HTTP ordinaire.

| Évènement | Données |
|---|---|
| `message` | `{ message: ChatMessage }` : le message utilisateur créé (pas pour une régénération) puis la réponse créée (`status: 'streaming'`, `content: ''`) |
| `loading` | `{ phase: 'starting'\|'loading', model_id, elapsed_s? }` : chargement du modèle |
| `delta` / `reasoning` | `{ id, content }` : fragment du texte / de la réflexion de la réponse `id` |
| `tool` | `{ id, run: ToolRun }` : début (`running`) et fin (`done` ou `error`) d'un appel d'outil ; `run.arguments` montre la requête réellement envoyée |
| `usage` | `{ id, stats }` : `prompt_tokens`, `completion_tokens` (cumulés sur les tours d'outils), `tokens_per_second`, `context_size`, `elapsed_ms` |
| `done` | `{ message }` : la réponse finale (`status: 'done'`, statistiques comprises), émis **dès la fin de la réponse** |
| `title` | `{ title }` : titre court trouvé par le modèle, émis **après** `done` (voir ci-dessous) |
| `error` | `{ code, message, id? }` : `busy`, `no_model`, `no_engine`, `context_exceeded`, `refused`, `upstream`, `closed`, `invalid` |

Un seul `done` **ou** un seul `error` termine la **réponse**. Le flux se ferme à `done` quand aucun titre n'est à produire ; sinon il reste ouvert jusqu'à `title` (ou jusqu'à l'échec, l'annulation ou le délai du titre : il se ferme alors sans `title`). Refus **avant** tout enregistrement (`busy`, `no_model`, `no_engine`, `upstream` du catalogue) : un flux à un seul évènement `error`, aucun message créé.
Annuler = fermer la connexion : le moteur coupe la génération et laisse le modèle chargé, le message garde le texte reçu avec `status: 'cancelled'` (aucun évènement n'est envoyé, personne n'écoute).

### Le titre automatique, après `done`

Le premier échange d'une conversation dont le titre vient encore du prompt reçoit d'abord un **titre provisoire** tiré du prompt (tout de suite, avec la création des messages). Une fois `done` émis, une requête au modèle
(24 jetons, 15 s au plus, sans raisonnement) tourne **en arrière-plan** et `title` est émis à son retour, puis le flux se ferme : l'interface a donc la réponse, ses statistiques et ses actions dès `done`.
Pendant cette requête la jauge d'occupation reste tenue **mais offerte** (`EngineBusyGate.setYield`) : un nouvel envoi, une régénération, une modification, `enhance-prompt` ou une génération en file d'attente **annule le titre et prend le moteur
immédiatement** (jamais de `busy` à cause d'un titre ; la file reprend à la libération de la jauge). Si le client ferme la connexion après `done`, le titre est annulé sans bruit (le titre provisoire reste, la réponse n'est pas touchée).
Pendant le titre, `runningIn(conversation)` est faux : on peut déjà supprimer un message ou régénérer.

### Écarts et précisions par rapport au contrat convenu avec le front

- `ChatAttachment` a un champ de plus, **`original_name`** (le nom que l'utilisateur a choisi ; `name` est le nom stocké, celui qu'on renvoie à `POST .../messages`).
- Les erreurs de forme (identifiant, `q`, `format`) sont des **400**, celles du corps des **422**, comme `studio-core`.
- `edit` : `attachments` omis garde les pièces jointes de l'original.
- Une réponse annulée ou en erreur **reste dans l'historique** (son texte est renvoyé au modèle au tour suivant) ; une réponse en erreur sans texte en est écartée.
- `usage.prompt_tokens` est celui du **dernier tour** (la taille du contexte utilisé), `completion_tokens` la somme des tours.

## Arbre et réglages

Un message a un `parent_id` ; ses **sœurs** sont les messages de même parent et même rôle, dans l'ordre de création (`sibling_ids`, `sibling_index` : le front propose `‹ 2/3 ›`).
La **branche active** est le chemin de la racine à `leaf_id`. Répondre, modifier un message utilisateur et régénérer une réponse créent des enfants / sœurs ;
changer de branche déplace la feuille. Les dates de création sont strictement croissantes dans le processus (deux messages créés dans la même milliseconde gardent leur ordre).
Supprimer une conversation supprime tout par cascade (clés étrangères) et, par `beforeRemove`, arrête la réponse en cours et supprime les fichiers joints.

L'historique envoyé au moteur : l'instruction système (si non vide), puis la branche active jusqu'au message auquel on répond — textes finaux seulement (les `tool_runs` ne sont pas rejoués),
fichiers texte en tête du message dans un bloc `<fichier nom="…">…</fichier>`, images en parties `image_url` avec leur chemin sous le dossier de données.

## Arbitrage avec les générations (un modèle à la fois)

Le moteur ne tient qu'un modèle en mémoire (mémoire unifiée) et répond **409** à celui qui arrive second. Côté Nest :

- une réponse de chat prend `EngineBusyGate` (`tryAcquire('chat')`) pour toute sa durée, titre compris, et la rend dans tous les cas (fin, erreur, annulation). Pendant le titre elle l'**offre** (`setYield`) : `ReplyService.run`, `PromptEnhanceService` et `GenerationQueueService` appellent `gate.preempt()`, qui annule le titre et rend la main à la libération ;
- `GenerationQueueService` ne soumet aucun job tant que la jauge est tenue et reprend à sa libération (les messages restent `queued`) ;
- le chat répond `busy` (texte : « Une génération d'image, d'audio ou de vidéo est en cours ou en attente… ») tant que `GenerationQueueService.occupied` est vrai, et `busy` (« Une réponse est déjà en cours… ») si la jauge est tenue ;
- `enhance-prompt` suit les mêmes règles ; il préfère le modèle de chat déjà chargé (pas de rechargement), sinon le défaut du moteur.

## Outils web

Actifs seulement si `settings.tools.web` **et** que le modèle appelle des fonctions (`llm.tools`). Au plus **5 tours** d'outils par réponse (le sixième appel n'offre plus d'outil : le modèle doit répondre).
Un outil en échec est un `ToolRun` en erreur dont le texte est renvoyé au modèle (« Erreur : … »), pas un échec de la réponse.

- `web_search(query, count ≤ 10)` : **DuckDuckGo** (`html.duckduckgo.com/html/`, sans clé ; page lue par expressions régulières : balisage vérifié le 2026-10-15, non officiel, peut changer ou être limité) ou **Brave Search** (API, en-tête `X-Subscription-Token`) quand une clé est saisie dans les réglages
  (`PUT /api/settings { brave_api_key }`, chiffrée, jamais renvoyée ni journalisée, jamais envoyée au moteur ni mise dans un `ToolRun`).
- `fetch_url(url)` : texte d'une page publique (20 000 caractères au plus). **Garde SSRF** (`tools/ssrfGuard.ts`, `safeFetch.ts`) : schémas `http` / `https` seulement, pas d'identifiants dans l'adresse, ports 80 / 443 / 8080 / 8443, noms locaux
  (`localhost`, `*.local`, `*.internal`, noms sans point…) et adresses littérales privées, locales, réservées, de métadonnées cloud (IPv4 et IPv6, y compris `::ffff:a.b.c.d`, NAT64, 6to4, Teredo) refusés ; **toutes** les adresses d'un nom doivent être publiques
  (une seule privée et le nom est refusé) ; la résolution est faite **par l'appel qui ouvre la connexion** (`lookup` d'`http.request`) : un nom qui change de réponse entre le contrôle et la connexion (rebinding DNS) ne peut pas atteindre une adresse privée ;
  l'adresse de la socket connectée est revérifiée ; au plus 3 redirections, chaque `Location` revalidée ; corps limité à 1,5 Mo et lu seulement pour les types texte ; aucun script exécuté (le HTML n'est jamais rendu).
- Toute requête sortante passe par `throttledFetchJson` (espacement par source : 1,5 s DuckDuckGo, 1 s Brave, 0,5 s pages ; une reprise sur 429 / 5xx).
- La vie privée : les requêtes de recherche **sortent de la machine**. Elles sont visibles dans le message (`tool_runs[].arguments`), et l'outil est désactivé par défaut (par conversation).

## Outils de création (image, vidéo, audio)

Actifs seulement si `settings.tools.creation` (par défaut) **et** que le modèle appelle des fonctions, et pour chaque studio dont le navigateur envoie un modèle (`creation_models`, lu de la sélection de chaque studio) **prêt** dans le catalogue : sans modèle prêt, l'outil n'est pas proposé.
Les schémas sont **reconstruits à chaque réponse** d'après les capacités du modèle (jamais figés) ; ils passent avec les outils web dans la même boucle de 5 tours (`ChatReplyService.streamRounds`, paramètre `creation`).

- `generate_image(prompt, aspect?)` : `aspect` parmi `1:1`, `16:9`, `9:16`, `4:3`, `3:4` ; le reste vient des paramètres par défaut du modèle.
- `generate_video(prompt, seconds?)` : la description donne les bornes de **ce** modèle (`min_seconds`–`max_seconds`, défaut `default_seconds`). Sans `seconds`, **rien n'est lancé** : le message reçoit une génération `pending: 'duration'` (carte de choix, curseur borné par le modèle) et le modèle apprend qu'il n'a pas à relancer l'outil.
- `generate_audio(text, …)` : n'expose que ce que le modèle accepte (`AudioCaps`) : `voice` (noms de la bibliothèque, si le modèle clone, et des voix prédéfinies du modèle, listés dans la description), `voice_description` si le modèle crée une voix d'après une description (`design`), `style` s'il prend une consigne (`instruct`), `language` s'il a plusieurs langues, `text` borné par `max_chars`. Les deux dernières vont dans `params.instruct` / `params.language`. Un modèle d'un autre `task` que `tts` (sons, musique : aucun au catalogue à ce jour) prend `description` (+ `seconds`) au lieu d'un texte et d'une voix ; un modèle de transcription (`stt`) n'a pas d'outil. La voix n'est exigée **que** si le modèle clone sans voix prédéfinie (`clone = required`) : voix nommée, sinon la **voix par défaut du chat** (`chat_voice_id`, réglage de l'application), sinon une carte de choix (`pending: 'voice'`). Une voix inconnue est une erreur renvoyée au modèle avec la liste des voix.

Un appel crée la génération avec les paramètres par défaut du modèle via `GenerationService.create` : un prompt et sa réponse **rattachés à la conversation de chat** (lignes `messages` de `studio-core` : les fichiers appartiennent à la conversation, leur origine est « chat », la suppression de la conversation les emporte) et mis en file. L'outil rend la main **tout de suite** (« génération lancée ») : le modèle de chat tient la jauge, la file ne soumet le job qu'à sa libération. Un refus du moteur (422 du contrôle `jobs/check`) est une erreur lisible par le modèle, comme pour les outils web.
Le modèle conclut en une phrase (il ne voit pas le résultat). La conversation reste « occupée » (`busy`) tant que la génération attend ou tourne : le chat ne répond pas avant sa fin.

**Commandes** `/image …`, `/video [Ns] …`, `/audio [voix :] …` (début du message, sans pièce jointe, `tools.creation` actif) : reconnues **avant** le modèle, qui n'est pas chargé et ne tient pas la jauge ; réponse = une phrase fixe (« Génération lancée… »). Un nom avant les deux-points n'est pris pour une voix que s'il en désigne une du modèle ou de la bibliothèque. Sans modèle prêt dans le studio : erreur `no_model` sans rien créer ; texte vide : `invalid`.

**Stockage** : `chat_messages.generations` (JSON, nullable) porte, par génération, `{ id, kind, model_id, message_id, prompt, params, pending? }`. Le **côté état** (`state`, `error`, `assets`) n'y est pas copié : `ChatStoreService` le lit chez `studio-core` à chaque lecture (`MessageService`, par `message_id`), donc une seule source ; `state: 'pending'` tant qu'une carte attend un choix, `cancelled` si le message du studio a disparu. Le front est prévenu par les événements `studio.*` déjà publiés par la file (`message.updated`, `job.image`) : voir le README du chat côté front. Supprimer un message du chat supprime ses générations (arrêt si elles tournent, fichiers purgés : `CreationToolsService.discard`).
**Chat privé** : les outils de création y sont **éteints** (`creation: false` imposé par `parsePrivateChatBody`) : une génération de la session privée passe par `PrivateGenerationService` et sa mémoire, ce que le chat privé sans état ne tient pas encore.

## Entités

- `ChatMessageEntity` (`chat_messages`) : `id`, `conversationId` (cascade), `parentId` (cascade), `role` (`user` | `assistant`), `content`, `reasoning`, `toolRuns` (JSON), `generations` (JSON, nullable : `StoredGeneration[]`), `attachments` (JSON : `kind`, `name`, `original_name`, `mime`, `size`), `modelId`, `params` (JSON : échantillonnage et raisonnement du tour), `status` (`done` | `streaming` | `error` | `cancelled`), `error`, `stats` (JSON), `createdAt` (secondes, flottant). Index `(conversation_id, created_at)` et `(parent_id)`.
- `ChatSettingsEntity` (`chat_conversation_settings`) : `conversationId` (clé primaire, cascade), `modelId`, `systemPrompt`, `params` (JSON), `contextSize`, `reasoning`, `tools` (JSON), `leafId` (sans clé étrangère : une branche supprimée déplace la feuille dans le code). Créée au premier réglage ou à la première réponse.
- Migrations `1792058442183-ChatTables.ts` (colonnes portables : `jsonColumnType()`) et `1792070000000-ChatGenerations.ts` (`chat_messages.generations`, nullable).
- `ChatSettingsEntity.tools` est un JSON : `creation` s'y ajoute sans migration (absent = actif).

Pièces jointes : fichiers `chat_<16 hex>.<ext>` dans `<données>/uploads/` (le moteur les lit par chemin absolu, le navigateur voit les images par `/api/media/uploads/<nom>`) et une description `uploads/chat-meta/<nom>.json`.
Un message modifié partage les fichiers de l'original : un fichier n'est supprimé que lorsqu'aucun message de la conversation ne l'utilise. Au démarrage, les envois vieux d'un jour et jamais utilisés sont supprimés.

## Reprise au démarrage

Une réponse restée `streaming` (arrêt brutal) passe à `error` avec « Réponse interrompue par l'arrêt de l'application. », son texte conservé (`ChatStoreService.failInterrupted`, comme `MessageService.failInterrupted`).

## Points d'extension

- Un nouvel outil : son schéma dans `WEB_TOOL_SCHEMAS` (`WebToolsService.ts`), son exécution dans `WebToolsService.run`, son nom dans `ToolRun.name` ; le moteur et le flux n'ont rien à savoir.
- Un nouvel outil de création (ou le `task` d'un nouveau modèle audio, sons / musique) : son schéma dans `CreationToolsService.schema` / `audioSchema`, son exécution dans `fromArguments`, son nom dans `CREATION_TOOL_NAMES` et `ToolRun.name` ; les capacités viennent du catalogue, rien à changer dans le moteur ni le flux.
- Un autre fournisseur de recherche : un analyseur dans `tools/webSearch.ts` et une branche de `WebToolsService.search`.
- `WEB_TOOL_DEPS` (jeton de `WebToolsService`) remplace la lecture de la clé Brave, le téléchargement et les transports de recherche : c'est ce que les tests injectent.
- Les instructions du bouton ✨ : `ENHANCE_INSTRUCTIONS` (`PromptEnhanceService.ts`).

## Tests

Un fichier à la fois, depuis `back/`, sous `docs/migration/tools/guarded_run.sh 3` (aucun moteur réel : faux moteur HTTP local qui diffuse des trames SSE) :

```sh
npx jest --runInBand src/modules/chat/controllers/ChatController.spec.ts     # routes : flux, en-têtes, refus, branches, sœurs, déchargement, pièces jointes, export, recherche, ✨, fermeture du client
npx jest --runInBand src/modules/chat/controllers/ConversationChatMode.spec.ts # /api/conversations avec mode=chat
npx jest --runInBand src/modules/chat/services/ChatReplyService.spec.ts      # réponse, titre, annulation, outils, régénération, modification, jauge
npx jest --runInBand src/modules/chat/services/ChatStoreService.spec.ts      # arbre, feuille, suppression, cascade, recherche, reprise
npx jest --runInBand src/modules/chat/services/EngineLlmClient.spec.ts       # flux du moteur, refus, coupure, annulation
npx jest --runInBand src/modules/chat/services/ChatAttachmentService.spec.ts # type par les octets, purge, balayage
npx jest --runInBand src/modules/chat/services/ChatBootstrap.spec.ts        # branchement sur les conversations partagées, suppression, reprise
npx jest --runInBand src/modules/chat/services/WebToolsService.spec.ts       # outils web avec faux fournisseurs
npx jest --runInBand src/modules/chat/services/CreationToolsService.spec.ts  # outils de création : schémas selon les capacités, appels, commandes, cartes de choix, nettoyage
npx jest --runInBand src/modules/chat/tools/ssrfGuard.spec.ts                # garde SSRF : adresses, URL, résolution, rebinding
npx jest --runInBand src/modules/chat/tools/safeFetch.spec.ts                # redirections, adresse de la socket, types, taille
npx jest --runInBand src/modules/chat/services/chatValidation.spec.ts        # toutes les validations
```

Aussi : `mappers/chatMapper.spec.ts` (état d'une génération), `studio-core/services/GenerationService.spec.ts` (une génération rattachée à une conversation de chat), `chatHistory`, `chatExport`, `ChatModelService`, `PromptEnhanceService`, `tools/htmlText`, `tools/webSearch` (mêmes dossiers), `studio-core/services/EngineBusyGate.spec.ts` (jauge et file), `migrations/tests/migrations.spec.ts`.

**Non vérifié** : aucun vrai `llama-server`, aucun vrai modèle d'image, de vidéo ou de son lancé par un outil (le catalogue, la file et le moteur sont des faux ; la régularité des petits modèles (1 à 4 B) à remplir les arguments des outils n'est pas mesurée : les commandes `/…` sont le recours fiable), ni le temps de rechargement du modèle de chat après une génération, aucun vrai modèle ni appel réseau réel n'a servi dans ces tests (la page DuckDuckGo servant de modèle à l'analyseur a été lue une fois à la main, le 2026-10-15) ; le comportement du flux derrière un proxy inverse n'est pas mesuré
(les en-têtes sont ceux que le gabarit documente pour ses propres flux).
