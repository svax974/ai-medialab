# Module `engines`

## Role

Installers of the inference engines, **delegated to the Python engine**: audio and video packs (isolated Python environments,
`engine/app/audio_packs.py`), the "torch" pack (PyTorch, diffusers, mflux: a venv added at import of the sole generation worker) and stable-diffusion.cpp (`engine/app/engine_install.py`). Nest carries the routes
(same URL and same shape as the former API); the installation runs in the engine and its progress is **pushed** by events.
Application module. Task H4.2.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `EnginesModule.ts` | Controller and service. |
| Controller | `controllers/EnginesController.ts` | The routes below (administrator, plain JSON). `pack/install` is declared before `pack/:packId`. |
| Service | `services/EnginesService.ts` | One typed call per route; errors via `engineErrorToHttp`. |
| Types | `types/enginesTypes.ts` | `PackInstallState`, `EngineInstallState`, `ComponentInfo`, `SetupPlan`, `SetupState`. |

## Dependencies

`engine`: `EngineClient`, `engineErrorToHttp`. The installed / installable state of each engine and pack is in `GET /api/system` (module `hardware`:
`engines`, `packs`, `pack_install`).

## Endpoints exposed (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/engines/pack/:packId/install` | Admin | Starts the installation of a pack (200, `PackInstallState`); 404 unknown pack, 409 refusal (an installation is already running, pack not installable here). |
| `DELETE` | `/api/engines/pack/install` | Admin | Cancels the installation of a pack in progress; 409 if none. |
| `DELETE` | `/api/engines/pack/:packId` | Admin | Uninstalls the pack alone (response once the environment is deleted, 120 s timeout): `{ ok: true }`; downloaded models are kept; 404 unknown pack, 409 if a model of the pack is loaded. The interface uses `components/:id`, which also deletes the dependent models. |
| `POST` | `/api/engines/sdcpp/install` | Admin | Starts the installation of stable-diffusion.cpp (200, `EngineInstallState`); 409 refusal. |
| `DELETE` | `/api/engines/sdcpp/install` | Admin | Cancels; 409 if no installation is running. |
| `POST` | `/api/engines/llamacpp/install` | Admin | Starts the installation of llama.cpp, the chat engine (200, `EngineInstallState`); progress arrives through the `engine.llamacpp.install` event; 409 refusal. |
| `DELETE` | `/api/engines/llamacpp/install` | Admin | Cancels; 409 if no installation is running. |
| `DELETE` | `/api/engines/llamacpp` | Admin | Uninstalls llama.cpp (downloaded models remain); 409 if the chat model is loaded or if an installation is running. |
| `GET` | `/api/engines/components?disk=` | Admin | The downloadable components (base data: PyTorch, FFmpeg; engines: stable-diffusion.cpp, llama.cpp, audio.cpp, packs): `ComponentInfo[]` with state, size, reason for unavailability, installed models that depend on them; `disk=true` also measures the disk space used. |
| `DELETE` | `/api/engines/components/:componentId` | Admin | Deletes the component **and** the installed models that need it (`{ ok, removed_models }`, 120 s timeout); 404 unknown, 409 if it is in use, being installed, built into the application, or if a download of one of its models is running. |
| `GET` | `/api/engines/setup/plan/:modelId` | Admin | What must be downloaded to use a model (`SetupPlan`: base data, engine, model, sizes; what is installed costs 0); 404 unknown model. |
| `POST` | `/api/engines/setup/:modelId` | Admin | Installs everything the model is missing in one run (200, `SetupState`); progress through the `engine.setup.progress` event; 404, 409 (another installation in progress, machine unable). |
| `GET` | `/api/engines/setup` | Admin | State of the run in progress or of the last one. |
| `DELETE` | `/api/engines/setup` | Admin | Cancels: the current step stops and deletes its partial files, finished steps remain; 409 if nothing is running. |

The `engines` segment delegates to the engine through `EngineClient`.

## Events (progress)

`engine.engine.install` (state of stable-diffusion.cpp: bytes downloaded) and `engine.pack.install` (steps of a pack: message,
detail, start), then `engine.models.changed` at the end. Payloads: `back/src/modules/engine/README.md`, "Event flow".

## Entities

None.

## Extension points

`EnginesService` is exported (H4.3+ can trigger an installation from an engine card).

## Tests

```sh
../scripts-local/guarded_run.sh 3 npx jest --runInBand src/modules/engines/services/EnginesService.spec.ts
```

Controller and service on the fake HTTP engine: refusal without administrator, pack installation (URL encoded, 404 relayed), order of
the uninstall and cancel routes, 409 relayed, stable-diffusion.cpp, unreachable engine (502).
