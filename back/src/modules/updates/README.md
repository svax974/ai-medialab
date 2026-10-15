# Module `updates`

## Rôle

Recherche de mises à jour des moteurs et des modèles **installés**, et lancement d'une mise à jour à la fois. **Délégué au moteur
Python** (`engine/app/updates.py`, routes `engine/app/api/updates.py`) : c'est lui qui sait ce qui est installé et comment le comparer.
Une mise à jour n'est pas un mécanisme de plus : c'est l'installateur existant relancé (téléchargement du modèle, installation du
moteur ou du pack), dont l'avancement arrive par les événements habituels. Rien ne se met à jour sans demande (pas de mise à jour
automatique). **Conseiller** : à la demande, le modèle de chat local lit des sources publiques structurées (GitHub pour un moteur,
Hugging Face pour un modèle) et liste les problèmes signalés sur la mise à jour ; Nest **enregistre** l'avis (`update_advisories`) et le
restitue ensuite, même hors ligne. L'avis est consultatif : il ne bloque jamais une mise à jour. Module d'application.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `UpdatesModule.ts` | Contrôleur, services, entité des avis ; importe `StudioCoreModule` (jauge du moteur et file des générations). |
| Contrôleur | `controllers/UpdatesController.ts` | Les routes ci-dessous (administrateur, JSON en clair). |
| Service | `services/UpdatesService.ts` | Un appel typé par route ; erreurs via `engineErrorToHttp` ; délai de 120 s pour la recherche (lit l'API Hugging Face et GitHub), 360 s pour une analyse. `check` fusionne les avis enregistrés ; `advise` demande l'analyse au moteur, tient la jauge `EngineBusyGate` (propriétaire `update-advice`) et enregistre. |
| Service | `services/UpdateAdvisoryService.ts` | Enregistre les avis, garde les 5 plus récents par élément (`ADVISORY_HISTORY`), les attache aux lignes d'un rapport (`merge`), signale ceux qui ne portent plus sur la version proposée (`stale`). |
| Entité | `entities/UpdateAdvisoryEntity.ts` | Table `update_advisories` (migration `1792061048743-UpdateAdvisories.ts`). |
| DTO | `dto/AdviseBody.ts` | `parseAdviseBody` : `{ kind, id, target? }` validé (liste blanche, motif d'identifiant, 400 sinon). |
| Mappeur | `mappers/advisoryMapper.ts` | Entité vers forme publique (snake_case). |
| Types | `types/updatesTypes.ts` | `UpdatesReport`, `EngineUpdate`, `ModelUpdate`, `UpdateStarted`, `UpdateAdvisory`, `EngineAdvice`, `AdviceFinding`. |

## Dépendances

`engine` : `EngineClient`, `engineErrorToHttp` (segment `updates` de `ENGINE_API_SEGMENTS`). `studio-core` : `EngineBusyGate`, `GenerationQueueService` (une analyse charge le modèle de chat : pas pendant une génération ni une réponse du chat, et inversement). `media-library` : `newId`, `nowSeconds`. `dto/UpdateEngineBody.ts` : `parseUpdateEngineBody` (liste blanche du corps ; les clés ajoutées par la couche d'authentification sont ignorées). Types seulement : `engines`
(`EngineInstallState`, `PackInstallState`) et `model-catalog` (`DownloadProgress`, `ModelKind`).

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/updates/check` | Admin | Moteurs installés et modèles installés, chacun `current`, `update` ou (modèles) `error` : `UpdatesReport`. Lit le réseau : plusieurs secondes. |
| `POST` | `/api/updates/models/:id` | Admin | Retélécharge les fichiers du modèle qui ont changé sur Hugging Face (200, `DownloadProgress`) ; 404 modèle inconnu, 409 : déjà à jour, non installé, chargé en mémoire, autre téléchargement en cours, vérification en erreur. |
| `POST` | `/api/updates/engines/:id` | Admin | Réinstalle un moteur : `sdcpp`, `audiocpp` ou l'identifiant d'un pack (200, état de l'installateur). Corps optionnel `{ target }`, liste blanche `pinned` (défaut : la version testée par l'application, ou retour à elle depuis une build plus récente) ou `latest` (la dernière version amont, non testée : `sdcpp` et `audiocpp` seulement) ; autre valeur : 400. 404 moteur non installé ; 409 : déjà à jour, pas de version plus récente connue (`latest`), génération en cours, moteur utilisé par le modèle chargé, autre installation en cours. |
| `GET` | `/api/updates/advisories` | Admin | Tous les avis enregistrés, du plus récent au plus ancien : `UpdateAdvisory[]`. `stale` vaut `null` tant qu'aucune vérification n'a été vue depuis le démarrage, sinon `true` quand l'avis porte sur une version qui n'est plus celle proposée. Affiché avant ou sans vérification (hors ligne). |
| `POST` | `/api/updates/advise` | Admin | Corps `{ kind: 'engine' \| 'model', id, target?: 'pinned' \| 'latest' }` (400 si invalide ; `target` : `latest` n'a de sens que pour un moteur). Le moteur lit les sources et le modèle local en extrait les problèmes (environ une minute) ; la réponse est enregistrée et renvoyée : `UpdateAdvisory` (200). 409 avec `{ code, message }` : `busy` (génération, réponse du chat ou autre analyse en cours), `no_engine` (llama.cpp absent), `no_model` (aucun modèle de chat installé), `nothing_to_analyse`, `unsupported` ; 404 `not_installed` ; 502 `no_sources`, `llm_output` ; 504 `llm`. |
| `DELETE` | `/api/updates/advisories/:id` | Admin | Supprime un avis (`{ ok: true }`) ; 404 s'il n'existe pas. |

## L'avis (voir `engine/app/update_advisor.py`, seul propriétaire de ces règles)

`UpdateAdvisory` : `kind`, `item_id`, `from_version` (build installée, ou révision courte du cache), `to_version` (release visée, ou
empreinte de ce qui a changé sur le Hub pour un modèle), `verdict` (`none` | `caution` | `discouraged`, **calculé par le code** à partir des constats
retenus et des régressions connues, jamais donné par le modèle), `summary`, `findings` (`severity`, `title`, `quote` : extrait recopié et **vérifié** dans la source,
`url`, `source_kind`), `sources`, `notes` (ce qui n'a pas pu être lu), `llm_model_id`, `created_at`, `stale`. Une ligne par analyse, les cinq dernières par
élément ; pour une même version, la plus récente fait foi. `check` les fusionne dans `advice` (moteur : la release que l'update installe) et `latest.advice` (la
release amont non testée), et dans `advice` des modèles (liés à l'empreinte `fingerprint`) ; une ligne à jour n'en porte pas ; un avis d'une autre version est rendu `stale: true`.

## Ce qui compte comme une mise à jour (voir `engine/app/updates.py`, seul propriétaire de ces règles)

Modèle : un fichier que le modèle télécharge et possède déjà a un identifiant différent sur Hugging Face. Moteur sd.cpp / audio.cpp :
build installée plus ancienne que la version épinglée par l'application = mise à jour recommandée et testée (`state`) ; une release
amont plus récente que l'installée et l'épinglée est en plus proposée comme **`latest`** (non testée, avec les régressions connues de
ce dépôt qui la touchent : table `KNOWN_REGRESSIONS`), que l'utilisateur peut choisir après confirmation ; une build plus récente que l'épinglée
(installée en `latest`) n'est jamais rétrogradée d'office, mais `rollback` permet de revenir à la version testée. Pack Python : dépendances
épinglées par l'application changées depuis l'installation. Chaque ligne de moteur porte `advice` et `latest.advice` (l'avis enregistré, ou `null`), chaque ligne de modèle `advice`, `revision` et `fingerprint` (ce à quoi l'avis est lié).

## Événements (progression)

Aucun événement propre : `engine.download.progress` (modèles), `engine.engine.install` (stable-diffusion.cpp), `engine.pack.install`
(packs et audio.cpp), puis `engine.models.changed`. Charges utiles : `back/src/modules/engine/README.md`, « Flux d'événements ».
Chaque installateur n'en exécute qu'un à la fois : celui qui lance plusieurs mises à jour les enchaîne (le front, module `updates`).

## Entités

`update_advisories` (`UpdateAdvisoryEntity`) : `id`, `kind`, `item_id`, `from_version`, `to_version`, `verdict`, `summary`, `findings` (JSON), `sources` (JSON), `notes` (JSON),
`llm_model_id`, `created_at` (secondes, strictement croissantes) ; index `(kind, item_id, created_at)`. Types de colonnes portables (`jsonColumnType()`).

## Tests

```sh
../docs/migration/tools/guarded_run.sh 3 npx jest --runInBand src/modules/updates/services/UpdatesService.spec.ts
../docs/migration/tools/guarded_run.sh 3 npx jest --runInBand src/modules/updates/services/UpdateAdvisoryService.spec.ts
../docs/migration/tools/guarded_run.sh 3 npx jest --runInBand src/modules/updates/UpdatesModule.spec.ts
```

Contrôleur et service sur le faux moteur HTTP : refus sans administrateur, rapport relayé, lancement (identifiant encodé), `target` par défaut,
`latest` et valeurs refusées (400, rien n'atteint le moteur), refus 409 et 404 relayés, moteur injoignable (502).

`UpdateAdvisoryService.spec.ts` (base SQLite en mémoire) : enregistrement et ordre, historique borné à cinq par élément, suppression, fusion dans un rapport
(release testée et `latest` sans mélange, avis périmé, élément à jour, empreinte d'un modèle), drapeau `stale` de la liste. `UpdatesService.spec.ts`, section
« advice » : l'avis demandé est enregistré et rendu, corps validé (huit corps refusés en 400), refus pendant une génération ou une réponse du chat, refus du
moteur relayés avec leur `code` et jauge toujours rendue, une seule analyse à la fois. `UpdatesModule.spec.ts` : câblage du conteneur.
