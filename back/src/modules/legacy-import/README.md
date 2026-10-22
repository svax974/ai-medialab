# Module `legacy-import`

## Role

Imports **once** the former engine database (`ai-medialab.db`, SQLite, data folder) into Nest's database, on the
first start. The files (`uploads/`, `outputs/`, `thumbs/`, `previews/`) do not move: the rows keep the
same relative file names. Once the import is complete, the former database is **renamed** `ai-medialab.db.imported` (never deleted).

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `LegacyImportModule.ts` | Imports `settings`, `studio-core`, `media-library`, `audio-studio`, `CommonModule`. |
| Service | `services/LegacyImportService.ts` | `run(dataDir?)`: finds the database, copies, sets the marker, applies the settings. |
| Bootstrap | `services/LegacyImportBootstrap.ts` | `OnApplicationBootstrap`: calls `run()`; `LEGACY_IMPORT=false` disables it; a failure is logged without stopping the server. |
| Reader | `services/LegacyDatabaseReader.ts` | `better-sqlite3` read-only, in a single read transaction; `findLegacyDatabase()`. |
| Conversions | `services/legacyRowMappers.ts` | Row of the former database to entity (columns added later: default values). |
| Entity | `entities/ImportMarkerEntity.ts` | Table `import_markers`: the import marker. |
| Types | `types/importTypes.ts` | `LegacyImportReport`, file names of the former database, minimal interface of `better-sqlite3`. |
| Tests | `services/*.spec.ts`, `publicShapes.spec.ts`, `persistenceModules.spec.ts`, `testing/` | See below. |

## Dependencies

`better-sqlite3` (already required by the template's SQLite engine; no `@types` package: local minimal interface),
`common` (`ModuleConfigService`, `resolveAppDataDir`), `settings`, `studio-core`, `media-library`, `audio-studio`.

## Endpoints exposed (exhaustive)

None.

## Behaviour

1. **Source**: `<APP_DATA_DIR>/ai-medialab.db`, otherwise `chambre-noire.db` (name from before the project was renamed; the engine no
   longer renames it). Folder: `APP_DATA_DIR`, otherwise `IMAGEGEN_DATA_DIR`. No
   database found: nothing happens (`no-source`).
2. **Marker**: the `import_markers` table of the new database (id `legacy-ai-medialab-db`). Present and settings
   applied: nothing happens (`already-imported`).
3. **Former database kept**: opened `readonly`, never modified nor deleted. Once the data **and** the settings are
   imported (marker set, `settingsApplied`), `ai-medialab.db` and its `-wal` / `-shm` files are **renamed** to
   `ai-medialab.db.imported` (`archiveLegacyDatabase`); an existing `.imported` is never overwritten (numeric suffix
   `.1`, `.2`…). The rename also happens when the marker already exists and the former database is still there. It does not happen
   if the settings step failed (the resume at the next start needs the file). A failed rename is
   logged without cancelling the import. The engine reads `.imported` itself to resume its custom model recipes
   (`engine/app/engine_state.py`): the engine / Nest start order does not matter.
   Opening a database in WAL mode, even read-only, can create the `-wal` and `-shm` files next to it: the
   main file is not touched (checked by fingerprint before renaming).
4. **Copy**: a single transaction (deferred constraints under SQLite): conversations, messages, assets, reference links,
   voices, then the marker. Reading in batches of 200 rows (bounded memory). `OR IGNORE` insertion: without a marker,
   a re-run duplicates nothing. Consistent read snapshot even if the engine writes during the import.
5. **Former databases**: the columns added by the engine's migrations (`conversations.mode`, `assets.media`,
   `assets.duration`) may be missing: default values (`image`, `image`, `null`). Unknown values of `mode`/`media`/
   `status` normalised.
6. **Dangling references**: a message without a conversation, or a link to a missing message or asset, is ignored
   (counted in `skipped`); an asset reference to a missing conversation or message is set to `null`.
7. **Settings**: the `settings` table is converted (`settings/legacySettings.ts`) then applied by
   `ModuleConfigService.updateModuleConfig('studio', …)` (`hf_token` encrypted). If this step fails after the copy, the
   marker stays `settingsApplied=false` and only this step is resumed at the next start (`settings-retried`). The data already copied is not
   copied again during this resume; the settings are only overwritten at that point (first start or resume).
8. **Report** (`LegacyImportReport`): `status`, `source`, `counts` (rows read per table), `skipped`, `settingsApplied`, `archivedTo` (path of the renamed file, or `null`).

## Tests

`services/LegacyImportService.spec.ts` (demonstration database built by the test: all tables, old schema without
the added columns, name `chambre-noire.db`, WAL opened by an "engine", absence of database, idempotence, settings resume,
dangling references, former database unchanged), `publicShapes.spec.ts` (public shapes compared with captured outputs
of the former `repo.py`, captured once: `testing/expectedPublic.json`, frozen fixture; the capture script was removed with `repo.py` in H6), `persistenceModules.spec.ts` (Nest wiring), `services/LegacyImportBootstrap.spec.ts`.

## Extension points

Once the import is done for all users (product decision), the module can be deleted and `import_markers` removed by a migration; the `.imported` former database remains at the user's discretion.

After an import that applied settings, `LegacyImportBootstrap` calls `SettingsService.pushToEngine()` (H4.1): the engine receives the imported values (see `back/src/modules/settings/README.md`).
