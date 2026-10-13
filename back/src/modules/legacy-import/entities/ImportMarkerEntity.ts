/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';

/** Id of the marker written by the import of the legacy `ai-medialab.db`. */
export const LEGACY_IMPORT_MARKER_ID = 'legacy-ai-medialab-db';

/**
 * Proof that a legacy database was imported: its presence stops the importer for good. The legacy file itself is never
 * renamed or deleted by the importer (the engine still uses it until H6); this row replaces the planned `.imported`
 * renaming.
 */
@Entity({ name: 'import_markers' })
export class ImportMarkerEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  /** Absolute path of the database that was read. */
  @Column({ name: 'source_path', type: 'varchar' })
  sourcePath: string;

  /** Epoch seconds. */
  @Column({ name: 'imported_at', type: 'float' })
  importedAt: number;

  /** Rows read per table. */
  @Column({ type: jsonColumnType(), default: () => "'{}'" })
  counts: Record<string, number>;

  /** The legacy settings are applied after the data (they go through the module config): retried while `false`. */
  @Column({ name: 'settings_applied', type: 'boolean', default: false })
  settingsApplied: boolean;
}
