# Module `video-studio` (front)

## Rôle

Le **studio vidéo** : l'accueil (« Que voulez-vous tourner ? »), le **composeur** (emplacements source / départ / fin, durée, format et définition, réglages du modèle, graine,
nombre de clips, `ModelPicker` vidéo, avis de licence et d'accès restreint), les **messages** (clips avec lecteur natif, actions au survol, état d'avancement par étapes), la
**bibliothèque vidéo** (`/video/bibliotheque`), le **dépôt** d'images et de vidéos sur la fenêtre, les actions de la **visionneuse** propres à la vidéo, et l'adaptateur de mode qui branche
tout cela sur le fil de `studio-core`. Les badges de modèle (tâches, durée maximale, définitions, son, anglais), l'avertissement de licence et l'avis d'accès restreint (ex-`VideoInfo.tsx`)
sont dans `model-catalog` (H4.2) et réutilisés ici. Back : `back/src/modules/studio-core/README.md` (`POST /api/messages`, jobs vidéo) ; moteur : `engine/app/job_plans.py`. Tâche H4.6.

## Structure

```
video-studio/
  index.ts                         exports : VideoHome, VideoGallery, VideoDropLayer, VideoViewerActions, useVideoInputs, videoStudioAdapter, useVideoDraftStore
  videoStudioAdapter.tsx           le ModeAdapter de la vidéo (composeur, message, reprise d'un prompt avec ses entrées)
  types.ts                         VideoSlot (start | end | source), VideoUpload (import en cours)
  state/videoDraftStore.ts         brouillon : prompt, départ, fin, source, imports, réglages par modèle, nombre de clips, graine (Zustand, `cn-video-composer`)
  hooks/useVideoComposer.ts        tout ce que montre et envoie le composeur : paramètres effectifs, entrées, emplacements, état d'envoi, avis, submit
  hooks/useVideoInputs.ts          ce qui remplit les emplacements : fichiers (avec progression), asset, clip comme source, dernière image comme départ ; change de modèle au besoin
  hooks/useSendVideo.ts            envoi (écrit les deux messages au cache ; depuis l'accueil, charge la conversation puis l'ouvre)
  hooks/useVideoDrop.ts            dépôt sur la fenêtre (règles de `media-library/lib/dropRules.ts`)
  lib/videoMath.ts                 formats, nombre d'images (n × pas + 1), taille de sortie, paramètres effectifs bornés au modèle, nombre de passages d'un clip enchaîné (`runCount`) et raison de la limite de durée (`durationLimitKey`) (testé)
  lib/slots.ts                     types de fichiers, modèle de remplacement, emplacement d'un asset, plan d'un import (testé)
  lib/composerRules.ts             exigences, ce qui bloque l'envoi et info-bulle du bouton, avis, emplacements affichés et leur rôle (testé)
  lib/sendRequest.ts               corps de POST /api/messages (testé)
  lib/clips.ts                     cellules d'une génération, mise en page, ligne d'état (étapes du moteur comprises), réglages repris (testé)
  lib/videoHelp.ts                 info-bulles (durée, format, définition, nombre de clips, emplacements avec l'état du modèle), textes de départ (testé)
  lib/videoDraftActions.ts         « Reprendre dans le composeur » (prompt + entrées), « Reprendre ces réglages »
  lib/frameCapture.ts              image d'une vidéo (canvas, dans le navigateur) ; lib/dropTarget.ts : emplacement visé par un dépôt ; lib/playback.ts : une seule vidéo à la fois
  components/                      VideoHome, VideoComposer, SlotTile, VideoPickers (DurationPicker : curseur borné au maximum du modèle, avec la raison du maximum et, pour un clip enchaîné, le nombre de tranches ; FormatPicker, ClipCountPicker), VideoAssistantMessage (+ VideoStatusLine,
                                   VideoMessageFooter), ClipTile (+ ClipActions, PendingClip), VideoGallery, VideoDropLayer, VideoViewerActions
  locales/                         locales.fr.json, locales.en.json (clés videoStudio.*)
```

Montage : `studio-shell/pages/{VideoHomePage,VideoLibraryPage,ConversationPage}.tsx` (pages minces) ; `ConversationPage` passe `{ image, audio, video: videoStudioAdapter }` à `ConversationView` ;
`StudioShell` monte `VideoDropLayer` en mode vidéo et passe `VideoViewerActions` à `StudioLightbox` (`modeActions`).

## Entrées du clip

| Emplacement | Pour qui | Comportement |
|---|---|---|
| Vidéo source | modèle de montage (`video_input` ≠ `none`) | une vidéo existante que le modèle modifie ; le réglage « Influence de la vidéo » (`strength`) n'est envoyé que si une source est jointe |
| Image de départ (ou « de référence » si `image_role = reference`) | `image_input` ≠ `none` | requise (avertissement) si `image_input = required` et pas de source ; sert de première image, ou de référence de sujet |
| Image de fin | `last_frame` | demande l'image de départ (avis sinon) |

Un emplacement s'affiche si le modèle l'accepte **ou** s'il contient encore quelque chose (on peut le retirer ; il apparaît alors « ignorée », grisé, avec l'avis correspondant). Un fichier arrive par le trombone
(images et vidéos), le collage dans le prompt, le glisser-déposer **sur un emplacement** (il y est rangé) ou sur la fenêtre (rangement automatique : la première vidéo en source, jusqu'à deux images en départ puis en fin si le modèle a
une image de fin). Si le modèle actif ne sait pas utiliser l'entrée, l'application passe à un modèle compatible (prêt d'abord, le plus léger ensuite) et le dit. Dans le job, l'ordre des fichiers est : départ, fin, source ;
le moteur décide de la tâche (`i2v`, `v2v`, `t2v`) d'après ce qui est joint et de ce que le modèle accepte (`engine/app/job_plans.py`).

## Messages et clips

`VideoAssistantMessage` : modèle, ligne d'état (en file · position N ; chargement du modèle · m:ss · téléchargement possible ; étape n/total · clip i/N · ~durée restantes, ou, tant qu'aucune étape n'est comptée,
« téléchargement du décodeur rapide (23 Mo)… », « décodage de la vidéo (peut durer plusieurs minutes)… » / « décodage rapide de la vidéo… », « encodage MP4… », « échantillonnage… » ; ensuite taille · durée · étapes · généré en · heure),
la grille de clips (un seul : large ; deux : deux colonnes ; clip fini : lecteur natif avec affiche, boucle ; emplacement en attente : plateau avec point, libellé et barre), l'erreur (encadré), « Génération annulée. »,
le pied : Annuler pendant le calcul ; ensuite « Varier » (nouvelles graines), mêmes graines, reprendre les réglages dans le composeur (graine fixée, entrées comprises), menu « … » (par clip : utiliser comme vidéo source,
dernière image comme départ, télécharger ; copier le prompt, copier les graines ; supprimer la génération avec confirmation). Au survol d'un clip : favori (à gauche), source, dernière image, télécharger (MP4), agrandir (à droite).
Lancer un clip met les autres en pause. « Dernière image comme départ » prend l'image dans le navigateur (`lib/frameCapture.ts`), l'envoie comme asset (`POST /api/assets`), la met en départ et vide la fin et la source.

## Liste de parité (anciens `VideoHome.tsx`, `VideoComposer.tsx`, `VideoMessage.tsx`, `VideoGallery.tsx`, `VideoInfo.tsx`, `lib/video.ts`, partie vidéo de `lib/help.ts`, `Lightbox.tsx`, `App.tsx`)

Cases cochées = vérifiées par la logique testée (`lib/*.spec.ts`) et le rendu côté serveur (`components/render.smoke.spec.ts`) ; **le rendu visuel, la lecture et les interactions restent à valider** (liste en fin de fichier).

**Accueil**
- [x] Surtitre « Studio vidéo local », titre « Que voulez-vous *tourner* ? », sous-titre, halo.
- [x] Carte du premier lancement (`WelcomeSetup` vidéo), composeur « héros » (3 lignes).
- [x] Quatre textes de départ (Paysage, Portrait, Urbain, Animation), textes à l'identique ; un clic remplit le composeur et le focalise.
- [x] « Derniers clips » : jusqu'à dix affiches (16:9, 96 px de haut) avec la durée ; un clic ouvre la visionneuse sur la liste.

**Composeur**
- [x] Trois emplacements (vidéo source, image de départ ou de référence, image de fin), affichés selon le modèle ; requis en avertissement, « option » sinon ; info-bulle (nom, requise / facultative, explication, état pour ce modèle, rôle de référence, conseil) ; clic, glisser-déposer sur l'emplacement, collage.
- [x] Import avec progression réelle (pourcentage et barre) ; miniature (ouvre la visionneuse), étiquette (« source » avec icône, « départ », « réf. », « fin »), « ignorée » grisée, bouton retirer au survol.
- [x] Trombone avec son info-bulle (images et vidéos, plusieurs fichiers) ; coller des fichiers dans le prompt.
- [x] Prompt : Entrée envoie, Maj+Entrée saute une ligne (pas pendant une composition IME), le champ grandit jusqu'à 40 % de la fenêtre (`/` le focalise), trois textes d'aide selon le cas (montage, depuis une image, scène).
- [x] Modèle non prêt : `SetupPrompt` ; sur l'accueil la carte du premier lancement la remplace. Licence (avertissement) et accès restreint sous le prompt.
- [x] Avis : modèle incompatible (texte du moteur), note du plan, source requise, départ requis, fin sans départ, départ / fin / source ignorés, anglais (avec « ? »), bande son (avec « ? »).
- [x] Barre : `ModelPicker` (badges et avertissements : `model-catalog`), durée (curseur de 0,5 s, « N images · i/s », durée réelle quand elle diffère), format (5 formes, définition du modèle, taille de sortie ≈ L × H), réglages du modèle + graine (`GenerationParams` de `studio-core`), clips 1 ou 2, « ⇧↵ nouvelle ligne », Générer.
- [x] Bouton Générer : désactivé sans prompt, modèle non prêt ou incompatible, source ou départ manquant, import en cours ; info-bulle selon la raison, raccourci ↵ ; après l'envoi le prompt et les emplacements sont vidés ; depuis l'accueil la conversation s'ouvre.
- [x] Corps envoyé : paramètres effectifs, graine, références dans l'ordre départ / fin (si départ) / source, seulement celles que le modèle utilise, `strength` retiré sans source, deux clips au plus.
- [x] Changement de modèle quand l'entrée n'est pas acceptée (prêt d'abord, le plus léger ensuite), avec message.
- [x] États : modèle en chargement (indicateur), serveur injoignable (« Serveur injoignable — le backend est-il démarré ? »).

**Messages**
- [x] Avatar, nom du modèle, ligne d'état (voir plus haut), grille de clips, emplacements en attente (libellé : chargement du modèle, étape n/total, préparation…, en attente), erreur, annulation.
- [x] Clip : lecteur natif (affiche, boucle, métadonnées seulement avant lecture), animation « développement » d'un clip de moins de 8 s, une seule lecture à la fois ; ratio réel du clip dès que connu.
- [x] Actions au survol : favori (cœur plein / vide), vidéo source, dernière image comme départ, télécharger (`<slug>-<seed>.mp4`), agrandir.
- [x] Pied : Annuler ; Varier (info-bulle), mêmes graines (info-bulle), reprendre les réglages (« Réglages repris (graine fixée) » ; reprend aussi départ, fin et source du prompt), menu « Plus d'actions » (voir plus haut), supprimer (confirmation « Supprimer cette génération ? » / « Les vidéos produites seront supprimées. »).
- [x] Message de l'utilisateur : miniatures des entrées (la vidéo marquée « vidéo »), copier le prompt, reprendre dans le composeur (prompt et entrées), supprimer (`studio-core`).
- [x] Temps réel : `studio.message.updated`, `studio.job.progress` (dont `stage`), `studio.job.image` (clip ajouté), `studio.asset.*`, `studio.queue.updated` (position exacte).

**Bibliothèque `/video/bibliotheque`**
- [x] Titre « Bibliothèque », compteur « N clips », filtre « Filtrer par prompt », bouton Favoris.
- [x] Tuile : affiche au ratio du clip, aperçu muet en boucle au survol, durée, prompt au survol, actions du clip (favori, source, dernière image, télécharger) ; un clic ouvre la visionneuse sur les clips chargés.
- [x] États : chargement, vide (« Aucune vidéo générée pour l'instant. », favoris, recherche), erreur avec « Réessayer », pagination infinie, mise à jour en direct (module `media-library`).

**Visionneuse (vidéo)**
- [x] Pour un clip : vidéo source, dernière image comme départ (ferment la visionneuse, remplissent l'emplacement, ramènent à l'accueil vidéo depuis la bibliothèque) ; pour une image en mode vidéo : « Utiliser comme image de départ » ; favori (`F`), télécharger, infos (`I` : prompt, modèle, durée, i/s, taille, graine…), supprimer la vidéo (`studio-core`).

**Dépôt vidéo** (règles de H4.4 : `media-library/lib/dropRules.ts`)
- [x] Déposer sur la fenêtre en mode vidéo : voile « Déposez une image ou une vidéo », images et vidéos rangées (une image en départ puis en fin, une vidéo en source) ; avertissement quand aucun fichier ne convient ; sur un emplacement : rangé là ; avertissements « Certains fichiers ont été ignorés… », « Une seule vidéo source à la fois… », « Seules deux images… ».

**Badges, licence, accès** (module `model-catalog`, H4.2)
- [x] Badges des tâches (texte → vidéo, image → vidéo, montage), durée maximale, définitions, « avec son », « anglais », chacun avec son info-bulle ; avertissement de licence ; avis d'accès restreint (avec l'état du jeton) ; dans le sélecteur de modèle, le dialogue Modèles et sous le prompt.

**Écarts**
- Le prompt négatif, quand le modèle en a un, se saisit sous le prompt (`NegativePromptField` de `studio-core`), pas dans les réglages.
- Le bouton ✨ de la barre du composeur (`EnhancePromptButton` du module `chat`) réécrit le prompt avec le modèle de chat et garde l'original ; le composeur prend aussi le texte qu'une réponse du chat lui envoie (`usePromptHandoff('video', …)`).
- Les réglages du modèle et la graine passent par `GenerationParams`, **remonté dans `studio-core`** (écart de H4.3b / H4.5 soldé) ; son bouton affiche « Réglages » pour l'audio et la vidéo (comme avant), le nombre d'étapes pour l'image.
- « Reprendre ces réglages » n'enregistre plus les valeurs que le moteur recalcule (`frames`, `fps`, `task`), qui s'ajoutaient aux réglages du modèle sans servir.
- Les actions de la visionneuse propres à la vidéo s'appliquent à tout clip, quel que soit le mode affiché (avant : idem) ; elles sont fournies par `video-studio` à `StudioLightbox` (`modeActions`) pour que `studio-core` ne dépende pas de la vidéo.
- Le brouillon est propre au mode (`cn-video-composer`) ; les anciennes préférences (`cn-prefs`) ne sont pas reprises (comme pour l'image et l'audio).
- L'avatar d'un message est l'icône MUI « clap » (`MovieCreationOutlined`) au lieu de celle de lucide.
- La capture d'une image demande la vidéo avec `crossOrigin = 'anonymous'` : en développement (front 5173, back 3000) elle dépend de l'en-tête CORS du back sur `/api/media` (non vérifié) ; empaqueté, tout est de la même origine.
- Les messages d'erreur du serveur, le texte de la note du plan et l'`engine_reason` ne sont pas traduits.

**À valider à l'œil** (aucun navigateur lancé) : lecture réelle des clips (contrôles natifs, pause des autres, affiche, boucle, 16:9 et 9:16), animation « développement », plateau et barre d'un clip en attente, mise en page de la grille (un clip / deux),
composeur (rangée d'emplacements, tuiles requises / facultatives / ignorées, progression d'un import, champ du prompt, popovers de durée et de format), accueil (textes de départ, derniers clips), bibliothèque (colonnes, aperçu au survol, actions), visionneuse (boutons vidéo),
glisser-déposer sur un emplacement et sur la fenêtre, capture de la dernière image (canvas, CORS en développement), téléchargement MP4 ; génération réelle (départ, fin, source, nombre de clips, décodage rapide) avec un modèle.

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire (`render.smoke.spec.ts` : 3 Go) :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/video-studio/lib/clips.spec.ts
```

`lib/{videoMath,slots,composerRules,sendRequest,clips,videoHelp,frameCapture,dropTarget,playback}.spec.ts`, `state/videoDraftStore.spec.ts`, `locales/locales.spec.ts`,
`components/render.smoke.spec.ts` (rendu côté serveur de l'accueil, du composeur dans plusieurs cas de modèle, des emplacements, des sélecteurs fermés, du fil vidéo, de chaque ligne d'état, des clips et de la bibliothèque ; pas de DOM : interactions, lecture,
popovers et capture d'image ne sont pas exercés ; un store Zustand est lu à son état initial, d'où les vues présentationnelles testées par leurs propriétés).
