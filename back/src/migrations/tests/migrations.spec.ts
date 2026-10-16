/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { describe, expect, it } from '@jest/globals';
import { readdirSync } from 'fs';
import { join } from 'path';
import { createTestDataSource } from 'src/testing/testDataSource';

// Not next to the migrations: `Datasource.ts` loads every `migrations/*.{js,ts}` file, specs included.
const MIGRATIONS_DIR = join(__dirname, '..');

/** Loads every migration of this folder, like `Datasource.ts` does with its glob. */
function loadMigrations(): unknown[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+-.+\.ts$/.test(f) && !f.endsWith('.spec.ts'))
    .sort()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    .flatMap((f) => Object.values(require(join(MIGRATIONS_DIR, f))));
}

const TABLES = ['conversations', 'messages', 'message_refs', 'assets', 'voices', 'import_markers', 'config'];

describe('TypeORM migrations on an empty in-memory SQLite database', () => {
  it('apply cleanly and leave exactly the schema of the entities', async () => {
    const dataSource = await createTestDataSource({ synchronize: false, migrations: loadMigrations() });
    try {
      const applied = await dataSource.runMigrations();
      expect(applied.length).toBeGreaterThan(0);
      const tables = (await dataSource.query("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
        (r: { name: string }) => r.name,
      );
      expect(tables).toEqual(expect.arrayContaining([...TABLES, 'migrations']));
      // A migration that no longer matches the entities would show up as pending schema changes.
      const pending = await dataSource.driver.createSchemaBuilder().log();
      expect(pending.upQueries.map((q) => q.query)).toEqual([]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('is recorded once: running again applies nothing', async () => {
    const dataSource = await createTestDataSource({ synchronize: false, migrations: loadMigrations() });
    try {
      await dataSource.runMigrations();
      expect(await dataSource.runMigrations()).toEqual([]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('enforce the foreign keys of the legacy schema (cascade and set null)', async () => {
    const dataSource = await createTestDataSource({ synchronize: false, migrations: loadMigrations() });
    try {
      await dataSource.runMigrations();
      await dataSource.query("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c', 't', 1, 1)");
      await dataSource.query("INSERT INTO messages (id, conversation_id, role, created_at) VALUES ('m', 'c', 'user', 1)");
      await dataSource.query("INSERT INTO assets (id, kind, conversation_id, message_id, filename, created_at) VALUES ('a', 'generated', 'c', 'm', 'f', 1)");
      await dataSource.query("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('m', 'a', 0)");
      await expect(
        dataSource.query("INSERT INTO messages (id, conversation_id, role, created_at) VALUES ('x', 'nope', 'user', 1)"),
      ).rejects.toThrow(/FOREIGN KEY/);
      await dataSource.query("DELETE FROM conversations WHERE id = 'c'");
      expect(await dataSource.query('SELECT id FROM messages')).toEqual([]);
      expect(await dataSource.query('SELECT message_id FROM message_refs')).toEqual([]);
      expect(await dataSource.query('SELECT conversation_id, message_id FROM assets')).toEqual([
        { conversation_id: null, message_id: null },
      ]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('revert back to an empty database', async () => {
    const dataSource = await createTestDataSource({ synchronize: false, migrations: loadMigrations() });
    try {
      await dataSource.runMigrations();
      const tableNames = async (): Promise<string[]> =>
        (await dataSource.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((r: { name: string }) => r.name);
      await dataSource.undoLastMigration(); // the latest one only: `generations` leaves the chat messages, the tables stay
      const columns = async (): Promise<string[]> => (await dataSource.query('PRAGMA table_info(chat_messages)')).map((r: { name: string }) => r.name);
      expect(await columns()).not.toContain('generations');
      await dataSource.undoLastMigration(); // then the advisories
      const afterOne = await tableNames();
      expect(afterOne).not.toContain('update_advisories');
      expect(afterOne).toEqual(expect.arrayContaining(['conversations', 'messages', 'assets', 'chat_messages']));
      await dataSource.undoLastMigration(); // then the chat tables
      expect(await tableNames()).not.toContain('chat_messages');
      for (let i = 3; i < loadMigrations().length; i++) await dataSource.undoLastMigration();
      expect(await tableNames()).toEqual(['migrations']);
    } finally {
      await dataSource.destroy();
    }
  });
});
