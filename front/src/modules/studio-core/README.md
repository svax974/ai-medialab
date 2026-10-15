# Module `studio-core` (front)

## Rôle

Le **fil de conversation** commun aux trois studios et ce qui l'entoure : conversation ouverte (titre modifiable, compteur, défilement),
messages de l'utilisateur et générations de l'assistant, progression en direct avec aperçus, états de la machine d'état des messages
(en file, chargement, calcul, terminé, erreur, annulé), relance (nouvelles variantes ou mêmes graines), annulation, suppression, vignettes
et leurs actions, visionneuse d'images, carte d'état du moteur dans la barre latérale, et **application des événements `studio.*` au cache**.
Seule la génération d'**images** est dessinée ici (`AssistantMessage`) ; l'audio (`audio-studio`, H4.5) et la vidéo (`video-studio`, H4.6) apportent leur `ModeAdapter`. Les **réglages du modèle et la graine** (`GenerationParams`, H4.6) sont communs aux trois composeurs.
Back : `back/src/modules/studio-core/README.md` (routes, file des générations, machine d'état, événements). Tâche H4.3b.

## Structure

```
studio-core/
  index.ts                         exports
  types.ts                         Asset, Message, MessageStatus, GenParams, JobProgress, ConversationDetail, SendMessageRequest/Response...
  services/messagesApi.ts          POST /messages, POST /messages/:id/retry, POST /messages/:id/cancel, DELETE /messages/:id, GET /queue,
                                   GET /messages/model-usage
  services/assetsApi.ts            (déplacé dans `media-library` en H4.4 ; types `Asset`, `AssetPage` réexportés par `types.ts`)
  hooks/useStudioEvents.ts         abonnement aux sujets studio.* et application au cache (monté par StudioShell)
  hooks/useMessageActions.ts       relance, annulation, suppression (confirmation)
  hooks/useAssetActions.ts         favori, suppression depuis la visionneuse
  components/StudioModelPicker.tsx sélecteur de modèle des composeurs, classé par usage (`ModelPicker` + `useModelUsage` de `model-catalog` ; la clé `model-usage` est invalidée ici à la fin ou à la suppression d'une génération), suivi du bouton « Nouveautés » (`WhatsNewButton` de `model-catalog`) (`onSelect` : ce qu'un choix fait en plus, par exemple le chat qui garde le modèle dans les réglages de la conversation ; le chat l'utilise aussi, pour le type `llm`)
  components/NegativePromptField.tsx ligne « À éviter » sous le prompt (image, vidéo) pour les modèles qui ont un `negative_prompt`,
                                   que `toParamsSchema` retire alors du panneau de réglages (`NEGATIVE_PROMPT`)
  hooks/useNow.ts                  horloge (secondes) rafraîchie chaque seconde tant qu'un chargement dure
  lib/messageState.ts              logique pure : états, cellules d'une génération, mise en page, ligne d'état, position en file (`queueIndex`),
                                   réglages repris, nom de fichier (testé)
  lib/studioEvents.ts              logique pure : événement studio.* vers opérations sur le cache (testé)
  lib/engineState.ts               logique pure : ce que montre la carte du moteur (testé)
  lib/viewerDetails.ts             logique pure : lignes « Détails » de la visionneuse (testé)
  lib/paramHelp.ts                 info-bulles des paramètres génériques (PARAM_HELP) + paramHelp(spec, kind, t) (testé)
  lib/paramsSchema.ts              schéma du formulaire commun d'après les paramètres d'un modèle, valeurs connues, détection du « Valeurs par défaut » (testé)
  lib/viewerActionsMode.ts         mode dont les actions de la visionneuse s'appliquent à un asset (testé)
  lib/draftActions.ts              actions sur le brouillon : utiliser comme référence, reprendre un prompt, reprendre des réglages (testé)
  lib/scroll.ts                    défilement du fil, édition du titre (testé)
  lib/format.ts, clipboard.ts, assetDrag.ts, studioKeys.ts, modeAdapter.ts
  state/liveStore.ts               progression en direct par message (Zustand)
  state/queueStore.ts              file des générations (message courant, messages en attente), tenue à jour par studio.queue.updated (Zustand)
  (lightboxStore : déplacé dans `media-library`, la galerie ouvre la même visionneuse)
  state/imageDraftStore.ts         brouillon du composeur image (Zustand, persisté sous `cn-composer`)
  state/promptHandoffStore.ts      texte qu'un studio laisse au compositeur d'un autre (le chat → image, vidéo, audio ; en mémoire seulement) ; hooks/usePromptHandoff.ts : le compositeur cible le prend à l'affichage
  components/                      ConversationView, TitleEditor, UserMessage, AssistantMessage, StatusLine, MessageFooter, ImageTile (+ TileActions,
                                   DevelopingTile), StudioLightbox, GenerationParams (réglages + graine, commun aux trois modes), EngineCard, HelpTooltip (+ LabelTooltip)
  locales/                         locales.fr.json, locales.en.json (clés thread.*)
```

## API publique

`ConversationView({ id, adapters })` (ne dessine pas le mode chat : son fil est celui du module `chat`, choisi par `ConversationPage`), `AssistantMessage`, `EngineCard`, `StudioLightbox({ modeActions })`, `GenerationParams`, `toParamsSchema` / `paramValues` / `isFullReset`, `useStudioEvents`, `useModelUsage` (réexporté de `model-catalog`, qui le porte), `StudioModelPicker`, `NegativePromptField`, `useToggleFavorite`,
`addAsReference` / `reuseUserMessage` / `reuseGenerationSettings` (actions sur le brouillon), `PARAM_HELP` / `paramHelp`, `HelpTooltip` / `LabelTooltip`,
`messagesApi`, `upsertMessage`, `useImageDraftStore`, `usePromptHandoff`, `usePromptHandoffStore`, `useLiveStore`, `useQueueStore` (`assetsApi`, `assetKeys` et `useLightboxStore` sont dans `media-library`), `ModeAdapter`, types.

`ModeAdapter` (`lib/modeAdapter.ts`) : ce qu'un mode branche sur le fil : `Composer`, `AssistantMessage`, `reuseUserMessage`. La page
`/c/:id` (`studio-shell/pages/ConversationPage.tsx`) passe `{ image: imageStudioAdapter, audio: audioStudioAdapter, video: videoStudioAdapter }` ; une conversation d'un mode sans adaptateur
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
  | `studio.asset.updated` | asset remplacé partout où il apparaît (références, sorties, listes d'assets dont les pages de la galerie, visionneuse) |
  | `studio.asset.deleted` | asset retiré des listes et de la visionneuse ; conversation et assets relus |
  | `studio.queue.updated` | `queueStore` : `{ current, queue }` (messages en attente dans l'ordre d'exécution, toutes conversations) ; lu aussi au chargement et après une reprise de flux (`GET /api/queue`) |

  Les relectures de listes sont regroupées sur 250 ms. Une reprise de flux impossible (`resync`) relit conversations et assets. Le cache n'est écrit que
  pour une conversation déjà chargée. `engine.*` (modèles, installateurs, statut du moteur) reste traité par `studio-shell/lib/eventEffects.ts` : le moteur
  ne connaît plus les conversations, les sujets `engine.conversation.*` et `engine.message.*` ne sont plus écoutés.
- **Envoi** : voir `image-studio` (`useSendMessage`) ; la réponse du serveur est écrite au cache sans attendre l'événement.

## États d'un message (`lib/messageState.ts`)

| État | Affichage |
|---|---|
| `queued` | « en file d'attente » (+ « position N » à partir de la deuxième : rang dans la file de Nest, toutes conversations), cellules « en attente », bouton Annuler |
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
La galerie complète est dans `media-library` (H4.4) : elle ouvre cette visionneuse sur les assets chargés. `I` agit en pressant le bouton « Détails » du `Lightbox` commun (qui n'a pas de raccourci propre).

## Carte du moteur (`EngineCard`)

Dans le pied de la barre latérale (`studio-shell/SidebarFooter`) : point d'état, nom du modèle, détail. Chargement (« Chargement du modèle » + horloge), génération (« en cours », « rendu vidéo en cours »),
prêt (« N bits · en mémoire » ou « en mémoire » ; bouton « Décharger le modèle » avec message de confirmation), rien de chargé (« chargé à la demande ») ; « N en attente » = messages en attente dans la file de Nest (toutes conversations) plus les jobs que le moteur est seul à lister (ancienne interface), comptés une fois.
Hooks `useEngineStatus` / `useUnloadEngine` du module `hardware` ; le statut est relu à chaque `engine.engine.status`.

## Info-bulles

Textes de `frontend/src/lib/help.ts` (supprimé en H6) repris à l'identique en français (`thread.help.*` : `steps`, `guidance`, `negative_prompt`, `strength`, `seed`, `fast_decode`, `count_images`) ; `paramHelp(spec, kind, t)` ajoute la
remarque du modèle (« Ce modèle : … », écrite par le moteur, donc non traduite) sauf quand elle répète le texte générique. Les textes propres à l'image sont dans `image-studio`
(`imageStudio.help.*`) ; ceux de l'audio : `thread.help.{speed,temperature,count_takes}` (H4.5) et `audioStudio.help.*` ; ceux de la vidéo : `thread.help.strength_video` (l'influence de la vidéo source, H4.6) et `videoStudio.help.*`. Info-bulles du fil : « Nouvelles variantes (graines aléatoires) », « Relancer avec les mêmes graines » (avec explication).

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`, supprimé en H6 : `git show 2435ab3:frontend/src/…`) | Nouveau |
|---|---|
| `components/ConversationView.tsx` : vue, `TitleEditor`, défilement | `components/ConversationView`, `TitleEditor`, `lib/scroll` |
| `components/Message.tsx` : `UserMessage` | `components/UserMessage` |
| `Message.tsx` : `AssistantMessage`, `StatusLine`, `MessageFooter` | `components/AssistantMessage`, `StatusLine`, `MessageFooter`, `lib/messageState` |
| `Message.tsx` : `ImageTile`, `TileActions`, `DevelopingTile` | `components/ImageTile` |
| `Message.tsx` : `copy`, `download` | `lib/clipboard` (`copyText`, `downloadAsset`), `lib/messageState` (`downloadName`) |
| `components/EngineCard.tsx` | `components/EngineCard`, `lib/engineState` (`useNow` : `hooks/useNow`) |
| `components/Lightbox.tsx` | `components/StudioLightbox` sur le `Lightbox` de `common` ; la barre d'actions propre à un mode (vidéo : source, dernière image, image de départ) est fournie par `modeActions` (`StudioShell` y passe `VideoViewerActions`) |
| `components/ParamsPopover.tsx` | `components/GenerationParams` + `lib/paramsSchema` (remontés d'`image-studio` en H4.6 ; le bouton montre les étapes pour l'image et « Réglages » pour l'audio et la vidéo, la graine et le cadenas partout) |
| `lib/queries.ts` : `upsertMessage`, `useServerEvents` (partie conversations) | `lib/studioEvents`, `hooks/useStudioEvents` |
| `engine.queue` (statut du moteur) | `state/queueStore` (`studio.queue.updated`) |
| `lib/store.ts` : `progress`, `lightbox`, brouillon du composeur image | `state/liveStore`, `state/lightboxStore`, `state/imageDraftStore` |
| `lib/composer.ts` : `addAsReference`, `uploadFiles` | `lib/draftActions`, `image-studio/lib/uploadReferences` |
| `lib/help.ts` (paramètres génériques) | `lib/paramHelp`, locales `thread.help.*` |
| `lib/api.ts` : `send`, `retry`, `cancel`, `deleteMessage`, `assets`, `patchAsset`, `deleteAsset`, `upload` | `services/messagesApi`, `services/assetsApi` |

## Écarts avec l'ancienne interface

- **Position dans la file** : exacte depuis H4.4. Nest publie la file (`studio.queue.updated`) ; « position N » est le rang du message dans la file globale (le premier en attente n'affiche pas de position, comme avant) ; tant que la file n'est pas connue (premier chargement), aucune position n'est affichée.
- Les messages d'erreur sont ceux du serveur (français, non traduits en anglais) ; les remarques « Ce modèle : … » viennent du moteur.
- Les messages (`toast`) passent par react-toastify ; la visionneuse est celle de `common` (barre d'actions et panneau latéral du composant commun ; l'index de vignettes, le zoom au clic et les flèches y sont aussi).
- Libellé du favori de la visionneuse : « Ajouter aux favoris » / « Retirer des favoris » (l'ancien disait « Favori »).
- L'audio a son fil depuis H4.5 (`audio-studio`) et la vidéo depuis H4.6 (`video-studio`).
- La galerie et la liste de la visionneuse sont dans `media-library` (H4.4) ; les actions de la visionneuse propres à la vidéo (source, dernière image) sont dans `video-studio` (`VideoViewerActions`), branchées par la propriété `modeActions` de `StudioLightbox` : un clip reçoit toujours les actions vidéo, une image reçoit celles du mode affiché (« utiliser comme référence » par défaut).

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/studio-core/lib/messageState.spec.ts
```

`lib/{messageState,studioEvents,engineState,viewerDetails,paramHelp,draftActions,scroll,format,assetDrag}.spec.ts`, `services/services.spec.ts`, `state/stores.spec.ts` (live, file, brouillon),
`locales/locales.spec.ts` ; le rendu côté serveur de l'écran est vérifié par `image-studio/components/render.smoke.spec.ts` (pas de DOM : voir le README d'`image-studio`).
