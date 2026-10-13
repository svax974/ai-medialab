/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';
import { toAssetDto } from '../mappers/assetMapper';
import { AssetEntity } from '../entities/AssetEntity';
import { newId, nowSeconds } from '../utils/ids';

describe('AssetService and asset mapper', () => {
  let dataSource: DataSource;
  let s: ReturnType<typeof buildServices>;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildServices(dataSource);
  });
  afterEach(() => dataSource.destroy());

  it('creates an asset with the legacy defaults and the public URLs', async () => {
    const asset = await s.assets.create({ id: 'a', kind: 'upload', filename: 'f.png', originalName: 'photo.png' });
    expect(asset).toMatchObject({
      media: 'image', url: '/media/uploads/f.png', thumb_url: '/media/uploads/f.png', favorite: false,
      meta: {}, fps: null, duration: null, conversation_id: null, original_name: 'photo.png',
    });
    const generated = await s.assets.create({ id: 'g', kind: 'generated', filename: 'g.png', thumb: 'g.jpg' });
    expect(generated).toMatchObject({ url: '/media/outputs/g.png', thumb_url: '/media/thumbs/g.jpg' });
  });

  it('exposes fps for videos only', () => {
    const base = { kind: 'generated', filename: 'v.mp4', meta: { fps: 24 } } as unknown as AssetEntity;
    expect(toAssetDto({ ...base, media: 'video' } as AssetEntity).fps).toBe(24);
    expect(toAssetDto({ ...base, media: 'image' } as AssetEntity).fps).toBeNull();
  });

  it('toggles the favorite flag; unknown id gives null', async () => {
    await s.assets.create({ id: 'a', kind: 'generated', filename: 'a.png' });
    expect((await s.assets.setFavorite('a', true))?.favorite).toBe(true);
    expect((await s.assets.setFavorite('a', false))?.favorite).toBe(false);
    expect(await s.assets.setFavorite('zz', true)).toBeNull();
  });

  it('removes the row and returns it for file cleanup', async () => {
    await s.assets.create({ id: 'a', kind: 'generated', filename: 'a.png', thumb: 'a.jpg' });
    expect(await s.assets.remove('a')).toMatchObject({ filename: 'a.png', thumb: 'a.jpg' });
    expect(await s.assets.remove('a')).toBeNull();
    expect(await s.assets.get('a')).toBeNull();
  });

  it('pages the gallery newest first with the cursor of the legacy API', async () => {
    for (let i = 1; i <= 5; i++) {
      await s.assets.create({ id: `a${i}`, kind: 'generated', filename: `a${i}.png`, createdAt: i });
    }
    await s.assets.create({ id: 'snd', kind: 'generated', media: 'audio', filename: 's.wav', createdAt: 9 });
    const first = await s.assets.list({ limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['a5', 'a4']);
    expect(first.next_before).toBe(4);
    const next = await s.assets.list({ limit: 2, before: first.next_before as number });
    expect(next.items.map((i) => i.id)).toEqual(['a3', 'a2']);
    const last = await s.assets.list({ limit: 2, before: 2 });
    expect(last.items.map((i) => i.id)).toEqual(['a1']);
    expect(last.next_before).toBeNull();
    expect((await s.assets.list({ media: 'audio' })).items.map((i) => i.id)).toEqual(['snd']);
    expect((await s.assets.list({ media: 'all' })).items).toHaveLength(6);
    expect((await s.assets.list({ limit: 0 })).items).toHaveLength(1);
  });

  it('filters favorites and searches prompts and conversation titles', async () => {
    const conversation = await s.conversations.create({ title: 'Montagne' });
    await s.messages.create({ id: 'm', conversationId: conversation.id, role: 'assistant', prompt: 'un chat roux', modelId: 'flux' });
    await s.assets.create({ id: 'a', kind: 'generated', filename: 'a.png', messageId: 'm', conversationId: conversation.id, favorite: true });
    await s.assets.create({ id: 'b', kind: 'generated', filename: 'b.png' });
    expect((await s.assets.list({ favorites: true })).items.map((i) => i.id)).toEqual(['a']);
    const [hit] = (await s.assets.list({ q: 'chat' })).items;
    expect(hit).toMatchObject({ id: 'a', prompt: 'un chat roux', model_id: 'flux', conversation_title: 'Montagne' });
    expect((await s.assets.list({ q: 'montagne' })).items.map((i) => i.id)).toEqual(['a']);
    const plain = (await s.assets.list()).items.find((i) => i.id === 'b');
    expect(plain).toMatchObject({ prompt: null, model_id: null, conversation_title: null });
  });

  it('generates sortable ids', () => {
    expect(newId(1).startsWith('00000000001')).toBe(true);
    expect(newId(255).startsWith('000000000ff')).toBe(true);
    expect(newId()).toHaveLength(21);
    expect(Math.abs(nowSeconds() - Date.now() / 1000)).toBeLessThan(1);
  });
});
