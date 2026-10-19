/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';
import { interruptedMessage } from './MessageService';

describe('conversation and message services', () => {
  let dataSource: DataSource;
  let s: ReturnType<typeof buildServices>;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildServices(dataSource);
  });
  afterEach(() => dataSource.destroy());

  it('creates a conversation with the legacy defaults', async () => {
    const created = await s.conversations.create({});
    expect(created).toMatchObject({
      title: 'Nouvelle création', mode: 'image', pinned: false, cover: null, generation_count: 0, busy: false, messages: [],
    });
    expect(created.id).toMatch(/^[0-9a-f]{21}$/);
    expect((await s.conversations.create({ title: '  Voix  ', mode: 'audio' }))).toMatchObject({ title: 'Voix', mode: 'audio' });
    expect((await s.conversations.create({ mode: 'bogus' })).mode).toBe('image');
  });

  it('updates the title (trimmed, 200 characters at most) and the pin; unknown id gives null', async () => {
    const { id } = await s.conversations.create({});
    const updated = await s.conversations.update(id, { title: ` ${'x'.repeat(300)} `, pinned: true });
    expect(updated?.title).toHaveLength(200);
    expect(updated?.pinned).toBe(true);
    expect(await s.conversations.update('missing', { pinned: true })).toBeNull();
  });

  it('lists pinned conversations first, then the most recently touched', async () => {
    const a = await s.conversations.create({ title: 'a' });
    const b = await s.conversations.create({ title: 'b' });
    const c = await s.conversations.create({ title: 'c' });
    await s.conversations.update(a.id, { pinned: true });
    await new Promise((r) => setTimeout(r, 5));
    await s.conversations.touch(b.id);
    expect((await s.conversations.list()).map((x) => x.title)).toEqual(['a', 'b', 'c']);
    expect((await s.conversations.list({ q: 'c' })).map((x) => x.id)).toEqual([c.id]);
  });

  it('creates messages with ordered, de-duplicated references, then reads them back', async () => {
    const conversation = await s.conversations.create({});
    await s.assets.create({ id: 'r1', kind: 'upload', filename: 'r1.png', createdAt: 1 });
    await s.assets.create({ id: 'r2', kind: 'upload', filename: 'r2.png', createdAt: 2 });
    const user = await s.messages.create({
      id: 'u', conversationId: conversation.id, role: 'user', prompt: 'hello', referenceIds: ['r2', 'r1', 'r2'],
    });
    expect(user.references.map((a) => a.id)).toEqual(['r2', 'r1']);
    expect(user).toMatchObject({ status: 'done', params: {}, model_id: null, parent_id: null, outputs: [] });
    const answer = await s.messages.create({
      id: 'a', conversationId: conversation.id, role: 'assistant', parentId: 'u', modelId: 'm', status: 'queued',
      params: { steps: 4 },
    });
    await s.assets.create({ id: 'o', kind: 'generated', filename: 'o.png', messageId: 'a', conversationId: conversation.id });
    expect((await s.messages.get('a'))?.outputs.map((o) => o.id)).toEqual(['o']);
    expect(answer.status).toBe('queued');
    const detail = await s.conversations.get(conversation.id);
    expect(detail?.messages.map((m) => m.id)).toEqual(['u', 'a']);
    expect(detail).toMatchObject({ busy: true, generation_count: 1, cover: { id: 'o' } });
  });

  it('updates a message and returns null for an unknown one', async () => {
    const { id } = await s.conversations.create({});
    await s.messages.create({ id: 'a', conversationId: id, role: 'assistant', status: 'queued' });
    const updated = await s.messages.update('a', { status: 'running', startedAt: 5, params: { seeds: [1] } });
    expect(updated).toMatchObject({ status: 'running', started_at: 5, params: { seeds: [1] } });
    expect(await s.messages.update('zz', { status: 'done' })).toBeNull();
    expect(await s.messages.get('zz')).toBeNull();
  });

  it('marks interrupted generations as failed, like the legacy startup sweep', async () => {
    const { id } = await s.conversations.create({});
    for (const [mid, status] of [['q', 'queued'], ['l', 'loading'], ['r', 'running'], ['d', 'done']] as const) {
      await s.messages.create({ id: mid, conversationId: id, role: 'assistant', status });
    }
    expect(await s.messages.failInterrupted()).toBe(3);
    expect((await s.messages.get('r'))).toMatchObject({ status: 'error', error: interruptedMessage() });
    expect((await s.messages.get('d'))?.status).toBe('done');
    expect((await s.conversations.getSummary(id))?.busy).toBe(false);
  });

  it('deleting a conversation cascades to messages and links but keeps the assets', async () => {
    const { id } = await s.conversations.create({});
    await s.messages.create({ id: 'u', conversationId: id, role: 'user', referenceIds: [] });
    await s.messages.create({ id: 'a', conversationId: id, role: 'assistant', parentId: 'u' });
    await s.assets.create({ id: 'y', kind: 'generated', filename: 'y.png', conversationId: id, messageId: 'a' });
    expect(await s.conversations.remove(id)).toBe(true);
    expect(await s.conversations.remove(id)).toBe(false);
    expect(await s.messages.get('a')).toBeNull();
    expect(await s.assets.get('y')).toMatchObject({ conversation_id: null, message_id: null });
  });

  it('deleting a prompt deletes the generations that answer it', async () => {
    const { id } = await s.conversations.create({});
    await s.messages.create({ id: 'u', conversationId: id, role: 'user' });
    await s.messages.create({ id: 'a', conversationId: id, role: 'assistant', parentId: 'u' });
    expect(await s.messages.remove('u')).toBe(true);
    expect(await s.messages.get('a')).toBeNull();
  });
});
