# Module `model-catalog`

## Rôle

Catalogue des modèles, téléchargements, modèles personnalisés et recherche Hugging Face, **délégués au moteur Python** (le
registre, le calcul de tenue en mémoire, la compatibilité matérielle, les téléchargements et la recherche vivent dans
`engine/app/catalog.py`, `downloads.py`, `hf_search.py`, `engines/custom.py`). Nest porte les routes (même URL, même forme
que l'ancienne API du moteur), applique l'authentification administrateur et traduit les erreurs. Il ne persiste rien. Module
d'application. Tâche H4.2.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `ModelCatalogModule.ts` | Contrôleur et service (`EngineModule` est global). |
| Contrôleur | `controllers/ModelCatalogController.ts` | Les routes ci-dessous (administrateur, JSON en clair, `NoTransportCrypt`, hors Swagger). `models/custom` est déclarée avant `models/:id/...`. |
| Service | `services/ModelCatalogService.ts` | Un appel typé du client du moteur par route ; erreurs via `engineErrorToHttp`. |
| Types | `types/modelCatalogTypes.ts` | `ModelCatalog`, `ModelInfo`, `DownloadProgress`, `HubResult`, `HubInspect`... (formes du moteur). |

## Dépendances

`engine` : `EngineClient` (typé d'après `engine/openapi.json`), `engineErrorToHttp` (statut et message du moteur relayés ; moteur
injoignable : 502 `Engine unavailable`). Les réglages `quantize`, `variant` et `hf_token` sont dans le module `settings` (poussés au
moteur) : changer une quantification passe par `PUT /api/settings`, pas par ce module.

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/models` | Admin | Catalogue : `models[]` (installation, compatibilité, plan mémoire, variantes, téléchargement en cours) + résumés `default_model_id`, `recommended_model_id`, `ready` (image au niveau supérieur, `audio` et `video` imbriqués). |
| `POST` | `/api/models/:id/download` | Admin | Démarre le téléchargement (200, `DownloadProgress`) ; 404 modèle inconnu, 409 refus du moteur (déjà en cours, pas de place...). |
| `DELETE` | `/api/models/:id/download` | Admin | Annule ; 409 si rien n'est en cours. |
| `DELETE` | `/api/models/:id` | Admin | Supprime les fichiers (réponse une fois l'espace libéré) : `{ freed_gb, also_affects }` ; 409 si le modèle est chargé. Délai 120 s. |
| `POST` | `/api/models/custom` | Admin | Ajoute un dépôt Hugging Face : corps `{ repo, option? }` (`option` : `default`), réponse `{ model_id }` ; 400 sans `repo` ; 422 relayé si le dépôt est inutilisable. |
| `DELETE` | `/api/models/:id/custom` | Admin | Retire un modèle ajouté et ses fichiers : `{ freed_gb }` ; 404 si ce n'est pas un modèle personnalisé, 409 s'il est chargé. |
| `GET` | `/api/hf/search?kind=&q=` | Admin | `{ results: HubResult[] }` (formats exécutables seulement, tenue en mémoire par machine, `precisions` : quantifications lues dans la liste des fichiers, sans requête de plus ; tailles exactes : `inspect`) ; 502 si Hugging Face est injoignable. `kind` : `image` (défaut), `audio`, `video`. |
| `GET` | `/api/hf/inspect?repo=` | Admin | `HubInspect` : licence, notes, quantifications avec `fits`/`fit_note` et `download_gb` (fichier + fichiers partagés du modèle de référence absents du cache, ce que l'ajout télécharge vraiment) ; 422 relayé si le dépôt est illisible ; 400 sans `repo`. |

Ces segments (`models`, `hf`) délèguent au moteur par `EngineClient`.

## Événements (progression)

Rien n'est interrogé : le moteur publie, `EngineEventRelay` relaie, le navigateur s'abonne à `GET /api/v1/events/stream?topics=…` :
`engine.download.progress` (progression d'un téléchargement : octets, débit, temps restant), `engine.models.changed` (catalogue à
relire). Charges utiles et fréquence : `back/src/modules/engine/README.md`, « Flux d'événements ».

## Entités

Aucune.

## Points d'extension

`ModelCatalogService` est exporté : H4.3+ peut lire le catalogue (`catalog()`) pour valider le modèle d'un job.

## Tests

```sh
../docs/migration/tools/guarded_run.sh 3 npx jest --runInBand src/modules/model-catalog/services/ModelCatalogService.spec.ts
```

Contrôleur et service sur le faux moteur HTTP (`engine/testing/fakeEngine.ts`) : refus sans administrateur, relais du catalogue,
téléchargement (URL encodée), refus 409/422 relayés avec leur message, ordre des routes (`models/custom`), recherche et inspection,
moteur injoignable (502).
