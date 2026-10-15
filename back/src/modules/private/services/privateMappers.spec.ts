/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { describe, expect, it } from '@jest/globals';
import { AssetEntity, toAssetDto } from 'src/modules/media-library';
import { ConversationEntity, MessageEntity, toConversationDto, toMessageDto } from 'src/modules/studio-core';
import { PrivateStore } from './PrivateStore';

/**
 * The interface shows a private generation with the components of a normal one: the shapes must stay the same fields.
 * (A field added to a public shape and forgotten here would fail this test.)
 */
describe('private shapes follow the public ones', () => {
  const asset = Object.assign(new AssetEntity(), {
    id: 'a1', kind: 'generated', media: 'video', conversationId: 'c1', messageId: 'm1', filename: 'f.mp4', thumb: 't.webp', originalName: null,
    width: 64, height: 48, seed: 1, duration: 2, position: 0, favorite: false, meta: { fps: 24 }, createdAt: 1,
  });
  const message = Object.assign(new MessageEntity(), {
    id: 'm1', conversationId: 'c1', parentId: 'u1', role: 'assistant', prompt: 'p', modelId: 'demo', params: {}, status: 'done', error: null,
    createdAt: 1, startedAt: 1, finishedAt: 2,
  });
  const conversation = Object.assign(new ConversationEntity(), { id: 'c1', title: 't', pinned: false, mode: 'video', createdAt: 1, updatedAt: 2 });

  function filled(): PrivateStore {
    const store = new PrivateStore();
    store.bind('s0123456789abcdef0123456789abcdef');
    const c = store.createConversation({ title: 't', mode: 'video' });
    const u = store.createMessage({ conversationId: c.id, role: 'user', prompt: 'p' });
    const a = store.createMessage({ conversationId: c.id, role: 'assistant', parentId: u.id, prompt: 'p', modelId: 'demo', status: 'done' });
    store.addAsset({ id: 'a1', kind: 'generated', media: 'video', filename: 'f.mp4', thumb: 't.webp', originalName: null, width: 64, height: 48, seed: 1, duration: 2, position: 0, meta: { fps: 24 }, conversationId: c.id, messageId: a.id });
    return Object.assign(store, { ids: { c: c.id, a: a.id } });
  }

  it('assets, messages and conversations have exactly the fields of the stored ones', () => {
    const store = filled() as PrivateStore & { ids: { c: string; a: string } };
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(store.assetDto(store.getAsset('a1')!))).toEqual(keys(toAssetDto(asset)));
    expect(keys(store.messageDto(store.getMessage(store.ids.a)!))).toEqual(keys(toMessageDto(message, [], [asset])));
    expect(keys(store.summary(store.ids.c)!)).toEqual(keys(toConversationDto(conversation, { cover: asset, generationCount: 1, busy: false })));
    expect(keys(store.detail(store.ids.c)!)).toEqual([...keys(store.summary(store.ids.c)!), 'messages'].sort());
  });

  it('the files are served under the session folder, thumbnails and posters included', () => {
    const store = filled();
    const dto = store.assetDto(store.getAsset('a1')!);
    expect(dto.url).toBe('/media/private/s0123456789abcdef0123456789abcdef/outputs/f.mp4');
    expect(dto.thumb_url).toBe('/media/private/s0123456789abcdef0123456789abcdef/thumbs/t.webp');
    expect(dto.fps).toBe(24);
  });

  it('the cover is the latest image or video, never an audio take; counts and busy follow the generations', () => {
    const store = filled() as PrivateStore & { ids: { c: string; a: string } };
    store.addAsset({ id: 'a2', kind: 'generated', media: 'audio', filename: 'x.wav', thumb: null, originalName: null, width: null, height: null, seed: null, duration: 1, position: 0, meta: {}, conversationId: store.ids.c, messageId: store.ids.a, createdAt: 99 });
    expect(store.summary(store.ids.c)).toMatchObject({ cover: { id: 'a1' }, generation_count: 1, busy: false });
    store.createMessage({ conversationId: store.ids.c, role: 'assistant', status: 'running' });
    expect(store.summary(store.ids.c)).toMatchObject({ generation_count: 2, busy: true });
  });

  it('forgetting messages returns the files to erase: outputs, and references nothing else uses', () => {
    const store = new PrivateStore();
    store.bind('s0123456789abcdef0123456789abcdef');
    const c = store.createConversation({ title: 't', mode: 'image' });
    const ref = store.addAsset({ id: 'r1', kind: 'upload', media: 'image', filename: 'r1.png', thumb: 'r1.webp', originalName: 'x', width: 1, height: 1, seed: null, duration: null, position: 0, meta: {}, conversationId: null, messageId: null });
    const u1 = store.createMessage({ conversationId: c.id, role: 'user', prompt: 'a', referenceIds: [ref.id] });
    const u2 = store.createMessage({ conversationId: c.id, role: 'user', prompt: 'b', referenceIds: [ref.id] });
    expect(store.removeMessages([u1.id]).map((a) => a.id)).toEqual([]); // still used by the second prompt
    expect(store.removeMessages([u2.id]).map((a) => a.id)).toEqual(['r1']);
    expect(store.getAsset('r1')).toBeNull();
  });

  it('a search finds a conversation by its title or a prompt, a mode filter narrows, pinned come first', () => {
    const store = filled();
    const other = store.createConversation({ title: 'autre', mode: 'image' });
    store.updateConversation(other.id, { pinned: true });
    expect(store.list().map((c) => c.id)[0]).toBe(other.id);
    expect(store.list({ mode: 'video' })).toHaveLength(1);
    expect(store.list({ q: 'AUT' })).toHaveLength(1);
    expect(store.list({ q: 'p' }).length).toBeGreaterThan(0);
  });
});
