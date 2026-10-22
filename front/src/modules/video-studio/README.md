# Module `video-studio` (front)

## Role

The **video studio**: the home page (`Que voulez-vous tourner ?`, "What do you want to shoot?"), the **composer** (source / start / end slots, duration, format and definition, model settings, seed,
number of clips, `ModelPicker` video, licence and restricted-access notices), the **messages** (clips with native player, hover actions, progress state by steps), the
**video library** (`/video/bibliotheque`), the **drop** of images and videos on the window, the **lightbox** actions specific to video, and the mode adapter that plugs
all this into the `studio-core` thread. The model badges (tasks, maximum duration, definitions, sound, English), the licence warning and the restricted-access notice (former `VideoInfo.tsx`)
are in `model-catalog` (H4.2) and reused here. Back: `back/src/modules/studio-core/README.md` (`POST /api/messages`, video jobs); engine: `engine/app/job_plans.py`. Task H4.6.

## Structure

```
video-studio/
  index.ts                         exports: VideoHome, VideoGallery, VideoDropLayer, VideoViewerActions, useVideoInputs, videoStudioAdapter, useVideoDraftStore
  videoStudioAdapter.tsx           the ModeAdapter of video (composer, message, resuming a prompt with its inputs)
  types.ts                         VideoSlot (start | end | source), VideoUpload (upload in progress)
  state/videoDraftStore.ts         draft: prompt, start, end, source, uploads, settings per model, number of clips, seed (Zustand, `cn-video-composer`)
  hooks/useVideoComposer.ts        everything the composer shows and sends: effective parameters, inputs, slots, sending state, notices, submit
  hooks/useVideoInputs.ts          what fills the slots: files (with progress), asset, clip as source, last frame as start; switches model if needed
  hooks/useSendVideo.ts            sending (writes the two messages to the cache; from the home page, loads the conversation then opens it)
  hooks/useVideoDrop.ts            drop on the window (rules of `media-library/lib/dropRules.ts`)
  lib/videoMath.ts                 formats, number of frames (n × step + 1), output size, effective parameters bounded by the model, number of passes of a chained clip (`runCount`) and reason of the duration limit (`durationLimitKey`) (tested)
  lib/slots.ts                     file types, replacement model, slot of an asset, plan of an upload (tested)
  lib/composerRules.ts             requirements, what blocks sending and button tooltip, notices, displayed slots and their role (tested)
  lib/sendRequest.ts               body of POST /api/messages (tested)
  lib/clips.ts                     cells of a generation, layout, status line (engine steps included), settings taken over (tested)
  lib/videoHelp.ts                 info tips (duration, format, definition, number of clips, slots with the model's state), starting texts (tested)
  lib/videoDraftActions.ts         "Reprendre dans le composeur" (resume in the composer) (prompt + inputs), "Reprendre ces réglages" (resume these settings)
  lib/frameCapture.ts              image of a video (canvas, in the browser); lib/dropTarget.ts: slot targeted by a drop; lib/playback.ts: one video at a time
  components/                      VideoHome, VideoComposer, SlotTile, VideoPickers (DurationPicker: slider bounded by the maximum of the model, with the reason for the maximum and, for a chained clip, the number of segments; FormatPicker, ClipCountPicker), VideoAssistantMessage (+ VideoStatusLine,
                                   VideoMessageFooter), ClipTile (+ ClipActions, PendingClip), VideoGallery, VideoDropLayer, VideoViewerActions
  locales/                         locales.fr.json, locales.en.json (keys videoStudio.*)
```

Mounting: `studio-shell/pages/{VideoHomePage,VideoLibraryPage,ConversationPage}.tsx` (thin pages); `ConversationPage` passes `{ image, audio, video: videoStudioAdapter }` to `ConversationView`;
`StudioShell` mounts `VideoDropLayer` in video mode and passes `VideoViewerActions` to `StudioLightbox` (`modeActions`).

## Clip inputs

| Slot | For whom | Behaviour |
|---|---|---|
| Source video | editing model (`video_input` ≠ `none`) | an existing video that the model modifies; the setting "Influence de la vidéo" (`strength`, video influence) is only sent if a source is attached |
| Start image (or "reference" if `image_role = reference`) | `image_input` ≠ `none` | required (warning) if `image_input = required` and no source; serves as first frame, or as subject reference |
| End image | `last_frame` | requires the start image (notice otherwise) |

A slot is displayed if the model accepts it **or** if it still contains something (it can be removed; it then appears "ignorée" (ignored), greyed out, with the corresponding notice). A file arrives through the paperclip
(images and videos), pasting into the prompt, drag and drop **onto a slot** (it is stored there) or onto the window (automatic placement: the first video as source, up to two images as start then end if the model has
an end image). If the active model cannot use the input, the application switches to a compatible model (ready first, the lightest next) and says so. In the job, the order of the files is: start, end, source;
the engine decides the task (`i2v`, `v2v`, `t2v`) from what is attached and what the model accepts (`engine/app/job_plans.py`).

## Messages and clips

`VideoAssistantMessage`: model, status line (queued · position N; model loading · m:ss · download possible; step n/total · clip i/N · ~remaining duration, or, as long as no step is counted,
`téléchargement du décodeur rapide (23 Mo)…` (downloading the fast decoder (23 MB)…), `décodage de la vidéo (peut durer plusieurs minutes)…` (decoding the video (may take several minutes)…) / `décodage rapide de la vidéo…` (fast video decoding…), `encodage MP4…` (MP4 encoding…), `échantillonnage…` (sampling…); then size · duration · steps · generated in · time),
the clip grid (one: wide; two: two columns; finished clip: native player with poster, loop; pending slot: plate with dot, label and bar), the error (boxed), `Génération annulée.` (generation cancelled),
footer: Cancel while computing; then `Varier` (vary) (new seeds), same seeds, resume the settings in the composer (seed fixed, inputs included), "…" menu (per clip: use as source video,
last frame as start, download; copy the prompt, copy the seeds; delete the generation with confirmation). On hover over a clip: favourite (left), source, last frame, download (MP4), enlarge (right).
Launching a clip pauses the others. "Dernière image comme départ" (last frame as start) takes the image in the browser (`lib/frameCapture.ts`), sends it as an asset (`POST /api/assets`), puts it as start and empties the end and the source.

## Parity checklist (former `VideoHome.tsx`, `VideoComposer.tsx`, `VideoMessage.tsx`, `VideoGallery.tsx`, `VideoInfo.tsx`, `lib/video.ts`, video part of `lib/help.ts`, `Lightbox.tsx`, `App.tsx`)

Ticked boxes = checked by the tested logic (`lib/*.spec.ts`) and the server-side rendering (`components/render.smoke.spec.ts`); **the visual rendering, playback and interactions remain to be validated** (list at the end of the file).

**Home**
- [x] Kicker `Studio vidéo local` (local video studio), title `Que voulez-vous *tourner* ?`, subtitle, glow.
- [x] First-launch card (video `WelcomeSetup`), "hero" composer (3 lines).
- [x] Four starting texts (Paysage (landscape), Portrait, Urbain (urban), Animation), texts identical; one click fills the composer and focuses it.
- [x] `Derniers clips` (latest clips): up to ten posters (16:9, 96 px high) with the duration; a click opens the lightbox on the list.

**Composer**
- [x] Three slots (source video, start or reference image, end image), displayed according to the model; required as a warning, `option` (optional) otherwise; tooltip (name, required / optional, explanation, state for this model, reference role, tip); click, drag and drop on the slot, paste.
- [x] Upload with real progress (percentage and bar); thumbnail (opens the lightbox), label (`source` with icon, `départ` (start), `réf.` (ref.), `fin` (end)), greyed `ignorée`, remove button on hover.
- [x] Paperclip with its tooltip (images and videos, several files); paste files into the prompt.
- [x] Prompt: Enter sends, Shift+Enter adds a line (not during an IME composition), the field grows up to 40 % of the window (`/` focuses it), three help texts depending on the case (editing, from an image, scene).
- [x] Model not ready: `SetupPrompt`; on the home page the first-launch card replaces it. Licence (warning) and restricted access below the prompt.
- [x] Notices: model incompatible (engine text), plan note, source required, start required, end without start, start / end / source ignored, English (with "?"), soundtrack (with "?").
- [x] Bar: `ModelPicker` (badges and warnings: `model-catalog`), duration (0.5 s slider, `N images · i/s`, actual duration when it differs), format (5 shapes, model definition, output size ≈ W × H), model settings + seed (`GenerationParams` of `studio-core`), clips 1 or 2, `⇧↵ nouvelle ligne` (new line), Générer (generate).
- [x] Generate button: disabled without prompt, model not ready or incompatible, source or start missing, upload in progress; tooltip depending on the reason, shortcut ↵; after sending the prompt and the slots are emptied; from the home page the conversation opens.
- [x] Body sent: effective parameters, seed, references in the order start / end (if start) / source, only those the model uses, `strength` removed without source, two clips at most.
- [x] Model switch when the input is not accepted (ready first, lightest next), with a message.
- [x] States: model loading (indicator), server unreachable (`Serveur injoignable — le backend est-il démarré ?`, "Server unreachable — is the backend started?").

**Messages**
- [x] Avatar, model name, status line (see above), clip grid, pending slots (label: model loading, step n/total, preparation…, waiting), error, cancellation.
- [x] Clip: native player (poster, loop, metadata only before playback), "development" animation of a clip under 8 s, a single playback at a time; real ratio of the clip as soon as known.
- [x] Hover actions: favourite (filled / empty heart), source video, last frame as start, download (`<slug>-<seed>.mp4`), enlarge.
- [x] Footer: Cancel; `Varier` (vary) (tooltip), same seeds (tooltip), resume settings (`Réglages repris (graine fixée)` (settings resumed (seed fixed)); also takes back the start, end and source of the prompt), "Plus d'actions" (more actions) menu (see above), delete (confirmation `Supprimer cette génération ?` (delete this generation?) / `Les vidéos produites seront supprimées.` (the videos produced will be deleted.)).
- [x] User message: input thumbnails (the video marked `vidéo`), copy the prompt, resume in the composer (prompt and inputs), delete (`studio-core`).
- [x] Real time: `studio.message.updated`, `studio.job.progress` (including `stage`), `studio.job.image` (clip added), `studio.asset.*`, `studio.queue.updated` (exact position).

**Library `/video/bibliotheque`**
- [x] Title `Bibliothèque` (library), counter `N clips`, filter `Filtrer par prompt` (filter by prompt), Favourites button.
- [x] Tile: poster at the clip's ratio, muted preview looping on hover, duration, prompt on hover, clip actions (favourite, source, last frame, download); a click opens the lightbox on the loaded clips.
- [x] States: loading, empty (`Aucune vidéo générée pour l'instant.` (no video generated yet), favourites, search), error with `Réessayer` (retry), infinite pagination, live update (`media-library` module).

**Lightbox (video)**
- [x] For a clip: source video, last frame as start (close the lightbox, fill the slot, go back to the video home page from the library); for an image in video mode: `Utiliser comme image de départ` (use as start image); favourite (`F`), download, info (`I`: prompt, model, duration, i/s, size, seed…), delete the video (`studio-core`).

**Video drop** (rules of H4.4: `media-library/lib/dropRules.ts`)
- [x] Drop on the window in video mode: veil `Déposez une image ou une vidéo` (drop an image or a video), images and videos stored (an image as start then end, a video as source); warning when no file fits; on a slot: stored there; warnings `Certains fichiers ont été ignorés…` (some files were ignored…), `Une seule vidéo source à la fois…` (only one source video at a time…), `Seules deux images…` (only two images…).

**Badges, licence, access** (`model-catalog` module, H4.2)
- [x] Task badges (text → video, image → video, editing), maximum duration, definitions, `avec son` (with sound), `anglais` (English), each with its tooltip; licence warning; restricted-access notice (with the state of the token); in the model selector, the Models dialogue and below the prompt.

**Deviations**
- The negative prompt, when the model has one, is entered below the prompt (`NegativePromptField` of `studio-core`), not in the settings.
- The ✨ button of the composer bar (`EnhancePromptButton` of the `chat` module) rewrites the prompt with the chat model and keeps the original; the composer also takes the text that a chat response sends to it (`usePromptHandoff('video', …)`).
- Model settings and seed go through `GenerationParams`, **moved up into `studio-core`** (deviation from H4.3b / H4.5 settled); its button shows `Réglages` (settings) for audio and video (as before), the number of steps for the image.
- "Reprendre ces réglages" no longer saves the values that the engine recomputes (`frames`, `fps`, `task`), which were added to the model's settings without serving any purpose.
- The video-specific lightbox actions apply to any clip, whatever the displayed mode (before: same); they are provided by `video-studio` to `StudioLightbox` (`modeActions`) so that `studio-core` does not depend on video.
- The draft is specific to the mode (`cn-video-composer`); the former preferences (`cn-prefs`) are not taken over (as for image and audio).
- The avatar of a message is the MUI "clap" icon (`MovieCreationOutlined`) instead of the lucide one.
- The capture of an image requests the video with `crossOrigin = 'anonymous'`: in development (front 5173, back 3000) it depends on the CORS header of the back on `/api/media` (not verified); packaged, everything is of the same origin.
- The server error messages, the text of the plan note and the `engine_reason` are not translated.

**To validate by eye** (no browser launched): real playback of the clips (native controls, pausing the others, poster, loop, 16:9 and 9:16), "development" animation, plate and bar of a pending clip, grid layout (one clip / two),
composer (row of slots, required / optional / ignored tiles, upload progress, prompt field, duration and format popovers), home (starting texts, latest clips), library (columns, preview on hover, actions), lightbox (video buttons),
drag and drop on a slot and onto the window, capture of the last frame (canvas, CORS in development), MP4 download; real generation (start, end, source, number of clips, fast decoding) with a model.

## Tests

One file at a time, from `front/`, under the memory guard (`render.smoke.spec.ts`: 3 GB):

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/video-studio/lib/clips.spec.ts
```

`lib/{videoMath,slots,composerRules,sendRequest,clips,videoHelp,frameCapture,dropTarget,playback}.spec.ts`, `state/videoDraftStore.spec.ts`, `locales/locales.spec.ts`,
`components/render.smoke.spec.ts` (server-side rendering of the home page, the composer in several model cases, the slots, the closed selectors, the video thread, each status line, the clips and the library; no DOM: interactions, playback,
popovers and image capture are not exercised; a Zustand store is read in its initial state, hence the presentational views tested through their properties).
