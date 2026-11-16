/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** New table only; portable on PostgreSQL and SQLite. */
export class TranscriptTable1794800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const text = ['source_url', 'error'];
    const names = ['id', 'title', 'source_kind', 'source_url', 'source_file', 'model_id', 'model_name', 'language', 'status', 'stage', 'progress', 'duration', 'processed_seconds', 'text', 'error', 'created_at', 'updated_at'];
    const nullable = new Set(['source_url', 'source_file', 'language', 'progress', 'error']);
    const numbers = new Set(['progress', 'duration', 'processed_seconds', 'created_at', 'updated_at']);
    const defaults: Record<string, string | number> = { status: "'queued'", stage: "'queued'", text: "''", duration: 0, processed_seconds: 0 };
    await queryRunner.createTable(new Table({ name: 'transcripts', columns: names.map((name) => ({
      name, type: numbers.has(name) ? 'float' : name === 'text' || text.includes(name) ? 'text' : 'varchar',
      isPrimary: name === 'id', isNullable: nullable.has(name), default: defaults[name],
    })) }));
    await queryRunner.createIndex('transcripts', new TableIndex({ name: 'idx_transcripts_created', columnNames: ['created_at'] }));
  }

  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.dropTable('transcripts'); }
}
