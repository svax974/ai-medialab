/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { buildStudio, engineDown, engineError, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';
import { StudioEvents, STUDIO_EVENT_NAMES } from './StudioEvents';
import { assetFilePath, outputsDir, studioDataDir, uploadsDir } from '../utils/dataDir';

describe('AssetFileService, asset purge and data folder', () => {
  let dataSource: DataSource;
  let s: Studio;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
  });
  afterEach(() => dataSource.destroy());

  describe('ingest', () => {
    it('hands the raw upload to the engine and stores the row it describes', async () => {
      s.engine.on('POST /engine/v1/media/ingest', (c) => ({
        media: 'video', filename: `${c.options?.body?.asset_id}.mp4`, thumb: 't.webp', width: 640, height: 360, duration: 4.5, meta: { fps: 24 },
      }));
      const asset = await s.files.ingest({ path: join(uploadsDir(), 'tmp_x'), originalName: 'clip.mp4', mimeType: 'video/mp4' });
      expect(asset).toMatchObject({ kind: 'upload', media: 'video', original_name: 'clip.mp4', duration: 4.5, fps: 24, thumb_url: '/media/thumbs/t.webp' });
      expect(s.engine.calls[0].options?.body).toMatchObject({ source_path: join(uploadsDir(), 'tmp_x'), original_name: 'clip.mp4', content_type: 'video/mp4' });
    });

    it('relays the engine refusal (422 unreadable file) and removes the raw file', async () => {
      const raw = join(mkdtempSync(join(tmpdir(), 'raw-')), 'tmp_bad');
      writeFileSync(raw, 'x');
      s.engine.on('POST /engine/v1/media/ingest', () => { throw engineError(422, 'Image illisible : x.png'); });
      const error = await s.files.ingest({ path: raw, originalName: 'x.png', mimeType: 'image/png' }).catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(422);
      expect((error as HttpException).message).toBe('Image illisible : x.png');
      expect(existsSync(raw)).toBe(false);
      expect(await s.assets.list({ kind: 'upload' })).toMatchObject({ items: [] });
    });

    it('answers 502 when the engine cannot be reached', async () => {
      s.engine.on('POST /engine/v1/media/ingest', () => { throw engineDown(); });
      const error = await s.files.ingest({ path: join(uploadsDir(), 'nope'), originalName: 'x.png', mimeType: 'image/png' }).catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(502);
    });
  });

  describe('purge', () => {
    it('deletes unreferenced assets and their files, keeps a row a remaining message references', async () => {
      const c = await s.conversations.create({});
      await s.messages.create({ id: 'u', conversationId: c.id, role: 'user', referenceIds: [] });
      await s.assets.create({ id: 'kept', kind: 'upload', filename: 'kept.png', messageId: 'u', conversationId: c.id });
      await s.assets.create({ id: 'gone', kind: 'generated', filename: 'gone.png', thumb: 'gone.webp', messageId: 'u' });
      await dataSource.query("INSERT INTO message_refs (message_id, asset_id, position) VALUES ('u', 'kept', 0)");
      const all = [(await s.assets.getEntity('kept'))!, (await s.assets.getEntity('gone'))!];
      await s.files.purge(all);
      expect(await s.assets.get('gone')).toBeNull();
      expect(await s.assets.get('kept')).toMatchObject({ message_id: null });
      expect(s.engine.calls.at(-1)?.options?.body).toEqual({ files: [{ folder: 'outputs', filename: 'gone.png', thumb: 'gone.webp' }] });
    });

    it('does not call the engine when nothing is removed, and logs instead of failing when it is unreachable', async () => {
      await s.files.purge([]);
      expect(s.engine.calls).toEqual([]);
      s.engine.on('POST /engine/v1/media/purge', () => { throw engineDown(); });
      await expect(s.files.removeFiles([{ kind: 'upload', filename: 'a.png', thumb: null } as never])).resolves.toBeUndefined();
    });
  });

  it('data folder helpers: APP_DATA_DIR first, then IMAGEGEN_DATA_DIR, an error without either', () => {
    expect(studioDataDir({ APP_DATA_DIR: '/d' })).toBe('/d');
    expect(studioDataDir({ IMAGEGEN_DATA_DIR: ' /e ' })).toBe('/e');
    expect(() => studioDataDir({})).toThrow(/APP_DATA_DIR/);
    expect(uploadsDir({ APP_DATA_DIR: '/d' })).toBe('/d/uploads');
    expect(outputsDir({ APP_DATA_DIR: '/d' })).toBe('/d/outputs');
    expect(assetFilePath('upload', 'a.png', { APP_DATA_DIR: '/d' })).toBe('/d/uploads/a.png');
    expect(assetFilePath('generated', 'a.png', { APP_DATA_DIR: '/d' })).toBe('/d/outputs/a.png');
  });

  it('StudioEvents publishes under studio.<name> to administrators with the name as type', () => {
    const sent: unknown[][] = [];
    const events = new StudioEvents({ publish: (...args: unknown[]) => sent.push(args) } as never);
    for (const name of STUDIO_EVENT_NAMES) events.publish(name, { id: 1 });
    expect(sent).toHaveLength(STUDIO_EVENT_NAMES.length);
    expect(sent[0]).toEqual(['studio.job.progress', { type: 'job.progress', data: { id: 1 } }, { admin: true }]);
    expect(STUDIO_EVENT_NAMES).toEqual(['job.progress', 'job.image', 'message.updated', 'message.deleted', 'conversation.updated', 'conversation.deleted', 'asset.updated', 'asset.deleted']);
  });
});
