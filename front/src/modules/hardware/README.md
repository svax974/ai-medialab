# Module `hardware` (front)

## Rôle

État de la machine et du moteur : carte « Cette machine » (puce ou GPU, mémoire vive, disque des modèles, GPU détectés mais
inutilisables), et hooks sur l'état du worker (`GET /api/status`) et le déchargement du modèle (`POST /api/engine/unload`).
Back : `back/src/modules/hardware/README.md`. Tâche H4.1.

L'ancienne interface n'affichait pas ces informations sur la carte d'accueil : la carte « Cette machine » était dans le
dialogue des modèles (`ModelsDialog.tsx`) et l'état du worker dans `EngineCard.tsx`. Ce module les fournit ; **le dialogue des
modèles (H4.2, module `model-catalog`) monte `MachineCard`/`StoragePaths`, les cartes de moteurs (module `engines`) lisent `engines`, `packs` et `pack_install` de `useSystemInfo`, la carte moteur (`EngineCard` du module `studio-core`, H4.3b) utilise `useEngineStatus`/`useUnloadEngine`**.

## Structure

```
hardware/
  index.ts                     exports
  types.ts                     SystemInfo (+ engines, packs, pack_install), Accelerator, UnusableGpu, EngineStatus, EngineInfo, PackInfo, états d'installation
  services/hardwareApi.ts      system(refresh), status(), unload()
  hooks/useHardware.ts         useSystemInfo({ enabled, pollMs }), useEngineStatus(), useUnloadEngine()
  lib/hardwareKeys.ts          clés TanStack Query : ['system'], ['engine-status']
  lib/machine.ts               formatGb (exporté), gpuKind, isDiskLow (pur, testé)
  components/MachineCard.tsx   MachineCard (charge et rafraîchit), MachineSummary (données en props), StoragePaths
  locales/                     locales.fr.json, locales.en.json (clés hardware.*)
```

## Comportement

- `MachineCard` : chargement, erreur avec « Réessayer », contenu ; rafraîchie toutes les 8 s tant qu'elle est montée.
- Disque : avertissement sous 40 Go libres ; « Aucun GPU exploitable » en avertissement quand aucun accélérateur.
- Invalidations (flux d'événements, `studio-shell/lib/eventEffects.ts`) : `engine.engine.status` relit l'état du worker ;
  `engine.models.changed` et la fin d'une installation (`engine.engine.install`, `engine.pack.install`) relisent `['system']`.

## Tests

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/hardware/lib/machine.spec.ts
```

`lib/machine.spec.ts`, `services/hardwareApi.spec.ts` (services mockés ; pas de rendu).

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`, supprimé en H6 : `git show 2435ab3:frontend/src/…`) | Nouveau |
|---|---|
| `ModelsDialog.tsx` : `MachineCard`, `Stat` | `components/MachineCard` (`MachineSummary`) |
| `ModelsDialog.tsx` : chemins en pied | `StoragePaths` |
| `lib/api.ts` : `system`, `status`, `unload` | `services/hardwareApi.ts` |
| `lib/format.ts` : `gb` | `lib/machine.ts` `formatGb` (séparateur selon la langue) |
