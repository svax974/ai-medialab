/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import './sqliteEnv';
import { join } from 'path';
import { DataSource } from 'typeorm';

/** Entities of the whole app, found the way `Datasource.ts` finds them. */
export const ENTITY_GLOBS = [
  join(__dirname, '../modules_shared/**/entities/*.{js,ts}'),
  join(__dirname, '../modules/**/entities/*.{js,ts}'),
];

/** In-memory SQLite database; `synchronize` builds the tables (the migration has its own spec). */
export async function createTestDataSource(overrides: { synchronize?: boolean; migrations?: unknown[] } = {}): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: ENTITY_GLOBS,
    synchronize: overrides.synchronize ?? true,
    migrations: overrides.migrations ?? [],
    prepareDatabase: (db: { pragma: (sql: string) => unknown }) => db.pragma('foreign_keys = ON'),
  } as never);
  return dataSource.initialize();
}
