# Module `voices` (front)

## Rôle

La **bibliothèque de voix** côté navigateur : la page « Mes voix » (`/audio/voix`), le **studio de voix** (enregistrer au micro avec un texte de lecture,
importer un fichier, nommer, choisir la langue, **transcrire automatiquement puis corriger la transcription**, aperçu, enregistrer, modifier),
le dépôt d'un son sur la fenêtre en mode audio et la mise à jour en direct de la liste. Les voix elles-mêmes sont dans Nest (`back/src/modules/audio-studio/README.md`) ;
le moteur prépare le clip de référence (mono 24 kHz, silences retirés, 30 s au plus) et propose la transcription. Tâche H4.5.

Le module ne connaît ni modèle ni composeur : « Écrire avec cette voix » est un rappel (`onUse`) que la page fournit (module `audio-studio`).
`audio-studio` dépend de `voices` (sélecteur de voix, « garder comme voix de référence »), jamais l'inverse.

## Structure

```
voices/
  index.ts                         exports
  types.ts                         Voice, VoiceRef, VoiceKind, VoiceTranscription, VoicePatch, VoiceStudioTarget
  services/voicesApi.ts            GET/POST /voices, POST /voices/from-asset, PATCH/DELETE /voices/:id, POST /voices/:id/transcribe (testé)
  hooks/useVoices.ts               la liste (staleTime 1 min) + useVoiceEvents (studio.voices.changed et resync : relecture)
  hooks/useVoiceStudio.ts          état du studio : échantillon, aperçu, brouillon, enregistrement, enregistrer / transcrire
  hooks/useVoiceActions.ts         suppression avec confirmation
  hooks/useVoiceDrop.ts            dépôt sur la fenêtre en mode audio (classifyDrop de media-library)
  state/voiceStudioStore.ts        ouverture du studio (Zustand : un fichier déposé, ou une voix à modifier) (testé)
  lib/voiceForm.ts                 règles pures : nom proposé, trop court, premier son d'un dépôt, corps de création et de mise à jour, enregistrable (testé)
  lib/voiceMeta.ts                 teinte de l'avatar, faits sous le nom, citation (testé)
  lib/recording.ts                 indice pendant l'enregistrement, raison d'un micro inutilisable (testé)
  lib/reading.ts                   langues d'un échantillon, texte à lire (fr, en) repris à l'identique (testé)
  lib/voiceHelp.ts, voiceKeys.ts, fieldStyles.ts
  components/                      VoicesLibrary, VoiceCard, VoiceStudioDialog (+ RecordingPanel, TranscriberInstall, StudioFields), SamplePlayer, VoiceAvatar, VoiceDropLayer
  locales/                         locales.fr.json, locales.en.json (clés voices.*)
```

Montage : `studio-shell/pages/VoicesPage.tsx` (page mince : `VoicesLibrary` + `useWriteWithVoice` d'`audio-studio`) ; `StudioShell` monte `VoiceStudioDialog`,
`useVoiceEvents` et, en mode audio, `VoiceDropLayer`.

## Studio de voix

| Étape | Comportement |
|---|---|
| Choix de la source | « Enregistrer » (micro : `useMicRecorder` de `common`, conversion en WAV mono) ou « Importer un fichier » (WAV, MP3, M4A, FLAC, OGG…, `audio/*`, mp4, webm) ; un son déposé sur la fenêtre ouvre le studio sur lui |
| Enregistrement | anneau de niveau autour du micro, durée, indice (« continuez, 15 à 30 s c'est idéal » avant 8 s, « c'est largement assez » après 30 s), « Terminer », **texte à lire** dans la langue choisie (français, sinon anglais) ; le texte à lire pré-remplit la transcription |
| Aperçu | lecteur sur le lecteur partagé de l'onglet (lecture/pause, onde cliquable, horloge) ; « Choisir un autre extrait » tant que la voix n'est pas créée ; avertissement au-delà de 30 s |
| Nom, langue | nom (80 caractères), langue parlée (11 langues) avec aide |
| Transcription | champ **modifiable** ; « Transcrire automatiquement » (le moteur propose un texte, que l'on corrige ; si aucun modèle n'est installé : message et « l'installer (≈ 0,5 Go) » qui lance Whisper Small et son moteur) ; la voix est créée à la première demande (le moteur lit le clip enregistré), puis seulement mise à jour ; le texte proposé est enregistré avec la voix, puis tout ce que contient le champ l'est à « Enregistrer » |
| Enregistrer | « Ajouter à mes voix » (nouvelle) / « Enregistrer » (modification) ; message « Voix « X » enregistrée » ; désactivé sans extrait, sans nom, pendant une opération ou avec un extrait connu pour durer moins d'une seconde |

## Liste de parité (anciens `VoicesPage.tsx`, `VoiceStudio.tsx`, `VoicePicker.tsx` pour l'avatar, `Waveform.tsx`)

Cases cochées = vérifiées par la logique testée et le rendu côté serveur (`audio-studio/components/render.smoke.spec.ts`) ; **le rendu visuel et le son restent à valider** (liste en fin de fichier).

**Page « Mes voix »**
- [x] Titre « Mes voix », compteur « N voix », bouton « Ajouter une voix ».
- [x] Chargement : indicateur centré ; vide : médaillon micro, « Donnez-leur *votre* voix », explication, « Enregistrer ma voix ».
- [x] Cartes en une colonne, deux à partir de `md`, largeur 1000 px.
- [x] Carte : avatar (micro, teinte du nom), nom tronqué, faits (« voix clonée » / « voix inventée », langue en majuscules, durée, « sans transcription » en alerte), modifier, supprimer (info-bulles), lecteur (lecture/pause « Écouter »/« Pause », onde cliquable), citation sur deux lignes (transcription, sinon description), « Écrire avec cette voix ».
- [x] Suppression avec confirmation : « Supprimer cette voix ? » + « « X » : l'enregistrement de référence sera supprimé. Les prises déjà générées avec cette voix sont conservées. » (écart : le nom est dans le message, pas dans le titre, `confirm()` n'acceptant pas de paramètre dans le titre).
- [x] « Écrire avec cette voix » : voir `audio-studio` (`useWriteWithVoice`).

**Studio de voix**
- [x] Titre « Nouvelle voix » / « Modifier la voix », fermer.
- [x] Deux grands choix (Enregistrer, Importer un fichier) avec leur légende ; micro refusé / absent / indisponible : légende d'alerte, bouton désactivé (nouveau : « aucun micro détecté », « l'enregistrement n'a pas pu démarrer »).
- [x] « Extrait de référence » avec info-bulle et trois conseils (10 à 30 secondes… ; voix claire… ; ne clonez que votre propre voix…).
- [x] Enregistrement : voir le tableau ; texte à lire en français / anglais (autre langue : anglais).
- [x] Aperçu et durée, « Choisir un autre extrait », avertissement au-delà de 30 s, « Extrait trop court : il faut au moins une seconde de parole. » (message et blocage).
- [x] Nom (placeholder « Ma voix », 80 caractères), langue parlée avec l'aide « Langue parlée » ; nom par défaut tiré du nom du fichier.
- [x] Transcription : libellé et info-bulle « Transcription de l'extrait », indication « Facultative ; améliore le clonage. », « Transcrire automatiquement » (chargement), « Pré-remplie avec le texte proposé : corrigez-la si vous avez lu autre chose. », notice « Aucun modèle de transcription installé (voir Modèles → Audio) · l'installer (≈ 0,5 Go) » (« téléchargement… » pendant le téléchargement).
- [x] Boutons Annuler / « Ajouter à mes voix » ou « Enregistrer », indicateur d'enregistrement.
- [x] Modifier une voix existante : nom, langue et transcription repris, lecteur sur l'échantillon enregistré.
- [x] Dépôt d'un son sur la fenêtre en mode audio : ouvre le studio ; surcouche « Déposez un enregistrement » ; autre fichier : « Déposez un fichier audio (WAV, MP3, M4A, FLAC, OGG…). » (seulement quand aucun fichier n'est un son).

**Temps réel** : `studio.voices.changed` relit la liste (création, modification, suppression depuis un autre onglet ou depuis une prise).

**Écarts** : titre de confirmation sans le nom de la voix ; états du micro plus fins (refusé, aucun micro, erreur) ; l'aperçu passe par le lecteur partagé de `common` (un seul son à la fois dans l'onglet, comme avant) ; la conversion en WAV d'un enregistrement ou d'un import est celle de `common` (`toMonoWavFile`).

**À valider à l'œil et à l'oreille** : enregistrement réel au micro (autorisation, niveau, durée, conversion en WAV), lecture de l'aperçu et des cartes, forme de l'onde, rendu du studio (largeur, défilement, deux colonnes des champs), du dialogue de suppression, de la page vide ; transcription réelle (Whisper installé), installation de Whisper depuis le studio ; dépôt d'un fichier audio sur la fenêtre.

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/voices/lib/voiceForm.spec.ts
```

`lib/{voiceForm,voiceMeta,recording}.spec.ts`, `services/voicesApi.spec.ts`, `state/voiceStudioStore.spec.ts`, `locales/locales.spec.ts` ; le rendu côté serveur de la page et d'une carte est dans
`audio-studio/components/render.smoke.spec.ts` (pas de DOM : le studio, fermé, n'y est pas rendu).
