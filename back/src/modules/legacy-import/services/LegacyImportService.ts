/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { ModuleConfigService } from 'src/modules_shared/common/CommonModule';
import { isSqliteDataSource } from 'src/modules_shared/common/utils/dbEngine';
import { resolveAppDataDir } from 'src/modules_shared/common/utils/appDataDir';
import { VoiceEntity } from 'src/modules/audio-studio';
import { AssetEntity, nowSeconds } from 'src/modules/media-library';
import { LEGACY_SETTING_KEYS, SETTINGS_MODULE_ID, mapLegacySettings, settingsConfigSchema } from 'src/modules/settings';
import { ConversationEntity, MessageEntity, MessageRefEntity } from 'src/modules/studio-core';
import { ImportMarkerEntity, LEGACY_IMPORT_MARKER_ID } from '../entities/ImportMarkerEntity';
import { LegacyDatabaseOpener, LegacyImportReport } from '../types/importTypes';
import { LegacyDatabaseReader, archiveLegacyDatabase, findLegacyDatabase, openLegacyDatabaseReadOnly } from './LegacyDatabaseReader';
import {
  LegacyRow,
  parseJson,
  toAsset,
  toConversation,
  toMessage,
  toMessageRef,
  toVoice,
} from './legacyRowMappers';

const BATCH_SIZE = 200;

type Counts = Record<string, number>;

/**
 * One-shot import of the legacy `ai-medialab.db` (written by the Python engine before H6) into the Nest database.
 *
 * - Read-only on the legacy file: opened `readonly`, never modified or deleted; once everything is imported (data and
 *   settings) it is renamed to `ai-medialab.db.imported` (with its `-wal` / `-shm` files).
 * - Files (`uploads/`, `outputs/`, `thumbs/`, `previews/`) stay where they are: asset and voice rows keep their
 *   relative file names.
 * - Idempotent: all data goes in one transaction together with the marker row (`import_markers`); a second run finds the
 *   marker and does nothing. Rows are inserted `OR IGNORE`, so a run that had no marker yet never duplicates anything.
 * - The legacy `settings` are applied afterwards through the module config (`hf_token` is stored encrypted) and
 *   retried at the next start if that step failed.
 */
@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);
  /** Replaceable in tests (an in-memory fake instead of a file on disk). */
  openDatabase: LegacyDatabaseOpener = openLegacyDatabaseReadOnly;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly moduleConfig: ModuleConfigService,
  ) {}

  /** Data folder shared with the engine (`APP_DATA_DIR`, which the engine reads as `IMAGEGEN_DATA_DIR`). */
  resolveDataDir(): string | null {
    return resolveAppDataDir() ?? process.env.IMAGEGEN_DATA_DIR?.trim() ?? null;
  }

  /** Imports the legacy database of `dataDir` (default: the shared data folder) unless it was already imported. */
  async run(dataDir: string | null = this.resolveDataDir()): Promise<LegacyImportReport> {
    const source = dataDir ? findLegacyDatabase(dataDir) : null;
    if (!source) return { status: 'no-source', source: null, counts: {}, skipped: {}, settingsApplied: 0, archivedTo: null };

    const markers = this.dataSource.getRepository(ImportMarkerEntity);
    const marker = await markers.findOneBy({ id: LEGACY_IMPORT_MARKER_ID });
    if (marker?.settingsApplied) {
      return {
        status: 'already-imported',
        source: marker.sourcePath,
        counts: {},
        skipped: {},
        settingsApplied: 0,
        archivedTo: this.archive(source),
      };
    }

    const reader = new LegacyDatabaseReader(source, this.openDatabase);
    let report: LegacyImportReport;
    try {
      const copied = marker ? null : await this.copyData(reader, source);
      const settingsApplied = await this.applySettings(reader);
      await markers.update({ id: LEGACY_IMPORT_MARKER_ID }, { settingsApplied: true });
      this.logger.log(`Legacy database ${source}: ${copied ? 'imported' : 'settings retried'}.`);
      report = {
        status: copied ? 'imported' : 'settings-retried',
        source,
        counts: copied?.counts ?? {},
        skipped: copied?.skipped ?? {},
        settingsApplied,
        archivedTo: null,
      };
    } finally {
      reader.close();
    }
    report.archivedTo = this.archive(source);
    return report;
  }

  /** Renames the imported database to `<name>.imported`; a failure is logged (the import itself is done and marked). */
  private archive(source: string): string | null {
    try {
      const target = archiveLegacyDatabase(source);
      this.logger.log(`Legacy database renamed to ${target} (kept, never deleted).`);
      return target;
    } catch (error) {
      this.logger.warn(`Could not rename the legacy database ${source}: ${(error as Error).message}`);
      return null;
    }
  }

  private async copyData(reader: LegacyDatabaseReader, source: string) {
    const counts: Counts = {};
    const skipped: Counts = {};
    const known = {
      conversations: reader.ids('conversations'),
      messages: reader.ids('messages'),
      assets: reader.ids('assets'),
    };
    await this.dataSource.transaction(async (manager) => {
      // Messages and assets reference each other in either order: check the constraints at commit.
      if (isSqliteDataSource(this.dataSource)) await manager.query('PRAGMA defer_foreign_keys = ON');
      await this.copy(manager, ConversationEntity, reader.rows('conversations', 'created_at, id'), counts, toConversation);
      await this.copy(manager, MessageEntity, reader.rows('messages', 'created_at, id'), counts, (r) =>
        this.keepMessage(r, known, skipped),
      );
      await this.copy(manager, AssetEntity, reader.rows('assets', 'created_at, id'), counts, (r) =>
        this.keepAsset(r, known),
      );
      await this.copy(manager, MessageRefEntity, reader.rows('message_refs', 'message_id, position'), counts, (r) =>
        this.keepRef(r, known, skipped),
      );
      await this.copy(manager, VoiceEntity, reader.rows('voices', 'created_at, id'), counts, toVoice);
      await manager.insert(ImportMarkerEntity, {
        id: LEGACY_IMPORT_MARKER_ID,
        sourcePath: source,
        importedAt: nowSeconds(),
        counts,
        settingsApplied: false,
      });
    });
    return { counts, skipped };
  }

  /** Streams `rows` into `target` in batches of {@link BATCH_SIZE}; `convert` returns `null` to leave a row out. */
  private async copy<T extends ObjectLiteral>(
    manager: EntityManager,
    target: EntityTarget<T>,
    rows: IterableIterator<LegacyRow>,
    counts: Counts,
    convert: (row: LegacyRow) => T | null,
  ): Promise<void> {
    const name = manager.connection.getMetadata(target).tableName;
    counts[name] = 0;
    let batch: T[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await manager.createQueryBuilder().insert().into(target).values(batch as never).orIgnore().execute();
      batch = [];
    };
    for (const row of rows) {
      counts[name] += 1;
      const entity = convert(row);
      if (entity) batch.push(entity);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
  }

  private keepMessage(r: LegacyRow, known: Known, skipped: Counts): MessageEntity | null {
    if (!known.conversations.has(String(r.conversation_id))) {
      known.messages.delete(String(r.id));
      return count(skipped, 'messages');
    }
    const message = toMessage(r);
    if (message.parentId && !known.messages.has(message.parentId)) message.parentId = null;
    return message;
  }

  private keepAsset(r: LegacyRow, known: Known): AssetEntity {
    const asset = toAsset(r);
    if (asset.conversationId && !known.conversations.has(asset.conversationId)) asset.conversationId = null;
    if (asset.messageId && !known.messages.has(asset.messageId)) asset.messageId = null;
    return asset;
  }

  private keepRef(r: LegacyRow, known: Known, skipped: Counts): MessageRefEntity | null {
    if (!known.messages.has(String(r.message_id)) || !known.assets.has(String(r.asset_id))) {
      return count(skipped, 'message_refs');
    }
    return toMessageRef(r);
  }

  /** Reads the legacy `settings` table and stores the known keys in the module config. Returns how many were applied. */
  private async applySettings(reader: LegacyDatabaseReader): Promise<number> {
    const legacy: Record<string, unknown> = {};
    for (const row of reader.rows('settings', 'key')) {
      if (String(row.key) in LEGACY_SETTING_KEYS) legacy[String(row.key)] = parseJson<unknown>(row.value, null);
    }
    const values = mapLegacySettings(legacy);
    if (!Object.keys(values).length) return 0;
    if (!this.moduleConfig.getSchema(SETTINGS_MODULE_ID)) this.moduleConfig.register(settingsConfigSchema);
    await this.moduleConfig.updateModuleConfig(SETTINGS_MODULE_ID, values);
    return Object.keys(values).length;
  }
}

interface Known {
  conversations: Set<string>;
  messages: Set<string>;
  assets: Set<string>;
}

function count(skipped: Counts, table: string): null {
  skipped[table] = (skipped[table] ?? 0) + 1;
  return null;
}
