# Module `voices` (front)

## Role

The **voice library** on the browser side: the `Mes voix` (My voices) page (`/audio/voix`), the **voice studio** (record with the microphone using a reading text, import a file, name it, choose the language, **transcribe automatically then correct the transcription**, preview, save, edit),
dropping a sound on the window in audio mode and the live update of the list. The voices themselves live in Nest (`back/src/modules/audio-studio/README.md`);
the engine prepares the reference clip (mono 24 kHz, silences removed, 30 s at most) and proposes the transcription. Task H4.5.

The module knows neither model nor composer: `Écrire avec cette voix` (Write with this voice) is a callback (`onUse`) that the page provides (module `audio-studio`).
`audio-studio` depends on `voices` (voice selector, "keep as reference voice"), never the reverse.

## Structure

```
voices/
  index.ts                         exports
  types.ts                         Voice, VoiceRef, VoiceKind, VoiceTranscription, VoicePatch, VoiceStudioTarget
  services/voicesApi.ts            GET/POST /voices, POST /voices/from-asset, PATCH/DELETE /voices/:id, POST /voices/:id/transcribe (tested)
  hooks/useVoices.ts               the list (staleTime 1 min) + useVoiceEvents (studio.voices.changed and resync: re-read)
  hooks/useVoiceStudio.ts          studio state: sample, preview, draft, recording, save / transcribe
  hooks/useVoiceActions.ts         deletion with confirmation
  hooks/useVoiceDrop.ts            drop on the window in audio mode (classifyDrop of media-library)
  state/voiceStudioStore.ts        opening of the studio (Zustand: a dropped file, or a voice to edit) (tested)
  lib/voiceForm.ts                 pure rules: suggested name, too short, first sound of a drop, create and update bodies, savable (tested)
  lib/voiceMeta.ts                 avatar hue, facts under the name, quote (tested)
  lib/recording.ts                 hint during recording, reason for an unusable microphone (tested)
  lib/reading.ts                   languages of a sample, text to read (fr, en) taken over as is (tested)
  lib/voiceHelp.ts, voiceKeys.ts, fieldStyles.ts
  components/                      VoicesLibrary, VoiceCard, VoiceStudioDialog (+ RecordingPanel, TranscriberInstall, StudioFields), SamplePlayer, VoiceAvatar, VoiceDropLayer
  locales/                         locales.fr.json, locales.en.json (keys voices.*)
```

Mounting: `studio-shell/pages/VoicesPage.tsx` (thin page: `VoicesLibrary` + `useWriteWithVoice` from `audio-studio`); `StudioShell` mounts `VoiceStudioDialog`,
`useVoiceEvents` and, in audio mode, `VoiceDropLayer`.

## Voice studio

| Step | Behaviour |
|---|---|
| Choice of source | `Enregistrer` (record) (microphone: `useMicRecorder` from `common`, conversion to mono WAV) or `Importer un fichier` (import a file) (WAV, MP3, M4A, FLAC, OGG…, `audio/*`, mp4, webm); a sound dropped on the window opens the studio on it |
| Recording | level ring around the microphone, duration, hint (`continuez, 15 à 30 s c'est idéal` (keep going, 15 to 30 s is ideal) before 8 s, `c'est largement assez` (that's more than enough) after 30 s), `Terminer` (finish), **text to read** in the chosen language (French, otherwise English); the text to read pre-fills the transcription |
| Preview | player on the shared player of the tab (play/pause, clickable waveform, clock); `Choisir un autre extrait` (choose another excerpt) as long as the voice is not created; warning beyond 30 s |
| Name, language | name (80 characters), spoken language (11 languages) with help |
| Transcription | **editable** field; `Transcrire automatiquement` (transcribe automatically) (the engine proposes a text, which is corrected; if no model is installed: a message and `l'installer (≈ 0.5 GB)` (install it (≈ 0.5 GB)) which launches Whisper Small and its engine); the voice is created on the first request (the engine reads the recorded clip), then only updated; the proposed text is saved with the voice, then whatever the field contains is saved on `Enregistrer` (save) |
| Save | `Ajouter à mes voix` (add to my voices) (new) / `Enregistrer` (save) (edit); message `Voix « X » enregistrée` (voice "X" saved); disabled without sample, without name, during an operation or with a sample known to last less than one second |

## Parity checklist (former `VoicesPage.tsx`, `VoiceStudio.tsx`, `VoicePicker.tsx` for the avatar, `Waveform.tsx`)

Checked boxes = verified by the tested logic and server-side rendering (`audio-studio/components/render.smoke.spec.ts`); **the visual rendering and the sound still need validation** (list at the end of the file).

**`Mes voix` (My voices) page**
- [x] Title `Mes voix` (My voices), counter `N voix` (N voices), button `Ajouter une voix` (add a voice).
- [x] Loading: centred indicator; empty: microphone medallion, `Donnez-leur *votre* voix` (give them *your* voice), explanation, `Enregistrer ma voix` (record my voice).
- [x] Cards in one column, two from `md`, width 1000 px.
- [x] Card: avatar (microphone, hue of the name), truncated name, facts (`voix clonée` (cloned voice) / `voix inventée` (invented voice), language in capitals, duration, `sans transcription` (no transcription) in alert), edit, delete (tooltips), player (play/pause `Écouter` (listen)/`Pause`, clickable waveform), quote on two lines (transcription, otherwise description), `Écrire avec cette voix` (write with this voice).
- [x] Deletion with confirmation: `Supprimer cette voix ?` (delete this voice?) + `« X » : l'enregistrement de référence sera supprimé. Les prises déjà générées avec cette voix sont conservées.` (reference recording will be deleted; takes already generated with this voice are kept) (gap: the name is in the message, not in the title, since `confirm()` does not accept a parameter in the title).
- [x] `Écrire avec cette voix` (write with this voice): see `audio-studio` (`useWriteWithVoice`).

**Voice studio**
- [x] Title `Nouvelle voix` (new voice) / `Modifier la voix` (edit voice), close.
- [x] Two large choices (`Enregistrer`, `Importer un fichier`) with their caption; microphone refused / absent / unavailable: alert caption, disabled button (new: `aucun micro détecté` (no microphone detected), `l'enregistrement n'a pas pu démarrer` (recording could not start)).
- [x] `Extrait de référence` (reference excerpt) with tooltip and three tips (10 to 30 seconds…; clear voice…; only clone your own voice…).
- [x] Recording: see the table; text to read in French / English (other language: English).
- [x] Preview and duration, `Choisir un autre extrait` (choose another excerpt), warning beyond 30 s, `Extrait trop court : il faut au moins une seconde de parole.` (excerpt too short: at least one second of speech is needed) (message and block).
- [x] Name (placeholder `Ma voix` (my voice), 80 characters), spoken language with the help `Langue parlée` (spoken language); default name taken from the file name.
- [x] Transcription: label and tooltip `Transcription de l'extrait` (transcription of the excerpt), indication `Facultative ; améliore le clonage.` (optional; improves cloning), `Transcrire automatiquement` (transcribe automatically) (loading), `Pré-remplie avec le texte proposé : corrigez-la si vous avez lu autre chose.` (pre-filled with the proposed text: correct it if you read something else), notice `Aucun modèle de transcription installé (voir Modèles → Audio) · l'installer (≈ 0.5 GB)` (no transcription model installed (see Models → Audio) · install it (≈ 0.5 GB)) (`téléchargement…` (downloading…) during the download).
- [x] Buttons `Annuler` (cancel) / `Ajouter à mes voix` (add to my voices) or `Enregistrer` (save), recording indicator.
- [x] Editing an existing voice: name, language and transcription taken over, player on the recorded sample.
- [x] Dropping a sound on the window in audio mode: opens the studio; overlay `Déposez un enregistrement` (drop a recording); other file: `Déposez un fichier audio (WAV, MP3, M4A, FLAC, OGG…).` (drop an audio file) (only when no file is a sound).

**Real time**: `studio.voices.changed` re-reads the list (creation, edit, deletion from another tab or from a take).

**Gaps**: confirmation title without the voice name; finer microphone states (refused, no microphone, error); the preview goes through the shared player of `common` (a single sound at a time in the tab, as before); the WAV conversion of a recording or an import is that of `common` (`toMonoWavFile`).

**To validate by eye and ear**: real microphone recording (authorisation, level, duration, WAV conversion), playback of the preview and of the cards, waveform shape, studio rendering (width, scrolling, two columns of the fields), of the deletion dialog, of the empty page; real transcription (Whisper installed), installation of Whisper from the studio; dropping an audio file on the window.

## Tests

One file at a time, from `front/`, under the memory guard:

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/voices/lib/voiceForm.spec.ts
```

`lib/{voiceForm,voiceMeta,recording}.spec.ts`, `services/voicesApi.spec.ts`, `state/voiceStudioStore.spec.ts`, `locales/locales.spec.ts`; the server-side rendering of the page and of a card is in
`audio-studio/components/render.smoke.spec.ts` (no DOM: the studio, closed, is not rendered there).
