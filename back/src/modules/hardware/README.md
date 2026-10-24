# Module `hardware`

## Role

State of the machine and of the engine, **delegated to the Python engine** by the typed client (GPU/memory/disk detection, the loaded model and its unloading live in `engine/app/system.py` and `jobs.py`). Nest carries the routes and translates the errors. Application module. Task H4.1.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `HardwareModule.ts` | Controller and service (`EngineModule` is global). |
| Controller | `controllers/HardwareController.ts` | The three routes below (administrator; plain JSON). |
| Service | `services/HardwareService.ts` | `system(refresh)`, `status()`, `unload()`; errors via `engineErrorToHttp`. |
| Types | `types/hardwareTypes.ts` | `SystemInfo`, `Accelerator`, `UnusableGpu`, `EngineStatus`. |

## Dependencies

`engine`: `EngineClient`, `engineErrorToHttp` (engine status and message relayed; engine unreachable: 502 `Engine unavailable`).

## Exposed endpoints (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/system?refresh=` | Admin | Hardware: OS, memory, accelerators, unusable GPUs, disk, folders; plus `memory` (the memory ceiling in force, what the models loaded now take and which they are: `engine/app/memory_budget.py`), `engines`, `packs`, `pack_install` (state of the engines and packs, read by the front of the `engines` module; the installations themselves are in `back/src/modules/engines/README.md`). Answers without waiting for the engine's PyTorch probe (a subprocess launched once at startup, several seconds): while it runs, `torch.pending` is `true` and `engines.torch` is unavailable ("detection in progress"), then the engine publishes `models.changed`. `refresh=true` runs the detection again, keeping the probe result. |
| `GET` | `/api/status` | Admin | Generation worker: `state`, `model_id`, `quantize`, queue, last error. |
| `POST` | `/api/engine/unload` | Admin | Unloads the model; 409 (relayed) during a generation. |

These three segments (`system`, `status`, `engine`) delegate to the engine through `EngineClient`.

## Entities

None.

## Extension points

The installers (engines, packs) are in the `engines` module (H4.2); H4.3 moves the worker state to events.

## Tests

```sh
npx jest --runInBand src/modules/hardware/services/HardwareService.spec.ts   # fake engine HTTP server
```
