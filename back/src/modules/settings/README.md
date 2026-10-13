# Module `settings`

## Rôle

Déclare les **réglages du studio** (anciennement la table `settings` de la base du moteur) comme configuration de module
du gabarit : valeurs par défaut semées au démarrage, administration générique, `hf_token` chiffré. Module d'application.

État (tâche H2) : schéma et enregistrement seulement, plus la correspondance avec les anciennes clés (utilisée par
l'importateur). Le panneau de réglages, les routes et la transmission au moteur sont la tâche H4.1.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `SettingsModule.ts` | Importe `CommonModule`, fournit l'enregistrement du schéma. |
| Schéma | `configSchema.ts` | `settingsConfigSchema` (moduleId `studio`). |
| Service | `services/SettingsConfigRegistration.ts` | `OnApplicationBootstrap` : `moduleConfigService.register(schema)`. |
| Correspondance | `legacySettings.ts` | `LEGACY_SETTING_KEYS`, `mapLegacySettings()` (ancienne clé vers clé de configuration, valeurs invalides écartées). |

Libellés : `back/src/locales/custom.fr.json` et `custom.en.json` (clés `custom.settings.*`).

## Dépendances

`common` : `ModuleConfigService`, `ConfigurationService` (stockage dans la table `config`).

## Endpoints exposés (exhaustif)

Aucun propre à ce module. Les valeurs sont lisibles et modifiables par les routes d'administration de `common`
(`GET`/`PUT /api/v1/admin/module-configs/studio`, `GET …/secret/studio_hfToken`).

## Entités

Aucune (table `config` de `common`).

| Clé de configuration | Ancienne clé | Type | Défaut | Rôle |
|---|---|---|---|---|
| `studio_keepAliveMinutes` | `keep_alive_minutes` | nombre | 10 | Inactivité avant de décharger le modèle ; -1 jamais, 0 après chaque génération. |
| `studio_previews` | `previews` | booléen | vrai | Aperçus intermédiaires des images. |
| `studio_lowMemory` | `low_memory` | booléen | vrai | Libère l'encodeur de texte après l'encodage du prompt. |
| `studio_quantize` | `quantize` | json (masqué) | `{}` | `model_id` vers bits de quantification. |
| `studio_variant` | `variant` | json (masqué) | `{}` | `model_id` vers variante de quantification. |
| `studio_hfToken` | `hf_token` | `secret` | vide | Jeton Hugging Face (modèles à accès restreint), chiffré. |

## Qui lit ces réglages (et ce que H4.1 doit faire)

Le moteur les lit lui-même dans **sa** base (`db.get_settings()`) : `keep_alive_minutes`, `previews`, `low_memory`,
`quantize` et `variant` dans `engine/app/jobs.py` (déchargement, aperçus, options du worker, quantification choisie) et
`engine/app/catalog.py` (précision affichée dans le catalogue), `hf_token` dans `downloads.py` et `hf_search.py`
(téléchargements et recherche Hugging Face) ainsi que `jobs.py` (jeton passé au worker). Tant que le moteur garde ses
routes `/api` et sa base (jusqu'à H6), ces lectures continuent de marcher et les réglages restent donc dans les **deux**
bases : celle du moteur fait foi pour lui, la configuration de Nest est une copie importée une fois.

Proposition pour H4.1 (non implémentée ici) : Nest devient la source et pousse les valeurs au moteur sans qu'il ait besoin de
lire une base : (1) `PUT /engine/v1/settings` (ou un nouvel `PUT /engine/v1/config`) appelé par Nest au démarrage du moteur
(détecté par `EngineHealthContributor`/relais SSE) et après chaque modification ; (2) en H4.3 (moteur sans état), les
valeurs propres à un job (`low_memory`, `quantize`, variante, `hf_token` pour les modèles à accès restreint) voyagent dans
le job lui-même, et `keep_alive_minutes` / `previews` dans la configuration poussée. `quantize` et `variant` sont aussi
validés par le moteur (modèle connu, bits pris en charge) : Nest doit relayer l'erreur 422 du moteur. Le jeton n'est jamais
renvoyé au navigateur (`has_hf_token` seulement, comme aujourd'hui).

## Points d'extension

H4.1 : contrôleur de réglages (forme publique actuelle : les clés ci-dessus en snake_case + `has_hf_token`), panneau,
transmission au moteur.
