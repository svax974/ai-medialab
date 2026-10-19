# Module `engines`

## Rôle

Installateurs des moteurs d'inférence, **délégués au moteur Python** : packs audio et vidéo (environnements Python isolés,
`engine/app/audio_packs.py`) et pack « torch » (PyTorch, diffusers, mflux : venv ajouté à l'import du seul worker de génération) et stable-diffusion.cpp (`engine/app/engine_install.py`). Nest porte les routes
(même URL et même forme que l'ancienne API), l'installation tourne dans le moteur et son avancement est **poussé** par événements.
Module d'application. Tâche H4.2.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `EnginesModule.ts` | Contrôleur et service. |
| Contrôleur | `controllers/EnginesController.ts` | Les routes ci-dessous (administrateur, JSON en clair). `pack/install` est déclarée avant `pack/:packId`. |
| Service | `services/EnginesService.ts` | Un appel typé par route ; erreurs via `engineErrorToHttp`. |
| Types | `types/enginesTypes.ts` | `PackInstallState`, `EngineInstallState`, `ComponentInfo`, `SetupPlan`, `SetupState`. |

## Dépendances

`engine` : `EngineClient`, `engineErrorToHttp`. L'état installé / installable de chaque moteur et pack est dans `GET /api/system` (module `hardware` :
`engines`, `packs`, `pack_install`).

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/engines/pack/:packId/install` | Admin | Démarre l'installation d'un pack (200, `PackInstallState`) ; 404 pack inconnu, 409 refus (une installation est déjà en cours, pack non installable ici). |
| `DELETE` | `/api/engines/pack/install` | Admin | Annule l'installation d'un pack en cours ; 409 si aucune. |
| `DELETE` | `/api/engines/pack/:packId` | Admin | Désinstalle le pack seul (réponse une fois l'environnement supprimé, délai 120 s) : `{ ok: true }` ; les modèles téléchargés sont conservés ; 404 pack inconnu, 409 si un modèle du pack est chargé. L'interface utilise `components/:id`, qui supprime aussi les modèles dépendants. |
| `POST` | `/api/engines/sdcpp/install` | Admin | Démarre l'installation de stable-diffusion.cpp (200, `EngineInstallState`) ; 409 refus. |
| `DELETE` | `/api/engines/sdcpp/install` | Admin | Annule ; 409 si aucune installation en cours. |
| `POST` | `/api/engines/llamacpp/install` | Admin | Démarre l'installation de llama.cpp, le moteur du chat (200, `EngineInstallState`) ; la progression arrive par l'événement `engine.llamacpp.install` ; 409 refus. |
| `DELETE` | `/api/engines/llamacpp/install` | Admin | Annule ; 409 si aucune installation en cours. |
| `DELETE` | `/api/engines/llamacpp` | Admin | Désinstalle llama.cpp (les modèles téléchargés restent) ; 409 si le modèle de chat est chargé ou si une installation tourne. |
| `GET` | `/api/engines/components?disk=` | Admin | Les composants téléchargeables (données de base : PyTorch, FFmpeg ; moteurs : stable-diffusion.cpp, llama.cpp, audio.cpp, packs) : `ComponentInfo[]` avec état, taille, raison d'indisponibilité, modèles installés qui en dépendent ; `disk=true` mesure aussi l'espace occupé. |
| `DELETE` | `/api/engines/components/:componentId` | Admin | Supprime le composant **et** les modèles installés qui en ont besoin (`{ ok, removed_models }`, délai 120 s) ; 404 inconnu, 409 s'il est utilisé, en cours d'installation, intégré à l'application ou si un téléchargement d'un de ses modèles tourne. |
| `GET` | `/api/engines/setup/plan/:modelId` | Admin | Ce qu'il faut télécharger pour utiliser un modèle (`SetupPlan` : données de base, moteur, modèle, tailles ; ce qui est installé coûte 0) ; 404 modèle inconnu. |
| `POST` | `/api/engines/setup/:modelId` | Admin | Installe tout ce qui manque au modèle en une exécution (200, `SetupState`) ; progression par l'événement `engine.setup.progress` ; 404, 409 (autre installation en cours, machine incapable). |
| `GET` | `/api/engines/setup` | Admin | État de l'exécution en cours ou de la dernière. |
| `DELETE` | `/api/engines/setup` | Admin | Annule : l'étape en cours s'arrête et supprime ses fichiers partiels, les étapes finies restent ; 409 si rien ne tourne. |

Le segment `engines` délègue au moteur par `EngineClient`.

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
