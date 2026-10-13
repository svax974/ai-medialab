# Module `studio-core` (front)

## Rôle

Le **fil de conversation** commun aux trois studios et ce qui l'entoure : conversation ouverte (titre modifiable, compteur, défilement),
messages de l'utilisateur et générations de l'assistant, progression en direct avec aperçus, états de la machine d'état des messages
(en file, chargement, calcul, terminé, erreur, annulé), relance (nouvelles variantes ou mêmes graines), annulation, suppression, vignettes
et leurs actions, visionneuse d'images, carte d'état du moteur dans la barre latérale, et **application des événements `studio.*` au cache**.
Seule la génération d'**images** est dessinée ici (`AssistantMessage`) ; l'audio et la vidéo apportent leur `ModeAdapter` avec H4.5 et H4.6.
Back : `back/src/modules/studio-core/README.md` (routes, file des générations, machine d'état, événements). Tâche H4.3b.

## Structure

```
studio-core/
  index.ts                         exports
  types.ts                         Asset, Message, MessageStatus, GenParams, JobProgress, ConversationDetail, SendMessageRequest/Response...
  services/messagesApi.ts          POST /messages, POST /messages/:id/retry, POST /messages/:id/cancel, DELETE /messages/:id
  services/assetsApi.ts            GET /assets (images récentes), POST /assets (multipart, HttpService.upload), PATCH /assets/:id (favori), DELETE /assets/:id
  hooks/useStudioEvents.ts         abonnement aux sujets studio.* et application au cache (monté par StudioShell)
  hooks/useMessageActions.ts       relance, annulation, suppression (confirmation)
  hooks/useAssetActions.ts         favori, suppression depuis la visionneuse
  hooks/useNow.ts                  horloge (secondes) rafraîchie chaque seconde tant qu'un chargement dure
  lib/messageState.ts              logique pure : états, cellules d'une génération, mise en page, ligne d'état, position en file,
                                   réglages repris, nom de fichier (testé)
  lib/studioEvents.ts              logique pure : événement studio.* vers opérations sur le cache (testé)
  lib/engineState.ts               logique pure : ce que montre la carte du moteur (testé)
  lib/viewerDetails.ts             logique pure : lignes « Détails » de la visionneuse (testé)
  lib/paramHelp.ts                 info-bulles des paramètres génériques (PARAM_HELP) + paramHelp(spec, kind, t) (testé)
  lib/draftActions.ts              actions sur le brouillon : utiliser comme référence, reprendre un prompt, reprendre des réglages (testé)
  lib/scroll.ts                    défilement du fil, édition du titre (testé)
  lib/format.ts, clipboard.ts, assetDrag.ts, studioKeys.ts, modeAdapter.ts
  state/liveStore.ts               progression en direct par message (Zustand)
  state/lightboxStore.ts           liste et position de la visionneuse (Zustand)
  state/imageDraftStore.ts         brouillon du composeur image (Zustand, persisté sous `cn-composer`)
  components/                      ConversationView, TitleEditor, UserMessage, AssistantMessage, StatusLine, MessageFooter, ImageTile (+ TileActions,
                                   DevelopingTile), StudioLightbox, EngineCard, HelpTooltip (+ LabelTooltip)
  locales/                         locales.fr.json, locales.en.json (clés thread.*)
```

## API publique

`ConversationView({ id, adapters })`, `AssistantMessage`, `EngineCard`, `StudioLightbox`, `useStudioEvents`, `useToggleFavorite`,
`addAsReference` / `reuseUserMessage` / `reuseGenerationSettings` (actions sur le brouillon), `PARAM_HELP` / `paramHelp`, `HelpTooltip` / `LabelTooltip`,
`messagesApi`, `assetsApi`, `assetKeys`, `upsertMessage`, `useImageDraftStore`, `useLightboxStore`, `useLiveStore`, `ModeAdapter`, types.

`ModeAdapter` (`lib/modeAdapter.ts`) : ce qu'un mode branche sur le fil : `Composer`, `AssistantMessage`, `reuseUserMessage`. La page
`/c/:id` (`studio-shell/pages/ConversationPage.tsx`) passe `{ image: imageStudioAdapter }` ; une conversation d'un mode sans adaptateur (audio, vidéo)
affiche « Ce type de conversation sera repris… » sans composeur.

## Données et événements

- **Conversation** : `useConversation(id)` (module `studio-shell`, clé `['conversation', id]`) ; 404 : message « Conversation introuvable. » et retour à l'accueil.
- **Sujets `studio.*`** (publiés par Nest ; charges utiles dans `back/src/modules/studio-core/README.md`) : `lib/studioEvents.ts` les traduit en opérations,
  `hooks/useStudioEvents.ts` les applique :

  | Sujet | Effet |
  |---|---|
  | `studio.job.progress` | fusion dans `liveStore` (étape, total, image courante, durée restante, aperçu) |
  | `studio.message.updated` | message inséré ou remplacé dans la conversation en cache (tri par date puis id) ; hors `queued`/`loading`/`running` : progression effacée et listes relues |
  | `studio.job.image` | image ajoutée au message (sans doublon, par ordre de production) ; assets relus |
  | `studio.message.deleted` | messages retirés de la conversation |
  | `studio.conversation.updated` | résumé fusionné (titre, épingle, vignette, compteur, occupé) sans toucher aux messages ; listes relues |
  | `studio.conversation.deleted` | conversation retirée du cache ; listes et assets relus |
  | `studio.asset.updated` | asset remplacé partout où il apparaît (références, sorties, listes d'assets, visionneuse) |
  | `studio.asset.deleted` | conversation et assets relus |

  Les relectures de listes sont regroupées sur 250 ms. Une reprise de flux impossible (`resync`) relit conversations et assets. Le cache n'est écrit que
  pour une conversation déjà chargée. `engine.*` (modèles, installateurs, statut du moteur) reste traité par `studio-shell/lib/eventEffects.ts` : le moteur
  ne connaît plus les conversations, les sujets `engine.conversation.*` et `engine.message.*` ne sont plus écoutés.
- **Envoi** : voir `image-studio` (`useSendMessage`) ; la réponse du serveur est écrite au cache sans attendre l'événement.

## États d'un message (`lib/messageState.ts`)

| État | Affichage |
|---|---|
| `queued` | « en file d'attente » (+ « position N » à partir de la deuxième : voir écarts), cellules « en attente », bouton Annuler |
| `loading` | « chargement du modèle en mémoire · m:ss » (+ « téléchargement possible » si le modèle n'est pas installé), Annuler |
| `running` | « étape n/total » (ou « préparation… »), « image i/n » s'il y en a plusieurs, « ~durée restantes » ; la cellule courante « se développe » (aperçu flouté et teinté qui s'éclaircit avec la fraction, barre fine), les suivantes attendent ; Annuler |
| `done` | taille, étapes, références, durée, heure ; images avec animation de « développement » si elles ont moins de 8 s ; Varier, mêmes graines, plus d'actions |
| `error` | encadré rouge avec le message du serveur (ou « Erreur inconnue. ») |
| `cancelled` | « Génération annulée. » si aucune image n'a été produite ; les images produites restent |

Actions du pied : **Varier** (nouvelles graines), **mêmes graines**, menu « plus » (reprendre ces réglages : modèle, paramètres, nombre d'images et première graine fixée ;
copier le prompt ; copier les graines ; supprimer avec confirmation). Message utilisateur : copier le prompt, reprendre dans le composeur (prompt et références), supprimer
(emporte les générations).

## Vignettes et visionneuse

Une vignette (`ImageTile`) : miniature (le fichier complet pour les grands écrans), clic pour ouvrir la visionneuse, glissable vers la fenêtre (devient une référence), et au survol : favori
(en haut à gauche), utiliser comme référence / télécharger / agrandir (en haut à droite), graine (en bas à gauche).
`StudioLightbox` (monté par `StudioShell`) : composant `Lightbox` de `common` ; actions : utiliser comme référence, favori (`F`), télécharger ; panneau de détails (bascule `I`) : prompt (copiable),
modèle, fichier, taille, graine (copiable, avec info-bulle), étapes, guidance, influence, durée de calcul, date ; ouvrir la conversation ; supprimer l'image (confirmation).
La galerie complète est la tâche H4.4. `I` agit en pressant le bouton « Détails » du `Lightbox` commun (qui n'a pas de raccourci propre).

## Carte du moteur (`EngineCard`)

Dans le pied de la barre latérale (`studio-shell/SidebarFooter`) : point d'état, nom du modèle, détail. Chargement (« Chargement du modèle » + horloge), génération (« en cours », « rendu vidéo en cours »),
prêt (« N bits · en mémoire » ou « en mémoire » ; bouton « Décharger le modèle » avec message de confirmation), rien de chargé (« chargé à la demande ») ; « N en attente » selon la file du moteur.
Hooks `useEngineStatus` / `useUnloadEngine` du module `hardware` ; le statut est relu à chaque `engine.engine.status`.

## Info-bulles

Textes de `frontend/src/lib/help.ts` repris à l'identique en français (`thread.help.*` : `steps`, `guidance`, `negative_prompt`, `strength`, `seed`, `fast_decode`, `count_images`) ; `paramHelp(spec, kind, t)` ajoute la
remarque du modèle (« Ce modèle : … », écrite par le moteur, donc non traduite) sauf quand elle répète le texte générique. Les textes propres à l'image sont dans `image-studio`
(`imageStudio.help.*`) ; ceux de l'audio et de la vidéo arrivent avec H4.5 et H4.6. Info-bulles du fil : « Nouvelles variantes (graines aléatoires) », « Relancer avec les mêmes graines » (avec explication).

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`) | Nouveau |
|---|---|
| `components/ConversationView.tsx` : vue, `TitleEditor`, défilement | `components/ConversationView`, `TitleEditor`, `lib/scroll` |
| `components/Message.tsx` : `UserMessage` | `components/UserMessage` |
| `Message.tsx` : `AssistantMessage`, `StatusLine`, `MessageFooter` | `components/AssistantMessage`, `StatusLine`, `MessageFooter`, `lib/messageState` |
| `Message.tsx` : `ImageTile`, `TileActions`, `DevelopingTile` | `components/ImageTile` |
| `Message.tsx` : `copy`, `download` | `lib/clipboard` (`copyText`, `downloadAsset`), `lib/messageState` (`downloadName`) |
| `components/EngineCard.tsx` | `components/EngineCard`, `lib/engineState` (`useNow` : `hooks/useNow`) |
| `components/Lightbox.tsx` (images) | `components/StudioLightbox` sur le `Lightbox` de `common` (vidéo : H4.6) |
| `lib/queries.ts` : `upsertMessage`, `useServerEvents` (partie conversations) | `lib/studioEvents`, `hooks/useStudioEvents` |
| `lib/store.ts` : `progress`, `lightbox`, brouillon du composeur image | `state/liveStore`, `state/lightboxStore`, `state/imageDraftStore` |
| `lib/composer.ts` : `addAsReference`, `uploadFiles` | `lib/draftActions`, `image-studio/lib/uploadReferences` |
| `lib/help.ts` (paramètres génériques) | `lib/paramHelp`, locales `thread.help.*` |
| `lib/api.ts` : `send`, `retry`, `cancel`, `deleteMessage`, `assets`, `patchAsset`, `deleteAsset`, `upload` | `services/messagesApi`, `services/assetsApi` |

## Écarts avec l'ancienne interface

- **Position dans la file** : la file des générations est dans Nest et n'est pas publiée ; le moteur ne voit qu'une génération à la fois (`GET /api/status` : `queue` vide ou presque). « position N » est donc
  calculée parmi les messages en attente **de la même conversation** (borne basse : les autres conversations ne sont pas connues) et « N en attente » de la carte du moteur ne compte que la file du moteur.
- Les messages d'erreur sont ceux du serveur (français, non traduits en anglais) ; les remarques « Ce modèle : … » viennent du moteur.
- Les messages (`toast`) passent par react-toastify ; la visionneuse est celle de `common` (barre d'actions et panneau latéral du composant commun ; l'index de vignettes, le zoom au clic et les flèches y sont aussi).
- Libellé du favori de la visionneuse : « Ajouter aux favoris » / « Retirer des favoris » (l'ancien disait « Favori »).
- Une conversation audio ou vidéo ouverte avant H4.5/H4.6 affiche un avis au lieu du fil.
- Les fonctions de l'ancienne visionneuse propres à la vidéo (source, dernière image) et à la galerie arrivent avec H4.4 et H4.6.

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/studio-core/lib/messageState.spec.ts
```

`lib/{messageState,studioEvents,engineState,viewerDetails,paramHelp,draftActions,scroll,format,assetDrag}.spec.ts`, `services/services.spec.ts`, `state/stores.spec.ts`,
`locales/locales.spec.ts` ; le rendu côté serveur de l'écran est vérifié par `image-studio/components/render.smoke.spec.ts` (pas de DOM : voir le README d'`image-studio`).
