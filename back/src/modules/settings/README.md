# Module `settings`

## Rôle

**Source de vérité des réglages du studio** (anciennement la table `settings` de la base du moteur). Ils sont déclarés comme
configuration de module du gabarit (valeurs par défaut semées au démarrage, `hf_token` chiffré), exposés par `GET/PUT
/api/settings` (même URL et même forme publique que l'ancienne route du moteur) et **transmis au moteur** au démarrage et à
chaque changement. Module d'application. Tâche H4.1.

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `SettingsModule.ts` | Importe `CommonModule`, déclare le contrôleur et les services, exporte `SettingsService`. |
| Schéma | `configSchema.ts` | `settingsConfigSchema` (moduleId `studio`). |
| Contrôleur | `controllers/SettingsController.ts` | `GET/PUT /api/settings` (administrateur, `local-trust` inclus ; JSON en clair, `NoTransportCrypt`). |
| Service | `services/SettingsService.ts` | Lecture (défauts si absent), mise à jour (validation, envoi au moteur, enregistrement), `pushToEngine()`. Appels sérialisés. |
| Service | `services/SettingsEngineSync.ts` | Envoie l'état au moteur au démarrage et à chaque reconnexion du flux d'événements (`EngineEventRelay.linkChanges$`). |
| Pures | `services/settingsPatch.ts` | `parseSettingsPatch` (422 sur un mauvais type), `applyPatch` (fusion des cartes par modèle), `toPublic`, `DEFAULT_SETTINGS`. |
| Service | `services/SettingsConfigRegistration.ts` | `OnApplicationBootstrap` : `moduleConfigService.register(schema)`. |
| Correspondance | `legacySettings.ts` | `LEGACY_SETTING_KEYS`, `mapLegacySettings()` (utilisée par l'importateur). |
| Types | `types/settingsTypes.ts` | `StudioSettings`, `PublicSettings`, `SettingsPatch`. |

Libellés : `back/src/locales/custom.fr.json` et `custom.en.json` (clés `custom.settings.*`).

## Dépendances

`common` : `ModuleConfigService`, `ConfigurationService` (table `config`). `engine` : `EngineClient` (typé), `EngineEventRelay`,
`engineErrorToHttp`. `legacy-import` appelle `SettingsService.pushToEngine()` après avoir importé les réglages de l'ancienne base.

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings` | Admin | Réglages publics : `keep_alive_minutes`, `previews`, `low_memory`, `quantize`, `variant`, `has_hf_token`, `has_brave_api_key`. Les secrets ne sont **jamais** renvoyés. |
| `PUT` | `/api/settings` | Admin | Sous-ensemble des mêmes clés + `hf_token` et `brave_api_key` (texte de 512 caractères au plus ; `''` le retire). Renvoie l'état public. |

Erreurs de `PUT` : 422 si un type est faux (`keep_alive_minutes` entier de -1 à 1440, booléens, cartes `model_id -> entier|null` et
`model_id -> texte`) ; 422 relayé du moteur (modèle ou quantification inconnus) ; 409 relayé du moteur (changer la
quantification du modèle chargé pendant une génération). Dans ces cas **rien n'est enregistré**.

## Transmission au moteur

Le moteur ne lit plus ces réglages dans sa base : Nest lui envoie l'état **complet** par `PUT /engine/v1/runtime/settings`
(route réservée à Nest, protégée par `X-Engine-Token`) :

1. au démarrage (`SettingsEngineSync.onApplicationBootstrap`), puis à chaque (re)connexion du flux d'événements (le moteur a pu
   redémarrer et a perdu sa mémoire) ;
2. après l'import des réglages de l'ancienne base (`LegacyImportBootstrap`) ;
3. à chaque `PUT /api/settings` : le moteur valide **avant** l'enregistrement (il connaît les modèles).

Si le moteur est injoignable au moment d'un `PUT`, les valeurs sont enregistrées (la validation du moteur est alors sautée) et
envoyées à la prochaine connexion ; un refus tardif est journalisé. Tant que Nest n'a rien envoyé, le moteur applique ses valeurs par défaut
(`DEFAULT_SETTINGS` de `engine/app/jobs.py`) ; il ne les écrit jamais sur disque (le jeton Hugging Face en fait partie).

## Entités

Aucune (table `config` de `common`).

| Clé de configuration | Ancienne clé | Type | Défaut | Rôle |
|---|---|---|---|---|
| `studio_keepAliveMinutes` | `keep_alive_minutes` | nombre | 10 | Inactivité avant de décharger le modèle ; -1 jamais, 0 après chaque génération. |
| `studio_previews` | `previews` | booléen | vrai | Aperçus intermédiaires des images. |
| `studio_lowMemory` | `low_memory` | booléen | vrai | Libère l'encodeur de texte après l'encodage du prompt. |
| `studio_quantize` | `quantize` | json (masqué) | `{}` | `model_id` vers bits de quantification (écrit par le dialogue des modèles, H4.2). |
| `studio_variant` | `variant` | json (masqué) | `{}` | `model_id` vers variante de quantification (H4.2). |
| `studio_hfToken` | `hf_token` | `secret` | vide | Jeton Hugging Face (modèles à accès restreint), chiffré. |
| `studio_braveApiKey` | `brave_api_key` (pas d'ancienne clé) | `secret` | vide | Clé de l'API Brave Search pour l'outil de recherche web du chat (sans clé, DuckDuckGo) ; chiffrée. **Reste dans Nest** : elle n'est pas envoyée au moteur (`SettingsService.push` l'écarte, type `EngineSettings`), et `SettingsService.braveApiKey()` la donne au module `chat`. |

Les valeurs restent lisibles et modifiables par les routes d'administration de `common` (`GET`/`PUT
/api/v1/admin/module-configs/studio`) ; une modification faite par là n'est **pas** transmise au moteur avant le prochain
démarrage ou la prochaine reconnexion (limite connue).

## Points d'extension

- Un nouveau réglage : champ du schéma, clé de `LEGACY_SETTING_KEYS` si l'ancienne base le portait, `StudioSettings`,
  `parseSettingsPatch`, `RuntimeSettings` du moteur (`engine/app/api/runtime.py`), puis `npm run engine:types`.

## Tests

Un fichier à la fois, depuis `back/`, sous `docs/migration/tools/guarded_run.sh 3` :

```sh
npx jest --runInBand src/modules/settings/services/settingsPatch.spec.ts
```

`services/{settingsPatch,SettingsService,SettingsEngineSync}.spec.ts` (faux moteur HTTP, configuration de module simulée),
`controllers/SettingsController.spec.ts`, `legacySettings.spec.ts`. Côté moteur : `engine/tests/test_runtime_settings.py`.
