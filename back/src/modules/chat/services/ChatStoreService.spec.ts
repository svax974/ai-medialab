/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConversationEntity } from 'src/modules/studio-core';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';
import { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatSettingsEntity } from '../entities/ChatSettingsEntity';
import { ChatStoreService, descendantsOf, latestLeaf, pathTo, snippetAround } from './ChatStoreService';

describe('ChatStoreService', () => {
  let dataSource: DataSource;
  let store: ChatStoreService;
  let conv: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });
  afterAll(() => dataSource.destroy());
  beforeEach(async () => {
    await dataSource.getRepository(ChatMessageEntity).clear();
    await dataSource.getRepository(ConversationEntity).clear();
    const services = buildServices(dataSource);
    store = new ChatStoreService(
      dataSource.getRepository(ChatMessageEntity), dataSource.getRepository(ChatSettingsEntity), dataSource.getRepository(ConversationEntity), services.conversations,
    );
    conv = (await services.conversations.create({ mode: 'chat' })).id;
  });

  const add = (role: 'user' | 'assistant', parentId: string | null, content: string = role, extra = {}) =>
    store.addMessage({ conversationId: conv, parentId, role, content, ...extra });
  const wait = () => new Promise((r) => setTimeout(r, 3)); // distinct creation times

  /** u1 -> a1 -> u2 -> a2, plus a regeneration a1b of u1 and an edit u2b of u2. */
  async function tree() {
    const u1 = await add('user', null, 'u1');
    await wait();
    const a1 = await add('assistant', u1.id, 'a1');
    await wait();
    const u2 = await add('user', a1.id, 'u2');
    await wait();
    const a2 = await add('assistant', u2.id, 'a2');
    await wait();
    const a1b = await add('assistant', u1.id, 'a1b');
    await wait();
    const u2b = await add('user', a1.id, 'u2b');
    return { u1, a1, u2, a2, a1b, u2b };
  }

  it('requires a chat conversation', async () => {
    await expect(store.requireConversation('nope')).rejects.toBeInstanceOf(NotFoundException);
    const image = (await buildServices(dataSource).conversations.create({ mode: 'image' })).id;
    await expect(store.requireConversation(image)).rejects.toBeInstanceOf(NotFoundException);
    expect((await store.requireConversation(conv)).mode).toBe('chat');
  });

  it('stores settings with defaults and updates them part by part', async () => {
    expect(await store.getSettings(conv)).toEqual({ model_id: null, system_prompt: '', params: {}, context_size: null, reasoning: 'auto', tools: { web: false, creation: true }, leaf_id: null });
    await store.updateSettings(conv, { model_id: 'llm-a', params: { temperature: 0.5 } });
    await store.updateSettings(conv, { system_prompt: 'Sois bref.', tools: { web: true }, reasoning: 'low', context_size: 8192 });
    expect(await store.getSettings(conv)).toEqual({
      model_id: 'llm-a', system_prompt: 'Sois bref.', params: { temperature: 0.5 }, context_size: 8192, reasoning: 'low', tools: { web: true, creation: true }, leaf_id: null,
    });
    await store.updateSettings(conv, { model_id: null });
    expect((await store.getSettings(conv)).model_id).toBeNull();
  });

  it('gives siblings (same parent and role) in creation order, with their index', async () => {
    const t = await tree();
    await store.setLeaf(conv, t.a2.id);
    const { messages } = await store.branch(conv);
    expect(messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2']);
    const byContent = Object.fromEntries(messages.map((m) => [m.content, m]));
    expect(byContent.u1).toMatchObject({ parent_id: null, sibling_ids: [t.u1.id], sibling_index: 0 });
    expect(byContent.a1).toMatchObject({ sibling_ids: [t.a1.id, t.a1b.id], sibling_index: 0 });
    expect(byContent.u2).toMatchObject({ sibling_ids: [t.u2.id, t.u2b.id], sibling_index: 0 });
    expect(byContent.a2).toMatchObject({ sibling_ids: [t.a2.id], sibling_index: 0 });
    await store.setLeaf(conv, t.a1b.id);
    const other = (await store.branch(conv)).messages;
    expect(other.map((m) => m.content)).toEqual(['u1', 'a1b']);
    expect(other[1]).toMatchObject({ sibling_ids: [t.a1.id, t.a1b.id], sibling_index: 1 });
  });

  it('finds the most recent descendant: where switching to a branch lands', async () => {
    const t = await tree();
    expect(await store.latestLeafUnder(conv, t.u1.id)).toBe(t.a1b.id); // a1b is newer than a1
    expect(await store.latestLeafUnder(conv, t.a1.id)).toBe(t.u2b.id); // u2b is newer than u2
    expect(await store.latestLeafUnder(conv, t.u2.id)).toBe(t.a2.id);
    expect(await store.latestLeafUnder(conv, t.a2.id)).toBe(t.a2.id);
  });

  it('deletes a subtree, moves the leaf to the previous sibling branch, and returns what went', async () => {
    const t = await tree();
    await store.setLeaf(conv, t.u2b.id);
    const gone = await store.deleteSubtree(conv, t.u2b.id);
    expect(gone.map((m) => m.id)).toEqual([t.u2b.id]);
    expect((await store.getSettings(conv)).leaf_id).toBe(t.a2.id); // the remaining sibling u2, down to its leaf
    expect((await store.all(conv)).map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2', 'a1b']);
  });

  it('deletes a whole branch with its descendants and falls back to the parent when no sibling remains', async () => {
    const t = await tree();
    await store.setLeaf(conv, t.a2.id);
    const gone = await store.deleteSubtree(conv, t.a1.id); // a1, u2, u2b, a2
    expect(gone.map((m) => m.content).sort()).toEqual(['a1', 'a2', 'u2', 'u2b']);
    expect((await store.getSettings(conv)).leaf_id).toBe(t.a1b.id); // its sibling a1b
    await store.deleteSubtree(conv, t.a1b.id);
    expect((await store.getSettings(conv)).leaf_id).toBe(t.u1.id); // no sibling left: the parent
    await store.deleteSubtree(conv, t.u1.id);
    expect((await store.getSettings(conv)).leaf_id).toBeNull();
    expect(await store.all(conv)).toEqual([]);
  });

  it('leaves the leaf alone when the deleted subtree is on another branch', async () => {
    const t = await tree();
    await store.setLeaf(conv, t.a2.id);
    await store.deleteSubtree(conv, t.a1b.id);
    expect((await store.getSettings(conv)).leaf_id).toBe(t.a2.id);
  });

  it('refuses a message of another conversation or an unknown one', async () => {
    const t = await tree();
    const other = (await buildServices(dataSource).conversations.create({ mode: 'chat' })).id;
    await expect(store.requireMessage(other, t.u1.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(store.deleteSubtree(conv, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cascades: deleting the conversation deletes its messages and settings', async () => {
    await tree();
    await store.updateSettings(conv, { reasoning: 'low' });
    await buildServices(dataSource).conversations.remove(conv);
    expect(await dataSource.getRepository(ChatMessageEntity).count()).toBe(0);
    expect(await dataSource.getRepository(ChatSettingsEntity).count()).toBe(0);
  });

  it('cascades down a subtree at the database level too', async () => {
    const t = await tree();
    await dataSource.getRepository(ChatMessageEntity).delete({ id: t.a1.id });
    expect((await store.all(conv)).map((m) => m.content)).toEqual(['u1', 'a1b']);
  });

  it('marks replies left streaming by a previous run, keeping their text', async () => {
    const u = await add('user', null);
    const a = await add('assistant', u.id, 'début', { status: 'streaming' });
    const done = await add('assistant', u.id, 'fini');
    expect(await store.failInterrupted()).toBe(1);
    expect(await store.failInterrupted()).toBe(0);
    const stuck = (await store.getMessage(a.id)) as ChatMessageEntity;
    expect(stuck).toMatchObject({ status: 'error', content: 'début' });
    expect(stuck.error).toMatch(/interrompue/);
    expect((await store.getMessage(done.id))?.status).toBe('done');
  });

  it('summarises for the conversation list: messages of the active branch, and busy while streaming', async () => {
    const t = await tree();
    await store.setLeaf(conv, t.a2.id);
    expect(await store.stats(conv)).toEqual({ generationCount: 4, busy: false });
    await store.updateMessage(t.a2.id, { status: 'streaming' });
    expect(await store.stats(conv)).toEqual({ generationCount: 4, busy: true });
    expect(await store.stats('nope')).toEqual({ generationCount: 0, busy: false });
  });

  it('searches the content: substring, case-insensitive, with LIKE characters taken literally', async () => {
    const u = await add('user', null, 'Parle-moi de 100% de réussite et de snake_case');
    await add('assistant', u.id, 'Le Fantôme de l’opéra');
    const other = (await buildServices(dataSource).conversations.create({ mode: 'chat' })).id;
    await store.addMessage({ conversationId: other, parentId: null, role: 'user', content: 'rien à voir' });
    expect(await store.matching('fantôme')).toEqual([conv]);
    expect(await store.matching('100%')).toEqual([conv]);
    expect(await store.matching('snake_case')).toEqual([conv]);
    expect(await store.matching('snakeXcase')).toEqual([]);
    expect(await store.matching('%')).toEqual([conv]); // the literal %
    const hits = await store.search('réussite');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ conversation_id: conv, message_id: u.id });
    expect(hits[0].snippet).toContain('réussite');
  });

  it('lists the attachments the messages use', async () => {
    const attachment = { kind: 'image' as const, name: 'chat_0123456789abcdef.png', original_name: 'a.png', mime: 'image/png', size: 3 };
    await add('user', null, 'x', { attachments: [attachment] });
    await add('user', null, 'y');
    expect(await store.referencedAttachments()).toEqual(new Set([attachment.name]));
  });
});

describe('tree helpers', () => {
  const m = (id: string, parentId: string | null, createdAt: number) => ({ id, parentId, createdAt, role: 'user' }) as ChatMessageEntity;
  const all = [m('r', null, 1), m('a', 'r', 2), m('b', 'r', 3), m('a1', 'a', 4)];

  it('walks to the root, to the newest leaf, and over a subtree', () => {
    expect(pathTo(all, 'a1').map((x) => x.id)).toEqual(['r', 'a', 'a1']);
    expect(pathTo(all, null)).toEqual([]);
    expect(pathTo(all, 'ghost')).toEqual([]);
    expect(latestLeaf(all, 'r')).toBe('b');
    expect(latestLeaf(all, 'a')).toBe('a1');
    expect(descendantsOf(all, 'a').map((x) => x.id)).toEqual(['a', 'a1']);
  });

  it('survives a parent cycle', () => {
    const loop = [m('x', 'y', 1), m('y', 'x', 2)];
    expect(pathTo(loop, 'x').length).toBeLessThanOrEqual(2);
  });

  it('cuts a snippet around the match', () => {
    const text = `${'début '.repeat(30)}trouvé ici${' fin'.repeat(40)}`;
    const snippet = snippetAround(text, 'trouvé');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('trouvé ici');
    expect(snippet.length).toBeLessThan(140);
    expect(snippetAround('court', 'ou')).toBe('court');
  });
});
