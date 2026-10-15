# Module `studio-shell`

## Rôle

Coquille du studio dans le nouveau front : barre latérale (mode image / audio / vidéo / chat, pages du mode, recherche et liste des
conversations épinglées et groupées par période, carte du moteur, modèles, réglages, langue, thème clair/sombre), mise en page, raccourcis
clavier, routes conservées de l'ancienne interface, cache de données serveur (TanStack Query), état client (Zustand) et
abonnements au flux d'événements (`engine.*` du moteur, `studio.*` de Nest). Les écrans eux-mêmes sont des **pages minces** : l'accueil et la conversation
sont ceux du studio image (modules `image-studio` et `studio-core`, H4.3b) ; la galerie d'images est celle de `media-library` (H4.4) ; l'accueil audio, la bibliothèque audio et les voix sont ceux des modules `audio-studio` et `voices` (H4.5) ; la vidéo reste « à venir » jusqu'à la tâche H4.6 ;
le dialogue Réglages est celui du module `settings` (H4.1), le dialogue Modèles celui du module `model-catalog` avec les installateurs du module `engines` (H4.2).

Module d'application (`front/src/modules/`), pas un module partagé. Thème : `front/src/themes/chambre-noire/README.md`.

## Structure

```
studio-shell/
  index.ts                 exports : StudioShell, StudioProviders, studioRoutes, matchStudioRoute
  StudioProviders.tsx      QueryClientProvider (client : state/queryClient.ts)
  routes.tsx               studioRoutes (PluginRoute[], layout 'fullscreen') pour components/Router.tsx
  types.ts                 StudioMode, ConversationSummary, Conversation, ConversationPatch
  components/              StudioShell, Sidebar, ModeSwitch, NavItem, SearchField, ConversationList, ConversationItem, SelectionBar,
                           SidebarFooter, Mark, modeIcons
  pages/                   HomePage (ImageHome), GalleryPage (ImageGallery), AudioHomePage, AudioLibraryPage, VoicesPage (VoicesLibrary), VideoHomePage, VideoLibraryPage, ChatHomePage (ChatHome, chargée à la demande), ConversationPage (ConversationView + adaptateurs image, audio et vidéo ; le fil du chat quand la conversation est de mode `chat`, chargé à la demande), ComingSoonPage (page de repli d'une route sans page)
  hooks/                   useConversations (requêtes + actions), useEngineEventSync, useModeSync, useShortcuts, useT
  lib/                     logique pure : periods, shortcuts, routes, eventEffects, queryKeys, focusRegistry
  services/                studioHttp (routes `/api/<segment>` de Nest, médias ; `StudioApiError` porte le `code` que la route ajoute à un refus, p. ex. `busy` ; en génération privée, les routes du studio vont sous `/private`, voir le module `private`), conversationsApi
  state/                   studioStore (Zustand), queryClient
  locales/                 locales.fr.json, locales.en.json (+ registre : src/locales/registerModuleLocales.ts)
```

Montage : `App.tsx` (`AppMuiTheme` > ... > `StudioProviders`), `components/Router.tsx` (`...studioRoutes`),
`components/PageLayout.tsx` (une page du studio est rendue dans `StudioShell`, sans l'en-tête ni la barre latérale du
gabarit ; la coquille reste montée d'une page à l'autre, donc la recherche et la liste persistent).

## Routes

| Chemin | Page | Mode | Tâche qui la remplit |
|---|---|---|---|
| `/` | Accueil du studio image (`ImageHome`) | image | H4.3b (fait) |
| `/c/:id` | Conversation (`ConversationView`, ou `ChatConversationView` du module `chat` pour le mode chat) | de la conversation | H4.3b (fait), audio : H4.5 (fait), vidéo : H4.6 (fait), chat (fait) |
| `/galerie` | Galerie (`ImageGallery`) | image | H4.4 (fait) |
| `/audio` | Accueil audio (`AudioHome`) | audio | H4.5 (fait) |
| `/audio/voix` | Mes voix (`VoicesLibrary`) | audio | H4.5 (fait) |
| `/audio/bibliotheque` | Bibliothèque audio (`AudioGallery`) | audio | H4.5 (fait) |
| `/video` | Accueil vidéo (`VideoHome`) | vidéo | H4.6 (fait) |
| `/video/bibliotheque` | Bibliothèque vidéo (`VideoGallery`) | vidéo | H4.6 (fait) |
| `/chat` | Accueil du chat (`ChatHome`, module `chat`, chargé à la demande) | chat | mode Chat (fait) |

Table unique : `lib/routes.ts` (`STUDIO_ROUTES`, `studioPaths`, `matchStudioRoute`). Pour remplacer une page : changer l'`element`
de sa route dans `routes.tsx` (ou passer un `lazy`).

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/conversations?mode=&q=` | Liste du mode, filtrée par la recherche (module Nest `studio-core`). |
| `GET` | `/api/conversations/:id` | Conversation et messages (mode de la page, titre). |
| `PATCH` | `/api/conversations/:id` | Épingler (`pinned`) ou renommer (`title`). |
| `DELETE` | `/api/conversations/:id` | Supprimer. |
| `POST` | (`studioUpload`) | Ajouté en H4.3b : envoi multipart avec progression (`HttpService.upload`), pour `POST /api/assets` (module `studio-core`). |
| `PUT`/`POST` | (`studioRequest`) | Ajouté en H4.1 pour les modules `settings` et `hardware` (`GET/PUT /api/settings`, `GET /api/system`, `GET /api/status`, `POST /api/engine/unload`, routes Nest). |
| `GET` | `/api/v1/events/stream?topics=studio.message.updated,…` | Flux d'événements (brique commune `eventStreamClient`). |

Les appels passent par `httpService` (`skipTransport: true` : ces routes répondent du JSON en clair) ; l'URL de base est celle de
`configurationService.getApiUrl()` sans le suffixe `/v1` (`studioApiBase()`), car les routes du studio sont sous `/api/<segment>`, à côté de `/api/v1`
(modules Nest, voir leurs README ; médias : `back/src/modules/engine/README.md`, « Relais des médias »).
Les médias du moteur (`/media/...`) sont servis sous `/api/media/...` : `resolveMediaUrl`.

## Données et temps réel

- **TanStack Query** (écart assumé au gabarit, lot H) : clés dans `lib/queryKeys.ts` (`conversations`, `conversation`).
  Défauts : `staleTime` 30 s, pas de rechargement au focus (le flux d'événements invalide), un nouvel essai.
- **Flux d'événements** : `hooks/useStudioEvents` du module `studio-core` (monté par `StudioShell`) suit les sujets `studio.*` publiés par Nest pour les conversations, messages, images,
  assets et la progression, et écrit directement dans le cache (voir son README). `hooks/useEngineEventSync.ts` (monté par `StudioShell`) : abonnement aux sujets
  `engine.engine.status`, `engine.models.changed`, `engine.download.progress`, `engine.engine.install`, `engine.pack.install`, `engine.llamacpp.install` (clés `['engine-status']` et
  `['system']` du module `hardware`, `['models']` du module `model-catalog` ; la progression en cours n'invalide rien, elle alimente les stores `model-catalog` et `engines`), `engine.link` (relais du moteur par Nest). `lib/eventEffects.ts` traduit chaque événement en invalidations/retraits du cache
  (regroupés sur 250 ms) ; `engine.link` revenu à `connected: true` et la trame `resync` rechargent tout. Quand le flux est
  indisponible (`fallback`), la liste se relit au montage ; les composants H4 ajoutent leurs sujets dans `ENGINE_TOPICS` et leurs effets.
- **Actions** (`useConversationActions`) : épingler/renommer en mise à jour optimiste avec retour arrière et message d'erreur
  (react-toastify) ; supprimer avec confirmation (`confirm()` de `common`) puis retour à l'accueil du mode si la conversation était ouverte. `remove` et `removeMany` oublient aussi l'arbre de messages d'une conversation de chat privé (`private/lib/privateChatMemory.ts`). `removeMany` supprime plusieurs conversations une à une
  (route `DELETE` existante, pas de route groupée) et renvoie `{ done, failed }` ; un échec partiel est signalé avec son nombre.
- **Zustand** (`state/studioStore.ts`) : `mode`, `lastPathByMode` (dernière page par mode, pour la bascule), `sidebarOpen`
  (persisté sous `cn-prefs`, comme avant), `settingsOpen`, `modelsOpen`, `modelsSearchKind` (ouverture du dialogue sur la recherche Hugging Face d'un type : `openModelSearch(kind)`). Les modules H4 y ajoutent leurs tranches.

## Raccourcis (`lib/shortcuts.ts`, `hooks/useShortcuts.ts`)

| Touche | Action |
|---|---|
| ⌘B / Ctrl+B | Masquer / afficher le panneau |
| ⌘⇧O / Ctrl+Shift+O | Nouvelle création du mode courant, puis focus du composeur |
| ⌘K / Ctrl+K | Rouvrir le panneau si besoin et focaliser la recherche |
| `/` | Focaliser le composeur (ignoré dans un champ ou quand un dialogue est ouvert) |

Le composeur et la recherche s'enregistrent par `registerFocusTarget('composer' | 'search', élément)` (`lib/focusRegistry.ts`).
Les composeurs de H4 n'ont qu'à appeler `registerFocusTarget('composer', textarea)`.

## Composants

| Nom | Description |
|---|---|
| `StudioShell` | Mise en page (barre latérale 284 px masquable + page), raccourcis, suivi du mode, abonnements aux événements (`engine.*`, `studio.*`), lanceur des mises à jour (`useUpdateRunner`, module `updates`), dialogues, visionneuse (`StudioLightbox`), dépôt d'images sur la fenêtre en mode image (`ImageDropLayer`), `ConfirmHost`, bandeau et garde-fous de la génération privée (`PrivateBanner`, `PrivateHost`, module `private` ; son bouton est dans `SidebarFooter`). |
| `Sidebar` | Marque (`custom.app.name`), masquage, `ModeSwitch`, pages du mode (`NavItem` ; le chat n'a que « Nouvelle conversation »), `SearchField`, `ConversationList` (en mode chat, les extraits des messages qui contiennent la recherche, `chat/ChatSearchHits`), `SidebarFooter`. |
| `ModeSwitch` | `Tabs` MUI en commande segmentée (image, audio, vidéo, chat) ; revient à la dernière page du mode. |
| `NavItem` | Entrée de navigation (lien), raccourci visible au survol. |
| `SearchField` | Champ de recherche, 200 ms d'attente, Échap efface, ⌘K focalise. |
| `ConversationList` / `ConversationItem` | Groupes par période (épinglées, aujourd'hui, hier, 7 et 30 jours, mois), vignette ou icône, point « occupé », menu (épingler, renommer, supprimer), renommage par double clic. `SelectionBar` (« Sélectionner ») bascule la liste en mode sélection : cases à cocher, compteur, tout (dé)sélectionner, suppression groupée après confirmation ; seules les conversations encore listées comptent (recherche ou changement de mode ne suppriment rien hors de vue). États : chargement, vide (par mode), aucun résultat, erreur avec « Réessayer ». |
| `SidebarFooter` | Carte du moteur (`EngineCard`, module `studio-core`), Modèles (`ModelsDialog`), Vérifier les mises à jour (`UpdatesDialog`, module `updates`), Réglages (`SettingsDialog`), `SwitchLanguage`, bascule clair/sombre. |
| `ComingSoonPage` | Page provisoire (le `ComingSoonDialog` a disparu avec H4.2 : plus aucun dialogue provisoire). |

Les composants génériques viennent du gabarit (lot I) : `TipIconButton`, `Kbd`, `confirm`/`ConfirmHost`.

## Types principaux

`StudioMode` (`'image' | 'audio' | 'video' | 'chat'`), `ConversationSummary` (forme du moteur : `updated_at` en secondes, `cover.thumb_url`,
`generation_count`, `busy`, `pinned`), `Conversation<TMessage>` (+ `messages`, typés par `studio-core` : `ConversationDetail`), `ConversationPatch`,
`StudioRouteDef`, `PeriodKey`, `ShortcutAction`, `CacheEffect`.

## Internationalisation

Toutes les chaînes sont dans `locales/locales.{fr,en}.json` (clés `studio.*`) ; le français reprend l'ancienne interface à
l'identique, l'anglais est rédigé. Le gabarit ne charge que les locales de `modules_shared` : `src/locales/registerModuleLocales.ts`
(importé par `main.tsx`) charge `src/modules/*/locales` et `src/themes/*/locales` (`i18n.add` fusionne avec les locales distantes).
Pas de `defaultLabel` : une clé manquante s'affiche telle quelle. Les composants utilisent `useT()` (re-rendu au changement de langue).
Contrôle : `npm run i18n:check` (front) ; `locales/locales.spec.ts` vérifie la parité fr/en et les marqueurs `{n}`.

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`, supprimé en H6 : `git show 2435ab3:frontend/src/…`) | Nouveau |
|---|---|
| `App.tsx` (mise en page, raccourcis, `useModeSync`) | `components/StudioShell`, `hooks/useShortcuts`, `hooks/useModeSync` |
| `App.tsx` (`useFileDrop`, surcouche de dépôt) | image : `image-studio` (`ImageDropLayer`, H4.3b) ; audio : `voices` (`VoiceDropLayer`, H4.5) ; vidéo : `video-studio` (`VideoDropLayer`, H4.6) |
| `App.tsx` (`Toaster` sonner) | `ToastZone` (react-toastify) du gabarit, dans `Router` |
| `components/Sidebar.tsx` : `Sidebar` | `components/Sidebar` |
| `Sidebar.tsx` : `ModeSwitch` | `components/ModeSwitch` |
| `Sidebar.tsx` : `NavButton` | `components/NavItem` |
| `Sidebar.tsx` : recherche (+ ⌘K) | `components/SearchField` |
| `Sidebar.tsx` : liste, groupes (`periodOf`) | `components/ConversationList`, `lib/periods` |
| `Sidebar.tsx` : `ConversationItem` (+ menu Radix) | `components/ConversationItem` (menu MUI) |
| `Sidebar.tsx` : pied (`EngineCard`, Modèles, Réglages, thème) | `components/SidebarFooter` ; `EngineCard` : module `studio-core` (H4.3b) |
| `components/ui.tsx` : `IconButton`, `Tip`, `Kbd`, `InfoTip`, `HelpBody` | `TipIconButton`, `Tooltip`, `Kbd`, `InfoTip`, `HelpBody` de `common` (lot I) |
| `ui.tsx` : `Button`, `Spinner` | `Button`, `CircularProgress` MUI (thème) |
| `ui.tsx` : `Mark` | `components/Mark` |
| `components/Confirm.tsx` | `confirm()` / `ConfirmHost` de `common` |
| `lib/router.ts` (History API) | `react-router-dom` + `lib/routes.ts` |
| `lib/store.ts` (partie coquille) | `state/studioStore.ts` (reste : H4) |
| `lib/queries.ts` : `useConversations`, `useConversation`, flux | `hooks/useConversations`, `hooks/useEngineEventSync`, `lib/eventEffects` ; événements de conversations : `studio-core` (`useStudioEvents`) |
| `lib/format.ts` : `periodOf`, `formatTime`, `cx` | `lib/periods` ; `cx` : inutile (`sx`) ; autres formats : H4 |
| `lib/composer.ts` : `focusComposer`, `registerComposer` | `lib/focusRegistry` |
| `components/SettingsDialog.tsx` | module `settings` (H4.1) |
| `components/ModelsDialog.tsx` | module `model-catalog` (`ModelsDialog`, H4.2) |
| `styles.css` | `front/src/themes/chambre-noire/` |

## Dépendances

`react-router-dom`, `@mui/material`, `@mui/icons-material`, `@tanstack/react-query`, `zustand`, `react-toastify` (messages d'erreur) ;
de `common` : `core/events` (`eventStreamClient`), `core/http/HttpService`, `core/i18n`, `components/ui/{iconbutton,kbd,confirm,theme,languages}`.

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/studio-shell/lib/periods.spec.ts
```

`lib/{periods,shortcuts,routes,eventEffects}.spec.ts`, `services/studioHttp.spec.ts`, `state/studioStore.spec.ts`,
`locales/locales.spec.ts`, et pour le thème `themes/chambre-noire/{tokens,muiTheme}.spec.ts`, `themes/modeStorage.spec.ts`,
`locales/mergeLocaleFiles.spec.ts`. Logique pure seulement (environnement Node, pas de DOM) : le rendu des composants n'est pas testé.

## Points d'extension

- Remplacer une page : `routes.tsx` (`pageOf`) ; un mode ajoute son adaptateur dans `pages/ConversationPage.tsx`. Ajouter une route : `STUDIO_ROUTES` (+ clé de titre dans les locales).
- Nouveaux sujets d'événements : `ENGINE_TOPICS` et `effectOfEvent` (`lib/eventEffects.ts`, avec test).
- État client : tranches ajoutées à `useStudioStore`.
