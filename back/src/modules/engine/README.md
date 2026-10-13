# Module `engine`

## Rôle

Relie Nest au moteur Python (`engine/`, FastAPI interne : modèles, téléchargements, jobs, médias) : **client HTTP typé**,
**relais du flux d'événements du moteur** vers le navigateur, **sonde de santé** et, jusqu'à la tâche H6, **proxy
transitoire** `/api/*` → moteur pour les routes que Nest ne porte pas encore. Le navigateur ne parle qu'à Nest ; le
moteur n'écoute que sur `127.0.0.1` et exige l'en-tête `X-Engine-Token`.

Module d'application (pas un module partagé) ; branché dans `modules/app/AppModule.ts`, `@Global()`.

## Architecture

| Élément | Fichier | Rôle |
|---|---|---|
| `EngineModule` | `EngineModule.ts` | Déclare les providers, fournit `HEALTH_CONTRIBUTORS`, exporte `EngineClient`, `EngineEventRelay`, `ENGINE_CONFIG`. |
| `engineConfig` | `engineConfig.ts` | `resolveEngineConfig(env)` : URL, jeton, délais (variables ci-dessous). |
| Types générés | `generated/engineApi.d.ts` | Types `paths`/`operations` produits par `openapi-typescript` depuis `engine/openapi.json`. **Ne pas éditer** : `npm run engine:types`. |
| Aides de types | `types/engineTypes.ts` | `EnginePath<M>`, `EngineRequestOptions`, `EngineResponse` : requête, paramètres, corps et réponse typés d'après le schéma. |
| `EngineClient` | `services/EngineClient.ts` | Client typé (`get/post/put/patch/delete/request`, `openEventStream`, `buildUrl`, `authHeaders`). |
| `EngineError`, `EngineUnavailableError` | `services/EngineError.ts` | Réponse non 2xx (`status`, `detail` FastAPI) / moteur injoignable ou délai dépassé. |
| `EngineEventRelay` | `services/EngineEventRelay.ts` | Abonnement à `/engine/v1/events` avec reconnexion ; relais vers `EventStreamService` ; flux serveur `events$`. |
| `SseParser` | `services/sseParser.ts` | Analyse incrémentale d'un flux SSE (trames `event:` / `data:`). |
| `EngineHealthContributor` | `services/EngineHealthContributor.ts` | Contribution `engine` de `GET /api/v1/health`. |
| `engineErrorToHttp` | `services/engineHttpError.ts` | Erreur du moteur vers erreur HTTP d'une route Nest (statut et message relayés, injoignable : 502). |
| `EngineProxyService`, `EngineProxyController` | `services/`, `controllers/` | Proxy transitoire (H6 : suppression). |
| Faux moteur de test | `testing/fakeEngine.ts` | Serveur HTTP local qui joue le moteur dans les tests. |

## Dépendances

- `common` : `EventStreamService` (publication), `HEALTH_CONTRIBUTORS`, `AdminOnlyInterceptor`, `NoTransportCrypt`.
- Dev : `openapi-typescript` (ajouté par `back/package.local.json` ; justifié car le contrat est entre deux langages).
- Aucune autre dépendance : `fetch` natif pour le client et le relais, `http` pour le proxy.

**Pourquoi pas `throttledFetch`.** Ce helper de `common` protège les API tierces à quota (espacement entre appels, reprises
avec backoff sur 5xx, réponses périmées). Pour un processus local que nous possédons, il retarderait des appels qui doivent
partir tout de suite (statut, jobs, téléchargements) et masquerait les erreurs 5xx ; le client appelle donc `fetch` directement,
avec délai (`ENGINE_TIMEOUT_MS`) et erreurs typées.

## Configuration

| Variable | Défaut | Effet |
|---|---|---|
| `ENGINE_TOKEN` | vide | Secret partagé, envoyé en `X-Engine-Token` (le moteur lit la même variable). Vide : aucun en-tête. |
| `ENGINE_PORT` | `8000` | Port du moteur sur `127.0.0.1`. |
| `ENGINE_URL` | `http://127.0.0.1:<ENGINE_PORT>` | URL de base (prioritaire sur `ENGINE_PORT`). |
| `ENGINE_TIMEOUT_MS` | `30000` | Délai d'un appel typé (surchargeable par appel : `timeoutMs`). |
| `ENGINE_EVENTS_RELAY` | `true` | `false` : ne pas s'abonner au flux d'événements au démarrage. |
| `ENGINE_RECONNECT_MIN_MS` / `ENGINE_RECONNECT_MAX_MS` | `1000` / `15000` | Reconnexion du flux : délai doublé à chaque échec, plafonné, +-20 % d'aléa. |
| `ENGINE_IDLE_TIMEOUT_MS` | `45000` | Le moteur envoie `: ping` toutes les 15 s ; sans octet pendant cette durée la connexion est coupée puis rétablie. |
| `APP_DATA_DIR` | non défini | Dossier de données commun : le moteur le lit sous le nom `IMAGEGEN_DATA_DIR` (posé par `scripts-local/dev-services.sh`). |

Lancement en dev : `scripts-local/dev-services.sh` (README racine, « Développement avec le serveur NestJS »).

## Client typé

```ts
constructor(private readonly engine: EngineClient) {}

const status = await this.engine.get('/engine/v1/status');
const audio = await this.engine.get('/engine/v1/assets', { query: { media: 'audio' } });
await this.engine.delete('/engine/v1/assets/{asset_id}', { params: { asset_id: id } });
const conv = await this.engine.post('/engine/v1/conversations', { body: { mode: 'image', title: 'T' } });
await this.engine.post('/engine/v1/assets', { form }); // multipart (FormData)
```

Chemins, méthodes, paramètres de chemin et de requête, corps JSON et type de réponse sont vérifiés à la compilation.
Une route absente du schéma, un paramètre manquant ou un corps incomplet ne compilent pas. Les `{param}` du chemin sont
remplacés (valeurs encodées). Erreurs : `EngineError` (le moteur a répondu hors 2xx), `EngineUnavailableError`
(injoignable, délai). Réponse vide ou non JSON : `undefined`.

**Régénérer les types** après toute modification de l'API du moteur :

```sh
engine/.venv/bin/python scripts-local/export_engine_openapi.py   # engine/openapi.json
cd back && npm run engine:types                                   # generated/engineApi.d.ts
```

Un test (`generated/engineApi.contract.spec.ts`) échoue si `engineApi.d.ts` n'est plus celui que produit le schéma ; un
test Python (`engine/tests/test_engine_api.py`) échoue si `engine/openapi.json` est périmé.

## Flux d'événements

`EngineEventRelay` ouvre `GET /engine/v1/events` au démarrage (sauf `ENGINE_EVENTS_RELAY=false`), relit le flux, et pour chaque
événement du moteur publie sur `EventStreamService` :

- sujet **`engine.<nom de l'événement>`** (ex. `engine.job.progress`, `engine.engine.status`, `engine.models.changed`,
  `engine.conversation.updated`), `type` = nom de l'événement, `data` = charge utile du moteur ;
- audience **`{ admin: true }`** : application mono-utilisateur, et le principal du mode local de confiance (`local-trust`)
  est `{ id: 0, admin: true }`, donc il reçoit ces événements (vérifié : `matchesAudience` ne teste que `admin`) ;
- `linkChanges$` (serveur) émet `true` à chaque (re)connexion et `false` à la coupure (`SettingsEngineSync` y renvoie les réglages) ;
- sujet **`engine.link`** : `{ connected: boolean }`, publié à chaque changement d'état du flux (le front relit l'état
  du moteur quand `connected` repasse à `true`, le moteur renvoyant son instantané à chaque connexion).

**Sujets relayés pour les modèles et les installateurs** (H4.2 ; le front s'abonne à ceux-là, vérifiés dans `engine/app/downloads.py`,
`engine_install.py`, `audio_packs.py` et le flux `/engine/v1/events`) :

| Sujet (navigateur) | Événement du moteur | Charge utile | Quand |
|---|---|---|---|
| `engine.download.progress` | `download.progress` | `DownloadProgress` : `model_id`, `state` (`running`, `done`, `error`, `cancelled`), `done`, `total` (octets), `rate` (octets/s), `eta` (s ou `null`), `error` | au plus toutes les 0,4 s pendant un téléchargement, puis à la fin ; rejoué à chaque connexion pour les téléchargements en cours |
| `engine.engine.install` | `engine.install` | `EngineInstallState` (stable-diffusion.cpp) : `state` (`idle`, `running`, `done`, `error`, `cancelled`), `variant`, `done`, `total` (octets), `message`, `error` | toutes les 0,4 s pendant l'installation ; l'état courant est rejoué à chaque connexion |
| `engine.pack.install` | `pack.install` | `PackInstallState` (audio/vidéo) : `state`, `pack`, `name`, `message`, `detail`, `started_at` (s epoch), `size_mb`, `error` | à chaque étape de l'installation d'un pack (pas de pourcentage) ; rejoué à chaque connexion |
| `engine.models.changed` | `models.changed` | `{}` | fin d'un téléchargement, d'une suppression, d'un ajout ou retrait de modèle personnalisé, d'une (dés)installation de pack ou de moteur : le catalogue et `/api/system` sont à relire |

Le nom `engine.engine.install` n'est pas une faute : préfixe `engine.` + événement `engine.install`.

## Contrat de jobs (H4.3a)

Le moteur est **sans état applicatif** pour les jobs soumis par Nest : il ne lit ni n'écrit conversations, messages ni assets. Routes
réservées à Nest (jeton `X-Engine-Token`, absentes de l'ancien préfixe `/api`) :

| Route | Rôle |
|---|---|
| `POST /engine/v1/jobs/check` `{ model_id, reference_media }` | Refuse (422, message à afficher tel quel) une génération que le modèle ne sait pas faire ; renvoie `{ kind, name, max_count, default_params }`. |
| `POST /engine/v1/jobs` `{ job_id, kind, model_id, prompt, params, inputs, output_dir, voices? }` (202) | Met le job en file. `inputs`, `output_dir` et les chemins de `voices` : absolus et **dans le dossier de données** (422 sinon). `job_id` déjà actif : 409. Le contenu (prompt vide, référence absente, modèle non installé…) est vérifié à l'exécution et signalé par `job.failed`. |
| `GET /engine/v1/jobs` / `GET /engine/v1/jobs/{id}` | Jobs actifs / état d'un job (`queued`, `loading`, `running`, `done`, `failed`, `cancelled`, `outputs`, `error`) ; les 100 derniers jobs terminés restent consultables (404 sinon). |
| `POST /engine/v1/jobs/{id}/cancel` | Un job en file s'arrête aussitôt ; un job en cours s'arrête après l'étape courante (pendant le chargement du modèle, le worker est tué ; `sd-cli` est arrêté par son moteur). 409 s'il n'est plus en cours, 404 s'il est inconnu. |
| `POST /engine/v1/media/ingest` `{ source_path, asset_id, original_name, content_type }` | Transforme un envoi brut en référence stockée (PNG ou vidéo conservée, vignette) ; renvoie `{ media, filename, thumb, width, height, duration, meta }` ; consomme le fichier source. |
| `POST /engine/v1/media/purge` `{ files: [{ folder, filename, thumb? }] }` | Supprime des fichiers médias et leurs vignettes (noms seuls). |

Événements du job (sur `/engine/v1/events`, tous avec `job_id`) :

| Événement | Charge utile (en plus de `job_id`) |
|---|---|
| `job.started` | `kind`, `model_id`, `params` (résolus : dimensions, graines, étapes, tâche vidéo…), `started_at` |
| `job.progress` | `phase` (`loading` pendant le chargement du modèle, `running`), `count`, `index`, `step`, `total`, `eta`, `seconds_per_step`, `stage`, `preview_url`, `load_started_at` (rejoué à la connexion pour les jobs actifs) |
| `job.preview` | `index`, `path`, `filename`, `url` (`/media/previews/…`) |
| `job.output` | un fichier produit : `index`, `media` (`image`, `audio`, `video`), `asset_id` (choisi par le moteur : la vignette en porte le nom), `path`, `filename`, `thumb`, `width`, `height`, `seed`, `duration`, `meta` (modèle, prompt, étapes, graine, durée de calcul ; fps, voix, formes d'onde, marqueurs selon le média) |
| `job.done` | `outputs` (nombre de fichiers) |
| `job.failed` | `error` (texte à afficher) |
| `job.cancelled` | `outputs` |

Garde-fous conservés : un modèle chargé à la fois, une génération à la fois, déchargement après inactivité (`keep_alive_minutes`),
annulation. Les vignettes et le sondage des médias restent au moteur (`media.py`, `job_outputs.py`).

**Ancien chemin.** L'ancienne interface (`frontend/`, jusqu'à H6) parle directement au moteur : `POST /api/messages` écrit toujours
la base du moteur, mais ne génère plus lui-même : `engine/app/legacy_jobs.py` construit le même `JobRequest` (références de la
base, `outputs/`) avec un *sink* qui écrit les messages et assets et publie les anciens événements (`message.updated`, `job.progress`
avec `message_id` et `conversation_id`, `job.image`) ; ces jobs n'émettent pas les événements `job.*` du nouveau contrat.
Les deux bases (celle du moteur et celle de Nest) sont indépendantes : un message créé par l'une n'existe pas dans l'autre.

Côté navigateur : `GET /api/v1/events/stream?topics=engine.job.progress,engine.link`. Côté serveur, `events$` donne les
événements (`{ name, data }`) à un service Nest (H4.3 en dépend pour mettre les messages à jour). Reconnexion : délai
`min * 2^n` plafonné, aléa +-20 %, remis à zéro après une ouverture réussie ; coupure silencieuse détectée par le délai
d'inactivité. Une indisponibilité prolongée n'est journalisée qu'une fois par série.

Limites : un événement de plus de 16 Ko est abandonné par `EventStreamService` (journalisé) ; `events$` le reçoit toujours.

## Proxy transitoire `/api/*` (supprimé en H6)

Pour que l'ancienne interface (et le nouveau front, avant que Nest ne porte chaque fonctionnalité) fonctionne dès
maintenant, toute requête `/api/<segment>[/...]` dont le premier segment est dans `PROXIED_SEGMENTS`
(`events, voices`) est relayée à
`/engine/v1/<segment>[/...]` avec `X-Engine-Token`. Un test vérifie que cette liste et `NEST_SERVED_SEGMENTS` (segments servis par Nest ou réservés à Nest : `engine`, `runtime`,
`settings`, `status`, `system` repris par `settings` et `hardware` en H4.1 ; `engines`, `hf`, `models` repris par `engines` et `model-catalog` en H4.2 ; `assets`, `conversations`, `messages` repris par `media-library` et `studio-core` en H4.3a, avec `jobs` et `media` qui ne sont appelés que par Nest) couvrent tous les premiers segments de
`engine/openapi.json`. Chaque tâche H4 retire de `PROXIED_SEGMENTS` les routes qu'elle reprend (et les ajoute à `NEST_SERVED_SEGMENTS`).

- **Ce qui reste au proxy (H4.3a)** : `events` (flux historique du moteur, que les composants migrés ne consomment plus : ils
  lisent `studio.*` et `engine.*`) et `voices`, qui appartiennent à H4.5 : la bibliothèque de voix est toujours celle de la base du
  moteur, que les jobs audio de Nest consultent eux aussi (le contrat accepte `voices`, mais Nest n'en passe pas encore). Limite
  connue jusqu'à H4.5 : `POST /api/voices/from-asset` cherche l'asset dans la base du moteur, donc un asset créé par Nest
  depuis H4.3a (génération ou envoi) n'y est pas trouvé.
- **Médias** : `/api/media/<kind>/<fichier>` → `/media/<kind>/<fichier>` du moteur (sans jeton, plages `Range` transmises).
  Le préfixe `/api` évite que le repli SPA de `serveFrontend` (qui sert `index.html` à tout `GET` acceptant du HTML hors
  `/api`) ne masque un média ouvert dans un onglet.
- **Pas de collision** : `/api/v1/*` (routes Nest) et `/api` (Swagger) n'ont pas de segment listé ; Nest les sert comme avant.
  Le contrôleur est exclu de Swagger.
- **Flux, envois, JSON** : réponses relayées en continu (le flux SSE reçoit `Cache-Control: no-cache, no-transform` et
  `X-Accel-Buffering: no`, comme les flux Nest, pour échapper à la compression) ; les envois `multipart` sont transmis sans
  être lus ; un corps JSON, déjà lu par le parseur de Nest, est resérialisé **sans** les membres `uid` / `user` que
  l'intercepteur d'authentification y recopie. L'en-tête `Authorization` du navigateur n'est jamais transmis au moteur.
- **Sécurité** : `AdminOnlyInterceptor` (le principal `local-trust` est administrateur). Sans principal ou non admin : 401.
  Moteur injoignable : 502 `{ statusCode: 502, message: 'Engine unavailable' }`.
- Limite connue : un `<img>` ou `EventSource` n'envoie pas `Authorization` ; hors mode local de confiance, ces ressources
  ne sont accessibles qu'avec un autre mécanisme (sans objet pour cette application locale).

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/health` | Public | Route de `common` ; ce module y ajoute `checks.engine` : `{ status, events, engine }`. |
| `ALL` | `/api/<events\|voices>[/...]` | Admin (`local-trust` inclus) | Proxy transitoire vers `/engine/v1/...`. |
| `ALL` | `/api/media/...` | Admin | Proxy transitoire vers les médias du moteur (`/media/...`). |

Santé : `status: ok` si `/engine/v1/status` répond sous 2 s, sinon **`degraded`** (HTTP 200 : le serveur et l'interface
fonctionnent, seule la génération est indisponible ; le moteur est supervisé par le lanceur ou la coquille de bureau) ;
`events` indique si le flux d'événements est ouvert.

## Entités

Aucune. (La persistance des conversations, messages et assets arrive en H2.)

## Points d'extension

- Injecter `EngineClient` (typage complet) ou s'abonner à `EngineEventRelay.events$` depuis un module applicatif.
- Un module qui reprend une route du proxy (H4) la retire de `PROXIED_SEGMENTS` et passe à `EngineClient`.
- `HEALTH_CONTRIBUTORS` est fourni ici sous forme de tableau : un autre contributeur est à ajouter à ce tableau (un seul
  fournisseur du jeton par projet).

## Tests

Un fichier à la fois, depuis `back/` (sous `docs/migration/tools/guarded_run.sh 3`) :

```sh
npx jest --runInBand src/modules/engine/services/EngineClient.spec.ts      # idem pour les autres fichiers du dossier
```

Fichiers : `engineConfig.spec.ts`, `services/{EngineClient,EngineEventRelay,EngineHealthContributor,EngineProxy,sseParser}.spec.ts`
(faux moteur HTTP local, `testing/fakeEngine.ts`), `generated/engineApi.contract.spec.ts` (types à jour).
