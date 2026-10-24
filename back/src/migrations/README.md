# TypeORM migrations

Versioned migrations of the Nest database (SQLite; Postgres is not a target of this application). Loaded by
`src/config/Datasource.ts` (`migrations/*.{js,ts}`, a single level: the tests are in `tests/`).

| File | Content |
|---|---|
| `1791891387395-InitialSchema.ts` | The whole starting schema: tables of `common` (`config`, `themes`, `cookie_consent_log`) and of the application (`conversations`, `messages`, `message_refs`, `assets`, `voices`, `import_markers`) with their indexes and foreign keys. |
| `1792061048743-UpdateAdvisories.ts` | The update advisor: `update_advisories` (advisories recorded on an engine or model update: verdict, summary, cited findings, sources, model used), one index per item and date. |
| `1792058442183-ChatTables.ts` | The chat: `chat_messages` (message tree, cascading foreign keys to the conversation and the parent message) and `chat_conversation_settings` (settings and active leaf of each chat conversation). |
| `1792070000000-ChatGenerations.ts` | The chat creation tools: column `chat_messages.generations` (JSON, nullable: existing messages do not change). |
| `1792831506395-OcrTables.ts` | The OCR tab: `ocr_documents` (one reading: file, model, task, status, progress) and `ocr_pages` (the text of each page, cascading foreign key). New tables only. |

## Usage

- **Dev**: `DB_SCHEMA_MODE` unset (or `sync`), TypeORM builds the tables (`synchronize`, default outside production). The migrations
  are not used.
- **Desktop and production**: `DB_SCHEMA_MODE=migrations` (see `back/.env.example`): pending
  migrations run at startup. Never mix `synchronize` and migrations on the same `app.db` file: a
  database built by `synchronize` does not have the `migrations` table, so the initial migration would fail ("table already
  exists"). Start again from an empty `app.db`, or delete it in dev (nothing irreplaceable: the original data is in
  the former database, re-importable by deleting `app.db`).
- The desktop target database is created by `DB_PATH` (relative to `APP_DATA_DIR`).

## Generating a migration after an entity change

Any entity change (see the TypeORM safety rule of the template: warn before renaming or removing a
column) comes with a migration, in the same commit:

```sh
cd back
DB_ENGINE=sqlite DB_PATH=/tmp/gen.db CRYPT_DB_MASTER_KEY=<clé> \
  node -r ts-node/register -r tsconfig-paths/register ./node_modules/typeorm/cli.js \
  migration:generate -d src/config/Datasource.ts src/migrations/<Nom>
```

The `DB_PATH` database must reflect the **previous** schema (first apply the existing migrations:
`migration:run -d src/config/Datasource.ts` with the same variables, on a new file). Re-read the generated file
(SQLite recreates the tables to add a foreign key) and run
`npx jest --runInBand src/migrations/tests/migrations.spec.ts`: it applies the migrations to an empty in-memory database, checks that no difference remains with the entities, the foreign keys and the rollback.
