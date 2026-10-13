# Module `studio-shell`

## Rôle

Coquille du studio dans le nouveau front : barre latérale (mode image / audio / vidéo, pages du mode, recherche et liste des
conversations épinglées et groupées par période, modèles, réglages, langue, thème clair/sombre), mise en page, raccourcis
clavier, routes conservées de l'ancienne interface, cache de données serveur (TanStack Query), état client (Zustand) et
abonnement au flux d'événements du moteur. Les écrans eux-mêmes (composeurs, conversation, galeries, voix, modèles,
réglages) sont de **pages minces « à venir »** que les tâches H4 remplacent ; les dialogues Réglages et Modèles sont
vides (H4.1, H4.2).

Module d'application (`front/src/modules/`), pas un module partagé. Thème : `front/src/themes/chambre-noire/README.md`.

## Structure

```
studio-shell/
  index.ts                 exports : StudioShell, StudioProviders, studioRoutes, matchStudioRoute
  StudioProviders.tsx      QueryClientProvider (client : state/queryClient.ts)
  routes.tsx               studioRoutes (PluginRoute[], layout 'fullscreen') pour components/Router.tsx
  types.ts                 StudioMode, ConversationSummary, Conversation, ConversationPatch
  components/              StudioShell, Sidebar, ModeSwitch, NavItem, SearchField, ConversationList, ConversationItem,
                           SidebarFooter, ComingSoonDialog, Mark, modeIcons
  pages/                   ComingSoonPage, ConversationPage (pages provisoires)
  hooks/                   useConversations (requêtes + actions), useEngineEventSync, useModeSync, useShortcuts, useT
  lib/                     logique pure : periods, shortcuts, routes, eventEffects, queryKeys, focusRegistry
  services/                studioHttp (proxy transitoire), conversationsApi
  state/                   studioStore (Zustand), queryClient
  locales/                 locales.fr.json, locales.en.json (+ registre : src/locales/registerModuleLocales.ts)
```

Montage : `App.tsx` (`AppMuiTheme` > ... > `StudioProviders`), `components/Router.tsx` (`...studioRoutes`),
`components/PageLayout.tsx` (une page du studio est rendue dans `StudioShell`, sans l'en-tête ni la barre latérale du
gabarit ; la coquille reste montée d'une page à l'autre, donc la recherche et la liste persistent).

## Routes

| Chemin | Page (provisoire) | Mode | Tâche qui la remplit |
|---|---|---|---|
| `/` | Nouvelle création | image | H4.3 |
| `/c/:id` | Conversation (titre chargé) | de la conversation | H4.3 |
| `/galerie` | Galerie | image | H4.4 |
| `/audio` | Nouvel audio | audio | H4.5 |
| `/audio/voix` | Mes voix | audio | H4.5 |
| `/audio/bibliotheque` | Bibliothèque audio | audio | H4.5 |
| `/video` | Nouvelle vidéo | vidéo | H4.6 |
| `/video/bibliotheque` | Bibliothèque vidéo | vidéo | H4.6 |

Table unique : `lib/routes.ts` (`STUDIO_ROUTES`, `studioPaths`, `matchStudioRoute`). Pour remplacer une page : changer l'`element`
de sa route dans `routes.tsx` (ou passer un `lazy`).

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/conversations?mode=&q=` | Liste du mode, filtrée par la recherche (proxy transitoire vers le moteur). |
| `GET` | `/api/conversations/:id` | Conversation et messages (mode de la page, titre). |
| `PATCH` | `/api/conversations/:id` | Épingler (`pinned`) ou renommer (`title`). |
| `DELETE` | `/api/conversations/:id` | Supprimer. |
| `GET` | `/api/events/stream?topics=engine.conversation.updated,…` | Flux d'événements (brique commune `eventStreamClient`). |

Les appels passent par `httpService` (`skipTransport: true` : le proxy relaie du JSON en clair) ; l'URL de base est celle de
`configurationService.getApiUrl()` sans le suffixe `/v1` (`studioApiBase()`), car le proxy transitoire est sous `/api/<segment>`
(`back/src/modules/engine/README.md`). Chaque tâche H4 reprend ses routes dans un module Nest (`getApiUrl('<module>')`) et les retire du proxy.
Les médias du moteur (`/media/...`) sont servis sous `/api/media/...` : `resolveMediaUrl`.

## Données et temps réel

- **TanStack Query** (écart assumé au gabarit, lot H) : clés dans `lib/queryKeys.ts` (`conversations`, `conversation`).
  Défauts : `staleTime` 30 s, pas de rechargement au focus (le flux d'événements invalide), un nouvel essai.
- **Flux d'événements** (`hooks/useEngineEventSync.ts`, monté par `StudioShell`) : abonnement aux sujets
  `engine.conversation.updated`, `engine.conversation.deleted`, `engine.message.updated`, `engine.message.deleted`,
  `engine.link` (relais du moteur par Nest). `lib/eventEffects.ts` traduit chaque événement en invalidations/retraits du cache
  (regroupés sur 250 ms) ; `engine.link` revenu à `connected: true` et la trame `resync` rechargent tout. Quand le flux est
  indisponible (`fallback`), la liste se relit au montage ; les composants H4 ajoutent leurs sujets dans `ENGINE_TOPICS` et leurs effets.
- **Actions** (`useConversationActions`) : épingler/renommer en mise à jour optimiste avec retour arrière et message d'erreur
  (react-toastify) ; supprimer avec confirmation (`confirm()` de `common`) puis retour à l'accueil du mode si la conversation était ouverte.
- **Zustand** (`state/studioStore.ts`) : `mode`, `lastPathByMode` (dernière page par mode, pour la bascule), `sidebarOpen`
  (persisté sous `cn-prefs`, comme avant), `settingsOpen`, `modelsOpen`. Les modules H4 y ajoutent leurs tranches.

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
| `StudioShell` | Mise en page (barre latérale 284 px masquable + page), raccourcis, suivi du mode, abonnement aux événements, dialogues, `ConfirmHost`. |
| `Sidebar` | Marque (`custom.app.name`), masquage, `ModeSwitch`, pages du mode (`NavItem`), `SearchField`, `ConversationList`, `SidebarFooter`. |
| `ModeSwitch` | `Tabs` MUI en commande segmentée ; revient à la dernière page du mode. |
| `NavItem` | Entrée de navigation (lien), raccourci visible au survol. |
| `SearchField` | Champ de recherche, 200 ms d'attente, Échap efface, ⌘K focalise. |
| `ConversationList` / `ConversationItem` | Groupes par période (épinglées, aujourd'hui, hier, 7 et 30 jours, mois), vignette ou icône, point « occupé », menu (épingler, renommer, supprimer), renommage par double clic. États : chargement, vide (par mode), aucun résultat, erreur avec « Réessayer ». |
| `SidebarFooter` | Modèles, Réglages (dialogues vides), `SwitchLanguage`, bascule clair/sombre. |
| `ComingSoonDialog` / `ComingSoonPage` | Dialogue et page provisoires. |

Les composants génériques viennent du gabarit (lot I) : `TipIconButton`, `Kbd`, `confirm`/`ConfirmHost`.

## Types principaux

`StudioMode` (`'image' | 'audio' | 'video'`), `ConversationSummary` (forme du moteur : `updated_at` en secondes, `cover.thumb_url`,
`generation_count`, `busy`, `pinned`), `Conversation` (+ `messages: unknown[]`, typés par H4), `ConversationPatch`,
`StudioRouteDef`, `PeriodKey`, `ShortcutAction`, `CacheEffect`.

## Internationalisation

Toutes les chaînes sont dans `locales/locales.{fr,en}.json` (clés `studio.*`) ; le français reprend l'ancienne interface à
l'identique, l'anglais est rédigé. Le gabarit ne charge que les locales de `modules_shared` : `src/locales/registerModuleLocales.ts`
(importé par `main.tsx`) charge `src/modules/*/locales` et `src/themes/*/locales` (`i18n.add` fusionne avec les locales distantes).
Pas de `defaultLabel` : une clé manquante s'affiche telle quelle. Les composants utilisent `useT()` (re-rendu au changement de langue).
Contrôle : `npm run i18n:check` (front) ; `locales/locales.spec.ts` vérifie la parité fr/en et les marqueurs `{n}`.

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`) | Nouveau |
|---|---|
| `App.tsx` (mise en page, raccourcis, `useModeSync`) | `components/StudioShell`, `hooks/useShortcuts`, `hooks/useModeSync` |
| `App.tsx` (`useFileDrop`, surcouche de dépôt) | **non repris** : dépend des composeurs (H4.3-H4.6) |
| `App.tsx` (`Toaster` sonner) | `ToastZone` (react-toastify) du gabarit, dans `Router` |
| `components/Sidebar.tsx` : `Sidebar` | `components/Sidebar` |
| `Sidebar.tsx` : `ModeSwitch` | `components/ModeSwitch` |
| `Sidebar.tsx` : `NavButton` | `components/NavItem` |
| `Sidebar.tsx` : recherche (+ ⌘K) | `components/SearchField` |
| `Sidebar.tsx` : liste, groupes (`periodOf`) | `components/ConversationList`, `lib/periods` |
| `Sidebar.tsx` : `ConversationItem` (+ menu Radix) | `components/ConversationItem` (menu MUI) |
| `Sidebar.tsx` : pied (`EngineCard`, Modèles, Réglages, thème) | `components/SidebarFooter` ; `EngineCard` : H4.3 |
| `components/ui.tsx` : `IconButton`, `Tip`, `Kbd`, `InfoTip`, `HelpBody` | `TipIconButton`, `Tooltip`, `Kbd`, `InfoTip`, `HelpBody` de `common` (lot I) |
| `ui.tsx` : `Button`, `Spinner` | `Button`, `CircularProgress` MUI (thème) |
| `ui.tsx` : `Mark` | `components/Mark` |
| `components/Confirm.tsx` | `confirm()` / `ConfirmHost` de `common` |
| `lib/router.ts` (History API) | `react-router-dom` + `lib/routes.ts` |
| `lib/store.ts` (partie coquille) | `state/studioStore.ts` (reste : H4) |
| `lib/queries.ts` : `useConversations`, `useConversation`, flux | `hooks/useConversations`, `hooks/useEngineEventSync`, `lib/eventEffects` |
| `lib/format.ts` : `periodOf`, `formatTime`, `cx` | `lib/periods` ; `cx` : inutile (`sx`) ; autres formats : H4 |
| `lib/composer.ts` : `focusComposer`, `registerComposer` | `lib/focusRegistry` |
| `components/SettingsDialog.tsx`, `ModelsDialog.tsx` | `ComingSoonDialog` (H4.1, H4.2) |
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

- Remplacer une page : `routes.tsx`. Ajouter une route : `STUDIO_ROUTES` (+ clé de titre dans les locales).
- Nouveaux sujets d'événements : `ENGINE_TOPICS` et `effectOfEvent` (`lib/eventEffects.ts`, avec test).
- État client : tranches ajoutées à `useStudioStore`.
