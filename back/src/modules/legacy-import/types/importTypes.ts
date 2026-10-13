/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

export type LegacyImportStatus =
  /** Data (and settings) copied during this call. */
  | 'imported'
  /** A marker exists and the settings are applied: nothing done. */
  | 'already-imported'
  /** The data was imported earlier; only the settings were retried during this call. */
  | 'settings-retried'
  /** No legacy database in the data folder (fresh install). */
  | 'no-source';

export interface LegacyImportReport {
  status: LegacyImportStatus;
  /** Path of the legacy database that was read (when there is one). */
  source: string | null;
  /** Rows read per table; empty unless data was copied during this call. */
  counts: Record<string, number>;
  /** Rows left out because they pointed at something missing (messages without conversation, dangling references). */
  skipped: Record<string, number>;
  /** Number of legacy settings applied during this call. */
  settingsApplied: number;
}

/** Names of the legacy database file, newest first (`engine/app/config.py`: `chambre-noire.db` is the pre-rename name). */
export const LEGACY_DB_NAMES = ['ai-medialab.db', 'chambre-noire.db'];

/** Minimal surface of `better-sqlite3` used to read the legacy database (no `@types` package in the project). */
export interface LegacyStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>;
}
export interface LegacyDatabase {
  prepare(sql: string): LegacyStatement;
  exec(sql: string): unknown;
  close(): void;
}
export type LegacyDatabaseOpener = (path: string) => LegacyDatabase;
