# Module `image-studio` (front)

## Rôle

L'**accueil** du studio image (titre, carte du premier lancement, composeur « héros », quatre prompts de départ, derniers tirages) et le **composeur** :
prompt, images de référence (clic, collage, dépôt sur la fenêtre, glisser depuis une vignette), sélecteur de modèle (module `model-catalog`), proportions et définition,
réglages du modèle générés depuis ses paramètres, graine, nombre d'images, envoi. Le fil de conversation, les messages, la progression et la visionneuse sont dans
`studio-core`. Back : `back/src/modules/studio-core/README.md` (`POST /api/messages`) et `media-library` (`POST /api/assets`). Tâche H4.3b.

## Structure

```
image-studio/
  index.ts                       exports : ImageHome, ImageGallery, Composer, ImageDropLayer, imageStudioAdapter
  imageStudioAdapter.tsx         ce que le mode image branche sur le fil de studio-core (composeur, génération, reprise d'un prompt)
  hooks/useSendMessage.ts        envoi (écrit les deux messages au cache ; depuis l'accueil, charge la conversation puis l'ouvre)
  hooks/useImageDrop.ts          dépôt sur la fenêtre : fichiers (useWindowDrop de `common`) et images de la conversation glissées
  lib/size.ts                    ASPECTS, QUALITIES, resolveSize (miroir de `resolve_size` du moteur), définitions visibles (testé)
  lib/params.ts                  paramètres effectifs (définition « Original » et format `auto` avec références), corps `params` d'un message (testé) ; le schéma du formulaire et `GenerationParams` sont dans `studio-core` depuis H4.6
  lib/composerRules.ts           avis du composeur, rôle d'une référence, modèle multi-images de remplacement, état du bouton Générer (testé)
  lib/uploadReferences.ts        import des références (filtre d'images, aperçus, HttpService.upload) (testé)
  lib/sendRequest.ts             corps de POST /api/messages (testé)
  lib/help.ts                    info-bulles propres à l'image, prompts de départ
  components/                    ImageHome, ImageGallery (H4.4 : `AssetGallery` de `media-library` + `ImageTile` de `studio-core`), Composer, ReferenceStrip, AspectPicker, CountPicker, DropOverlay (ImageDropLayer)
  locales/                       locales.fr.json, locales.en.json (clés imageStudio.*)
```

Montage : `studio-shell/pages/{HomePage,ConversationPage,GalleryPage}.tsx` (pages minces) ; `StudioShell` monte `ImageDropLayer` en mode image.

## Composeur

| Élément | Comportement |
|---|---|
| Prompt | Entrée envoie, Maj+Entrée saute une ligne (pas pendant une composition IME), coller des fichiers les importe, le champ grandit jusqu'à 40 % de la fenêtre (`/` le focalise : `registerFocusTarget('composer')`). Placeholder selon les références et le modèle. |
| Références | Vignettes de 72 px avec leur rôle pour le modèle : « départ » (img2img, la 1re), « image N » (édition multi-images), « ignorée » (grisée) ; infobulle explicative ; retrait au survol. Imports en cours : aperçu estompé + indicateur. |
| Avis | Le modèle modifie des images et n'en a aucune ; n'utilise pas les références ; ne part que d'une image ; en accepte N au plus ; ne tourne pas sur cette machine (texte du moteur) ; note du plan (autre chose que « full »). Un bouton « Passer à X (MLX) » propose un modèle qui accepte toutes les images (prêt d'abord, puis le plus léger). |
| Modèle non prêt | `SetupPrompt` (module `engines`) sous le prompt ; sur l'accueil, la carte du premier lancement (`WelcomeSetup`) la remplace. |
| Proportions | Bouton « format · LxH » : 10 formats (+ « Auto » = image de référence, « Libre » = pixels avec arrondi au multiple du modèle et bornes) ; définition Origine (avec référence et Auto) / Brouillon 0,5 / Standard 1 / Haute 1,6 / Très haute 2,3 MP, infobulle de chacune ; sortie « L × H px · x MP ». |
| Réglages | `SchemaParamsPopover` de `common` à partir des `ParamSpec` du modèle (curseur si bornes, interrupteur, texte ; « Avancé » replié ; infobulles de `thread.help.*` + remarque du modèle ; paramètres « avec références » masqués sans référence) ; la graine (aléatoire/fixe, tirer, effacer) est ajoutée après les réglages de base ; le bouton montre les étapes, un cadenas si la graine est fixée, un point si un réglage diffère du défaut. « Valeurs par défaut » libère aussi la graine. |
| Nombre d'images | 1 à 4, infobulle. |
| Envoyer | Désactivé sans prompt, pendant un import ou un envoi, modèle non installé ou incompatible, image de référence requise manquante ; infobulle selon la raison, raccourci ↵. Après l'envoi : prompt et références vidés ; depuis l'accueil la conversation s'ouvre. |

Paramètres effectifs (`lib/params.ts`) : valeurs par défaut du modèle, puis réglages enregistrés (`cn-composer`, par modèle) ; avec références la définition par défaut est « Origine » et le format `auto` ;
sans, `auto` retombe sur 1:1. La graine fixée n'est pas conservée entre deux chargements.

## Dépôt de fichiers

`useImageDrop` (monté par `ImageDropLayer`, en mode image) : fichiers déposés n'importe où sur la fenêtre (`useWindowDrop`, images seulement, les autres ignorés avec un avertissement) et images de la conversation
glissées depuis une vignette (type `application/x-cn-asset`) deviennent des références. Surcouche « Déposez vos images » (`DropVeil` de `media-library`). Envoi par `assetsApi.upload` (`HttpService.upload`, champ multipart `files`).

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`) | Nouveau |
|---|---|
| `components/Home.tsx` | `components/ImageHome` |
| `components/Composer.tsx` : composeur, `RefThumb`, `CountPicker`, avis | `components/Composer`, `ReferenceStrip`, `CountPicker`, `lib/composerRules` |
| `components/AspectPicker.tsx` | `components/AspectPicker`, `lib/size` |
| `components/ParamsPopover.tsx` | `studio-core/components/GenerationParams` (remonté en H4.6) + `SchemaParamsPopover` (`common`), `studio-core/lib/paramsSchema` |
| `lib/size.ts` | `lib/size` |
| `lib/composer.ts` : `uploadFiles`, `effectiveParams`, `registerComposer`/`focusComposer` | `lib/uploadReferences`, `lib/params`, `studio-shell/lib/focusRegistry` |
| `App.tsx` : `useFileDrop`, surcouche | `hooks/useImageDrop`, `components/DropOverlay` |
| `lib/help.ts` (image) | `lib/help`, locales `imageStudio.help.*` |
| `lib/api.ts` : `send`, `upload` | `studio-core/services/{messagesApi,assetsApi}` |

## Écarts avec l'ancienne interface

- Le titre du panneau de réglages est « Réglages » (le formulaire commun n'accepte pas de nom de modèle dans son titre) ; le nombre d'étapes, le cadenas de la graine et le point « modifié » sont dans le bouton.
- « Valeurs par défaut » est repéré à partir de ce que le formulaire commun envoie (tous les champs à leur défaut, au moins deux champs) ; il libère la graine comme l'ancien bouton « Défauts ».
- Le dépôt de fichiers ne s'applique qu'en mode image (comme avant) ; l'audio a le sien depuis H4.5 (module `voices` : un son ouvre le studio de voix) et la vidéo depuis H4.6 (`video-studio` : images et vidéos vers les emplacements du composeur).
- Les libellés des réglages d'un modèle et les remarques « Ce modèle : » viennent du moteur (français).
- Pas de barre de progression de l'envoi des images (l'ancien composeur n'en avait pas non plus pour les images : indicateur seulement).

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire (`render.smoke.spec.ts` : 3 Go) :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/image-studio/lib/size.spec.ts
```

`lib/{size,params,composerRules,uploadReferences,sendRequest}.spec.ts`, `locales/locales.spec.ts`. `components/render.smoke.spec.ts` rend côté serveur (`renderToString`, environnement Node, i18n simulé avec les textes français)
l'accueil, une conversation, un message utilisateur, des générations dans leurs états, la carte du moteur et la bande de références, avec un cache rempli : il détecte les erreurs d'exécution et les clés de texte brutes,
mais **ne remplace pas** la validation visuelle (les magasins Zustand y sont lus à leur état initial, le portail de la visionneuse n'est pas rendu).
