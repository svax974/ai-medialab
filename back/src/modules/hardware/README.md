# Module `hardware`

## Rôle

État de la machine et du moteur, **délégué au moteur Python** par le client typé (la détection GPU/mémoire/disque, le modèle
chargé et son déchargement vivent dans `engine/app/system.py` et `jobs.py`). Nest porte les routes et traduit les erreurs.
Module d'application. Tâche H4.1.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `HardwareModule.ts` | Contrôleur et service (`EngineModule` est global). |
| Contrôleur | `controllers/HardwareController.ts` | Les trois routes ci-dessous (administrateur ; JSON en clair). |
| Service | `services/HardwareService.ts` | `system(refresh)`, `status()`, `unload()` ; erreurs via `engineErrorToHttp`. |
| Types | `types/hardwareTypes.ts` | `SystemInfo`, `Accelerator`, `UnusableGpu`, `EngineStatus`. |

## Dépendances

`engine` : `EngineClient`, `engineErrorToHttp` (statut et message du moteur relayés ; moteur injoignable : 502
`Engine unavailable`).

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/system?refresh=` | Admin | Matériel : OS, mémoire, accélérateurs, GPU inutilisables, disque, dossiers ; plus `engines`, `packs`, `pack_install` (installateurs : H4.2). `refresh=true` relance la détection (sonde PyTorch du moteur, plusieurs secondes). |
| `GET` | `/api/status` | Admin | Worker de génération : `state`, `model_id`, `quantize`, file, dernière erreur. |
| `POST` | `/api/engine/unload` | Admin | Décharge le modèle ; 409 (relayé) pendant une génération. |

Ces trois segments (`system`, `status`, `engine`) ne sont plus relayés par le proxy transitoire (`NEST_SERVED_SEGMENTS`).

## Entités

Aucune.

## Points d'extension

H4.2 y rattache les installateurs (moteurs, packs) ; H4.3 l'état du worker en événements.

## Tests

```sh
npx jest --runInBand src/modules/hardware/services/HardwareService.spec.ts   # faux moteur HTTP
```
