# Module `chat` (front)

## Rôle

Le **mode Chat** : conversation avec un modèle de langage local (exécuté par llama.cpp côté moteur). L'accueil (`/chat`), le **fil** d'une conversation (`/c/:id` quand `mode = 'chat'`),
le **composeur** (pièces jointes, modèle, instruction système et personas, réglages, recherche web, jauge de contexte, envoi / arrêt), le **rendu** des réponses (Markdown sûr, code coloré,
réflexion du modèle, appels d'outils, statistiques), les **branches** (régénérer, modifier un message, comparer deux modèles), l'export, la recherche dans les messages et l'état du modèle
en mémoire. Back : `back/src/modules/chat/README.md` (routes `/api/chat/*`, flux SSE) ; moteur : `engine/app/llm.py`, `engine/app/api/llm.py`. Les conversations (liste, titre, épingle, suppression)
sont celles de `studio-core` avec `mode = 'chat'` ; les messages de chat sont dans les tables de `back/src/modules/chat` (arbre : `parent_id`).

## Structure

```
chat/
  index.ts                          exports : ChatHome, ChatConversationView, LlmStatusChip, useLlmEvents, useChatSearch, chatApi, useChatLiveStore, types
  types.ts                          ChatMessage, ChatSettings, ChatConversation, ToolRun, ChatStreamEvent, LlmStatus... (forme publique de Nest, snake_case)
  services/chatApi.ts               routes REST (studioRequest) ; `streamAnswer` : fetch + flux SSE (lecture par `readSse` du gabarit) ; chemins des trois façons de demander une réponse
  services/privateChatBackend.ts    le chat d'une **session privée** : la conversation (réglages et arbre de messages) tenue en mémoire de la page (`private/lib/privateChatMemory.ts`), jamais `localStorage` ni serveur ; `privateChatApi` répond à ce que `chatApi` lit/écrit, `streamPrivateAnswer` remplace `streamAnswer` (appelle `POST /api/private/chat`, mêmes évènements)
  lib/privateTree.ts                l'arbre de messages en mémoire (frères, branche active, dernière feuille, suppression d'un sous-arbre, historique envoyé au serveur, export) : pur, testé
  services/answerRunner.ts          `startAnswer` / `stopAnswer` : lance une réponse et l'écrit dans le cache TanStack au fil du flux ; une seule réponse à la fois ; continue si la page est quittée
  state/chatLiveStore.ts            par conversation : chargement du modèle, erreur, contrôleur d'arrêt ; et l'état du modèle de chat (`llm.status`) (Zustand)
  state/chatDraftStore.ts           brouillon par conversation (`cn-chat-drafts`, texte seulement), pièces jointes en cours, envoi remis par l'accueil, messages déjà vus (comparaison)
  state/chatDefaultsStore.ts        réglages de l'accueil = réglages de départ des nouvelles conversations (`cn-chat-defaults`)
  hooks/useChat.ts                  conversation (requête ; relue tant qu'un message reste `streaming` sans réponse lue ici), réglages (enregistrés 500 ms après la dernière modification), modèle de la conversation, recherche plein texte
  hooks/useSiblings.ts              lit les réponses sœurs jamais vues (`GET …/siblings`) pour que la comparaison survive à un rechargement ; hooks/useElapsedSeconds.ts : horloge d'une attente
  hooks/useChatActions.ts           régénérer (même modèle ou un autre), modifier, changer de branche, supprimer, arrêter
  hooks/useChatSubmit.ts            envoi du composeur ; depuis l'accueil : crée la conversation, lui donne les réglages de l'accueil, l'ouvre
  hooks/useAttachments.ts           pièces jointes : vérification, envoi (`/api/chat/attachments`), retrait
  hooks/useLlmEvents.ts             abonnement à `engine.llm.status` ; hooks/useThrottled.ts, hooks/useModelName.ts
  lib/sse.ts                        `toChatEvent` : bloc SSE -> évènement typé (un bloc illisible est ignoré)
  lib/streamReducer.ts              applique un évènement à la conversation en cache (pur) ; `placeMessage` : une branche nouvelle remplace la suite de l'ancien frère
  lib/branches.ts                   position parmi les frères (‹ 2/3 ›), réponses à comparer
  lib/context.ts                    remplissage du contexte, contexte demandé, « le contexte change-t-il ? » (rechargement), texte de chargement
  lib/presets.ts                    valeurs par défaut du serveur, préréglages, schéma du formulaire de réglages, niveaux de réflexion, personas
  lib/attachments.ts, errors.ts, markdownSafety.ts, estimate.ts, chatKeys.ts   règles des pièces jointes (noms stockés, nom affiché `displayName`, limites du serveur) ; code d'erreur -> texte et action ; liens et images sûrs ; estimation de tokens ; clés de requête
  lib/math.ts                       `normalizeMath` : `\( \)`, `\[ \]` et `$x$` écrits `$$…$$` (jamais dans le code, même un bloc encore ouvert ; les montants restent du texte)
  lib/handoff.ts, selection.ts      réponse (ou sélection) -> prompt sans balisage Markdown ; texte sélectionné dans une réponse
  lib/enhance.ts                    codes d'échec de ✨ (409 `busy` / `no_model` / `no_engine`, sinon moteur), état du bouton, retour à l'original
  components/                       ChatHome, ChatConversationView, ChatThread, UserMessageView, AssistantMessageView, AssistantBody, CompareView, MessageParts (BranchNav, ReasoningBlock, ToolRuns, StatsLine,
                                    AttachmentList), Markdown (+ MarkdownRenderer, chargé à la demande, et MathMarkdownRenderer : KaTeX, chargé seulement si une réponse a une formule), SendToMenu, EnhancePromptButton, ChatComposer, ChatSettingsPopover, ContextField, SystemPromptPopover, ContextGauge, ChatStatusLine,
                                    ChatErrorNotice, ChatSuggestions, LlmStatusChip, ExportMenu, ChatSearchHits
  locales/                          locales.fr.json, locales.en.json (clés chat.*)
```

Montage : `studio-shell/routes.tsx` (la route `/chat` est chargée à la demande : `pages/ChatHomePage.tsx`), `pages/ConversationPage.tsx` (rend `ChatConversationView`, chargé à la demande, quand la conversation est de mode chat),
`StudioShell` (monte `useLlmEvents`), `ConversationList` (en mode chat, `ChatSearchHits` sous les titres). Le sélecteur de modèle est `StudioModelPicker` de `studio-core` (type `llm`), qui porte aussi le bouton « Nouveautés ».
Les cartes de modèles de chat, la carte du moteur llama.cpp et la recherche Hugging Face `kind=llm` sont dans `model-catalog` et `engines` ; la clé Brave Search est dans `settings`.

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `POST` | `/api/conversations` `{ mode: 'chat' }` | crée la conversation (accueil) |
| `GET` | `/api/chat/conversations/:id` | `ChatConversation` : conversation, réglages, messages de la branche active |
| `PATCH` | `/api/chat/conversations/:id/settings` | réglages (modèle, instruction système, paramètres, contexte, réflexion, outils) |
| `POST` | `/api/chat/conversations/:id/messages` | envoi : **flux SSE** (message utilisateur puis réponse) |
| `POST` | `/api/chat/conversations/:id/messages/:mid/regenerate` | nouvelle réponse sœur, éventuellement d'un autre modèle : **flux SSE** |
| `POST` | `/api/chat/conversations/:id/messages/:mid/edit` | nouveau message utilisateur sœur et sa réponse : **flux SSE** |
| `POST` | `/api/chat/conversations/:id/leaf` | change de branche |
| `DELETE` | `/api/chat/conversations/:id/messages/:mid` | supprime le message et ce qui le suit |
| `POST` | `/api/chat/attachments` | envoi d'une pièce jointe (multipart) |
| `GET` | `/api/chat/conversations/:id/export?format=md\|json` | export (téléchargement par lien) |
| `GET` | `/api/chat/search?q=` | recherche plein texte dans les messages |
| `GET` | `/api/chat/conversations/:id/messages/:mid/siblings` | `chatApi.siblings` : les sœurs complètes d'une réponse (comparaison après un rechargement) |
| `POST` | `/api/chat/model/unload` | `chatApi.unloadModel` : décharge le modèle de chat (bouton ⏏ de l'indicateur d'état ; 409 `busy` pendant une réponse) |
| `POST` | `/api/chat/enhance-prompt` | `chatApi.enhancePrompt` : amélioration d'un prompt de génération, bouton ✨ `EnhancePromptButton` des compositeurs image, audio et vidéo |

Le flux : `message` (utilisateur, puis assistant créé), `loading`, `delta`, `reasoning`, `tool`, `usage`, `title`, puis un seul `done` **ou** `error`. Un flux qui s'arrête sans l'un des deux donne une erreur `closed`
côté client. Arrêter = fermer la connexion (`AbortController`) : le serveur garde le texte reçu et marque le message `cancelled`. Les requêtes de flux partent sans jeton d'accès : l'application est en `LOCAL_TRUST`
(un en-tête `Authorization` n'est ajouté que par `HttpService`, qui ne sait pas lire un refus avec son message). Un refus avant le flux (`400` identifiant, `422` corps, `409`) donne un `ChatError` dont le code est celui que
le serveur ajoute au refus (`code`) quand il en met un, sinon deviné d'après le statut ; `StudioApiError.code` (`studio-shell/services/studioHttp.ts`) porte ce même code pour les appels JSON.

## Comportements

- **Une réponse à la fois.** `startAnswer` refuse (message) quand une autre réponse est en cours, dans n'importe quelle conversation ; le moteur n'a qu'un modèle en mémoire. Le composeur remplace « Envoyer » par « Arrêter » pour la
  conversation qui écrit, et avertit quand une génération d'image, d'audio ou de vidéo tourne (le moteur répond alors `busy`).
- **Changer le contexte recharge le modèle.** Le cache du contexte est alloué au chargement : le contexte par défaut est de 16 384 tokens (`context_default` du modèle) et le modifier recharge le modèle. Dans le popover des réglages,
  le champ « Contexte » montre sous lui un avis (icône + texte, rôle `status`) *tant que la valeur saisie diffère du contexte du modèle actuellement chargé* (`llm.status.context_size`, même modèle que celui de la conversation ;
  la valeur est bornée comme le fait le moteur : `lib/context.ts` `requestedContext`, `contextChangeReloads`). L'avis n'a pas de chiffre de mémoire (aucune route ne l'expose ; le moteur la calcule pour le planificateur) et ne
  bloque rien. Au prochain envoi qui recharge le modèle, la ligne de statut dit « Rechargement du modèle avec un contexte de N tokens… » (phase `loading`, `chat.status.reloadContext`) au lieu de « Chargement du modèle… ».
- **Réponse en cours.** Le Markdown est rendu au plus ~12 fois par seconde (`useThrottled`) ; le fil suit le bas tant que le lecteur n'a pas remonté. Les lecteurs d'écran reçoivent une annonce par réponse
  (`aria-live` coupé sur le fil), pas une par token.
- **Branches.** Le serveur n'envoie que la branche active. `‹ n/m ›` change de branche (`/leaf`). La **comparaison** montre côte à côte (onglets sous 900 px) les réponses sœurs de modèles différents **que ce navigateur a vues**
  (`chatDraftStore.seen`, alimenté par chaque conversation chargée et chaque flux) ; après un rechargement de page, `useSiblingsSync` lit une fois les sœurs jamais vues (`GET …/siblings`, valables une minute)
  pour que la comparaison réapparaisse.
- **Une réponse qui ne se termine pas.** Arrêter ferme la connexion et le serveur règle le message (`cancelled`) un instant plus tard ; une réponse restée `streaming` côté serveur alors que ce navigateur ne la lit pas
  (arrêt pas encore réglé, page rechargée en pleine réponse) est relue toutes les 1,5 s, une quarantaine de fois au plus, jusqu'à ce qu'elle soit réglée : elle ne reste jamais bloquée.
- **Envoyer vers Image / Vidéo / Audio.** `SendToMenu` (sur chaque réponse) envoie la réponse, ou le texte qu'on y a sélectionné, sans balisage Markdown (`lib/handoff.ts`), au compositeur du studio choisi par
  `usePromptHandoffStore` (`studio-core`, en mémoire seulement) puis ouvre ce studio ; son compositeur le prend à l'affichage (`usePromptHandoff`).
- **✨ Améliorer le prompt.** `EnhancePromptButton` est monté dans les compositeurs image, audio et vidéo (import direct de ce fichier : le module `chat` n'importe jamais ces studios). Il réécrit le prompt avec le
  modèle de chat (une horloge s'affiche si le modèle doit se charger), garde l'original (« Rétablir » tant que le prompt est celui qui a été amélioré) et, en cas de refus, explique pourquoi (génération ou réponse en
  cours, aucun modèle de chat, moteur llama.cpp absent) avec le bouton qui ouvre les modèles ; désactivé tant qu'aucun modèle de chat n'est installé ; un résultat qui arrive après que l'utilisateur a retapé est ignoré.
- **Brouillon.** Le texte non envoyé est gardé par conversation (`cn-chat-drafts`) ; il est vidé quand le serveur a enregistré le message. Les pièces jointes en cours ne sont pas gardées.
- **Accueil.** Ses réglages (instruction système, paramètres, contexte, réflexion, recherche web) sont les réglages de départ des nouvelles conversations. Le premier envoi crée la conversation, lui applique ces réglages, l'ouvre ;
  la page de la conversation prend l'envoi en charge (`pending`) une fois la conversation chargée, pour que le flux écrive dans un cache qui existe.
- **Sûreté du Markdown.** Pas de HTML brut (react-markdown ne le rend pas), liens `http(s)` et `mailto` seulement, ouverts hors de l'application (`rel="noopener noreferrer nofollow"`), **images distantes bloquées** :
  un bouton « Charger l'image » affiche l'hôte. Le code est coloré par un sous-ensemble de highlight.js (22 langages). **Formules** : KaTeX (`remark-math` + `rehype-katex`, `trust` désactivé : ni lien ni image dans une formule ; une formule illisible s'affiche en couleur d'erreur sans casser la réponse),
  dans un morceau à part chargé seulement quand le texte en contient (`mayHaveMath`) ; `\( \)`, `\[ \]` et `$x$` sont ramenés à `$$…$$` hors du code, et un montant (`5$`, `$6`) reste du texte.

## Dépendances

`react-markdown` (déjà dans le gabarit), `remark-gfm` 4.0.1 (MIT), `rehype-highlight` 7.0.2 (MIT, avec `lowlight` 3), `highlight.js` 11.12 (BSD-3-Clause), `katex` 0.16.47, `remark-math` 6.0.0 et `rehype-katex` 7.0.1 (MIT ; `katex` est épinglé en 0.16 comme l'exige `rehype-katex`) : déclarées dans `front/package.local.json`. Le Markdown et le code coloré sont dans le morceau
`MarkdownRenderer`, les formules dans `MathMarkdownRenderer`, tous deux chargés à la demande (poids non mesuré : pas de `vite build` en développement). `@/modules/model-catalog` (modèles, `ModelPicker`), `@/modules/engines` (`SetupPrompt`, `WelcomeSetup`),
`@/modules/settings` (clé Brave), `@/modules/studio-core` (`StudioModelPicker`, `TitleEditor`, `copyText`, défilement), `@/modules/studio-shell` (conversations, routes, focus, HTTP), `@/modules_shared/common` (SSE, confirm, aide, formulaire par schéma).

## Tests

`lib/*.spec.ts` (flux SSE coupé octet par octet, réducteur, branches, contexte, pièces jointes, réglages, erreurs, liens sûrs, formules, envoi vers un studio, amélioration de prompt), `services/chatApi.spec.ts` (fetch simulé : flux, refus, flux interrompu, annulation),
`services/chatContract.spec.ts` (**fige le contrat avec le module Nest** : les formes et l'ordre réels des évènements d'un envoi, d'un refus, d'une erreur, d'une régénération, d'une modification et d'un arrêt, les appels, les limites et les bornes de réglages),
`services/answerRunner.spec.ts` (le cache écrit au fil du flux, brouillon vidé, une réponse à la fois, rechargement du contexte, erreur, arrêt), `state/chatDraftStore.spec.ts`, `hooks/useLlmEvents.spec.ts`,
`components/render.smoke.spec.ts` (rendu serveur sans DOM : accueil, composeur, fil, comparaison, avis de contexte, erreurs ; les états de stores ne se lisent pas au rendu serveur : les parties présentationnelles
prennent leurs données en propriétés), `locales/locales.spec.ts`. Aucun test dans un navigateur : le rendu réel des fenêtres, le défilement et le flux face à un vrai serveur ne sont pas vérifiés.

## Limites connues

- Le contenu d'un message est limité à 200 000 caractères (le serveur refuse au-delà : message d'erreur côté client avant l'envoi) ; la police des formules (KaTeX) pèse 1,1 Mo en trois formats dans le paquet : non mesurée dans le bundle (pas de `vite build` en développement).
- Les liens externes s'ouvrent avec `target="_blank"` (comme le reste de l'application) : dans la coquille Tauri leur comportement n'a pas été vérifié.

## Chat en session privée (module `private`)

Pendant une session privée (`isPrivateMode()`), `chatApi` et `streamAnswer` envoient à `services/privateChatBackend.ts` : **rien du chat ne passe par les routes qui enregistrent** (`/api/chat/conversations/*`, refusées par
`private/lib/privateRouting.ts`). La conversation est un arbre de messages en mémoire de la page (mêmes formes que `ChatMessage`, donc le fil, le composeur, les branches, la comparaison, la régénération et la modification
sont ceux du chat normal) ; chaque réponse part vers `POST /api/private/chat` avec **tout** l'historique de la branche et les réglages, et revient en évènements (`accepted` : les messages sont ajoutés ; `loading`, `delta`,
`reasoning`, `tool`, `usage`, `done` / `error`). Un refus avant `accepted` (un `error` sans `id`) ne crée rien. Annuler garde le texte reçu en `cancelled`.

- **Coquille** : la création (`POST /api/conversations` → `/api/private/conversations`, mode `chat`) donne une coquille côté serveur (titre générique, nombre de messages mis à jour par `PATCH … { message_count }`) pour la liste de la barre latérale ; pas de titre automatique. Renommer, épingler, supprimer passent par les routes de conversations privées ; supprimer oublie aussi l'arbre (`forgetPrivateChat`).
- **Pièces jointes, ✨** : `/chat/attachments` et `/chat/enhance-prompt` sont routés vers `/api/private/chat/*` (dossier de session, rien de gardé) ; une pièce jointe ôtée avant l'envoi est supprimée de la session ; « Envoyer vers » reste en mémoire (`usePromptHandoffStore`).
- **Recherche** dans les conversations privées : en mémoire (`privateChatApi.search`). **Export** : un fichier fabriqué dans la page (lien `blob:` révoqué avec la session), jamais téléchargé du serveur.
- **Recherche web** : éteinte par défaut ; l'activer en privé demande une confirmation (`chat.web.private.*` : les requêtes sortent de la machine).
- **Fin de session** (quitter, tout effacer, expiration, serveur injoignable) : `forgetPrivateChats()` abandonne les réponses en cours, vide les conversations et les fichiers envoyés, l'état de lecture des réponses, le texte « envoyé vers » et les liens d'export.
- **Limites** : la conversation n'existe que dans la page (recharger la page la perd, la session privée aussi) ; le modèle de chat reste chargé jusqu'à la fin de la session (le serveur le décharge alors), son cache de prompt est en mémoire de `llama-server`.
