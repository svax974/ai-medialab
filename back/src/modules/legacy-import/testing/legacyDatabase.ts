/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type Row = Record<string, unknown>;
export type LegacyDemo = Record<'conversations' | 'messages' | 'assets' | 'message_refs' | 'voices' | 'settings', Row[]>;

/** Rows of the demo database (the same rows fed the frozen fixture `expectedPublic.json`). */
export function loadDemo(): LegacyDemo {
  return JSON.parse(readFileSync(join(__dirname, 'legacyDemo.json'), 'utf8')) as LegacyDemo;
}

export function loadExpectedPublic(): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.parse(readFileSync(join(__dirname, 'expectedPublic.json'), 'utf8'));
}

/** `SCHEMA` of `engine/app/db.py` (removed in H6) as of the first release: no `conversations.mode`, `assets.media`, `assets.duration`. */
const FIRST_RELEASE_SCHEMA = `
CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  prompt TEXT NOT NULL DEFAULT '', model_id TEXT, params TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'done',
  error TEXT, created_at REAL NOT NULL, started_at REAL, finished_at REAL);
CREATE TABLE assets (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('upload', 'generated')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  filename TEXT NOT NULL, thumb TEXT, original_name TEXT, width INTEGER, height INTEGER, seed INTEGER,
  position INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, meta TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL);
CREATE TABLE message_refs (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, position INTEGER NOT NULL, PRIMARY KEY (message_id, asset_id));
CREATE TABLE voices (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('clone', 'design')),
  filename TEXT, transcript TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', language TEXT, duration REAL,
  peaks TEXT NOT NULL DEFAULT '[]', created_at REAL NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Columns added by the legacy `_migrate()`, with the tables that carry them. */
const ADDED_COLUMNS: [string, string, string][] = [
  ['conversations', 'mode', "TEXT NOT NULL DEFAULT 'image'"],
  ['assets', 'media', "TEXT NOT NULL DEFAULT 'image'"],
  ['assets', 'duration', 'REAL'],
];
const JSON_COLUMNS = new Set(['params', 'meta', 'peaks']);
const TABLES = ['conversations', 'messages', 'assets', 'message_refs', 'voices'] as const;

export interface BuildOptions {
  /** `first-release`: the schema before the later migrations; rows then lack `mode`, `media` and `duration`. */
  schema?: 'current' | 'first-release';
  /** Write the settings table. Default true. */
  settings?: boolean;
  /** Leave the database in WAL mode, like the engine does. */
  wal?: boolean;
  fileName?: string;
}

/** Builds a legacy database in a fresh temporary folder; returns the folder and the file. */
export function buildLegacyDatabase(options: BuildOptions = {}): { dir: string; file: string; cleanup: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const demo = loadDemo();
  const dir = mkdtempSync(join(tmpdir(), 'legacy-import-'));
  const file = join(dir, options.fileName ?? 'ai-medialab.db');
  const db = new Database(file);
  const firstRelease = options.schema === 'first-release';
  if (options.wal) db.pragma('journal_mode = WAL');
  db.exec(FIRST_RELEASE_SCHEMA);
  const skipped = new Set<string>();
  if (!firstRelease) {
    for (const [table, column, ddl] of ADDED_COLUMNS) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } else {
    for (const [, column] of ADDED_COLUMNS) skipped.add(column);
  }
  for (const table of TABLES) {
    for (const row of demo[table]) insert(db, table, row, skipped);
  }
  if (options.settings !== false) {
    for (const s of demo.settings) insert(db, 'settings', { key: s.key, value: JSON.stringify(s.value) }, skipped);
  }
  db.close();
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Subset of `better-sqlite3` used to fill the demo database. */
interface DemoDb {
  prepare(sql: string): { run(...params: unknown[]): unknown };
}

function insert(db: DemoDb, table: string, row: Row, skipped: Set<string>): void {
  const entries = Object.entries(row)
    .filter(([key]) => !skipped.has(key))
    .map(([key, value]) => [key, JSON_COLUMNS.has(key) ? JSON.stringify(value) : value] as const)
    .map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value] as const);
  const columns = entries.map(([k]) => k).join(', ');
  const marks = entries.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${marks})`).run(...entries.map(([, v]) => v));
}
