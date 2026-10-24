# Module `model-catalog` (front)

## Role

**Models** dialog of the studio (replaces the `ComingSoonDialog` of the shell) and model picker reusable by the
composers of H4.3+: catalogue by type (image, audio, video), download with progress (bytes, rate, remaining time),
cancellation, deletion with confirmation, choice of quantization (variant) and precision (MLX), custom models
(added from Hugging Face, removed), Hugging Face search with compatibility and memory fit, Hugging Face token. The catalogue, downloads and search are **computed by the engine**; this module displays and drives them.
Back: `back/src/modules/model-catalog/README.md`. Installation of engines and packs: `engines` module. Task H4.2.

## Structure

```
model-catalog/
  index.ts                       exports (see "Public API")
  types.ts                       ModelInfo, ModelCatalog, DownloadProgress, HubResult, HubInspect... (engine shapes)
  services/modelCatalogApi.ts    GET /models, POST|DELETE /models/:id/download, DELETE /models/:id, POST /models/custom,
                                 DELETE /models/:id/custom, GET /hf/search, GET /hf/inspect, GET /hf/trending
  hooks/useModelCatalog.ts       useModels, useActiveModel, useWelcomeModel, useRefreshCatalog, useStartDownload, useCancelDownload
  hooks/useModelUsage.ts         finished generations per model (`GET /api/messages/model-usage`, key `model-usage`, invalidated by `studio-core`)
  hooks/useModelActions.ts       delete / remove (confirmation, wait for the release, message)
  hooks/useHubSearch.ts          useDebouncedQuery, useHubSearch, useHubInspect, useAddCustomModel (answers the id of the added model)
  hooks/useWhatsNew.ts           useWhatsNew, useRefreshWhatsNew ("New": recent successful models)
  hooks/useDownloadEvents.ts     subscription to engine.download.progress (mounted by the shell)
  hooks/useSizeLabel.ts          localized labels such as `650 Mo` / `4,5 Go` (`650 Mo` / `4,5 Go` are the displayed sizes)
  lib/catalogFormat.ts           sizes, "installed first" sort, split generators/transcription, disk space,
                                 engine label, precision choice, GPU alternative (pure, tested)
  lib/downloads.ts               active download (direct > catalogue), error, update, event parsing (pure, tested)
  lib/hubSearch.ts               counters, default variant, add blocking, key tables (pure, tested)
  lib/whatsNew.ts                age, size to download, "new" badge (last opening per type, protected `localStorage`) (pure, tested)
  lib/activeModel.ts             active model of a composer, model of the home card (pure, tested)
  lib/modelKind.ts               `modelKindOfMode`: chat uses the `llm` models, the other modes their type (pure, tested)
  lib/modelHelp.ts, modelCatalogKeys.ts
  state/downloadStore.ts         live progress per model (Zustand)
  state/modelSelectionStore.ts   model chosen per type (persisted under `cn-models`)
  lib/modelsView.ts              `groupModelsByKind` (chat, audio, image, video; installed first), `onDisk` (pure, tested)
  components/                    ModelsDialog, ModelsManager (Models tab of the Settings: state and deletion per category), ModelCard, ModelHeader, ModelActions, TempDownloadNote (temporary download of a locally quantized model: total, temporary share, size on disk), VariantPicker, QuantizeControl, HubSearch,
                                 ModelPicker, ModelBadges (VideoBadges, LlmBadges, LicenseWarning, GatedNotice, HelpTag), panels (Section, Tag, Notice),
                                 WhatsNewButton, WhatsNewDialog, WhatsNewRow
  locales/                       locales.fr.json, locales.en.json (keys models.*)
```

## Public API

`ModelsDialog` (mounted by `StudioShell`, which passes it `onSetup` and `renderEngines` of the `engines` module: the module does not depend on
`engines`), `ModelPicker` (`<ModelPicker model={active} usage? onSelect? />`: the most used first according to `usage`, then the other
installed ones, then the rest; models too heavy for the machine (`plan.fits` false) hidden behind "Show too-heavy models", except the active model; the composers go through `StudioModelPicker` of `studio-core`, which provides `usage`), `useModelUsage`, `useModels`, `useActiveModel(kind)`, `useWelcomeModel(kind)`,
`WhatsNewButton` (`<WhatsNewButton kind />`, `kind`: `image`, `audio`, `video` or `llm`), `useWhatsNew`, `useModelSelectionStore`, `useDownloadStore`, `activeDownload`, `modelCatalogApi`, `modelCatalogKeys`, `VideoBadges`, `LlmBadges`, `modelKindOfMode`, `LicenseWarning`,
`GatedNotice` (reused by the video composer, H4.6), `MODEL_HELP` (badge tooltips, reused by the notices of the video composer), `Section`, `Tag`, `Notice`, types.

## Chat models (`kind: 'llm'`)

Fourth type, next to image, audio and video: the GGUF language models that the engine runs with llama.cpp (`backend: 'llamacpp'`). The dialog has a "Chat models" tab (the engine card above it is that of
llama.cpp, `engines` module); `ModelInfo.llm` (`LlmCaps`: default and maximum context, vision, tools, reasoning `none | toggle | always | levels`, MoE, parameters) is shown by `LlmBadges` (card and picker row);
the Hugging Face search passes `kind=llm`; the catalogue carries an `llm` block (`default_model_id`, `recommended_model_id`, `ready`) read by `resolveActiveModel` / `welcomeModel`; the selection (`cn-models`) has an `llm` entry
(a state saved before it existed has none: read as "none"). The current mode gives the type of the initial tab through `modelKindOfMode` (chat → `llm`). Usage (`useModelUsage`) only counts the generations
of media: chat models are not ranked by usage.

## OCR models (`kind: 'ocr'`)

Sixth type, for the OCR tab (`ocr-studio` module): vision GGUF models run by llama.cpp in a server of their own
(`engine/app/engines/ocr_models.py`). `ModelInfo.ocr` carries their tasks, languages and an honest card (strengths, limits) shown by the
composer. The tab "Modèles d'OCR" lists them (not downloaded ones included, installed on demand), the Hugging Face search finds repos
whose name or tags say OCR (family `ocr-gguf`); no « What's new » section (the trending ranking covers four kinds).

## Diagram models (`kind: 'diagram'`)

Fifth type, for the Diagrams tab (`diagram-studio` module): the **same** GGUF language models as `kind: 'llm'`
(same files, no duplicate download — see `engine/app/engines/diagram_models.py`), under a `diagram` block separate
from the catalogue (`default_model_id`, `recommended_model_id`, `ready`), with a dedicated "Diagram models" tab. Unlike
`llm`, there is no Hugging Face search nor "New" button for this type (`HubSearch`/`WhatsNewButton` render `null`
for `kind === 'diagram'`): these are the same models as Chat, not a separate Hugging Face family.

## Behaviour

- **Opening**: "Models" button of the sidebar (`modelsOpen`); initial tab = current mode. "Search a model on Hugging Face…" of the picker opens the dialog on this type and brings the search field to the front (`openModelSearch`).
- **Loading**: the catalogue is only read when the dialog opens (`enabled`); states: loading, error with "Retry", no model, content.
- **Live progress**: `engine.download.progress` feeds `downloadStore` (progress continues with the dialog closed: home card, composers). End of a download (`done`, `error`, `cancelled`) and `engine.models.changed` invalidate `['models']` and
  `['system']` (`studio-shell/lib/eventEffects.ts`). After a reconnection, live progress is cleared: the catalogue (`download` in progress or in error) is authoritative.
- **Model card**: see the parity list below. The button follows the state: deletion in progress, cancel (download in progress), install the engine (+ model), use / delete (installed), complete / download.
- **Quantization and precision**: saved as the `variant` and `quantize` settings (`useSaveSettings` of the `settings` module, which invalidates the catalogue); downloading a variant does not delete the others already installed (the setting only chooses
  the one used for generating). Some MLX models (e.g. Qwen Image Edit) quantize locally once at the installation of a variant (never re-run at each loading): the full unquantized copy, needed to produce these variants,
  can then be freed via `ModelActions` (button "Free the full copy", visible as soon as a quantized variant is installed) — `DELETE /api/models/:id/source/bf16`, see `back/src/modules/model-catalog/README.md`.
- **Use**: remembers the model of the type (`modelSelectionStore`), goes to the home page of the mode and closes the dialog. Composers read `useActiveModel(kind)` (remembered choice, otherwise the most used installed model, otherwise the server default, otherwise the first of the type; never a transcription model).
- **Hugging Face search**: input debounced 350 ms, results kept 60 s, details of a repository kept 5 min, no retry.
  Incompatible results faded; variants that do not fit in memory faded and **struck through** (tooltip = `fit_note`); the default variant is a Q4_K that fits, never one that does not fit when another does; adding is blocked if the machine
  cannot run the model or if the chosen variant does not fit. "Add and download" adds the repository then starts the download.
- **"New" (`WhatsNewButton`)**: button next to the model picker of each composer (single mount point:
  `StudioModelPicker` of `studio-core`, hence the image, audio and video pages; the Chat page will mount it with `kind="llm"`). It opens a
  window (`WhatsNewDialog`) listing the **recent** Hugging Face models (30, 90 or 180 days), that **are successful** and that **this machine can run**, computed by the engine without AI (`engine/app/hf_trending.py`: Hub signals, thresholds per type; see
  "New" in `back/src/modules/model-catalog/README.md`). Each row: name, author, family, proposed variant and size to download, age, downloads 30 d, likes, license (warning if non-commercial or special),
  "Add" (the search flow: `useAddCustomModel` with the proposed variant, then the download progress bar), "Variants (n)" (the search details, `Detail` of `HubSearch`, to choose the quantization) and the Hugging Face link.
  States: loading, empty (with what counts), error with "Retry"; "Refresh" re-reads the Hub (the engine keeps one hour); too-heavy models are hidden behind "Also show… (n)", as in the picker. A **dot** on the button
  signals models published since the last opening of this type (read 3 s after the page is displayed; last opening kept in the browser: per-visitor convenience, the application works without it).
- **"Slow · processor" marker** (`plan.degraded`): dot on the card (tooltip = plan note); the alternative that uses the GPU is named by the engine's note (`plan.note`) and, if the note does not name it, by a dedicated line.
- **Restricted access** (`gated`): box with the procedure to follow, plus the token state ("A token is saved." / "No token is saved.").

## Tooltips

Texts of `frontend/src/lib/help.ts` (removed in H6) repeated identically in French (`models.help.*`: `quantize`, `variant`, `seconds`, `resolution`,
`audio_out`, `english_only`, `license`), plus the help of video tasks (`models.video.taskHelp.*`, from `VideoInfo.tsx`). The title of
`seconds` and `resolution` is the one the old `VideoBadges` gave them ("Maximum duration of a clip", "Proposed definitions").

## Correspondence with the old interface

| Old (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `components/ModelsDialog.tsx`: `ModelsDialog`, `KindTabs` | `components/ModelsDialog` (MUI `Dialog`, `Tabs`) |
| `ModelsDialog.tsx`: `MachineCard`, paths | `hardware` module (`MachineCard`, `StoragePaths`) |
| `ModelsDialog.tsx`: `ModelCard` | `components/ModelCard`, `ModelHeader`, `ModelActions` |
| `ModelsDialog.tsx`: `VariantPicker` | `components/VariantPicker` |
| `ModelsDialog.tsx`: MLX precision | `components/QuantizeControl` |
| `ModelsDialog.tsx`: `TokenField` | `HfTokenField` of the `settings` module |
| `ModelsDialog.tsx`: `EnginesCard`, `PacksCard` | `engines` module (`EnginesPanel`) |
| `components/HubSearch.tsx` | `components/HubSearch`, `hooks/useHubSearch`, `lib/hubSearch` |
| `components/ModelPicker.tsx` | `components/ModelPicker`, `lib/catalogFormat` (`pickerModels`: order and hiding, `tooHeavy`, `pickerSize`) |
| `components/VideoInfo.tsx` | `components/ModelBadges` |
| `lib/queries.ts`: `useModels`, `useActiveModel`, `download.progress` and `models.changed` events | `hooks/useModelCatalog`, `hooks/useDownloadEvents`, `studio-shell/lib/eventEffects` |
| `lib/store.ts`: `downloads`, `modelId`, `audioModelId`, `videoModelId`, `modelsSearch` | `state/downloadStore`, `state/modelSelectionStore`, `studioStore.modelsSearchKind` |
| `lib/format.ts`: `formatModelSize`, `installedFirst` | `lib/catalogFormat` |
| `lib/api.ts`: model and Hugging Face routes | `services/modelCatalogApi` |

## Deviations from the old interface

- Confirmation title: the template's `confirm()` component does not substitute a parameter in the title; the model name goes into the
  message ("Delete this model?" / "« X »: frees ≈ N GB…"). Same for removing a model and uninstalling a pack.
- Messages (`toast`) go through react-toastify (template) instead of sonner.
- Additions: error state of the catalogue with "Retry", message "No model for this type.", token state in the "Restricted access" box,
  GPU alternative line when the note does not name it.
- The message of a refused download, of an unavailable engine (`engine_reason`) and the plan notes come from the engine (French): not translated into English.

## Tests

One file at a time, from `front/`: `../scripts-local/guarded_run.sh 3 npx vitest run src/modules/model-catalog/lib/catalogFormat.spec.ts`
(same for `downloads`, `hubSearch`, `whatsNew`, `activeModel`, `services/modelCatalogApi`, `state/stores`, `locales/locales`, `components/whatsNew.smoke`).
Pure logic and simulated services; component rendering is limited to a server rendering (without DOM) of the row and of the "New" button:
the window (portal) is not rendered in tests. `locales.spec.ts` checks the fr/en parity, the `{n}` markers and
that every `models.*` key written in the sources exists.
