# Module `engines`

## Rôle

Installateurs des moteurs d'inférence, **délégués au moteur Python** : packs audio et vidéo (environnements Python isolés,
`engine/app/audio_packs.py`) et stable-diffusion.cpp (`engine/app/engine_install.py`). Nest porte les routes
(même URL et même forme que l'ancienne API), l'installation tourne dans le moteur et son avancement est **poussé** par événements.
Module d'application. Tâche H4.2.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `EnginesModule.ts` | Contrôleur et service. |
| Contrôleur | `controllers/EnginesController.ts` | Les routes ci-dessous (administrateur, JSON en clair). `pack/install` est déclarée avant `pack/:packId`. |
| Service | `services/EnginesService.ts` | Un appel typé par route ; erreurs via `engineErrorToHttp`. |
| Types | `types/enginesTypes.ts` | `PackInstallState`, `EngineInstallState`. |

## Dépendances

`engine` : `EngineClient`, `engineErrorToHttp`. L'état installé / installable de chaque moteur et pack est dans `GET /api/system` (module `hardware` :
`engines`, `packs`, `pack_install`).

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/engines/pack/:packId/install` | Admin | Démarre l'installation d'un pack (200, `PackInstallState`) ; 404 pack inconnu, 409 refus (une installation est déjà en cours, pack non installable ici). |
| `DELETE` | `/api/engines/pack/install` | Admin | Annule l'installation d'un pack en cours ; 409 si aucune. |
| `DELETE` | `/api/engines/pack/:packId` | Admin | Désinstalle le pack (réponse une fois l'environnement supprimé, délai 120 s) : `{ ok: true }` ; les modèles téléchargés sont conservés ; 404 pack inconnu, 409 si un modèle du pack est chargé. |
| `POST` | `/api/engines/sdcpp/install` | Admin | Démarre l'installation de stable-diffusion.cpp (200, `EngineInstallState`) ; 409 refus. |
| `DELETE` | `/api/engines/sdcpp/install` | Admin | Annule ; 409 si aucune installation en cours. |

Le segment `engines` n'est plus relayé par le proxy transitoire (`NEST_SERVED_SEGMENTS`).

## Événements (progression)

`engine.engine.install` (état de stable-diffusion.cpp : octets téléchargés) et `engine.pack.install` (étapes d'un pack : message,
détail, début), puis `engine.models.changed` à la fin. Charges utiles : `back/src/modules/engine/README.md`, « Flux d'événements ».

## Entités

Aucune.

## Points d'extension

`EnginesService` est exporté (H4.3+ peut déclencher une installation depuis une carte moteur).

## Tests

```sh
../docs/migration/tools/guarded_run.sh 3 npx jest --runInBand src/modules/engines/services/EnginesService.spec.ts
```

Contrôleur et service sur le faux moteur HTTP : refus sans administrateur, installation de pack (URL encodée, 404 relayé), ordre des
routes de désinstallation et d'annulation, 409 relayé, stable-diffusion.cpp, moteur injoignable (502).
