/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import { existsSync, mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { EngineClient } from 'src/modules/engine';
import { ENGINE_CONFIG } from 'src/modules/engine/engineConfig';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { ConversationEntity, ConversationModeRegistry, ConversationService, EngineBusyGate, MessageEntity } from 'src/modules/studio-core';
import { AssetEntity } from 'src/modules/media-library';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import type { AuthPrincipal } from 'src/modules_shared/common/auth';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';
import { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatSettingsEntity } from '../entities/ChatSettingsEntity';
import { ChatAttachmentService } from '../services/ChatAttachmentService';
import { ChatBootstrap } from '../services/ChatBootstrap';
import { ChatReplyService } from '../services/ChatReplyService';
import { ChatService } from '../services/ChatService';
import { ChatStoreService } from '../services/ChatStoreService';
import { EngineLlmClient } from '../services/EngineLlmClient';
import { PromptEnhanceService } from '../services/PromptEnhanceService';
import { frame, type Json } from '../testing/sse';
import { ChatError } from '../types/chatTypes';
import { ChatController } from './ChatController';

let principal: AuthPrincipal | undefined = { id: 0, admin: true, kind: 'local-trust' };

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (principal) applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), principal);
    return next.handle();
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const events = (text: string): { event: string; data: Json }[] =>
  text.split('\n\n').filter((b) => b.trim() && !b.startsWith(':')).map((block) => {
    const lines = block.split('\n');
    return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
  });

describe('chat routes', () => {
  let dataSource: DataSource;
  let engine: FakeEngine;
  let app: INestApplication;
  let gate: EngineBusyGate;
  let store: ChatStoreService;
  let conv: string;
  let occupied = false;
  let resolveModel: () => unknown;
  let script: object[];
  let loadedModel: string | null;
  const dataDir = mkdtempSync(join(tmpdir(), 'chat-routes-'));

  beforeAll(async () => {
    process.env.APP_DATA_DIR = dataDir;
    dataSource = await createTestDataSource();
    engine = await startFakeEngine();
    const base = buildServices(dataSource);
    const registry = new ConversationModeRegistry();
    const conversations = new ConversationService(
      dataSource.getRepository(ConversationEntity), dataSource.getRepository(MessageEntity), dataSource.getRepository(AssetEntity), base.messages, registry,
    );
    const services = { ...base, conversations };
    store = new ChatStoreService(dataSource.getRepository(ChatMessageEntity), dataSource.getRepository(ChatSettingsEntity), dataSource.getRepository(ConversationEntity), conversations);
    gate = new EngineBusyGate();
    const engineClient = new EngineClient(testConfig(engine.url));
    const llm = new EngineLlmClient(engineClient);
    const attachments = new ChatAttachmentService(store);
    const models = { resolve: async () => { const m = resolveModel(); if (m instanceof ChatError) throw m; return m; } } as never;
    const queue = { get occupied() { return occupied; } } as never;
    const replies = new ChatReplyService(store, llm, models, attachments, { begin: () => ({}), run: async () => ({}) } as never, { prepare: async () => null } as never, services.conversations, { publishConversation: () => Promise.resolve() } as never, queue, gate, {} as never);
    const chat = new ChatService(store, services.conversations, attachments, replies, { discard: async () => undefined } as never, engineClient, gate);
    await new ChatBootstrap(registry, store, replies, attachments).onApplicationBootstrap();
    const enhancer = new PromptEnhanceService(llm, models, engineClient, queue, gate);

    @Module({
      controllers: [ChatController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        { provide: ChatService, useValue: chat },
        { provide: ChatReplyService, useValue: replies },
        { provide: ChatAttachmentService, useValue: attachments },
        { provide: PromptEnhanceService, useValue: enhancer },
        { provide: APP_INTERCEPTOR, useClass: FakeAuthInterceptor },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await engine.close();
    await dataSource.destroy();
  });
  /** The engine as most tests want it: the loaded model on `/llm/status`, the scripted reply on `/llm/chat`. */
  const defaultEngine = (req: { url: string }, res: http.ServerResponse) => {
    if (req.url === '/engine/v1/llm/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ state: loadedModel ? 'ready' : 'idle', model_id: loadedModel }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const e of script) res.write(frame(e));
    res.end();
  };

  beforeEach(async () => {
    engine.handle(defaultEngine);
    await dataSource.getRepository(ChatMessageEntity).clear();
    await dataSource.getRepository(ConversationEntity).clear();
    conv = (await buildServices(dataSource).conversations.create({ mode: 'chat' })).id;
    occupied = false;
    loadedModel = null;
    resolveModel = () => ({ id: 'llm-a', name: 'Modèle A', caps: { context_default: 16384, context_max: 32768, vision: true, tools: true, reasoning: 'toggle', moe: false, params_b: 4, active_params_b: null } });
    script = [{ type: 'delta', content: 'Bonjour' }, { type: 'usage', prompt_tokens: 4, completion_tokens: 1, tokens_per_second: 20, context_size: 8192 }, { type: 'done', finish_reason: 'stop' }];
    engine.requests.length = 0;
  });
  afterEach(() => {
    principal = { id: 0, admin: true, kind: 'local-trust' };
  });

  const http_ = () => request(app.getHttpServer());
  const post = (path: string, body: object = {}) => http_().post(`/api/chat/conversations/${conv}${path}`).send(body);

  it('refuses a request without an admin principal', async () => {
    principal = undefined;
    await http_().get(`/api/chat/conversations/${conv}`).expect(401);
    await post('/messages', { content: 'x' }).expect(401);
    expect(engine.requests).toHaveLength(0);
  });

  describe('conversation and settings', () => {
    it('reads an empty conversation: summary, default settings, no message', async () => {
      const res = await http_().get(`/api/chat/conversations/${conv}`).expect(200);
      expect(res.body).toMatchObject({
        conversation: { id: conv, mode: 'chat', title: 'Nouvelle conversation', pinned: false, cover: null, generation_count: 0, busy: false },
        settings: { model_id: null, system_prompt: '', params: {}, context_size: null, reasoning: 'auto', tools: { web: false }, leaf_id: null },
        messages: [],
      });
    });

    it('answers 404 for an unknown conversation or one of another studio, 400 for a malformed id', async () => {
      await http_().get('/api/chat/conversations/nope').expect(404);
      const image = (await buildServices(dataSource).conversations.create({ mode: 'image' })).id;
      await http_().get(`/api/chat/conversations/${image}`).expect(404);
      await http_().get('/api/chat/conversations/a%20b').expect(400);
    });

    it('patches and persists settings, and validates them (422)', async () => {
      const res = await http_().patch(`/api/chat/conversations/${conv}/settings`).send({ model_id: 'llm-a', system_prompt: 'Sois bref.', params: { temperature: 0.3 }, tools: { web: true }, reasoning: 'off' }).expect(200);
      expect(res.body).toMatchObject({ model_id: 'llm-a', system_prompt: 'Sois bref.', params: { temperature: 0.3 }, tools: { web: true }, reasoning: 'off', leaf_id: null });
      expect((await http_().get(`/api/chat/conversations/${conv}`)).body.settings.system_prompt).toBe('Sois bref.');
      for (const bad of [{ params: { temperature: 5 } }, { reasoning: 'max' }, { tools: { web: 1 } }, { context_size: 5 }]) {
        await http_().patch(`/api/chat/conversations/${conv}/settings`).send(bad as object).expect(422);
      }
      await http_().patch('/api/chat/conversations/nope/settings').send({}).expect(404);
    });
  });

  describe('model unload and siblings', () => {
    const unloadHandler = (status: number, body: object) => (req: { url: string }, res: http.ServerResponse) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/engine/v1/llm/unload' ? body : {}));
    };

    it('unloads the chat model through the engine', async () => {
      engine.handle(unloadHandler(200, { ok: true }));
      const res = await http_().post('/api/chat/model/unload').expect(200);
      expect(res.body).toEqual({ ok: true });
      expect(engine.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /engine/v1/llm/unload']);
    });

    it('refuses to unload (409, code busy) while a reply or a generation holds the engine, without calling it', async () => {
      expect(gate.tryAcquire('chat')).toBe(true);
      const res = await http_().post('/api/chat/model/unload').expect(409);
      gate.release('chat');
      expect(res.body).toMatchObject({ statusCode: 409, code: 'busy' });
      expect(engine.requests).toHaveLength(0);
    });

    it('passes the engine\'s own refusal on (409)', async () => {
      engine.handle(unloadHandler(409, { detail: 'Une réponse est en cours.' }));
      await http_().post('/api/chat/model/unload').expect(409);
    });

    it('lists the complete siblings of a message, oldest first, whichever branch is active', async () => {
      const user = await store.addMessage({ conversationId: conv, parentId: null, role: 'user', content: 'Q' });
      const a = await store.addMessage({ conversationId: conv, parentId: user.id, role: 'assistant', content: 'A', status: 'done', modelId: 'llm-a' });
      const b = await store.addMessage({ conversationId: conv, parentId: user.id, role: 'assistant', content: 'B', status: 'done', modelId: 'llm-b' });
      await store.setLeaf(conv, b.id);
      const res = await http_().get(`/api/chat/conversations/${conv}/messages/${a.id}/siblings`).expect(200);
      expect(res.body.map((m: Json) => [m.id, m.content, m.model_id, m.sibling_index])).toEqual([[a.id, 'A', 'llm-a', 0], [b.id, 'B', 'llm-b', 1]]);
      expect(res.body[0].sibling_ids).toEqual([a.id, b.id]);
      expect((await http_().get(`/api/chat/conversations/${conv}/messages/${user.id}/siblings`).expect(200)).body).toHaveLength(1);
    });

    it('answers 404 for an unknown message or conversation, 400 for a malformed id', async () => {
      await http_().get(`/api/chat/conversations/${conv}/messages/nope/siblings`).expect(404);
      await http_().get('/api/chat/conversations/nope/messages/x/siblings').expect(404);
      await http_().get(`/api/chat/conversations/${conv}/messages/a%20b/siblings`).expect(400);
    });
  });

  describe('replies (server-sent events)', () => {
    it('streams a reply with the contract headers and the events in order', async () => {
      const res = await post('/messages', { content: 'Salut' }).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['x-accel-buffering']).toBe('no');
      const got = events(res.text);
      expect(got.map((e) => e.event)).toEqual(['message', 'message', 'delta', 'usage', 'done', 'title']); // done first: the title follows, then the stream closes
      expect(got[0].data.message).toMatchObject({ role: 'user', content: 'Salut' });
      expect(got.find((e) => e.event === 'done')?.data.message).toMatchObject({ role: 'assistant', content: 'Bonjour', status: 'done', model_id: 'llm-a' });
      const read = (await http_().get(`/api/chat/conversations/${conv}`)).body;
      expect(read.messages.map((m: Json) => m.content)).toEqual(['Salut', 'Bonjour']);
      expect(read.conversation).toMatchObject({ generation_count: 2, busy: false });
      expect(gate.busy).toBe(false);
    });

    it('answers a refusal as a one-event stream, with nothing stored', async () => {
      resolveModel = () => new ChatError('no_model', "Aucun modèle de chat n'est installé.");
      const res = await post('/messages', { content: 'Salut' }).expect(200);
      expect(events(res.text)).toEqual([{ event: 'error', data: { code: 'no_model', message: "Aucun modèle de chat n'est installé." } }]);
      expect(await store.all(conv)).toEqual([]);
      occupied = true;
      expect(events((await post('/messages', { content: 'Salut' }).expect(200)).text)[0].data.code).toBe('busy');
    });

    it('answers invalid requests as ordinary HTTP errors, before any stream', async () => {
      const bad = await post('/messages', { content: '   ' }).expect(422);
      expect(bad.headers['content-type']).toMatch(/json/);
      await post('/messages', { content: 'x', attachments: [{ name: '../../etc/passwd' }] }).expect(422);
      await post('/messages', { content: 'x', parent_id: 'ghost' }).expect(404);
      await http_().post('/api/chat/conversations/nope/messages').send({ content: 'x' }).expect(404);
      await http_().post('/api/chat/conversations/a%20b/messages').send({ content: 'x' }).expect(400);
      expect(engine.requests).toHaveLength(0);
    });

    it('regenerates and edits', async () => {
      const first = events((await post('/messages', { content: 'Question' })).text);
      const user = first[0].data.message;
      const answer = first.find((e) => e.event === 'done')?.data.message;
      script = [{ type: 'delta', content: 'Autre' }, { type: 'done', finish_reason: 'stop' }];
      const regenerated = events((await post(`/messages/${answer.id}/regenerate`, { model_id: 'llm-b' }).expect(200)).text);
      expect(regenerated[0].data.message).toMatchObject({ role: 'assistant', parent_id: user.id, sibling_index: 1 });
      const edited = events((await post(`/messages/${user.id}/edit`, { content: 'Question 2' }).expect(200)).text);
      expect(edited[0].data.message).toMatchObject({ role: 'user', content: 'Question 2', parent_id: null, sibling_index: 1 });
      await post(`/messages/${user.id}/regenerate`).expect(422); // a user message cannot be regenerated
      await post(`/messages/${answer.id}/edit`, { content: 'x' }).expect(422); // nor an assistant one edited
      await post('/messages/ghost/regenerate').expect(404);
    });

    it('switches branch and deletes a message with its subtree', async () => {
      const first = events((await post('/messages', { content: 'Question' })).text);
      const answer = first.find((e) => e.event === 'done')?.data.message;
      script = [{ type: 'delta', content: 'Autre' }, { type: 'done', finish_reason: 'stop' }];
      const second = events((await post(`/messages/${answer.id}/regenerate`)).text).find((e) => e.event === 'done')?.data.message;
      let read = (await post('/leaf', { message_id: answer.id }).expect(200)).body;
      expect(read.messages.map((m: Json) => m.content)).toEqual(['Question', 'Bonjour']);
      expect(read.settings.leaf_id).toBe(answer.id);
      read = (await post('/leaf', { message_id: second.id }).expect(200)).body;
      expect(read.messages.at(-1).id).toBe(second.id);
      await post('/leaf', { message_id: 'ghost' }).expect(404);
      await post('/leaf', {}).expect(400);
      read = (await http_().delete(`/api/chat/conversations/${conv}/messages/${second.id}`).expect(200)).body;
      expect(read.messages.map((m: Json) => m.content)).toEqual(['Question', 'Bonjour']); // the leaf went back to the other answer
      await http_().delete(`/api/chat/conversations/${conv}/messages/${second.id}`).expect(404);
    });

    it('stops when the client closes the connection: the reply is cancelled and the engine is free again', async () => {
      engine.handle((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(frame({ type: 'delta', content: 'Début' }));
      });
      await app.listen(0);
      const { port } = app.getHttpServer().address() as { port: number };
      await new Promise<void>((resolve) => {
        const req = http.request({ port, method: 'POST', path: `/api/chat/conversations/${conv}/messages`, headers: { 'content-type': 'application/json' } }, (res) => {
          let seen = '';
          res.on('data', (chunk: Buffer) => {
            seen += chunk.toString();
            if (!seen.includes('event: delta')) return; // leave once the first piece of text arrived
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => undefined);
        req.end(JSON.stringify({ content: 'Raconte' }));
      });
      for (let i = 0; i < 40 && gate.busy; i++) await new Promise((r) => setTimeout(r, 25));
      expect(gate.busy).toBe(false);
      const assistant = (await store.all(conv)).find((m) => m.role === 'assistant');
      expect(assistant).toMatchObject({ status: 'cancelled', content: 'Début' });
    });
  });

  describe('attachments', () => {
    it('stores an image and a text file, then sends them with a message', async () => {
      const image = (await http_().post('/api/chat/attachments').attach('file', PNG, 'photo.png').expect(200)).body;
      expect(image).toMatchObject({ kind: 'image', original_name: 'photo.png', mime: 'image/png', size: PNG.length });
      expect(image.name).toMatch(/^chat_[0-9a-f]{16}\.png$/);
      expect(image.url).toBe(`/api/media/uploads/${image.name}`);
      const text = (await http_().post('/api/chat/attachments').attach('file', Buffer.from('bonjour'), 'notes.txt').expect(200)).body;
      expect(text).toMatchObject({ kind: 'text', original_name: 'notes.txt' });
      const got = events((await post('/messages', { content: 'Regarde', attachments: [{ name: image.name }, { name: text.name }] })).text);
      expect(got[0].data.message.attachments.map((a: Json) => a.kind).sort()).toEqual(['image', 'text']);
      expect(got[0].data.message.attachments.find((a: Json) => a.kind === 'image').url).toBe(image.url);
      const body = JSON.parse(engine.requests.find((r) => r.url === '/engine/v1/llm/chat')!.body.toString());
      expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: join(dataDir, 'uploads', image.name) } });
    });

    it('refuses what is not an image or a text file, and an upload without a file', async () => {
      const before = readdirSync(join(dataDir, 'uploads'));
      await http_().post('/api/chat/attachments').attach('file', Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), 'archive.zip').expect(422);
      await http_().post('/api/chat/attachments').attach('file', Buffer.from('<svg onload=alert(1)></svg>\u0000'), 'x.svg').expect(422);
      await http_().post('/api/chat/attachments').field('x', 'y').expect(422);
      expect(readdirSync(join(dataDir, 'uploads')).filter((f) => f.startsWith('tmp_'))).toEqual(before.filter((f) => f.startsWith('tmp_')));
    });

    it('deleting the message deletes its files', async () => {
      const image = (await http_().post('/api/chat/attachments').attach('file', PNG, 'photo.png')).body;
      const got = events((await post('/messages', { content: 'Regarde', attachments: [{ name: image.name }] })).text);
      expect(existsSync(join(dataDir, 'uploads', image.name))).toBe(true);
      await http_().delete(`/api/chat/conversations/${conv}/messages/${got[0].data.message.id}`).expect(200);
      expect(existsSync(join(dataDir, 'uploads', image.name))).toBe(false);
    });
  });

  describe('export and search', () => {
    beforeEach(async () => {
      await post('/messages', { content: 'Parle-moi des élans' });
    });

    it('exports the active branch as Markdown or JSON', async () => {
      const md = await http_().get(`/api/chat/conversations/${conv}/export?format=md`).expect(200);
      expect(md.headers['content-type']).toMatch(/^text\/markdown/);
      expect(md.headers['content-disposition']).toMatch(/^attachment; filename="[\w.-]+\.md"$/);
      expect(md.text).toContain('## Vous');
      expect(md.text).toContain('Parle-moi des élans');
      expect(md.text).toContain('Bonjour');
      const json = await http_().get(`/api/chat/conversations/${conv}/export?format=json`).expect(200);
      expect(JSON.parse(json.text)).toMatchObject({ conversation: { id: conv }, messages: [{ role: 'user' }, { role: 'assistant' }] });
      await http_().get(`/api/chat/conversations/${conv}/export?format=pdf`).expect(400);
      await http_().get(`/api/chat/conversations/${conv}/export`).expect(400);
    });

    it('searches the messages', async () => {
      const hits = (await http_().get('/api/chat/search?q=%C3%A9lans').expect(200)).body;
      expect(hits).toEqual([{ conversation_id: conv, message_id: expect.any(String), snippet: expect.stringContaining('élans') }]);
      expect((await http_().get('/api/chat/search?q=zzzz').expect(200)).body).toEqual([]);
      await http_().get('/api/chat/search').expect(400);
      await http_().get(`/api/chat/search?q=${'x'.repeat(201)}`).expect(400);
    });
  });

  describe('prompt enhancement', () => {
    beforeEach(() => {
      script = [{ type: 'delta', content: '"A red fox in the snow, soft light."' }, { type: 'done', finish_reason: 'stop' }];
    });

    it('improves a prompt with the default model, and asks the model for no reasoning', async () => {
      const res = await http_().post('/api/chat/enhance-prompt').send({ kind: 'image', prompt: 'un renard' }).expect(200);
      expect(res.body).toEqual({ prompt: 'A red fox in the snow, soft light.', model_id: 'llm-a' });
      const sent = JSON.parse(engine.requests.find((r) => r.url === '/engine/v1/llm/chat')!.body.toString());
      expect(sent).toMatchObject({ reasoning: 'off', messages: [{ role: 'system' }, { role: 'user', content: 'un renard' }] });
      expect(sent.messages[0].content).toMatch(/image/);
      expect(gate.busy).toBe(false);
    });

    it('answers 409 with a code when busy or without a model', async () => {
      occupied = true;
      expect((await http_().post('/api/chat/enhance-prompt').send({ kind: 'video', prompt: 'x' }).expect(409)).body).toMatchObject({ code: 'busy' });
      occupied = false;
      gate.tryAcquire('chat');
      expect((await http_().post('/api/chat/enhance-prompt').send({ kind: 'video', prompt: 'x' }).expect(409)).body).toMatchObject({ code: 'busy' });
      gate.release('chat');
      resolveModel = () => new ChatError('no_model', 'Aucun modèle de chat.');
      expect((await http_().post('/api/chat/enhance-prompt').send({ kind: 'audio', prompt: 'x' }).expect(409)).body).toMatchObject({ code: 'no_model', message: 'Aucun modèle de chat.' });
      expect(gate.busy).toBe(false);
    });

    it('validates the body (422)', async () => {
      for (const bad of [{ kind: 'text', prompt: 'x' }, { kind: 'image' }, { kind: 'image', prompt: '' }]) {
        await http_().post('/api/chat/enhance-prompt').send(bad).expect(422);
      }
    });
  });
});
