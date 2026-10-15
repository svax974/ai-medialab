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
| Types | `types/modelCatalogTypes.ts` | `ModelCatalog`, `ModelInfo`, `DownloadProgress`, `HubResult`, `HubInspect`, `HubTrending`, `TrendingEntry`... (formes du moteur). |

## Dépendances

`engine` : `EngineClient` (typé d'après `engine/openapi.json`), `engineErrorToHttp` (statut et message du moteur relayés ; moteur
injoignable : 502 `Engine unavailable`). Les réglages `quantize`, `variant` et `hf_token` sont dans le module `settings` (poussés au
moteur) : changer une quantification passe par `PUT /api/settings`, pas par ce module.

## Modèles de langage (chat)

Le catalogue du moteur contient des modèles `kind: 'llm'` (moteur `llamacpp`) ; Nest les laisse passer sans les transformer. Types
(`types/modelCatalogTypes.ts`) : `ModelKind` ajoute `llm`, `ModelInfo.llm` porte `LlmCapabilities` (`context_default`, `context_max`,
`vision`, `tools`, `reasoning` : `none` | `toggle` | `always` | `levels`, `moe`, `params_b`, `active_params_b`), `ModelCatalog.llm` résume le type
(`default_model_id`, `recommended_model_id`, `ready`). Le module `chat` s'en sert (`ChatModelService`) pour choisir le modèle, savoir s'il lit les
images et s'il appelle des fonctions.

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/models` | Admin | Catalogue : `models[]` (installation, compatibilité, plan mémoire, variantes, téléchargement en cours) + résumés `default_model_id`, `recommended_model_id`, `ready` (image au niveau supérieur, `audio` et `video` imbriqués). |
| `POST` | `/api/models/:id/download` | Admin | Démarre le téléchargement (200, `DownloadProgress`) ; 404 modèle inconnu, 409 refus du moteur (déjà en cours, pas de place...). |
| `DELETE` | `/api/models/:id/download` | Admin | Annule ; 409 si rien n'est en cours. |
| `DELETE` | `/api/models/:id` | Admin | Supprime les fichiers (réponse une fois l'espace libéré) : `{ freed_gb, also_affects }` ; 409 si le modèle est chargé. Délai 120 s. |
| `POST` | `/api/models/custom` | Admin | Ajoute un dépôt Hugging Face : corps `{ repo, option? }` (`option` : `default`), réponse `{ model_id }` ; 400 sans `repo` ; 422 relayé si le dépôt est inutilisable. |
| `DELETE` | `/api/models/:id/custom` | Admin | Retire un modèle ajouté et ses fichiers : `{ freed_gb }` ; 404 si ce n'est pas un modèle personnalisé, 409 s'il est chargé. |
| `GET` | `/api/hf/search?kind=&q=` | Admin | `{ results: HubResult[] }` (formats exécutables seulement, tenue en mémoire par machine, `precisions` : quantifications lues dans la liste des fichiers, sans requête de plus ; tailles exactes : `inspect`) ; 502 si Hugging Face est injoignable. `kind` : `image` (défaut), `audio`, `video`, `llm` (modèles de chat GGUF, famille `llm-gguf`) ; toute autre valeur : 400 (liste blanche `HUB_SEARCH_KINDS`, rien n'atteint le moteur). |
| `GET` | `/api/hf/trending?kind=&days=&limit=&include_heavy=&refresh=` | Admin | « Nouveautés » : `HubTrending` = modèles Hugging Face **récents, qui ont du succès et compatibles avec la machine** d'un type, du meilleur au moins bon (voir « Nouveautés » plus bas). Paramètres validés ici (liste blanche, sinon 400, rien n'atteint le moteur) : `kind` `image` (défaut), `audio`, `video`, `llm` ; `days` entier 7 à 365 (90) ; `limit` entier 1 à 30 (12) ; `include_heavy` et `refresh` `true`/`false` (`false`). 502 si Hugging Face est injoignable. |
| `GET` | `/api/hf/inspect?repo=` | Admin | `HubInspect` : licence, notes, quantifications avec `fits`/`fit_note` et `download_gb` (fichier + fichiers partagés du modèle de référence absents du cache, ce que l'ajout télécharge vraiment) ; 422 relayé si le dépôt est illisible ; 400 sans `repo`. |

Ces segments (`models`, `hf`) délèguent au moteur par `EngineClient`.

## Nouveautés (`GET /api/hf/trending`)

Nest ne fait que relayer ; le calcul est dans `engine/app/hf_trending.py` (route `GET /engine/v1/hf/trending`, segment `hf`), **sans modèle
de langage**. Un dépôt est listé s'il est : créé dans la fenêtre (`days`, le Hub ne filtre pas par date : le filtre est côté moteur) ;
« à succès » (j'aime ET téléchargements des 30 derniers jours au moins égaux au seuil du type : image 15 / 2 000, audio 8 / 250, vidéo
10 / 2 000, chat 100 / 20 000 : des heuristiques lues sur le Hub réel en octobre 2026, modifiables dans `THRESHOLDS`) ; d'une famille que
l'application sait ajouter (`hf_search.classify`) et lisible par `hf_search.inspect` (donc ajoutable) ; ni à accès restreint, ni privé, ni
marqué pour adultes, ni nommé « uncensored / abliterated / nsfw… » ; absent du catalogue (compté dans `hidden.existing`) ; compatible
avec la machine (moteur de la famille disponible ou installable ET variante proposée qui tient en mémoire : mêmes verdicts que la
recherche ; les autres sont comptés dans `hidden.heavy` et renvoyés seulement avec `include_heavy`). Au plus 3 dépôts par modèle de
référence (un modèle populaire est re-quantifié par des dizaines). Classement : `trendingScore` du Hub, puis téléchargements. Chaque entrée porte nom, auteur, famille, âge, téléchargements,
j'aime, licence (`license_note` : `noncommercial` ou `custom` si elle n'est pas une licence ouverte courante), variante proposée
(`option` : la même règle que le détail d'un ajout, la plus petite quand aucune ne tient) avec sa taille à télécharger, verdict
mémoire et lien. Le Hub est interrogé une fois par famille et par tri (`trending_score`, `created_at`, 100 dépôts), les survivants
(24 au plus) sont inspectés en parallèle ; le résultat reste **une heure en mémoire du moteur** par (type, fenêtre) ; `refresh=true`
est ignoré s'il a moins d'une minute (limites de débit du Hub). Le jeton Hugging Face de l'utilisateur est réutilisé s'il existe.

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
moteur injoignable (502), « Nouveautés » (valeurs par défaut, paramètres relayés, 11 valeurs refusées en 400 avant le moteur, administrateur
requis, refus du moteur relayé).
