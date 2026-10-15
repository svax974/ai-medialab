/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AssetEntity } from 'src/modules/media-library';
import { ConversationEntity, ConversationModeRegistry, ConversationService, GenerationService, MessageEntity } from 'src/modules/studio-core';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';
import { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatSettingsEntity } from '../entities/ChatSettingsEntity';
import { ChatAttachmentService } from './ChatAttachmentService';
import { ChatBootstrap } from './ChatBootstrap';
import { ChatStoreService } from './ChatStoreService';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);

describe('the chat inside the shared conversation code', () => {
  let dataSource: DataSource;
  let s: Studio;
  let conversations: ConversationService;
  let generations: GenerationService;
  let store: ChatStoreService;
  let attachments: ChatAttachmentService;
  let bootstrap: ChatBootstrap;
  let cancelled: string[];
  let uploads: string;

  beforeEach(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chat-bootstrap-'));
    process.env.APP_DATA_DIR = dataDir;
    uploads = join(dataDir, 'uploads');
    mkdirSync(uploads, { recursive: true });
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
    const registry = new ConversationModeRegistry();
    conversations = new ConversationService(
      dataSource.getRepository(ConversationEntity), dataSource.getRepository(MessageEntity), dataSource.getRepository(AssetEntity), s.messages, registry,
    );
    generations = new GenerationService(conversations, s.messages, s.assets, s.files, s.queue, s.client as never, s.events);
    store = new ChatStoreService(dataSource.getRepository(ChatMessageEntity), dataSource.getRepository(ChatSettingsEntity), dataSource.getRepository(ConversationEntity), conversations);
    attachments = new ChatAttachmentService(store);
    cancelled = [];
    bootstrap = new ChatBootstrap(registry, store, { cancelConversation: (id: string) => cancelled.push(id) } as never, attachments);
    await bootstrap.onApplicationBootstrap();
  });
  afterEach(() => dataSource.destroy());

  const chat = async (title = 'Discussion') => (await conversations.create({ title, mode: 'chat' })).id;
  const say = (conversationId: string, role: 'user' | 'assistant', parentId: string | null, content: string, extra = {}) =>
    store.addMessage({ conversationId, role, parentId, content, ...extra });

  it('summarises a chat conversation from its active branch, with no cover', async () => {
    const id = await chat();
    const u = await say(id, 'user', null, 'Salut');
    const a = await say(id, 'assistant', u.id, 'Bonjour');
    await say(id, 'assistant', u.id, 'Salut aussi'); // another branch
    await store.setLeaf(id, a.id);
    expect(await conversations.getSummary(id)).toMatchObject({ mode: 'chat', cover: null, generation_count: 2, busy: false });
    await store.updateMessage(a.id, { status: 'streaming' });
    expect((await conversations.getSummary(id))?.busy).toBe(true);
    expect((await conversations.list({ mode: 'chat' })).map((c) => c.id)).toEqual([id]);
  });

  it('keeps the media conversations as they were (counts of generations, covers)', async () => {
    const image = (await conversations.create({ title: 'Image' })).id;
    expect(await conversations.getSummary(image)).toMatchObject({ mode: 'image', generation_count: 0, cover: null });
  });

  it('finds a chat conversation by the text of its messages, as well as the media ones by their prompts', async () => {
    const id = await chat('Sans rapport');
    await say(id, 'user', null, 'Que sais-tu des aurores boréales ?');
    const image = (await conversations.create({ title: 'Image' })).id;
    await dataSource.query("INSERT INTO messages (id, conversation_id, role, prompt, params, status, created_at) VALUES ('m1', ?, 'user', 'une aurore sur un lac', '{}', 'done', 1)", [image]);
    expect((await conversations.list({ q: 'boréales' })).map((c) => c.id)).toEqual([id]);
    expect((await conversations.list({ q: 'aurore' })).map((c) => c.id).sort()).toEqual([id, image].sort());
    expect((await conversations.list({ q: 'Sans rapport' })).map((c) => c.id)).toEqual([id]); // the title still matches
    expect(await conversations.list({ q: 'inconnu' })).toEqual([]);
  });

  it('creates conversations in chat mode with the chat title', async () => {
    const created = await conversations.create({ mode: 'chat' });
    expect(created).toMatchObject({ mode: 'chat', title: 'Nouvelle conversation', generation_count: 0 });
    expect((await conversations.create({})).title).toBe('Nouvelle création');
  });

  it('deletes a conversation with its messages, settings and attachment files, after stopping its reply', async () => {
    const id = await chat();
    writeFileSync(join(uploads, 'tmp_a'), PNG);
    const file = await attachments.accept({ path: join(uploads, 'tmp_a'), originalname: 'a.png', size: PNG.length });
    const u = await say(id, 'user', null, 'Regarde', { attachments: await attachments.resolve([file.name]) });
    await say(id, 'assistant', u.id, 'Joli');
    await store.updateSettings(id, { reasoning: 'low' });
    const other = await chat('Autre');
    await say(other, 'user', null, 'reste');
    expect(await generations.removeConversation(id)).toEqual({ ok: true });
    expect(cancelled).toEqual([id]);
    expect(existsSync(join(uploads, file.name))).toBe(false);
    expect(await store.all(id)).toEqual([]);
    expect(await dataSource.getRepository(ChatSettingsEntity).countBy({ conversationId: id })).toBe(0);
    expect(await conversations.getSummary(id)).toBeNull();
    expect((await store.all(other)).map((m) => m.content)).toEqual(['reste']); // the other conversation is untouched
    expect(s.published.map((e) => e.type)).toContain('conversation.deleted');
  });

  it('settles at start-up what a previous run left: replies still streaming, uploads never sent', async () => {
    const id = await chat();
    const u = await say(id, 'user', null, 'q');
    const a = await say(id, 'assistant', u.id, 'début', { status: 'streaming' });
    writeFileSync(join(uploads, 'chat_aaaaaaaaaaaaaaaa.png'), PNG);
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    utimesSync(join(uploads, 'chat_aaaaaaaaaaaaaaaa.png'), old, old);
    await bootstrap.onApplicationBootstrap();
    expect(await store.getMessage(a.id)).toMatchObject({ status: 'error', content: 'début' });
    expect(existsSync(join(uploads, 'chat_aaaaaaaaaaaaaaaa.png'))).toBe(false);
  });

  it('never fails the start-up when the cleanup cannot run', async () => {
    jest.spyOn(store, 'failInterrupted').mockRejectedValueOnce(new Error('db locked'));
    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
