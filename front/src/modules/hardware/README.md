# Module `hardware` (front)

## Role

State of the machine and of the engine: the "This machine" card (chip or GPU, RAM, models disk, GPUs detected but
unusable), and hooks on the worker state (`GET /api/status`) and on the model unload (`POST /api/engine/unload`).
Back: `back/src/modules/hardware/README.md`. Task H4.1.

The former interface did not show this information on the home card: the "This machine" card was in the models
dialog (`ModelsDialog.tsx`) and the worker state in `EngineCard.tsx`. This module provides them; **the models
dialog (H4.2, module `model-catalog`) mounts `MachineCard`/`StoragePaths`, the engine cards (module `engines`) read `engines`, `packs` and `pack_install` from `useSystemInfo`, the engine card (`EngineCard` of module `studio-core`, H4.3b) uses `useEngineStatus`/`useUnloadEngine`**.

## Structure

```
hardware/
  index.ts                     exports
  types.ts                     SystemInfo (+ engines, packs, pack_install), Accelerator, UnusableGpu, EngineStatus, EngineInfo, PackInfo, installation states
  services/hardwareApi.ts      system(refresh), status(), unload()
  hooks/useHardware.ts         useSystemInfo({ enabled, pollMs }), useEngineStatus(), useUnloadEngine()
  lib/hardwareKeys.ts          TanStack Query keys: ['system'], ['engine-status']
  lib/machine.ts               formatGb (exported), gpuKind, isDiskLow (pure, tested)
  components/MachineCard.tsx   MachineCard (loads and refreshes), MachineSummary (data in props), StoragePaths
  locales/                     locales.fr.json, locales.en.json (keys hardware.*)
```

## Behavior

- `MachineCard`: loading, error with `Réessayer` (Retry), content; refreshed every 8 s while mounted.
- Disk: warning under 40 GB free; `Aucun GPU exploitable` (no usable GPU) as a warning when there is no accelerator.
- Invalidations (event stream, `studio-shell/lib/eventEffects.ts`): `engine.engine.status` rereads the worker state;
  `engine.models.changed` and the end of an installation (`engine.engine.install`, `engine.pack.install`) reread `['system']`.

## Tests

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/hardware/lib/machine.spec.ts
```

`lib/machine.spec.ts`, `services/hardwareApi.spec.ts` (services mocked; no rendering).

## Correspondence with the former interface

| Former (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `ModelsDialog.tsx`: `MachineCard`, `Stat` | `components/MachineCard` (`MachineSummary`) |
| `ModelsDialog.tsx`: paths in the footer | `StoragePaths` |
| `lib/api.ts`: `system`, `status`, `unload` | `services/hardwareApi.ts` |
| `lib/format.ts`: `gb` | `lib/machine.ts` `formatGb` (separator depending on the language) |
