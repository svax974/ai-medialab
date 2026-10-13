# Module `audio-studio` (front)

## Rôle

Le **studio audio** : l'accueil (« Que voulez-vous faire entendre ? »), le **composeur** (texte ou dialogue avec distribution des voix, voix, langue, consigne de style ou description de voix,
réglages du modèle, graine, nombre de prises, lecture automatique, `ModelPicker` audio), les **messages** (prises avec lecteur partagé et forme d'onde, repères des personnages, vitesse, favori,
téléchargement WAV, garder comme voix de référence, supprimer), la **galerie audio** (`/audio/bibliotheque`) et l'adaptateur de mode qui branche tout cela sur le fil de `studio-core`.
Les voix (bibliothèque, studio, dépôt d'un son) sont dans le module `voices`. Back : `back/src/modules/studio-core/README.md` (`POST /api/messages`, jobs audio) et
`back/src/modules/audio-studio/README.md` (voix). Tâche H4.5.

## Structure

```
audio-studio/
  index.ts                         exports : AudioHome, AudioGallery, TakeCard, audioStudioAdapter, useWriteWithVoice, useAudioDraftStore
  audioStudioAdapter.tsx           le ModeAdapter de l'audio (composeur, message, reprise d'un texte)
  hooks/useAudioComposer.ts        tout ce que montre et envoie le composeur : paramètres, langue, voix, personnages et distribution, durée estimée, état d'envoi, avis, submit
  hooks/useSendAudio.ts            envoi (écrit les deux messages au cache ; depuis l'accueil, charge la conversation puis l'ouvre)
  hooks/useTakeActions.ts          téléchargement WAV, « garder comme voix », suppression avec confirmation
  hooks/useAutoplayFirstTake.ts    lecture automatique de la première prise d'un message qui vient d'être produite
  hooks/useWriteWithVoice.ts       « Écrire avec cette voix » (bouton de la bibliothèque de voix)
  state/audioDraftStore.ts         brouillon : texte, par modèle (réglages, voix, langue, style), distribution, prises, lecture auto, graine (Zustand, `cn-audio-composer`)
  lib/audioText.ts                 durée estimée, durée approchée, personnages d'un dialogue (testé)
  lib/voiceChoice.ts               voix intégrées, langue par défaut, voix effective, distribution automatique (testé)
  lib/composerRules.ts             ce qui bloque l'envoi, info-bulle du bouton, avis (testé)
  lib/sendRequest.ts               corps de POST /api/messages (testé)
  lib/takes.ts                     méta d'une prise, cellules d'un message, étiquette, couleurs, repères, nom de fichier, lecture auto, voix depuis une prise, réglages repris (testé)
  lib/audioStatus.ts               ligne d'état d'un message audio (testé)
  lib/cloner.ts                    modèle à utiliser pour une voix de la bibliothèque (testé)
  lib/audioHelp.ts                 info-bulles et textes de départ ; lib/audioDraftActions.ts : reprise d'un texte, de réglages
  components/                      AudioHome, AudioComposer, AudioAssistantMessage (+ AudioStatusLine, AudioMessageFooter), TakeCard (+ RateMenu, TakeMenu, PendingTake, VoiceSavedToast),
                                   VoicePicker, LanguagePicker, CastPanel, TakesPicker, AutoplayToggle, AudioGallery
  locales/                         locales.fr.json, locales.en.json (clés audioStudio.*)
```

Montage : `studio-shell/pages/{AudioHomePage,AudioLibraryPage,VoicesPage,ConversationPage}.tsx` (pages minces) ; `ConversationPage` passe `{ image, audio: audioStudioAdapter }` à `ConversationView`.

## Composeur

| Élément | Comportement |
|---|---|
| Style / Voix | ligne au-dessus du texte pour un modèle à consigne (« Style ») ou à voix décrite (« Voix », **obligatoire**) ; texte d'aide du modèle en placeholder ; info-bulles |
| Texte | Entrée envoie, Maj+Entrée saute une ligne (pas pendant une composition IME), le champ grandit jusqu'à 40 % de la fenêtre (`/` le focalise), placeholder selon le modèle ; 8000 caractères au plus |
| Compteur | « N caractères · ≈ durée d'audio » (15 caractères par seconde, selon la vitesse) ; « ? » sur la longueur lue d'un seul tenant par le modèle et sur le dialogue |
| Dialogue | deux personnages détectés (« Nom : réplique » en début de ligne) : panneau « Scénario à N voix » avec un sélecteur de voix par personnage (distribution automatique : le premier garde la voix choisie, les autres des voix du genre opposé d'abord) ; « C'est un simple texte » / « Attribuer une voix à chaque personnage » |
| Avis | modèle incompatible (texte du moteur), note du plan, « Ce modèle clone une voix : choisissez ou enregistrez une voix de référence. », texte très long (> 6000) |
| Modèle non prêt | `SetupPrompt` (module `engines`) ; sur l'accueil, la carte du premier lancement (`WelcomeSetup`) la remplace |
| Barre | `ModelPicker`, voix (intégrées par langue / « Mes voix » / « Enregistrer ou importer une voix… » ; modèle à voix décrite : rappel « Voix décrite ci-dessus » ; modèle qui ne clone pas : avertissement), langue (si le modèle en a plusieurs), réglages du modèle + graine (`GenerationParams` d'`image-studio`, voir écarts), prises 1 à 4, lecture automatique, Synthétiser |
| Envoyer | désactivé sans texte, au-delà de 8000, modèle non installé ou incompatible, sans voix, sans description de voix ; info-bulle selon la raison, raccourci ↵ ; après l'envoi le texte est vidé ; depuis l'accueil la conversation s'ouvre |

## Messages et prises

`AudioAssistantMessage` : modèle, ligne d'état (en file · position N ; chargement du modèle · m:ss ; passage n/total · prise i/N · ~durée restantes ; langue · généré en · heure), une carte par prise
ou un emplacement en attente (onde animée qui se remplit, « N % »), erreur (encadré), « Synthèse annulée. », pied : Annuler pendant le calcul ; ensuite « Refaire » (nouvelles graines), mêmes graines, reprendre texte et
réglages dans le composeur (graine fixée), supprimer (confirmation). `TakeCard` : lecture/pause sur le lecteur partagé de l'onglet (une seule prise à la fois), onde cliquable (clavier : flèches, Début, Fin),
horloge, repères colorés des personnages (clic : saut), « prise N · voix · seed », vitesse (0,75 à 2×, globale), favori, télécharger (WAV), menu (garder comme voix de référence, copier le texte, supprimer la prise).
La première prise d'un message produite à l'instant démarre seule si la lecture automatique est active (jamais en rouvrant une ancienne conversation, jamais si un autre son joue).

## Liste de parité (anciens `AudioHome.tsx`, `AudioComposer.tsx`, `AudioMessage.tsx`, `AudioGallery.tsx`, `VoicePicker.tsx`, `Waveform.tsx`, `lib/audio.ts`, `lib/help.ts`)

Cases cochées = vérifiées par la logique testée et le rendu côté serveur (`components/render.smoke.spec.ts`) ; **le rendu visuel et le son restent à valider** (liste en fin de fichier).

**Accueil**
- [x] Surtitre « Studio vocal local », titre « Que voulez-vous faire *entendre* ? », sous-titre, halo.
- [x] Carte du premier lancement (`WelcomeSetup`), composeur « héros » (4 lignes).
- [x] Quatre textes de départ (Narration, Annonce, Dialogue, Publicité), textes à l'identique ; un clic remplit le composeur et le focalise.
- [x] « Dernières prises » : trois prises récentes, début du texte au-dessus, lecteur compact.

**Composeur** : voir le tableau ci-dessus ; en plus
- [x] Info-bulles : Style, Description de la voix, Voix, Langue du texte, Longueur du texte (corps dynamique : « environ N caractères… (8 000 au maximum…) »), Dialogue à plusieurs voix (×2), Nombre de prises, Lecture automatique (titre « activée / désactivée »), vitesse et variabilité (`thread.help.speed`, `thread.help.temperature`).
- [x] Sélecteur de voix : deux onglets (« Voix du modèle » N, « Mes voix » N), lignes avec avatar, nom, ♀/♂, description, onde miniature des voix clonées, coche ; messages vides et d'avertissement ; pied « Enregistrer ou importer une voix… » (ouvre le studio).
- [x] Sélecteur de langue : liste « Langue du texte » avec coche et code.
- [x] Réglages : paramètres du modèle (curseur, interrupteur, texte, « Avancé »), graine (aléatoire / fixée, tirer), point « modifié », cadenas.
- [x] États : modèle en chargement (indicateur), serveur injoignable (« Serveur injoignable — le backend est-il démarré ? »).
- [x] Raccourcis : ↵ envoie, ⇧↵ ligne, `/` focalise le texte.

**Messages**
- [x] Avatar (onde animée pendant le calcul), nom du modèle, ligne d'état (voir plus haut), cartes de prises, emplacements en attente, erreur, annulation.
- [x] Lecture automatique de la première prise fraîche ; animation « développement » d'une prise de moins de 8 s.
- [x] Carte : lecture/pause, onde (clic, glisser, clavier), horloge, repères des personnages colorés (jusqu'à 6 couleurs, clic = saut), étiquette, vitesse, favori (cœur plein/vide), téléchargement WAV (`<slug>-<seed>.wav`), menu.
- [x] Menu : « Garder comme voix de référence » (« Voix créée » pour une voix décrite, « X (copie) » sinon ; message « « X » ajoutée à vos voix » avec « Modifier »), « Copier le texte », « Supprimer la prise » (confirmation « Supprimer cette prise ? » / « Le fichier audio sera supprimé. »).
- [x] Pied : Annuler ; Refaire (info-bulle « Nouvelles prises (graines aléatoires) »), mêmes graines (info-bulle avec explication), reprendre texte et réglages (« Réglages repris (graine fixée) »), « Supprimer la synthèse » (confirmation « Supprimer cette synthèse ? »).
- [x] Message de l'utilisateur : copier le texte, reprendre dans le composeur, supprimer (`studio-core`).
- [x] Temps réel : `studio.message.updated` (prises incluses, formes d'onde comprises : limite d'événement relevée, voir le back), `studio.job.progress`, `studio.job.image` (prise ajoutée), `studio.asset.*`, `studio.queue.updated` (position exacte).

**Bibliothèque `/audio/bibliotheque`**
- [x] Titre « Bibliothèque », compteur « N prises », filtre « Filtrer par texte », bouton Favoris ; colonne unique de 760 px.
- [x] Chaque prise : début du texte (deux lignes) et titre de la conversation au-dessus (clic : ouvre la conversation), carte complète.
- [x] États : chargement, vide (« Aucune prise audio pour l'instant. », favoris, recherche), erreur avec « Réessayer », pagination infinie, mise à jour en direct (module `media-library`).

**Dépôt audio** (règles de H4.4) : voir `voices` (dépôt d'un son = ouvre le studio de voix).

**Écarts**
- Réglages du modèle et graine : composant `GenerationParams` d'`image-studio` (réexporté), à remonter dans `studio-core` avec H4.6 ; son bouton n'affiche pas le nombre d'étapes pour l'audio.
- La langue par défaut suit la langue de l'interface (fr / en), plus le réglage du navigateur.
- Libellés du favori : « Ajouter aux favoris » / « Retirer des favoris » (comme les images).
- Lecteur : composants de `common` (`useSharedAudioPlayer`, `Waveform`, `WaveformPending`) ; la vitesse de lecture est partagée par tout l'onglet (comme avant).
- Les messages d'erreur du serveur, le texte d'aide du modèle (`instruct_help`) et les avis du moteur ne sont pas traduits.

**À valider à l'œil et à l'oreille** : lecture réelle des prises (partage du lecteur entre cartes, lecture automatique, vitesse), forme de l'onde et alignement des repères sur la ligne de temps, animation « développement »,
onde animée et pourcentage pendant le calcul, mise en page de la carte (largeur, ligne d'étiquette, menu), composeur (ligne de style, panneau du scénario, sélecteurs de voix et de langue, hauteur du champ),
accueil (textes de départ, « Dernières prises »), bibliothèque (colonne centrée, en-tête), dépôt audio ; génération réelle (clonage, dialogue, voix décrite) et téléchargement WAV.

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire (`render.smoke.spec.ts` : 3 Go) :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/audio-studio/lib/takes.spec.ts
```

`lib/{audioText,voiceChoice,composerRules,sendRequest,takes,audioStatus,cloner,audioHelp}.spec.ts`, `state/audioDraftStore.spec.ts`, `locales/locales.spec.ts`,
`components/render.smoke.spec.ts` (rendu côté serveur de l'accueil, du fil audio, d'une prise et de ses états, du scénario, des sélecteurs, de la bibliothèque de voix et de sa carte ; pas de DOM : interactions, lecture et popovers ne sont pas exercés).
