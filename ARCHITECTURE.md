# Architecture d'AI MediaLab

Point d'entrée technique du projet : la **forme** de l'application (processus, propriétés, flux, contrats). Le détail de
chaque brique est dans l'annexe qui la possède (carte ci-dessous) ; ce fichier ne recopie ni constante ni liste d'URL.

## Carte de la documentation

La seule liste faisant autorité des annexes du projet et de ce que chacune possède. Une annexe absente de cette carte
n'existe pas ; une nouvelle annexe s'y ajoute avec son chemin (règle « un fait, un seul endroit », `CLAUDE.md`).

| Fichier | Possède |
|---|---|
| `README.md` | Présentation, lancement (développement, bureau), variables d'environnement du moteur, règles de test, guide des modèles et moteurs pour l'utilisateur (image, audio, vidéo, mesures, limites) |
| `FEATURES.md` | Inventaire de ce qui est construit, par module (et ce qui ne l'est pas) |
| `ARCHITECTURE.md` (ce fichier) | Processus, contrat Nest ↔ moteur, flux d'événements, données et migrations, bureau, mémoire au repos, plan du moteur |
| `CLAUDE.md` | Règles de travail du projet : gabarit importé, mémoire unifiée (critique), notes de développement |
| `back/src/modules/<module>/README.md` | Contrat d'un module serveur : rôle, fichiers, endpoints exhaustifs, entités, tests. Modules : `engine`, `settings`, `hardware`, `model-catalog`, `engines`, `studio-core`, `media-library`, `audio-studio`, `legacy-import` |
| `back/src/migrations/README.md` | Migrations TypeORM de la base de Nest : usage, génération, vérification |
| `front/src/modules/<module>/README.md` | Contrat d'un module d'interface : composants, hooks, locales, parité avec l'ancienne interface. Modules : `studio-shell`, `studio-core`, `image-studio`, `audio-studio`, `voices`, `video-studio`, `media-library`, `model-catalog`, `engines`, `settings`, `hardware` |
| `front/src/themes/chambre-noire/README.md` | Thème « chambre noire » : jetons, surcharges MUI |
| `desktop/README.md` | Coquille de bureau (Tauri) : configuration, lancement, empaquetage, signature, CI |
| `engine/openapi.json` | Contrat de l'API interne du moteur (**généré** : `scripts-local/export_engine_openapi.py`) |
| `docs/components/README.md` | Registre des composants tiers intégrés et procédure de revue ; fiches `audiocpp.md`, `pytorch-gpu.md`, `ffmpeg.md` (build et licence de FFmpeg), `audiocpp-tests-manuels.md` |
| `THIRD_PARTY_LICENSES.md` | Licences des composants et des modèles |
| `docs/migration/` | Plan et suivi de la migration vers le gabarit vx-public (historique) |
| `back/.libs/vx-public/template/CLAUDE.md`, `front/.libs/apptemplate/README.md` | Conventions du gabarit et lanceur (hors de ce dépôt : sous-modules) |

*Dernière vérification contre les sources : 2026-10-13 (fin de la migration, tâche H6).*

## Vue d'ensemble : quatre processus

```
navigateur / fenêtre Tauri
        │  HTTP + SSE (/api/v1, /api/…)           (le seul point d'entrée du navigateur)
        ▼
  Nest (back/, port 3000)  ──── HTTP + jeton X-Engine-Token ───►  moteur Python (engine/, 127.0.0.1:8000)
   · routes /api, base SQLite app.db                               · modèles, téléchargements, jobs, médias
   · file des générations, relais d'événements                     · un modèle chargé à la fois (worker séparé)
   · sert le front compilé (bureau)                                · n'a pas de base applicative
        ▲
        │ supervise (bureau seulement)
  coquille Tauri (desktop/)  ──►  lance le moteur, puis Nest, puis ouvre l'interface
```

| Processus | Rôle | Écoute | Possède |
|---|---|---|---|
| **Moteur** (`engine/`, FastAPI) | Tout ce qui fait tourner des modèles : détection de la machine, catalogue, téléchargements, installateurs de moteurs, planification et exécution des générations (image, audio, vidéo), vignettes et sondage des médias | `127.0.0.1` seulement, jeton obligatoire | Les fichiers médias (`uploads/`, `outputs/`, `thumbs/`, `previews/`), le cache des modèles, `engine-state.json`, les moteurs installés (`engines/`) |
| **Nest** (`back/`, vx-public) | L'application : conversations, messages, assets, voix, réglages, file des générations, import de l'ancienne base, événements vers le navigateur | `NODE_PORT` (3000), `LOCAL_TRUST` | La base `app.db` et toutes les données applicatives |
| **Front** (`front/`, React + MUI) | L'interface : trois studios (image, audio, vidéo), bibliothèque, modèles, réglages | Vite (5173) en développement ; servi par Nest en bureau | L'état d'affichage (cache TanStack Query, Zustand) |
| **Coquille** (`desktop/`, Tauri 2) | Lance et supervise le moteur puis Nest, ouvre la fenêtre, gère le dossier de données | aucun | Le cycle de vie des deux processus, le jeton partagé, les secrets du premier lancement |

Règles de propriété qui structurent tout le reste :

- **Le navigateur ne parle qu'à Nest.** Les médias passent par `/api/media/…` (relais, `back/src/modules/engine/README.md`).
- **Le moteur n'a pas d'état applicatif.** Il ne connaît ni conversation, ni message, ni voix, ni réglage persistant : un job
  arrive avec tout ce qu'il faut, les événements en sortie décrivent ce qui a été produit, Nest enregistre.
- **Nest ne fait jamais tourner de modèle.** Il délègue au moteur par un client typé.
- **Un modèle chargé à la fois, une génération à la fois** (mémoire unifiée), imposé par le moteur ; la file qui décide « quel
  message ensuite » est dans Nest (`back/src/modules/studio-core/README.md`).

## Contrat Nest ↔ moteur

Le moteur expose `/engine/v1` (FastAPI) ; `engine/openapi.json` en est le schéma, **généré** (jamais écrit à la main) :

```sh
engine/.venv/bin/python scripts-local/export_engine_openapi.py          # écrit engine/openapi.json
cd back && npm run engine:types                                           # écrit back/src/modules/engine/generated/engineApi.d.ts
```

Deux tests gardent les deux fichiers à jour (`engine/tests/test_engine_api.py`, `generated/engineApi.contract.spec.ts`), et
`EngineMedia.spec.ts` vérifie que `ENGINE_API_SEGMENTS` suit les segments du schéma. Le client typé (`EngineClient`) refuse à la
compilation une route, un paramètre ou un corps absent du schéma.

- **Authentification** : l'en-tête `X-Engine-Token` (secret partagé, variable `ENGINE_TOKEN` des deux côtés) est exigé sur toutes
  les routes sauf `/engine/v1/status` (sonde de vivacité). Les fichiers `/media/<dossier>/…` sont servis sans jeton, en lecture
  seule, sur la boucle locale. En développement le jeton est dans `back/.env.dev` ; en bureau la coquille le génère à chaque
  lancement.
- **Zones de l'API** (premiers segments ; routes exactes dans `engine/openapi.json` et dans le README du module Nest qui les appelle) :
  `models`, `hf` (catalogue, téléchargements, modèles personnalisés, recherche Hugging Face : `model-catalog`), `engines`
  (installateurs : `engines`), `system`, `status`, `engine` (matériel, état, déchargement : `hardware`), `runtime` (réglages
  poussés par Nest : `settings`), `jobs` et `media` (générations et fichiers : `studio-core`, `audio-studio`, `media-library`),
  `events` (flux SSE du moteur : module `engine`).
- **Jobs** : contrat détaillé (corps, erreurs, événements) dans `back/src/modules/engine/README.md`, section « Contrat de jobs ». Le
  moteur refuse hors du dossier de données tout chemin d'entrée, de sortie ou de voix.
- **Réglages du studio** : propriété de Nest (module `settings`, configuration de module, jeton Hugging Face chiffré). Nest les
  pousse au moteur par `PUT /engine/v1/runtime/settings` au démarrage, à chaque reconnexion du flux et à chaque changement ; le
  moteur les garde **en mémoire seulement** (jamais sur disque) et applique des valeurs par défaut tant qu'il n'a rien reçu.
- **Erreurs** : une réponse non 2xx devient `EngineError`, un moteur injoignable `EngineUnavailableError` (502 côté route Nest) ;
  la sonde de santé de Nest passe en `degraded` (HTTP 200) quand le moteur ne répond pas : l'interface reste utilisable, seules
  les générations le sont plus.

## Flux d'événements

```
moteur: bus d'événements ──SSE /engine/v1/events──► EngineEventRelay (Nest, reconnexion exponentielle)
                                                        │
                       ┌────────────────────────────────┴───────────────────────────┐
                       ▼                                                            ▼
   EventStreamService  sujets engine.<nom>               GenerationQueueService : job.* → messages, assets (base)
   (téléchargements, installateurs, état du moteur,                                  │
    changement de catalogue, engine.link)                                            ▼
                       │                                       EventStreamService  sujets studio.<nom>
                       └──────────────┬────────────────────────────────────────────┘ (message.updated, job.progress, job.image,
                                      ▼                                               queue.updated, asset.*, conversation.*, voices.changed…)
                     GET /api/v1/events/stream?topics=…  (SSE, brique commune du gabarit)
                                      ▼
                     front : eventStreamClient → effets de cache (studio-shell/lib/eventEffects.ts)
```

- **Moteur → Nest** : un flux unique ; à chaque connexion le moteur rejoue son instantané (état, jobs actifs, téléchargements,
  installations). Un client lent est déconnecté côté moteur puis se reconnecte et relit son état. Le relais signale la perte et le
  retour du lien (`engine.link`), ce qui fait renvoyer les réglages et relire l'état côté interface.
- **Nest → navigateur** : sujets `engine.*` (noms et charges utiles dans `back/src/modules/engine/README.md`, section « Flux
  d'événements ») et `studio.*` (publiés par `StudioEvents`, liste dans `back/src/modules/media-library/services/StudioEvents.ts`).
  Audience : administrateur (application mono-utilisateur, le principal `local-trust` en est un).
- **Taille** : la limite d'un événement du gabarit est portée à 256 Ko pour cette application (`StudioEventLimitsModule`,
  `back/src/modules/media-library/README.md`), à cause des formes d'onde des prises audio.
- **Navigateur** : le front s'abonne aux sujets utiles et traduit chaque événement en invalidation ou retrait du cache TanStack
  Query, regroupés sur 250 ms ; au retour du lien ou sur la trame `resync`, il recharge tout
  (`front/src/modules/studio-shell/README.md`). Sans flux, retour au polling.

## Données et migrations

Dossier de données commun à Nest et au moteur : `APP_DATA_DIR` côté Nest, **le même dossier** lu sous `IMAGEGEN_DATA_DIR` côté
moteur (posé par `scripts-local/dev-services.sh` en développement, par la coquille en bureau). Par défaut `<dépôt>/data/` en
développement ; en bureau le dossier local de l'OS de l'identifiant `app.aimedialab.studio` (`desktop/README.md`).

| Élément | Propriétaire | Remarque |
|---|---|---|
| `app.db` (SQLite) | Nest | conversations, messages, références, assets (métadonnées), voix, configuration de modules (réglages), marqueur d'import ; schéma versionné par migrations |
| `uploads/`, `outputs/`, `thumbs/`, `previews/` | moteur (fichiers) | les lignes d'assets ne gardent que des noms de fichiers relatifs |
| `engine-state.json` | moteur | recettes des modèles personnalisés Hugging Face (`engines/custom.py` → `engine_state.py`) |
| `engines/` | moteur | moteurs et packs installés depuis l'application (stable-diffusion.cpp, audio.cpp, environnements Python isolés audio et vidéo) |
| `ai-medialab.db.imported` | personne | ancienne base du moteur, conservée, jamais supprimée |
| `secrets.json`, `logs/` | coquille (bureau) | clés au premier lancement, journaux |
| cache Hugging Face (`HF_HOME`) | Hugging Face | hors du dossier de données ; poids des modèles |

**Migrations de la base de Nest** : versionnées dans `back/src/migrations/` (en développement TypeORM construit le schéma lui-même ;
en bureau `DB_SYNC=false` et `DB_MIGRATIONS_RUN=true`). Toute modification d'entité s'accompagne d'une migration dans le même
commit (procédure et test de cohérence : `back/src/migrations/README.md`).

**Reprise des anciennes données (versions d'avant la migration)**, trois étapes indépendantes, dans cet ordre au premier
lancement d'une installation existante :

1. **Ancien dossier de bureau** (`app.chambrenoire.studio`) : le moteur, démarré en premier, déplace ses entrées dans le dossier
   courant à l'import de `config.py` (`engine/app/legacy_data.py`), sauf si le dossier courant contient déjà une base (y compris
   `….imported`) ; rien n'est écrasé.
2. **Recettes de modèles personnalisés** : le moteur, au premier accès à son registre, crée `engine-state.json` à partir de la
   table `settings` de l'ancienne base (`ai-medialab.db`, `chambre-noire.db` ou `….imported`), en lecture seule ; seule la clé
   `custom_models` est reprise (`engine/app/engine_state.py`, testé par `engine/tests/test_engine_state.py`).
3. **Conversations, messages, assets, voix, réglages** : Nest, au démarrage, importe l'ancienne base en une transaction avec un
   marqueur (idempotent), puis la **renomme** `ai-medialab.db.imported` (et ses fichiers `-wal`, `-shm`), sans jamais la supprimer
   (`back/src/modules/legacy-import/README.md`). L'ordre de démarrage moteur / Nest n'a pas d'importance : le moteur lit aussi
   le fichier renommé.

## Bureau

La coquille du gabarit (Tauri 2, `desktop/`) est configurée par `desktop/desktop.config.json` : un processus annexe `engine`
(interpréteur Python et dépendances **embarqués**, `uvicorn app.main:app`, santé `/engine/v1/status`) démarré **avant** Nest, puis le
serveur Nest (Node embarqué), qui sert aussi le front compilé et dont la santé inclut celle du moteur. Le jeton `ENGINE_TOKEN` est
généré à chaque lancement et partagé ; les ports sont alloués libres. À la fermeture la coquille arrête les deux groupes de
processus, y compris le worker de génération. Procédure de construction, profils d'exécution par GPU, signature et CI :
`desktop/README.md` et la section « Application de bureau » de `README.md`. Le crochet d'empaquetage du moteur est
`scripts-local/build_runtime.py` (profils : `desktop/runtime/profiles.json`).

État de vérification : la chaîne de construction de la coquille a été écrite et testée par morceaux, **aucune application n'a été
assemblée ni lancée de bout en bout** avec la coquille du gabarit (voir le suivi de la migration, `docs/migration/README.md`).

## Mémoire au repos

Mesurée sans modèle chargé ni génération (macOS arm64, Apple Silicon) :

| Mesure | Moteur | Nest | Total | Source |
|---|---|---|---|---|
| H1b, 13/10/2026, `nest build` puis `node dist/main.js`, moteur lancé à la main | ≈ 77 Mo | ≈ 155 Mo | ≈ 232 Mo | Nest après connexion au flux et quelques requêtes ; Vite non mesuré |
| H5, 13/10/2026, mêmes variables que la coquille, sans Tauri | ≈ 80 Mo | ≈ 157 Mo | ≈ 235 Mo | la coque Tauri et la fenêtre de rendu ne sont pas comptées |

Pic du moteur au démarrage : ≈ 0,40 Go (sonde PyTorch lancée en sous-processus par `warm_up`, qui se termine) ; pic de Nest
≈ 0,15 Go. Pendant une génération la mémoire est celle du worker et du modèle (planificateur mémoire du moteur, `README.md`).
Les mesures de H6 (bout en bout en mode démonstration) : pic de ≈ 0,8 Go pour le test `studioEngine.e2e.spec.ts` complet (Jest, Nest en
mémoire et moteur en sous-processus). Elles ne remplacent pas une mesure de l'application empaquetée, qui n'a pas été faite.

## Le moteur : plan

```
engine/app/
  main.py            application FastAPI : routeurs sous /engine/v1 (jeton), médias statiques sous /media/<dossier>
  api/               routes : routes.py (modèles, moteurs, Hugging Face, statut, flux SSE), jobs.py (jobs, ingestion et purge de
                     médias), runtime.py (réglages poussés), voice_media.py (clip de référence, transcription), auth.py (jeton)
  jobs.py            file des jobs, cycle de vie du worker, progression, annulation, déchargement après inactivité
  job_plans.py       JobRequest et planification pure d'une génération ; job_checks.py, job_outputs.py (description des sorties)
  worker.py, audio_worker.py, download_worker.py   processus séparés : génération, audio, téléchargement
  engines/           registre des modèles (specs) et moteurs : MLX, diffusers, stable-diffusion.cpp, audio, vidéo, modèles personnalisés
  catalog.py, downloads.py, hf_search.py           catalogue, téléchargements, recherche Hugging Face
  system.py          détection GPU, mémoire, disque ; planificateur mémoire
  engine_install.py, audio_packs.py, audiocpp.py   installateurs (moteur GGUF, packs audio et vidéo, audio.cpp)
  runtime_settings.py  réglages poussés par Nest (mémoire seulement) ; engine_state.py  état propre du moteur (fichier JSON)
  legacy_data.py     reprise de l'ancien dossier de données ; events.py  bus d'événements
engine/audio_runtime/, engine/video_runtime/   code exécuté dans les environnements isolés des packs
engine/tests/        tests pytest, un fichier à la fois (aucun ne charge de modèle)
```

Le worker tourne dans son propre processus : le serveur reste réactif pendant le calcul, décharger un modèle libère
vraiment la mémoire et un plantage (mémoire insuffisante…) n'emporte pas l'application.

## Pile de développement

Lancement : `./scripts/run.sh dev` (Nest 3000, Vite 5173, moteur 127.0.0.1:8000 via le crochet
`scripts-local/dev-services.sh`) ; détail et variables dans `README.md`. Règles de test et de mémoire : `CLAUDE.md`.
