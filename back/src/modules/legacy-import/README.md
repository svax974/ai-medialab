# Module `legacy-import`

## Rôle

Importe **une fois** l'ancienne base du moteur (`ai-medialab.db`, SQLite, dossier de données) dans la base de Nest, au
premier démarrage. Les fichiers (`uploads/`, `outputs/`, `thumbs/`, `previews/`) ne bougent pas : les lignes gardent les
mêmes noms de fichiers relatifs. Une fois l'import complet, l'ancienne base est **renommée** `ai-medialab.db.imported` (jamais supprimée).

## Architecture

| Type | Fichier | Description |
|---|---|---|
| Module | `LegacyImportModule.ts` | Importe `settings`, `studio-core`, `media-library`, `audio-studio`, `CommonModule`. |
| Service | `services/LegacyImportService.ts` | `run(dataDir?)` : trouve la base, copie, pose le marqueur, applique les réglages. |
| Démarrage | `services/LegacyImportBootstrap.ts` | `OnApplicationBootstrap` : appelle `run()` ; `LEGACY_IMPORT=false` désactive ; un échec est journalisé sans arrêter le serveur. |
| Lecteur | `services/LegacyDatabaseReader.ts` | `better-sqlite3` en lecture seule, dans une seule transaction de lecture ; `findLegacyDatabase()`. |
| Conversions | `services/legacyRowMappers.ts` | Ligne de l'ancienne base vers entité (colonnes ajoutées plus tard : valeurs par défaut). |
| Entité | `entities/ImportMarkerEntity.ts` | Table `import_markers` : le marqueur d'import. |
| Types | `types/importTypes.ts` | `LegacyImportReport`, noms de fichiers de l'ancienne base, interface minimale de `better-sqlite3`. |
| Tests | `services/*.spec.ts`, `publicShapes.spec.ts`, `persistenceModules.spec.ts`, `testing/` | Voir plus bas. |

## Dépendances

`better-sqlite3` (déjà requis par le moteur SQLite du gabarit ; pas de paquet `@types` : interface minimale locale),
`common` (`ModuleConfigService`, `resolveAppDataDir`), `settings`, `studio-core`, `media-library`, `audio-studio`.

## Endpoints exposés (exhaustif)

Aucun.

## Comportement

1. **Source** : `<APP_DATA_DIR>/ai-medialab.db`, sinon `chambre-noire.db` (nom d'avant le renommage du projet ; le moteur ne le
   renomme plus). Dossier : `APP_DATA_DIR`, sinon `IMAGEGEN_DATA_DIR`. Aucune
   base trouvée : rien ne se passe (`no-source`).
2. **Marqueur** : la table `import_markers` de la nouvelle base (id `legacy-ai-medialab-db`). Présent et réglages
   appliqués : rien ne se passe (`already-imported`).
3. **Ancienne base conservée** : ouverte `readonly`, jamais modifiée ni supprimée. Une fois les données **et** les réglages
   importés (marqueur posé, `settingsApplied`), `ai-medialab.db` et ses fichiers `-wal` / `-shm` sont **renommés** en
   `ai-medialab.db.imported` (`archiveLegacyDatabase`) ; un `.imported` déjà présent n'est jamais écrasé (suffixe numérique
   `.1`, `.2`…). Le renommage a lieu aussi quand le marqueur existe déjà et que l'ancienne base est encore là. Il n'a pas lieu
   si l'étape des réglages a échoué (la reprise au démarrage suivant a besoin du fichier). Un échec du renommage est
   journalisé sans annuler l'import. Le moteur lit lui-même `.imported` pour reprendre ses recettes de modèles
   personnalisés (`engine/app/engine_state.py`) : l'ordre de démarrage moteur / Nest n'a pas d'importance.
   Ouvrir une base en mode WAL, même en lecture seule, peut créer les fichiers `-wal` et `-shm` à côté : le fichier
   principal n'est pas touché (testé par empreinte avant renommage).
4. **Copie** : une transaction unique (contraintes différées sous SQLite) : conversations, messages, assets, liens de
   références, voix, puis marqueur. Lecture par lots de 200 lignes (mémoire bornée). Insertion `OR IGNORE` : sans marqueur,
   une relance ne duplique rien. Instantané de lecture cohérent même si le moteur écrit pendant l'import.
5. **Bases anciennes** : les colonnes ajoutées par les migrations du moteur (`conversations.mode`, `assets.media`,
   `assets.duration`) peuvent manquer : valeurs par défaut (`image`, `image`, `null`). Valeurs inconnues de `mode`/`media`/
   `status` normalisées.
6. **Références pendantes** : un message sans conversation ou un lien vers un message ou un asset absent est ignoré
   (compté dans `skipped`) ; une référence d'asset vers une conversation ou un message absent est mise à `null`.
7. **Réglages** : la table `settings` est convertie (`settings/legacySettings.ts`) puis appliquée par
   `ModuleConfigService.updateModuleConfig('studio', …)` (`hf_token` chiffré). Si cette étape échoue après la copie, le
   marqueur reste `settingsApplied=false` et seule cette étape est reprise au démarrage suivant (`settings-retried`). Les données déjà copiées ne sont pas
   recopiées lors de cette reprise ; les réglages ne sont écrasés qu'à ce moment-là (premier démarrage ou reprise).
8. **Rapport** (`LegacyImportReport`) : `status`, `source`, `counts` (lignes lues par table), `skipped`, `settingsApplied`, `archivedTo` (chemin du fichier renommé, ou `null`).

## Tests

`services/LegacyImportService.spec.ts` (base de démonstration construite par le test : toutes les tables, ancien schéma sans
colonnes ajoutées, nom `chambre-noire.db`, WAL ouvert par un « moteur », absence de base, idempotence, reprise des réglages,
références pendantes, ancienne base inchangée), `publicShapes.spec.ts` (formes publiques comparées à des sorties capturées
de l'ancien `repo.py`, capturées une fois : `testing/expectedPublic.json`, fixture figée ; le script de capture a été supprimé avec `repo.py` en H6),
`persistenceModules.spec.ts` (câblage Nest), `services/LegacyImportBootstrap.spec.ts`.

## Points d'extension

Une fois l'import fait chez tous les utilisateurs (décision produit), le module peut être supprimé et `import_markers` retiré par une migration ; l'ancienne base `.imported` reste au choix de l'utilisateur.

Après un import qui a appliqué des réglages, `LegacyImportBootstrap` appelle `SettingsService.pushToEngine()` (H4.1) : le moteur reçoit les valeurs importées (voir `back/src/modules/settings/README.md`).
