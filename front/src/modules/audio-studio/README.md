# Module `audio-studio` (front)

## Role

The **audio studio**: the home page (`Que voulez-vous faire *entendre* ?`, "What do you want to make heard?"), the **composer** (text or dialogue with voice cast, voice, language, style instruction or voice description,
model settings, seed, number of takes, autoplay, `ModelPicker` audio), the **messages** (takes with shared player and waveform, character markers, speed, favourite,
WAV download, keep as reference voice, delete), the **audio gallery** (`/audio/bibliotheque`) and the mode adapter that plugs all this into the `studio-core` flow.
Voices (library, studio, sound upload) are in the `voices` module. Back: `back/src/modules/studio-core/README.md` (`POST /api/messages`, audio jobs) and
`back/src/modules/audio-studio/README.md` (voices). Task H4.5.

## Structure

```
audio-studio/
  index.ts                         exports: AudioHome, AudioGallery, TakeCard, audioStudioAdapter, useWriteWithVoice, useAudioDraftStore
  audioStudioAdapter.tsx           the ModeAdapter of audio (composer, message, resuming a text)
  hooks/useAudioComposer.ts        everything the composer shows and sends: settings, language, voice, characters and cast, estimated duration, sending state, notices, submit
  hooks/useSendAudio.ts            sending (writes the two messages to the cache; from the home page, loads the conversation then opens it)
  hooks/useTakeActions.ts          WAV download, "keep as voice", deletion with confirmation
  hooks/useAutoplayFirstTake.ts    autoplay of the first take of a message that has just been produced
  hooks/useWriteWithVoice.ts       "Write with this voice" (button of the voice library)
  state/audioDraftStore.ts         draft: text, per model (settings, voice, language, style), cast, takes, autoplay, seed (Zustand, `cn-audio-composer`)
  lib/audioText.ts                 estimated duration, approximate duration, characters of a dialogue (tested)
  lib/voiceChoice.ts               built-in voices, default language, effective voice, automatic cast (tested)
  lib/composerRules.ts             what blocks sending, button tooltip, notices (tested)
  lib/sendRequest.ts               body of POST /api/messages (tested)
  lib/takes.ts                     meta of a take, cells of a message, label, colours, markers, file name, autoplay, voice from a take, settings taken over (tested)
  lib/audioStatus.ts               status line of an audio message (tested)
  lib/cloner.ts                    model to use for a library voice (tested)
  lib/audioHelp.ts                 info tips and starting texts; lib/audioDraftActions.ts: resuming a text, settings
  components/                      AudioHome, AudioComposer (with the ✨ `EnhancePromptButton` of the `chat` module: corrected text for a natural reading; it also takes the text that a chat response sends to it, `usePromptHandoff('audio', …)`), AudioAssistantMessage (+ AudioStatusLine, AudioMessageFooter), TakeCard (+ RateMenu, TakeMenu, PendingTake, VoiceSavedToast),
                                   VoicePicker, LanguagePicker, CastPanel, TakesPicker, AutoplayToggle, AudioGallery
  locales/                         locales.fr.json, locales.en.json (keys audioStudio.*)
```

Mounting: `studio-shell/pages/{AudioHomePage,AudioLibraryPage,VoicesPage,ConversationPage}.tsx` (thin pages); `ConversationPage` passes `{ image, audio: audioStudioAdapter }` to `ConversationView`.

## Composer

| Element | Behaviour |
|---|---|
| Style / Voice | line above the text for a model with an instruction (`Style`) or with a described voice (`Voix`, **mandatory**); model help text as placeholder; info tips |
| Text | Enter sends, Shift+Enter adds a line (not during an IME composition); the field grows up to 40 % of the window (`/` focuses it); placeholder depending on the model; 8000 characters at most |
| Counter | "N characters · ≈ audio duration" (15 characters per second, depending on speed); "?" on the length the model reads in one go and on the dialogue |
| Dialogue | two characters detected (`Name: line` at the start of a line): panel `Scénario à N voix` (script with N voices, "script with N voices") with a voice selector per character (automatic cast: the first keeps the chosen voice, the others get voices of the opposite gender first); `C'est un simple texte` (it is plain text) / `Attribuer une voix à chaque personnage` (assign a voice to each character) |
| Notices | model incompatible (engine text), plan note, `Ce modèle clone une voix : choisissez ou enregistrez une voix de référence.` (this model clones a voice: choose or record a reference voice), very long text (> 6000) |
| Model not ready | `SetupPrompt` (`engines` module); on the home page, the first-launch card (`WelcomeSetup`) replaces it |
| Bar | `ModelPicker`, voice (built-in by language / `Mes voix` (my voices) / `Enregistrer ou importer une voix…` (record or import a voice); described-voice model: reminder `Voix décrite ci-dessus` (described voice above); model that does not clone: warning), language (if the model has several), model settings + seed (`GenerationParams` of `studio-core`), takes 1 to 4, autoplay, `Synthétiser` (synthesize) |
| Send | disabled without text, above 8000, model not installed or incompatible, without voice, without voice description; tooltip depending on the reason, shortcut ↵; after sending the text is cleared; from the home page the conversation opens |

## Messages and takes

`AudioAssistantMessage`: model, status line (queued · position N; model loading · m:ss; pass n/total · take i/N · ~remaining duration; language · generated in · time), one card per take
or a pending slot (animated waveform that fills up, `N %`), error (boxed), `Synthèse annulée.` (synthesis cancelled), footer: Cancel while computing; then `Refaire` (redo: new seeds), same seeds, resume text and
settings in the composer (seed fixed), delete (confirmation). `TakeCard`: play/pause on the shared player of the tab (a single take at a time), clickable waveform (keyboard: arrows, Home, End),
clock, coloured character markers (click: jump), `prise N · voix · seed` (take N · voice · seed), speed (0.75 to 2×, global), favourite, download (WAV), menu (keep as reference voice, copy the text, delete the take).
The first take of a message just produced starts by itself if autoplay is active (never when reopening an old conversation, never if another sound is playing).

## Parity checklist (former `AudioHome.tsx`, `AudioComposer.tsx`, `AudioMessage.tsx`, `AudioGallery.tsx`, `VoicePicker.tsx`, `Waveform.tsx`, `lib/audio.ts`, `lib/help.ts`)

Ticked boxes = checked by the tested logic and the server-side rendering (`components/render.smoke.spec.ts`); **the visual rendering and the sound remain to be validated** (list at the end of the file).

**Home**
- [x] Kicker `Studio vocal local` (local voice studio), title `Que voulez-vous faire *entendre* ?`, subtitle, glow.
- [x] First-launch card (`WelcomeSetup`), "hero" composer (4 lines).
- [x] Four starting texts (Narration, Annonce, Dialogue, Publicité), texts identical; one click fills the composer and focuses it.
- [x] `Dernières prises` (latest takes): three recent takes, beginning of the text above, compact player.

**Composer**: see the table above; in addition
- [x] Info tips: Style, Description de la voix (voice description), Voix, Langue du texte (text language), Longueur du texte (text length) (dynamic body: `environ N caractères… (8 000 au maximum…)`, "about N characters… (8,000 at most…)"), Dialogue à plusieurs voix (multi-voice dialogue) (×2), Nombre de prises (number of takes), Lecture automatique (autoplay) (title `activée / désactivée`, enabled / disabled), speed and variability (`thread.help.speed`, `thread.help.temperature`).
- [x] Voice selector: two tabs (`Voix du modèle` (model voices) N, `Mes voix` (my voices) N), rows with avatar, name, ♀/♂, description, miniature waveform of cloned voices, tick; empty and warning messages; footer `Enregistrer ou importer une voix…` (opens the studio).
- [x] Language selector: list `Langue du texte` with tick and code.
- [x] Settings: model parameters (slider, switch, text, `Avancé` (advanced)), seed (random / fixed, draw), "modified" dot, padlock.
- [x] States: model loading (indicator), server unreachable (`Serveur injoignable — le backend est-il démarré ?`, "Server unreachable — is the backend started?").
- [x] Shortcuts: ↵ sends, ⇧↵ line, `/` focuses the text.

**Messages**
- [x] Avatar (animated waveform during computation), model name, status line (see above), take cards, pending slots, error, cancellation.
- [x] Autoplay of the first fresh take; "development" animation of a take under 8 s.
- [x] Card: play/pause, waveform (click, drag, keyboard), clock, coloured character markers (up to 6 colours, click = jump), label, speed, favourite (filled/empty heart), WAV download (`<slug>-<seed>.wav`), menu.
- [x] Menu: `Garder comme voix de référence` (keep as reference voice) (`Voix créée` (created voice) for a described voice, `X (copie)` (copy) otherwise; message `« X » ajoutée à vos voix` with `Modifier`), `Copier le texte` (copy the text), `Supprimer la prise` (delete the take) (confirmation `Supprimer cette prise ?` / `Le fichier audio sera supprimé.`).
- [x] Footer: Cancel; `Refaire` (info tip `Nouvelles prises (graines aléatoires)`, new takes (random seeds)), same seeds (info tip with explanation), resume text and settings (`Réglages repris (graine fixée)`, settings taken over (seed fixed)), `Supprimer la synthèse` (delete the synthesis) (confirmation `Supprimer cette synthèse ?`).
- [x] User message: copy the text, resume in the composer, delete (`studio-core`).
- [x] Real time: `studio.message.updated` (takes included, waveforms included: event limit raised, see the back), `studio.job.progress`, `studio.job.image` (take added), `studio.asset.*`, `studio.queue.updated` (exact position).

**Library `/audio/bibliotheque`**
- [x] Title `Bibliothèque` (library), counter `N prises`, filter `Filtrer par texte` (filter by text), Favourites button; single 760 px column.
- [x] Each take: beginning of the text (two lines) and conversation title above (click: opens the conversation), full card.
- [x] States: loading, empty (`Aucune prise audio pour l'instant.`, no audio take yet; favourites, search), error with `Réessayer` (retry), infinite pagination, live update (`media-library` module).

**Audio upload** (rules of H4.4): see `voices` (uploading a sound = opens the voice studio).

**Deviations**
- Model settings and seed: `GenerationParams` component of `studio-core` (moved up from `image-studio` in H4.6); its button shows `Réglages` (settings) for audio (and video), like the former interface.
- The default language follows the interface language (fr / en), plus the browser setting.
- Favourite labels: `Ajouter aux favoris` / `Retirer des favoris` (add to / remove from favourites) (like images).
- Player: components of `common` (`useSharedAudioPlayer`, `Waveform`, `WaveformPending`); the playback speed is shared by the whole tab (as before).
- The server error messages, the model help text (`instruct_help`) and the engine notices are not translated.

**To validate by eye and ear**: real playback of the takes (player sharing between cards, autoplay, speed), waveform shape and alignment of the markers on the timeline, "development" animation,
animated waveform and percentage during computation, card layout (width, label line, menu), composer (style line, script panel, voice and language selectors, field height),
home (starting texts, `Dernières prises`), library (centred column, header), audio upload; real generation (cloning, dialogue, described voice) and WAV download.

## Tests

One file at a time, from `front/`, under the memory guard (`render.smoke.spec.ts`: 3 GB):

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/audio-studio/lib/takes.spec.ts
```

`lib/{audioText,voiceChoice,composerRules,sendRequest,takes,audioStatus,cloner,audioHelp}.spec.ts`, `state/audioDraftStore.spec.ts`, `locales/locales.spec.ts`,
`components/render.smoke.spec.ts` (server-side rendering of the home page, the audio thread, a take and its states, the script, the selectors, the voice library and its card; no DOM: interactions, playback and popovers are not exercised).
