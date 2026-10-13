/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { LEGACY_DB_NAMES, LegacyDatabase, LegacyDatabaseOpener } from '../types/importTypes';

/** Opens a SQLite file read-only with `better-sqlite3` (a driver the SQLite build of the project already has). */
export const openLegacyDatabaseReadOnly: LegacyDatabaseOpener = (path) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (file: string, options: object) => LegacyDatabase;
  return new Database(path, { readonly: true, fileMustExist: true });
};

/** First legacy database found in the data folder, or `null`. */
export function findLegacyDatabase(dataDir: string): string | null {
  for (const name of LEGACY_DB_NAMES) {
    const candidate = join(dataDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Read-only view of the legacy database, taken inside one read transaction so that the tables are consistent with one
 * another even if the engine writes meanwhile. Never writes: the connection is opened `readonly`.
 */
export class LegacyDatabaseReader {
  private readonly db: LegacyDatabase;

  constructor(path: string, open: LegacyDatabaseOpener = openLegacyDatabaseReadOnly) {
    this.db = open(path);
    this.db.exec('BEGIN');
  }

  /** Whether the table exists (a very old database may lack, say, `voices`). */
  hasTable(table: string): boolean {
    return this.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").all(table).length > 0;
  }

  /** Rows of a table (`SELECT *`, so columns added by later migrations are present only when they exist). */
  *rows(table: string, orderBy: string): IterableIterator<Record<string, unknown>> {
    if (!this.hasTable(table)) return;
    yield* this.db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).iterate();
  }

  /** Ids of a table, to detect dangling references. */
  ids(table: string): Set<string> {
    if (!this.hasTable(table)) return new Set();
    return new Set(this.db.prepare(`SELECT id FROM ${table}`).all().map((r) => String(r.id)));
  }

  close(): void {
    try {
      this.db.exec('COMMIT');
    } finally {
      this.db.close();
    }
  }
}
