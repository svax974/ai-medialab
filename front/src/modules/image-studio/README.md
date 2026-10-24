# Module `image-studio` (front)

## Role

The **home** of the image studio (title, first-launch card, "hero" composer, four starter prompts, latest prints) and the **composer**:
prompt, reference images (paperclip menu: computer or generated images, paste, drop on the window, drag from a thumbnail), model selector (module `model-catalog`), proportions and definition,
model settings generated from its parameters, seed, number of images, send. The conversation thread, the messages, the progress and the viewer are in
`studio-core`. Back: `back/src/modules/studio-core/README.md` (`POST /api/messages`) and `media-library` (`POST /api/assets`). Task H4.3b.

## Structure

```
image-studio/
  index.ts                       exports: ImageHome, ImageGallery, Composer, ImageDropLayer, imageStudioAdapter
  imageStudioAdapter.tsx         what the image mode plugs into the studio-core thread (composer, generation, resuming a prompt)
  hooks/useSendMessage.ts        send (writes the two messages to the cache; from the home, loads the conversation then opens it)
  hooks/useImageDrop.ts          drop on the window: files (useWindowDrop of `common`) and conversation images dragged in
  lib/size.ts                    ASPECTS, QUALITIES, resolveSize (mirror of the engine's `resolve_size`), visible definitions (tested)
  lib/params.ts                  effective parameters ("Original" definition and `auto` format with references), `params` body of a message (tested); the form schema and `GenerationParams` are in `studio-core` since H4.6
  lib/composerRules.ts           composer notices, role of a reference, replacement multi-image model, state of the Generate button (tested)
  lib/uploadReferences.ts        import of references (image filter, previews, HttpService.upload) (tested)
  lib/sendRequest.ts             body of POST /api/messages (tested)
  lib/help.ts                    image-specific tooltips, starter prompts
  components/                    ImageHome, ImageGallery (H4.4: `AssetGallery` of `media-library` + `ImageTile` of `studio-core`), Composer, ReferenceStrip, AspectPicker, CountPicker, DropOverlay (ImageDropLayer)
  locales/                       locales.fr.json, locales.en.json (keys imageStudio.*)
```

Mounting: `studio-shell/pages/{HomePage,ConversationPage,GalleryPage}.tsx` (thin pages); `StudioShell` mounts `ImageDropLayer` in image mode.

## Composer

| Element | Behavior |
|---|---|
| Prompt | Enter sends, Shift+Enter inserts a line break (not during an IME composition), pasting files imports them, the field grows up to 40 % of the window (`/` focuses it: `registerFocusTarget('composer')`). Placeholder depends on the references and the model. Below it, the `À éviter` (avoid) line (`NegativePromptField` of `studio-core`, red border and a "forbidden" sign, smaller) holds the model's negative prompt, remembered per model; Enter also sends from there. In the composer bar, the ✨ button (`EnhancePromptButton` of the `chat` module) rewrites the prompt with the chat model and keeps the original; the composer also takes the text that a chat reply sends to it (`usePromptHandoff('image', …)`). |
| References | 72 px thumbnails with their role for the model: `départ` (start) (img2img, the 1st), `image N` (multi-image editing), `visage` (face) then `départ` (start) (`face` mode: face followed by the IP-Adapter, start image optional), `ignorée` (ignored) (greyed out); explanatory tooltip; size in pixels under the thumbnail; removal on hover; reorderable (drag a thumbnail onto another, or `mettre en premier` (move to first) on hover, `moveReference` of the draft): the 1st gives the `Référence` (reference) format (the 2nd, the start image, for a `face` model that has two: `sizeReferenceIndex`, mirror of the engine) and the order sent to the model. Imports in progress: faded preview + indicator. |
| Notices | The model modifies images and has none; does not use the references; only starts from an image; accepts N at most; does not run on this machine (engine text); plan note (anything other than `full`). A `Passer à X (MLX)` (switch to X (MLX)) button proposes a model that accepts all the images (ready first, then the lightest). |
| Model not ready | `SetupPrompt` (module `engines`) under the prompt; on the home, the first-launch card (`WelcomeSetup`) replaces it. |
| Proportions | `format · LxH` button: 10 formats (+ `Référence` = format of the 1st attached image, with its size shown on the tile; `Libre` (free) = pixels rounded to the model's multiple and bounds); definition `Origine` (origin) (with reference and `Référence`: resolution of the 1st image, capped at `NATIVE_MAX_MP`, enlarged without distortion up to the model's minimum side); without an attached image, `Référence` keeps the size of the last image made this way (`referenceSize` of the draft, remembered on send, sent as a free size) / `Brouillon` (draft) 0.5 / `Standard` 1 / `Haute` (high) 1.6 / `Très haute` (very high) 2.3 MP, tooltip for each; output `L × H px · x MP`. |
| Settings | `SchemaParamsPopover` of `common` from the model's `ParamSpec` (slider if bounds, switch, text; the negative prompt is no longer here, it is under the prompt; `Avancé` (advanced) collapsed; tooltips from `thread.help.*` + the model's remark; "with references" parameters hidden without a reference); the seed (random/fixed, draw, clear) is added after the basic settings; the button shows the steps, a padlock if the seed is fixed, a dot if a setting differs from the default. `Valeurs par défaut` (defaults) also frees the seed. |
| Number of images | 1 to 4, tooltip. |
| Send | Disabled without a prompt, during an import or a send, model not installed or incompatible, required reference image missing; tooltip depending on the reason, shortcut ↵. After sending: prompt and references emptied; from the home the conversation opens. |

Effective parameters (`lib/params.ts`): the model's default values, then the saved settings (`cn-composer`, per model); with references the default definition is `Origine` and the format `auto`;
without, `auto` falls back to 1:1. The fixed seed is not kept between two loads.

## File drop

`useImageDrop` (mounted by `ImageDropLayer`, in image mode): files dropped anywhere on the window (`useWindowDrop`, images only, others ignored with a warning) and conversation images
dragged from a thumbnail (type `application/x-cn-asset`) become references. Overlay `Déposez vos images` (Drop your images) (`DropVeil` of `media-library`). Sent by `assetsApi.upload` (`HttpService.upload`, multipart field `files`).

## Correspondence with the former interface

| Former (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `components/Home.tsx` | `components/ImageHome` |
| `components/Composer.tsx`: composer, `RefThumb`, `CountPicker`, notices | `components/Composer`, `ReferenceStrip`, `CountPicker`, `lib/composerRules` |
| `components/AspectPicker.tsx` | `components/AspectPicker`, `lib/size` |
| `components/ParamsPopover.tsx` | `studio-core/components/GenerationParams` (moved up in H4.6) + `SchemaParamsPopover` (`common`), `studio-core/lib/paramsSchema` |
| `lib/size.ts` | `lib/size` |
| `lib/composer.ts`: `uploadFiles`, `effectiveParams`, `registerComposer`/`focusComposer` | `lib/uploadReferences`, `lib/params`, `studio-shell/lib/focusRegistry` |
| `App.tsx`: `useFileDrop`, overlay | `hooks/useImageDrop`, `components/DropOverlay` |
| `lib/help.ts` (image) | `lib/help`, locales `imageStudio.help.*` |
| `lib/api.ts`: `send`, `upload` | `studio-core/services/{messagesApi,assetsApi}` |

## Deviations from the former interface

- The title of the settings panel is `Réglages` (Settings) (the common form does not accept a model name in its title); the number of steps, the seed padlock and the "modified" dot are in the button.
- `Valeurs par défaut` (defaults) is detected from what the common form sends (all fields at their default, at least two fields); it frees the seed like the former `Défauts` (defaults) button.
- File drop only applies in image mode (as before); audio has its own since H4.5 (module `voices`: a sound opens the voice studio) and video since H4.6 (`video-studio`: images and videos to the composer's slots).
- The labels of a model's settings and the `Ce modèle :` (this model:) remarks come from the engine (French).
- No progress bar for the upload of images (the former composer had none for images either: indicator only).

## Tests

One file at a time, from `front/`, under memory guard (`render.smoke.spec.ts`: 3 GB):

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/image-studio/lib/size.spec.ts
```

`lib/{size,params,composerRules,uploadReferences,sendRequest}.spec.ts`, `locales/locales.spec.ts`. `components/render.smoke.spec.ts` renders server-side (`renderToString`, Node environment, i18n simulated with the French texts)
the home, a conversation, a user message, generations in their states, the engine card and the reference strip, with a filled cache: it detects runtime errors and raw text keys,
but **does not replace** the visual validation (the Zustand stores are read at their initial state, the viewer portal is not rendered).
