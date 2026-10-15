/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CallHandler, ExecutionContext, INestApplication, Injectable, Module, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'fs';
import type { ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ChatError, ChatReplyService, EngineLlmClient, type ResolvedModel, type ReplySink } from 'src/modules/chat';
import { frame, type Json } from 'src/modules/chat/testing/sse';
import { EngineClient } from 'src/modules/engine';
import { ENGINE_CONFIG } from 'src/modules/engine/engineConfig';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { EngineBusyGate } from 'src/modules/studio-core';
import { applyPrincipal, type AuthRequest } from 'src/modules_shared/common/auth/authRequest';
import { createTestDataSource } from 'src/testing/testDataSource';
import { NoStoreInterceptor } from '../controllers/NoStoreInterceptor';
import { PrivateChatController } from '../controllers/PrivateChatController';
import { PrivateEvents } from './PrivateEvents';
import { PrivateChatAttachmentService } from './PrivateChatAttachmentService';
import { PrivateChatService } from './PrivateChatService';
import { PrivateSessionService } from './PrivateSessionService';
import { PrivateStore } from './PrivateStore';
import { parsePrivateChatBody } from './privateChatValidation';
import { privateRoot, sessionPath } from './privateFiles';

const SENTINEL = 'SENTINELLE-chat-privé-4b9e17';
const NORMAL_FOLDERS = ['uploads', 'outputs', 'thumbs', 'previews'] as const;
const TABLES = ['conversations', 'messages', 'message_refs', 'assets', 'chat_messages', 'chat_conversation_settings'];
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

@Injectable()
class FakeAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    applyPrincipal(context.switchToHttp().getRequest<AuthRequest>(), { id: 0, admin: true, kind: 'local-trust' });
    return next.handle();
  }
}

const caps = (over = {}) => ({ context_default: 16384, context_max: 32768, vision: true, tools: true, reasoning: 'toggle' as const, moe: false, params_b: 4, active_params_b: null, ...over });
const model = (over = {}): ResolvedModel => ({ id: 'llm-a', name: 'Modèle A', caps: caps(over) });
const goodReply = (...texts: string[]) => [
  { type: 'loading', phase: 'loading', model_id: 'llm-a', elapsed_s: 1 },
  { type: 'reasoning', content: 'Je réfléchis.' },
  ...texts.map((content) => ({ type: 'delta', content })),
  { type: 'usage', prompt_tokens: 12, completion_tokens: 3, cached_tokens: 0, tokens_per_second: 30, prompt_ms: 5, predicted_ms: 100, context_size: 16384 },
  { type: 'done', finish_reason: 'stop' },
];
const events = (text: string): { event: string; data: Json }[] =>
  text.split('\n\n').filter((b) => b.trim() && !b.startsWith(':')).map((block) => {
    const lines = block.split('\n');
    return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
  });

/** Everything that reached a log, whatever the logger: the standard streams are captured for the length of a test. */
function captureLogs(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spies = [jest.spyOn(process.stdout, 'write'), jest.spyOn(process.stderr, 'write')].map((spy) =>
    spy.mockImplementation(((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as never));
  return { text: () => chunks.join(''), restore: () => spies.forEach((s) => s.mockRestore()) };
}

class Sink implements ReplySink {
  events: { event: string; data: Json }[] = [];
  readonly controller = new AbortController();
  get signal() { return this.controller.signal; }
  emit(event: string, data: unknown) { this.events.push({ event, data }); }
  names() { return this.events.map((e) => e.event); }
}

describe('the private chat: a conversation that is nowhere', () => {
  let dataSource: DataSource;
  let engine: FakeEngine;
  let app: INestApplication;
  let session: PrivateSessionService;
  let service: PrivateChatService;
  let attachments: PrivateChatAttachmentService;
  let gate: EngineBusyGate;
  let occupied: boolean;
  let resolved: ResolvedModel | ChatError;
  let script: object[];
  let chatBodies: Json[];
  let logs: ReturnType<typeof captureLogs>;
  const dataDir = mkdtempSync(join(tmpdir(), 'private-chat-'));
  const webTool = { begin: jest.fn(), run: jest.fn() };

  const rows = async (): Promise<Record<string, number>> =>
    Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, Number((await dataSource.query(`SELECT COUNT(*) AS n FROM ${t}`))[0].n)])));
  const normalFolders = () => Object.fromEntries(NORMAL_FOLDERS.map((f) => [f, readdirSync(join(dataDir, f))]));
  const body = (content: string, extra: object = {}) => ({ reply_id: 'reply1', messages: [{ role: 'user', content }], settings: {}, ...extra });

  beforeAll(async () => {
    process.env.APP_DATA_DIR = dataDir;
    for (const f of NORMAL_FOLDERS) mkdirSync(join(dataDir, f), { recursive: true });
    dataSource = await createTestDataSource();
    engine = await startFakeEngine();
  });
  afterAll(async () => {
    await engine.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    occupied = false;
    resolved = model();
    chatBodies = [];
    script = goodReply('Bon', 'jour');
    webTool.begin.mockReset();
    webTool.run.mockReset();
    engine.requests.splice(0);
    engine.handle((req, res: ServerResponse) => {
      if (req.url === '/engine/v1/llm/chat') {
        chatBodies.push(JSON.parse(req.body.toString()));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const e of script) res.write(frame(e));
        return void res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
    const engineClient = new EngineClient(testConfig(engine.url));
    const store = new PrivateStore();
    session = new PrivateSessionService(store, new PrivateEvents({ publish: () => undefined } as never));
    session.onModuleInit();
    gate = new EngineBusyGate();
    attachments = new PrivateChatAttachmentService(session);
    const llm = new EngineLlmClient(engineClient);
    const models = { resolve: async () => { if (resolved instanceof ChatError) throw resolved; return resolved; } } as never;
    const replies = new ChatReplyService(
      {} as never, llm, models, {} as never, webTool as never, {} as never, {} as never, { get occupied() { return occupied; } } as never, gate, {} as never,
    );
    const enhancer = { enhance: jest.fn(async () => ({ prompt: 'mieux', model_id: 'llm-a' })) } as never;
    service = new PrivateChatService(session, replies, models, attachments, enhancer, { get occupied() { return occupied; } } as never, gate, engineClient);
    service.onModuleInit();

    @Module({
      controllers: [PrivateChatController],
      providers: [
        { provide: ENGINE_CONFIG, useValue: testConfig(engine.url) },
        { provide: PrivateChatService, useValue: service },
        { provide: PrivateChatAttachmentService, useValue: attachments },
        NoStoreInterceptor,
        { provide: APP_INTERCEPTOR, useClass: FakeAuthInterceptor },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();
    logs = captureLogs();
  });
  afterEach(async () => {
    logs.restore();
    await session.end();
    await app.close();
  });

  const post = (path: string, payload?: object) => request(app.getHttpServer()).post(`/api/private/chat${path}`).send(payload);

  it('without a session, every route is a 409 before any stream', async () => {
    expect((await post('', body('salut'))).status).toBe(409);
    expect((await post('/enhance-prompt', { kind: 'image', prompt: 'x' })).status).toBe(409);
    expect((await request(app.getHttpServer()).post('/api/private/chat/attachments').attach('file', PNG, 'a.png')).status).toBe(409);
  });

  it('streams the events of the normal chat, with no message, no title, and a done that carries the id', async () => {
    session.start();
    const res = await post('', body('Bonjour le monde'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-store, no-transform');
    const sent = events(res.text);
    expect(sent.map((e) => e.event)).toEqual(['accepted', 'loading', 'reasoning', 'delta', 'delta', 'usage', 'done']);
    expect(sent[0].data).toEqual({ id: 'reply1' });
    expect(sent.filter((e) => e.event === 'delta').map((e) => e.data)).toEqual([{ id: 'reply1', content: 'Bon' }, { id: 'reply1', content: 'jour' }]);
    expect(sent[5].data).toMatchObject({ id: 'reply1', stats: { prompt_tokens: 12, completion_tokens: 3, tokens_per_second: 30, context_size: 16384 } });
    expect(sent[6].data).toEqual({ id: 'reply1', stats: expect.objectContaining({ completion_tokens: 3 }), tool_runs: [] });
    expect(gate.busy).toBe(false);
  });

  it('sends the whole history to the engine, marked private, with the system prompt and no tools by default', async () => {
    session.start();
    await post('', {
      reply_id: 'r2',
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
      settings: { system_prompt: 'Sois bref.', params: { temperature: 0.3 }, context_size: 8192, reasoning: 'off' },
    });
    const sent = chatBodies[0] as Json;
    expect(sent).toMatchObject({ model_id: 'llm-a', private: true, reasoning: 'off', context_size: 8192, params: { temperature: 0.3 } });
    expect(sent.messages.map((m: Json) => [m.role, m.content])).toEqual([['system', 'Sois bref.'], ['user', 'a'], ['assistant', 'b'], ['user', 'c']]);
    expect(sent.tools).toBeUndefined(); // the web tools are off unless the request turns them on
  });

  it('turns the web tools on only when the request asks and the model calls functions', async () => {
    session.start();
    await post('', body('x', { settings: { tools: { web: true } } }));
    expect((chatBodies[0] as Json).tools).toHaveLength(2);
    resolved = model({ tools: false });
    await post('', body('x', { settings: { tools: { web: true } } }));
    expect((chatBodies[1] as Json).tools).toBeUndefined();
  });

  it('keeps nothing: no row in any table, no file outside the session folder, no log line with the conversation', async () => {
    session.start();
    const before = { rows: await rows(), folders: normalFolders() };
    script = [{ type: 'delta', content: `réponse ${SENTINEL}` }, { type: 'done', finish_reason: 'stop' }];
    const res = await post('', body(`question ${SENTINEL}`, { settings: { system_prompt: `système ${SENTINEL}` } }));
    expect(res.text).toContain(SENTINEL); // the browser gets its own text back
    expect(await rows()).toEqual(before.rows);
    expect(normalFolders()).toEqual(before.folders);
    expect(logs.text()).not.toContain(SENTINEL);
  });

  it('tells a failure in general terms and logs nothing, even when the engine repeats the prompt', async () => {
    session.start();
    engine.handle((_req, res) => void res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: `échec avec ${SENTINEL}` })));
    const res = await post('', body(`question ${SENTINEL}`));
    const error = events(res.text)[1]; // after `accepted`: the browser has its messages, the answer carries the failure
    expect(error.event).toBe('error');
    expect(error.data).toMatchObject({ code: 'upstream', id: 'reply1' });
    expect(logs.text()).not.toContain(SENTINEL);
    expect(gate.busy).toBe(false);
  });

  it('refuses while a generation is waiting or running, or another reply is, without calling the engine', async () => {
    session.start();
    occupied = true;
    expect(events((await post('', body('x'))).text)).toEqual([{ event: 'error', data: expect.objectContaining({ code: 'busy' }) }]);
    occupied = false;
    gate.tryAcquire('chat');
    expect(events((await post('', body('x'))).text)[0].data).toMatchObject({ code: 'busy' });
    expect(chatBodies).toHaveLength(0);
    gate.release('chat');
  });

  it('turns a model that is missing into an event that says what to do', async () => {
    session.start();
    resolved = new ChatError('no_model', "Aucun modèle de chat n'est installé.");
    const [error] = events((await post('', body('x'))).text);
    expect(error).toEqual({ event: 'error', data: { code: 'no_model', message: "Aucun modèle de chat n'est installé." } }); // before `accepted`: nothing to undo
  });

  it('stops quietly when the client goes away: no done, no error, the gauge is released', async () => {
    session.start();
    engine.handle((_req, res) => { // an answer that never ends: only the client's departure stops it
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(frame({ type: 'delta', content: 'début' }));
    });
    const sink = new Sink();
    const running = service.reply(parsePrivateChatBody(body('x')), sink);
    await new Promise((r) => setTimeout(r, 100));
    sink.controller.abort();
    await running;
    expect(sink.names()).toEqual(['accepted', 'delta']);
    expect(gate.busy).toBe(false);
  });

  describe('attachments', () => {
    it('keeps an image and a text file in the session folder only, and reads them back for the model', async () => {
      session.start();
      const before = normalFolders();
      const image = (await request(app.getHttpServer()).post('/api/private/chat/attachments').attach('file', PNG, 'photo.png')).body;
      const text = (await request(app.getHttpServer()).post('/api/private/chat/attachments').attach('file', Buffer.from('contenu du fichier'), 'notes.md')).body;
      expect(image).toMatchObject({ kind: 'image', mime: 'image/png', original_name: 'photo.png' });
      expect(image.name).toMatch(/^chat_[0-9a-f]{16}\.png$/);
      expect(image.url).toBe(`/media/private/${session.sessionId}/inputs/${image.name}`); // the browser reaches it through the `/api` relay
      expect(text).toMatchObject({ kind: 'text', mime: 'text/plain', original_name: 'notes.md' });
      expect(existsSync(join(sessionPath(session.sessionId), 'inputs', image.name))).toBe(true);
      expect(readdirSync(join(sessionPath(session.sessionId), 'tmp'))).toEqual([]); // the raw upload was consumed
      expect(normalFolders()).toEqual(before);

      await post('', {
        reply_id: 'r3', settings: {},
        messages: [{ role: 'user', content: 'regarde', attachments: [{ name: image.name, original_name: 'photo.png' }, { name: text.name, original_name: 'notes.md' }] }],
      });
      const user = (chatBodies[0] as Json).messages[0];
      expect(user.content[0].text).toContain('<fichier nom="notes.md">\ncontenu du fichier\n</fichier>');
      expect(user.content[1]).toEqual({ type: 'image_url', image_url: { url: join(sessionPath(session.sessionId), 'inputs', image.name) } });
    });

    it('refuses a binary file, a name that is not ours and an attachment that is not in the session', async () => {
      session.start();
      const refused = await request(app.getHttpServer()).post('/api/private/chat/attachments').attach('file', Buffer.from([1, 2, 0, 3]), 'x.bin');
      expect(refused.status).toBe(422);
      expect(readdirSync(join(sessionPath(session.sessionId), 'tmp'))).toEqual([]);
      expect((await post('', { reply_id: 'r', settings: {}, messages: [{ role: 'user', content: 'x', attachments: [{ name: '../../etc/passwd' }] }] })).status).toBe(422);
      expect((await post('', { reply_id: 'r', settings: {}, messages: [{ role: 'user', content: 'x', attachments: [{ name: 'chat_0123456789abcdef.png' }] }] })).status).toBe(422);
      expect((await request(app.getHttpServer()).delete('/api/private/chat/attachments/..%2Fsecret')).status).toBe(422); // never a path
    });

    it('removes an attachment the user took off', async () => {
      session.start();
      const image = (await request(app.getHttpServer()).post('/api/private/chat/attachments').attach('file', PNG, 'a.png')).body;
      expect((await request(app.getHttpServer()).delete(`/api/private/chat/attachments/${image.name}`)).status).toBe(200);
      expect(existsSync(join(sessionPath(session.sessionId), 'inputs', image.name))).toBe(false);
    });
  });

  it('unloads the chat model when the session ends, if it was used, and only then', async () => {
    session.start();
    await session.end();
    expect(engine.requests.filter((r) => r.url === '/engine/v1/llm/unload')).toHaveLength(0);
    session.start();
    await post('', body('x'));
    await session.end();
    expect(engine.requests.filter((r) => r.url === '/engine/v1/llm/unload')).toHaveLength(1);
    expect(existsSync(join(privateRoot(), 'anything'))).toBe(false);
  });

  it('improves a prompt through the same stateless service', async () => {
    session.start();
    const res = await post('/enhance-prompt', { kind: 'image', prompt: 'un chat' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prompt: 'mieux', model_id: 'llm-a' });
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
  });

  describe('what a request may say', () => {
    const bad = (over: object) => parsePrivateChatBody({ ...body('x'), ...over });
    it('accepts a history that ends with the user and fills the settings with the defaults', () => {
      const parsed = parsePrivateChatBody({ reply_id: 'r', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.settings).toMatchObject({ model_id: null, system_prompt: '', reasoning: 'auto', tools: { web: false }, leaf_id: null });
    });
    it.each([
      ['a body that is not an object', 'x'],
      ['an id that is not safe', { reply_id: '../x' }],
      ['no messages', { messages: [] }],
      ['too many messages', { messages: Array.from({ length: 401 }, () => ({ role: 'user', content: 'x' })) }],
      ['a role that is unknown', { messages: [{ role: 'system', content: 'x' }] }],
      ['a history that ends with the assistant', { messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }],
      ['an empty user message', { messages: [{ role: 'user', content: '  ' }] }],
      ['a message that is too long', { messages: [{ role: 'user', content: 'x'.repeat(200_001) }] }],
      ['a history that is too long', { messages: Array.from({ length: 11 }, () => ({ role: 'user', content: 'x'.repeat(190_000) })) }],
      ['sampling out of range', { settings: { params: { temperature: 5 } } }],
      ['an unknown setting', { settings: { params: { nonsense: 1 } } }],
      ['tools that are not a boolean', { settings: { tools: { web: 'yes' } } }],
    ])('refuses %s', (_name, over) => {
      expect(() => (typeof over === 'string' ? parsePrivateChatBody(over) : bad(over))).toThrow();
    });
    it('is a 422 over HTTP, with nothing sent to the engine', async () => {
      session.start();
      expect((await post('', { reply_id: 'r', messages: [] })).status).toBe(422);
      expect(chatBodies).toHaveLength(0);
    });
  });
});
