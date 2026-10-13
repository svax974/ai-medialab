/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync } from 'fs';
import { DataSource } from 'typeorm';
import { ConversationEntity, MessageEntity, MessageRefEntity } from 'src/modules/studio-core';
import { AssetEntity } from 'src/modules/media-library';
import { VoiceEntity } from 'src/modules/audio-studio';
import { ImportMarkerEntity, LEGACY_IMPORT_MARKER_ID } from '../entities/ImportMarkerEntity';
import { buildLegacyDatabase, loadDemo } from '../testing/legacyDatabase';
import { createTestDataSource } from 'src/testing/testDataSource';
import { LegacyImportService } from './LegacyImportService';

const fakeModuleConfig = () => ({
  getSchema: jest.fn(() => ({ moduleId: 'studio' })),
  register: jest.fn(),
  updateModuleConfig: jest.fn(async () => null),
});

describe('LegacyImportService', () => {
  let dataSource: DataSource;
  let moduleConfig: ReturnType<typeof fakeModuleConfig>;
  let service: LegacyImportService;
  const cleanups: (() => void)[] = [];

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    moduleConfig = fakeModuleConfig();
    service = new LegacyImportService(dataSource, moduleConfig as never);
  });
  afterEach(async () => {
    await dataSource.destroy();
    cleanups.splice(0).forEach((c) => c());
  });
  /** Puts the archived database back under its original name (a restored backup, an old copy…). */
  const restore = (file: string) => renameSync(`${file}.imported`, file);
  const legacy = (options?: Parameters<typeof buildLegacyDatabase>[0]) => {
    const built = buildLegacyDatabase(options);
    cleanups.push(built.cleanup);
    return built;
  };

  it('does nothing when the data folder has no legacy database', async () => {
    const empty = legacy({ fileName: 'unrelated.db' });
    expect(await service.run(empty.dir)).toMatchObject({ status: 'no-source', source: null });
    expect(await service.run(null)).toMatchObject({ status: 'no-source' });
    expect(await dataSource.getRepository(ConversationEntity).count()).toBe(0);
    expect(await dataSource.getRepository(ImportMarkerEntity).count()).toBe(0);
  });

  it('copies every table, with the file names unchanged', async () => {
    const { dir, file } = legacy();
    const demo = loadDemo();
    const report = await service.run(dir);
    expect(report).toMatchObject({ status: 'imported', source: file, skipped: {} });
    expect(report.counts).toEqual({
      conversations: demo.conversations.length,
      messages: demo.messages.length,
      assets: demo.assets.length,
      message_refs: demo.message_refs.length,
      voices: demo.voices.length,
    });
    expect(await dataSource.getRepository(ConversationEntity).count()).toBe(demo.conversations.length);
    expect(await dataSource.getRepository(MessageEntity).count()).toBe(demo.messages.length);
    expect(await dataSource.getRepository(MessageRefEntity).count()).toBe(1);
    expect(await dataSource.getRepository(VoiceEntity).count()).toBe(demo.voices.length);

    const asset = await dataSource.getRepository(AssetEntity).findOneByOrFail({ id: 'g4' });
    expect(asset).toMatchObject({ media: 'video', filename: 'clip_m3.mp4', thumb: 'clip_m3.jpg', duration: 4.04 });
    expect(asset.meta).toEqual({ fps: 24, frames: 97 });
    const message = await dataSource.getRepository(MessageEntity).findOneByOrFail({ id: 'm1' });
    expect(message.params).toEqual({ steps: 4, count: 2, seeds: [11, 22], width: 1024, height: 1024 });
    const voice = await dataSource.getRepository(VoiceEntity).findOneByOrFail({ id: 'v1' });
    expect(voice.peaks).toEqual([0.1, 0.5, 1.0, 0.3]);
    expect(voice.filename).toBe('voice_v1.wav');
  });

  it('writes the marker and applies the legacy settings through the module config', async () => {
    const { dir, file } = legacy();
    const report = await service.run(dir);
    expect(report.settingsApplied).toBe(6);
    expect(moduleConfig.updateModuleConfig).toHaveBeenCalledWith('studio', {
      studio_keepAliveMinutes: 30,
      studio_previews: false,
      studio_lowMemory: true,
      studio_quantize: { 'flux-schnell': 4, 'qwen-edit': null },
      studio_variant: { 'flux-schnell': 'q4' },
      studio_hfToken: 'hf_demo_token',
    });
    const marker = await dataSource.getRepository(ImportMarkerEntity).findOneByOrFail({ id: LEGACY_IMPORT_MARKER_ID });
    expect(marker).toMatchObject({ sourcePath: file, settingsApplied: true });
    expect(marker.counts.assets).toBe(loadDemo().assets.length);
  });

  it('is idempotent: a second run finds the marker and changes nothing', async () => {
    const { dir, file } = legacy();
    await service.run(dir);
    await dataSource.getRepository(ConversationEntity).update({ id: 'c1' }, { title: 'Renommée dans Nest' });
    await dataSource.getRepository(VoiceEntity).delete({ id: 'v2' });
    moduleConfig.updateModuleConfig.mockClear();

    expect(await service.run(dir)).toMatchObject({ status: 'no-source' }); // renamed: nothing to find
    restore(file);
    expect(await service.run(dir)).toMatchObject({ status: 'already-imported', counts: {} });
    expect(await dataSource.getRepository(ConversationEntity).findOneByOrFail({ id: 'c1' })).toMatchObject({
      title: 'Renommée dans Nest',
    });
    expect(await dataSource.getRepository(VoiceEntity).count()).toBe(1);
    expect(moduleConfig.updateModuleConfig).not.toHaveBeenCalled();
  });

  it('does not duplicate rows when it runs again without a marker', async () => {
    const { dir, file } = legacy();
    await service.run(dir);
    restore(file);
    await dataSource.getRepository(ImportMarkerEntity).delete({ id: LEGACY_IMPORT_MARKER_ID });
    await service.run(dir);
    expect(await dataSource.getRepository(AssetEntity).count()).toBe(loadDemo().assets.length);
    expect(await dataSource.getRepository(MessageRefEntity).count()).toBe(1);
  });

  it('retries only the settings when they failed after the data was copied', async () => {
    const { dir } = legacy();
    moduleConfig.updateModuleConfig.mockRejectedValueOnce(new Error('config unavailable'));
    await expect(service.run(dir)).rejects.toThrow('config unavailable');
    const marker = await dataSource.getRepository(ImportMarkerEntity).findOneByOrFail({ id: LEGACY_IMPORT_MARKER_ID });
    expect(marker.settingsApplied).toBe(false);
    expect(await dataSource.getRepository(ConversationEntity).count()).toBe(5);

    const report = await service.run(dir);
    expect(report).toMatchObject({ status: 'settings-retried', counts: {}, settingsApplied: 6 });
    expect(await dataSource.getRepository(ConversationEntity).count()).toBe(5);
    expect((await dataSource.getRepository(ImportMarkerEntity).findOneByOrFail({ id: LEGACY_IMPORT_MARKER_ID })).settingsApplied).toBe(true);
  });

  it('imports a database from before the later migrations (no mode, media or duration column)', async () => {
    const { dir } = legacy({ schema: 'first-release' });
    await service.run(dir);
    const conversations = await dataSource.getRepository(ConversationEntity).find();
    expect(conversations).toHaveLength(5);
    expect(conversations.every((c) => c.mode === 'image')).toBe(true);
    const assets = await dataSource.getRepository(AssetEntity).find();
    expect(assets.every((a) => a.media === 'image' && a.duration === null)).toBe(true);
  });

  it('accepts the pre-rename file name and a database without settings', async () => {
    const { dir, file } = legacy({ fileName: 'chambre-noire.db', settings: false });
    const report = await service.run(dir);
    expect(report).toMatchObject({ status: 'imported', source: file, settingsApplied: 0 });
    expect(moduleConfig.updateModuleConfig).not.toHaveBeenCalled();
    expect((await dataSource.getRepository(ImportMarkerEntity).findOneByOrFail({ id: LEGACY_IMPORT_MARKER_ID })).settingsApplied).toBe(true);
  });

  it('leaves rows out instead of failing on dangling references', async () => {
    const built = legacy();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = new (require('better-sqlite3'))(built.file);
    raw.pragma('foreign_keys = OFF');
    raw.prepare("INSERT INTO messages (id, conversation_id, role, prompt, created_at) VALUES ('lost', 'gone', 'user', 'x', 1)").run();
    raw.prepare("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('u3', 'nope', 0)").run();
    raw.prepare("UPDATE assets SET conversation_id = 'gone', message_id = 'lost' WHERE id = 'g5'").run();
    raw.close();
    const report = await service.run(built.dir);
    expect(report.skipped).toEqual({ messages: 1, message_refs: 1 });
    expect(await dataSource.getRepository(AssetEntity).findOneByOrFail({ id: 'g5' })).toMatchObject({
      conversationId: null,
      messageId: null,
    });
  });

  it('renames the imported database to .imported without changing a byte, and never deletes it', async () => {
    const { dir, file } = legacy();
    const before = readFileSync(file);
    const report = await service.run(dir);
    expect(report.archivedTo).toBe(`${file}.imported`);
    expect(readdirSync(dir)).toEqual(['ai-medialab.db.imported']);
    expect(readFileSync(`${file}.imported`).equals(before)).toBe(true);
    expect(await service.run(dir)).toMatchObject({ status: 'no-source', archivedTo: null });
    expect(readdirSync(dir)).toEqual(['ai-medialab.db.imported']);
  });

  it('keeps an earlier .imported file: a second archive gets a numeric suffix', async () => {
    const { dir, file } = legacy();
    copyFileSync(file, `${file}.imported`);
    const report = await service.run(dir);
    expect(report.archivedTo).toBe(`${file}.imported.1`);
    expect(readdirSync(dir).sort()).toEqual(['ai-medialab.db.imported', 'ai-medialab.db.imported.1']);
  });

  it('does not rename the database while the settings step failed (the retry needs it)', async () => {
    const { dir, file } = legacy();
    moduleConfig.updateModuleConfig.mockRejectedValueOnce(new Error('config unavailable'));
    await expect(service.run(dir)).rejects.toThrow('config unavailable');
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.imported`)).toBe(false);
    expect((await service.run(dir)).archivedTo).toBe(`${file}.imported`);
  });

  it('reads a WAL database that the engine still has open, without touching the main file', async () => {
    const { dir, file } = legacy({ wal: true });
    // The engine's connection stays open: its latest write lives in the -wal file, not in the main file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const engine = new (require('better-sqlite3'))(file);
    engine.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c9', 'Écrite dans le WAL', 1, 1)").run();
    const before = createHash('sha256').update(readFileSync(file)).digest('hex');
    try {
      expect(existsSync(`${file}-wal`)).toBe(true);
      const report = await service.run(dir);
      expect(report).toMatchObject({ status: 'imported' });
      expect(report.counts.conversations).toBe(6);
      expect(await dataSource.getRepository(ConversationEntity).findOneByOrFail({ id: 'c9' })).toMatchObject({ mode: 'image' });
      // The main file is archived untouched; its -wal and -shm files follow it.
      expect(createHash('sha256').update(readFileSync(`${file}.imported`)).digest('hex')).toBe(before);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(`${file}-wal`)).toBe(false);
    } finally {
      engine.close();
    }
  });

  it('resolves the data folder from APP_DATA_DIR, then IMAGEGEN_DATA_DIR', () => {
    const saved = { app: process.env.APP_DATA_DIR, img: process.env.IMAGEGEN_DATA_DIR };
    try {
      delete process.env.APP_DATA_DIR;
      delete process.env.IMAGEGEN_DATA_DIR;
      expect(service.resolveDataDir()).toBeNull();
      process.env.IMAGEGEN_DATA_DIR = '/tmp/engine-data';
      expect(service.resolveDataDir()).toBe('/tmp/engine-data');
      process.env.APP_DATA_DIR = '/tmp/app-data';
      expect(service.resolveDataDir()).toBe('/tmp/app-data');
    } finally {
      for (const [key, value] of [['APP_DATA_DIR', saved.app], ['IMAGEGEN_DATA_DIR', saved.img]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
