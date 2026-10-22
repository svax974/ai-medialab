# Module `engines` (front)

## Role

Installation of the inference engines and their models, **only at the first selection of a model that needs them**:
`startSetup(model)` opens the `SetupDialog` modal, which lists what will be downloaded (`Données de base` (base data) shared by several engines,
`Moteur d'exécution` (runtime engine), `Modèle` (model)), with the size of each line and the total; what is already installed is not listed there and is never
downloaded again. On confirmation, everything is installed in a single run on the engine side (one progress, a cancellation that deletes what is partial).
The module also carries a model's "to install" prompt (`SetupPrompt`), the first-launch welcome card (`WelcomeSetup`), the
`Moteurs` (engines) cards of the `Modèles` (Models) dialog (install, cancel) and the Engines tab of Settings (`ComponentsManager`: state and deletion).
Progress through `ProgressBar` / `IndeterminateBar` from `common`. The installation runs in the engine;
Nest relays the routes and the events (`back/src/modules/engines/README.md`). Task H4.2.

## Structure

```
engines/
  index.ts                      exports
  types.ts                      installation states (defined in `hardware`, which describes `GET /api/system`)
  services/enginesApi.ts        POST|DELETE /engines/pack/:id/install, DELETE /engines/pack/install, POST|DELETE /engines/sdcpp/install,
                                POST|DELETE /engines/llamacpp/install, GET /engines/components, DELETE /engines/components/:id,
                                GET /engines/setup/plan/:modelId, GET|DELETE /engines/setup, POST /engines/setup/:modelId
  hooks/useEngineInstaller.ts   useInstallPack, useInstallSdcpp, useInstallLlamacpp, useCancelInstall
  hooks/useComponents.ts        useComponents (list, re-read at the end of an installation), useRemoveComponent (confirmation naming the models deleted with it)
  hooks/useModelSetup.ts        startSetup (opens the modal), useInstallEvents, useSetupEvents (`engine.setup.progress`), useEnginesSync
  hooks/useLocalAiSetup.ts      useLocalAiSetup: local AI (llama.cpp + a small chat model) as a single reusable flow
  lib/localAi.ts                `deriveLocalAi`: state, sizes, disk, progress, error (pure, tested)
  lib/installState.ts           live state or state read with the system, engine and pack rows, summary of what is missing (pure, tested)
  lib/setupLabels.ts            label of the total to install and of the banner button (pure, tested)
  lib/setupDialog.ts            phase of the modal (`dialogPhase`), steps to download, labels of the three levels, sizes (pure, tested)
  lib/componentsView.ts         `Données de base` / `Moteurs` groups and the state line of a component (pure, tested)
  state/installStore.ts         live states of the three installers (packs, stable-diffusion.cpp, llama.cpp) (Zustand)
  state/setupStore.ts           model shown by the modal and state of the run in progress (Zustand)
  components/                   EnginesPanel, EnginesCard, PacksCard, LlamacppCard, InstallRow, SetupPrompt, WelcomeSetup, SetupDialog,
                                ComponentsManager, LocalAiProgress, LocalAiLaunchDialog
  state/localAiPromptStore.ts   `Ne plus me le proposer` (don't offer it again) (`cn-local-ai`, browser) and closing for the launch in progress
  lib/launchPrompt.ts           `shouldPromptLocalAi`: when the invitation is due (tested)
  locales/                      locales.fr.json, locales.en.json (keys engines.*)
```

## Public API

`EnginesPanel` (the engines card of a tab of the `Modèles` dialog; passed to `ModelsDialog` by the shell), `SetupPrompt({ model, welcome? })`
and `WelcomeSetup({ kind })` (for the welcomes of the composers, H4.3+), `startSetup(model)`, `SetupDialog` and `useEnginesSync()` (mounted by the shell),
`ComponentsManager` (Engines tab of `Réglages` (Settings)), `useInstallStore`, `useSetupStore`, `enginesApi`, installation states.

## Chat engine (llama.cpp)

The `Modèles de chat` (chat models) tab of the dialog shows `LlamacppCard`: installation (progress in bytes through `engine.llamacpp.install`, cancellation) and the reason when
the engine is not installable here. `startSetup` covers llama.cpp like the other engines (the modal lists it as `Moteur d'exécution` (runtime engine)). The deletion of an engine
is done in Settings.

## Reusable local AI (`useLocalAiSetup`)

For any screen that needs a local chat model (the update advisor, a launch prompt): **`useLocalAiSetup(): LocalAiSetup`**
(`hooks/useLocalAiSetup.ts`, exported with `LocalAiProgress`, `deriveLocalAi`, `pickAdvisor`, `ADVISOR_MODEL_ID`, `DISK_MARGIN_GB`).

| Field | Meaning |
|---|---|
| `state` | `unknown` (catalogue or machine not yet read), `ready` (llama.cpp and a chat model — any one — are installed), `needs-setup`, `installing` (the engine), `downloading` (the model), `error`, `no-space` (insufficient disk) |
| `modelId`, `modelName` | the model that will be installed: the one the catalogue recommends (`llm.recommended_model_id`), otherwise `llm-qwen3-4b-instruct-2507` |
| `engineInstalled`, `modelInstalled` | what is already there |
| `engineSizeMb`, `modelSizeGb`, `neededGb` | what remains to download (0 when installed), total in GB |
| `freeGb` | free disk space (null if unknown); `no-space` when `neededGb + DISK_MARGIN_GB` (2 GB) exceeds the free space: nothing starts |
| `progress` | `{ step: 'engine' \| 'model', done, total, rate?, eta?, message? }` of the current step |
| `error` | the message of the failure (installer or download); `start` retries |
| `start({ withModel? })` | installs llama.cpp then (`withModel`, default `true`) the model, through `POST /engines/setup/:modelId` (without the modal: the invitation has already shown the sizes); does nothing if it is ready, in progress, or without room |
| `cancel()` | stops the current step and the download that was to follow |

`LocalAiProgress({ setup })` shows the step, the bar (bytes and rate, or the installer's message), "Annuler" (cancel) and the error. This module does not depend on `updates`:
the invitation of the update dialog (`LocalAiInvite`) and any other modal use it. The hook relies on `useEnginesSync`, mounted once by the shell.

## Behaviour

- **Installation in a single run**: `startSetup(model)` opens `SetupDialog`, which reads `GET /engines/setup/plan/:modelId` (missing steps and sizes;
  `blocked` when the machine cannot run the engine). `Télécharger` (download) launches `POST /engines/setup/:modelId`: the engine installs in order
  base data, engine, model, with the existing installers, and publishes `engine.setup.progress` (`useSetupEvents`, which also re-reads `GET /engines/setup`
  on load and after a reconnection). `Annuler` (cancel) stops the current step (its partial files are deleted); the steps already finished remain. Another
  installation in progress gives a readable refusal. At the end, the modal closes with a message.
- **Events**: `engine.engine.install` (bytes, message) and `engine.pack.install` (message, detail, start) feed `installStore`;
  the front queries nothing. The end of an installation re-reads `['system']` and `['models']` (`studio-shell/lib/eventEffects.ts`). Only one
  installer runs at a time. After a reconnection, the live state is emptied and the state read with `GET /api/system` is authoritative
  (the engine also replays the current state at connection).
- **Cards**: status dot (available, installable, unavailable with the engine's reason), install (≈ size), cancel. A pack belongs to the tab
  of the models that use it; a pack without a model stays with audio. MLX is hidden outside Mac. No deletion here: it is in Settings.
- **Settings > Engines** (`ComponentsManager`): all components in two groups (`Données de base` (base data): PyTorch, FFmpeg; `Moteurs d'exécution` (runtime engines)),
  installed or not (size on disk, number of installed models that depend on them) and a `Supprimer` (delete) button. The confirmation names the installed models that
  will be deleted with the component. An engine built into the application (the Metal / Vulkan builds of stable-diffusion.cpp) has no button.
- **`SetupPrompt`**: nothing when the model is ready; otherwise `à installer` (to install): engine ≈ X MB + model ≈ Y GB and a button (`Tout installer` (install all) /
  `Installer le moteur` (install the engine) / `Télécharger` (download), `Voir la progression` (view progress) during the run) that opens the modal. `welcome`: first-launch card, with
  the model recommended for the machine (`useWelcomeModel`) and `Choisir un autre modèle` (choose another model).

## Mapping from the former interface

| Former (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `components/Setup.tsx`: `ProgressBar`, `IndeterminateBar` | `ProgressBar`, `IndeterminateBar` from `common` (batch I) |
| `Setup.tsx`: `startSetup` | `hooks/useModelSetup` `startSetup` |
| `Setup.tsx`: `SetupController` | `setup_runner.py` of the engine + `useSetupEvents` (hook mounted by the shell) |
| `Setup.tsx`: `SetupPrompt`, `Steps` | `components/SetupPrompt` |
| `Setup.tsx`: `useWelcomeModel`, `WelcomeSetup` | `useWelcomeModel` (module `model-catalog`), `components/SetupPrompt` `WelcomeSetup` |
| `ModelsDialog.tsx`: `EnginesCard` | `components/EnginesCard` |
| `ModelsDialog.tsx`: `PacksCard` | `components/PacksCard` |
| `lib/store.ts`: `packInstall`, `engineInstall` | `state/installStore` (the pending model is replaced by `state/setupStore`) |
| `lib/queries.ts`: `engine.install`, `pack.install` | `hooks/useModelSetup` `useInstallEvents` |

## Tests

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/engines/lib/installState.spec.ts   # one file at a time
```

`lib/installState.spec.ts`, `lib/setupLabels.spec.ts`, `lib/setupDialog.spec.ts`, `lib/componentsView.spec.ts`, `state/installStore.spec.ts`, `state/setupStore.spec.ts`.
Component rendering is not tested.

## Launch invitation (`LocalAiLaunchDialog`)

At each launch, as long as **llama.cpp is not installed** (a single missing chat model triggers nothing: the Chat page and the model list offer it),
a window to close presents what local AI brings (immediate Chat, updates analysed before installation, prompts improved by ✨, all local),
the sizes (engine, recommended model, free space), a checkbox `télécharger aussi le modèle conseillé` (also download the recommended model) (checked), a host checkbox (`extraOption`, here
`analyser automatiquement les risques des mises à jour` (automatically analyse update risks), applied **at installation only**), the installation with its progress (`useLocalAiSetup`,
`LocalAiProgress`) then `Ouvrir le Chat` (open Chat). `Plus tard` (later) or Escape closes it until the next launch; the checkbox `Ne plus me le proposer` (don't offer it again) (`optOut`) is
stored in the browser (`cn-local-ai`) and is found in Settings (switch `IA locale au lancement` (local AI at launch)). Held back during a private session
(`suppressed`) and when disk space is insufficient (message, installation disabled). Mounted once by `StudioShell`.
