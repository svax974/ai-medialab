/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ServerResponse } from 'http';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { EngineClient } from 'src/modules/engine';
import { startFakeEngine, testConfig, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { ConversationEntity, DEFAULT_CHAT_TITLE, EngineBusyGate } from 'src/modules/studio-core';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';
import { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatSettingsEntity } from '../entities/ChatSettingsEntity';
import { ChatAttachmentService } from './ChatAttachmentService';
import type { ResolvedModel } from './ChatModelService';
import { ChatReplyService, cleanTitle, type ReplySink } from './ChatReplyService';
import { ChatStoreService } from './ChatStoreService';
import { EngineLlmClient } from './EngineLlmClient';
import { WebToolsService } from './WebToolsService';
import { frame, type Json } from '../testing/sse';
import { ChatError } from '../types/chatTypes';

const caps = (over = {}) => ({ context_default: 16384, context_max: 32768, vision: true, tools: true, reasoning: 'toggle' as const, moe: false, params_b: 4, active_params_b: null, ...over });
const model = (over = {}): ResolvedModel => ({ id: 'llm-a', name: 'Modèle A', caps: caps(over) });

const reply = (...texts: string[]) => [
  { type: 'loading', phase: 'loading', model_id: 'llm-a', elapsed_s: 1 },
  ...texts.map((content) => ({ type: 'delta', content })),
  { type: 'usage', prompt_tokens: 12, completion_tokens: 3, cached_tokens: 0, tokens_per_second: 30, prompt_ms: 5, predicted_ms: 100, context_size: 16384 },
  { type: 'done', finish_reason: 'stop' },
];
const toolCall = (id: string, name: string, args: object) => ({ type: 'tool_calls', calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

class Sink implements ReplySink {
  events: { event: string; data: Json }[] = [];
  readonly controller = new AbortController();
  get signal() { return this.controller.signal; }
  emit(event: string, data: unknown) { this.events.push({ event, data }); }
  names() { return this.events.map((e) => e.event); }
  of(name: string) { return this.events.filter((e) => e.event === name).map((e) => e.data); }
}

describe('ChatReplyService', () => {
  let dataSource: DataSource;
  let engine: FakeEngine;
  let store: ChatStoreService;
  let service: ChatReplyService;
  let gate: EngineBusyGate;
  let conv: string;
  let dataDir: string;
  let occupied: boolean;
  let resolved: ResolvedModel | ChatError;
  let scripts: object[][];
  let chatBodies: Json[];
  const published = jest.fn();
  const webTool = { begin: jest.fn(), run: jest.fn() };
  const creation = { prepare: jest.fn(async (..._args: unknown[]): Promise<unknown> => null), runCommand: jest.fn(async (..._args: unknown[]): Promise<unknown> => null) };

  /** Each call of the chat route plays the next script (the last one repeats). */
  const play = (...list: object[][]) => {
    scripts = list;
    chatBodies = [];
    engine.handle((req, res: ServerResponse) => {
      if (req.url !== '/engine/v1/llm/chat') return void res.writeHead(404).end();
      const sent = JSON.parse(req.body.toString());
      chatBodies.push(sent);
      const script = scripts[Math.min(chatBodies.length - 1, scripts.length - 1)];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of script) res.write(frame(e));
      res.end();
    });
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'chat-reply-'));
    process.env.APP_DATA_DIR = dataDir;
    dataSource = await createTestDataSource();
    engine = await startFakeEngine();
  });
  afterAll(async () => {
    await engine.close();
    await dataSource.destroy();
  });
  beforeEach(async () => {
    await dataSource.getRepository(ChatMessageEntity).clear();
    await dataSource.getRepository(ChatSettingsEntity).clear();
    await dataSource.getRepository(ConversationEntity).clear();
    const services = buildServices(dataSource);
    store = new ChatStoreService(dataSource.getRepository(ChatMessageEntity), dataSource.getRepository(ChatSettingsEntity), dataSource.getRepository(ConversationEntity), services.conversations);
    gate = new EngineBusyGate();
    occupied = false;
    resolved = model();
    published.mockClear();
    webTool.begin.mockReset();
    webTool.run.mockReset();
    creation.prepare.mockReset().mockResolvedValue(null);
    creation.runCommand.mockReset();
    const llm = new EngineLlmClient(new EngineClient(testConfig(engine.url)));
    service = new ChatReplyService(
      store, llm, { resolve: async () => { if (resolved instanceof ChatError) throw resolved; return resolved; } } as never,
      new ChatAttachmentService(store), webTool as unknown as WebToolsService, creation as never, services.conversations,
      { publishConversation: published } as never, { get occupied() { return occupied; } } as never, gate, {} as never,
    );
    conv = (await services.conversations.create({ mode: 'chat' })).id;
    play(reply('Bon', 'jour'));
  });
  afterEach(() => engine.requests.splice(0));

  const send = (content: string, extra: object = {}) => {
    const sink = new Sink();
    return service.send(conv, { content, attachments: [], parentId: undefined, modelId: undefined, ...extra }, sink).then(() => sink);
  };
  const title = async () => (await dataSource.getRepository(ConversationEntity).findOneByOrFail({ id: conv })).title;

  it('answers: the user message, the empty answer, the stream, the usage, then done', async () => {
    play(reply('Bon', 'jour'), [{ type: 'delta', content: 'Salutations cordiales' }, { type: 'done', finish_reason: 'stop' }]);
    const sink = await send('Bonjour le monde');
    expect(sink.names()).toEqual(['message', 'message', 'loading', 'delta', 'delta', 'usage', 'done', 'title']); // done first, the title after
    const [user, assistant] = sink.of('message').map((m) => m.message);
    expect(user).toMatchObject({ role: 'user', content: 'Bonjour le monde', parent_id: null, status: 'done' });
    expect(assistant).toMatchObject({ role: 'assistant', content: '', parent_id: user.id, status: 'streaming', model_id: 'llm-a' });
    expect(sink.of('loading')[0]).toEqual({ phase: 'loading', model_id: 'llm-a', elapsed_s: 1 });
    expect(sink.of('delta')).toEqual([{ id: assistant.id, content: 'Bon' }, { id: assistant.id, content: 'jour' }]);
    expect(sink.of('usage')[0]).toMatchObject({ id: assistant.id, stats: { prompt_tokens: 12, completion_tokens: 3, tokens_per_second: 30, context_size: 16384 } });
    expect(sink.of('title')).toEqual([{ title: 'Salutations cordiales' }]);
    const done = sink.of('done')[0].message;
    expect(done).toMatchObject({ id: assistant.id, status: 'done', content: 'Bonjour', error: null, stats: { completion_tokens: 3 } });
    // stored: the branch, the leaf, the title
    expect((await store.branch(conv)).messages.map((m) => m.content)).toEqual(['Bonjour le monde', 'Bonjour']);
    expect((await store.getSettings(conv)).leaf_id).toBe(assistant.id);
    expect(await title()).toBe('Salutations cordiales');
    expect(published).toHaveBeenCalled();
    expect(gate.busy).toBe(false);
  });

  it('names the conversation from the prompt right away, then from the model', async () => {
    play(reply('ok'), [{ type: 'delta', content: '"Titre du modèle."' }, { type: 'done', finish_reason: 'stop' }]);
    await send('Explique-moi la photosynthèse en trois phrases simples');
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies[1]).toMatchObject({ reasoning: 'off', params: { max_tokens: 24 } });
    expect(await title()).toBe('Titre du modèle');
  });

  it('keeps the prompt-based title when the model gives none, and a title the user chose', async () => {
    play(reply('ok'), [{ type: 'error', code: 'upstream', message: 'boom' }]);
    const sink = await send('Ma première question');
    expect(sink.names()).not.toContain('title');
    expect(sink.names().at(-1)).toBe('done'); // a failed title is not a failed reply: the stream just ends
    expect(await title()).toBe('Ma première question');
    await dataSource.getRepository(ConversationEntity).update({ id: conv }, { title: 'Mon titre' });
    const second = await send('Suite');
    expect(second.names()).not.toContain('title');
    expect(chatBodies.length).toBe(3); // 2 for the first exchange (reply + title), 1 for the second (no title request)
    expect(await title()).toBe('Mon titre');
  });

  it('asks the engine with the history, the settings and the sampling of the conversation', async () => {
    await store.updateSettings(conv, { system_prompt: 'Sois bref.', params: { temperature: 0.4, top_k: 20, seed: 9 }, context_size: 8192, reasoning: 'low', model_id: 'llm-a' });
    await send('Salut');
    expect(chatBodies[0]).toMatchObject({
      model_id: 'llm-a', reasoning: 'low', context_size: 8192, params: { temperature: 0.4, top_k: 20, seed: 9 },
      messages: [{ role: 'system', content: 'Sois bref.' }, { role: 'user', content: 'Salut' }],
    });
    expect(chatBodies[0].tools).toBeUndefined();
    const second = await send('Et ensuite ?');
    expect(chatBodies[2].messages.map((m: Json) => `${m.role}:${m.content}`)).toEqual(['system:Sois bref.', 'user:Salut', 'assistant:Bonjour', 'user:Et ensuite ?']);
    expect(second.of('message')[0].message.parent_id).toBeTruthy(); // a child of the previous answer
  });

  it('refuses before storing anything when no model can answer', async () => {
    resolved = new ChatError('no_model', "Aucun modèle de chat n'est installé.");
    const sink = await send('Salut');
    expect(sink.events).toEqual([{ event: 'error', data: { code: 'no_model', message: "Aucun modèle de chat n'est installé." } }]);
    expect(await store.all(conv)).toEqual([]);
    expect(chatBodies).toEqual([]);
    expect(gate.busy).toBe(false);
  });

  it('answers busy, without storing, while a generation runs or waits, or while another reply holds the engine', async () => {
    occupied = true;
    const generation = await send('Salut');
    expect(generation.events).toEqual([{ event: 'error', data: { code: 'busy', message: expect.stringMatching(/génération/) } }]);
    occupied = false;
    expect(gate.tryAcquire('chat')).toBe(true);
    const reply2 = await send('Salut');
    expect(reply2.events).toEqual([{ event: 'error', data: { code: 'busy', message: expect.stringMatching(/réponse est déjà en cours/) } }]);
    expect(gate.busy).toBe(true); // still held by its owner: a refused request does not release it
    gate.release('chat');
    expect(await store.all(conv)).toEqual([]);
  });

  it('holds the gate for the length of the reply and releases it at the end, even on failure', async () => {
    const seen: boolean[] = [];
    const original = webTool.run;
    play([{ type: 'delta', content: 'a' }, { type: 'done', finish_reason: 'stop' }]);
    const sink = new Sink();
    const emit = sink.emit.bind(sink);
    sink.emit = (event, data) => {
      if (event === 'delta') seen.push(gate.busy);
      emit(event, data);
    };
    await service.send(conv, { content: 'x', attachments: [], parentId: undefined, modelId: undefined }, sink);
    expect(seen).toEqual([true]);
    expect(gate.busy).toBe(false);
    expect(original).toBe(webTool.run);
    play([{ type: 'error', code: 'upstream', message: 'boom' }]);
    await send('y');
    expect(gate.busy).toBe(false);
  });

  it('keeps the text received and reports an engine error with the message id', async () => {
    play([{ type: 'delta', content: 'Début' }, { type: 'error', code: 'context_exceeded', message: 'Trop long' }]);
    const sink = await send('Salut');
    const assistant = sink.of('message')[1].message;
    expect(sink.of('error')).toEqual([{ code: 'context_exceeded', message: 'Trop long', id: assistant.id }]);
    expect(sink.names()).not.toContain('done');
    expect(await store.getMessage(assistant.id)).toMatchObject({ status: 'error', error: 'Trop long', content: 'Début' });
    expect(gate.busy).toBe(false);
  });

  it('reports a stream cut by the engine (memory guard) as closed', async () => {
    play([{ type: 'delta', content: 'a' }]);
    const sink = await send('Salut');
    expect(sink.of('error')[0]).toMatchObject({ code: 'closed' });
    expect((await store.all(conv)).at(-1)).toMatchObject({ status: 'error', content: 'a' });
  });

  it('turns an unexpected failure into a generic error, and logs it', async () => {
    const real = store.path.bind(store);
    jest.spyOn(store, 'path').mockImplementationOnce(real).mockRejectedValueOnce(new Error('disk gone')); // the history, after the messages exist
    const sink = await send('Salut');
    expect(sink.of('error')[0]).toMatchObject({ code: 'upstream', message: 'La réponse a échoué de façon inattendue.' });
    expect(gate.busy).toBe(false);
    jest.restoreAllMocks();
  });

  it('is cancelled when the client leaves: the text so far is kept, the state is cancelled, the engine request is closed', async () => {
    let closed = false;
    engine.handle((req, res) => {
      if (req.url !== '/engine/v1/llm/chat') return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(frame({ type: 'delta', content: 'Partiel' }));
      res.on('close', () => (closed = true));
    });
    const sink = new Sink();
    const base = sink.emit.bind(sink);
    sink.emit = (event, data) => {
      base(event, data);
      if (event === 'delta') setTimeout(() => sink.controller.abort(), 20);
    };
    await service.send(conv, { content: 'Raconte', attachments: [], parentId: undefined, modelId: undefined }, sink);
    const assistant = (await store.all(conv)).at(-1) as ChatMessageEntity;
    expect(assistant).toMatchObject({ status: 'cancelled', content: 'Partiel', error: null });
    expect(sink.names()).not.toContain('done');
    expect(sink.names()).not.toContain('error');
    expect(gate.busy).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
    // and the conversation can go on: the cancelled reply is in the history
    play(reply('Suite'));
    await send('Continue');
    expect(chatBodies[0].messages.map((m: Json) => m.content)).toEqual(['Raconte', 'Partiel', 'Continue']);
  });

  it('cancelConversation stops the reply of that conversation', async () => {
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(frame({ type: 'delta', content: 'x' }));
    });
    const sink = new Sink();
    const running = service.send(conv, { content: 'q', attachments: [], parentId: undefined, modelId: undefined }, sink);
    await new Promise((r) => setTimeout(r, 80));
    expect(service.runningIn(conv)).toBe(true);
    expect(service.runningIn('other')).toBe(false);
    service.cancelConversation(conv);
    await running;
    expect(service.runningIn(conv)).toBe(false);
    expect((await store.all(conv)).at(-1)?.status).toBe('cancelled');
  });

  it('regenerates: a new sibling answer to the same message, possibly from another model, no new user message', async () => {
    const first = await send('Question');
    const answer = first.of('done')[0].message;
    play(reply('Autre réponse'));
    const sink = new Sink();
    await service.regenerate(conv, answer.id, { modelId: 'llm-b' }, sink);
    expect(sink.of('message')).toHaveLength(1);
    const added = sink.of('message')[0].message;
    expect(added).toMatchObject({ role: 'assistant', parent_id: answer.parent_id, sibling_ids: [answer.id, added.id], sibling_index: 1 });
    expect(chatBodies[0].messages.map((m: Json) => m.content)).toEqual(['Question']); // the old answer is not in the history
    expect(sink.names().at(-1)).toBe('done');
    expect((await store.getSettings(conv)).leaf_id).toBe(added.id);
    expect((await store.all(conv)).filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('edits: a new sibling user message and its answer; the original branch stays', async () => {
    const first = await send('Question');
    const [user] = first.of('message').map((m) => m.message);
    play(reply('Réponse 2'));
    const sink = new Sink();
    await service.edit(conv, user.id, { content: 'Question corrigée', attachments: undefined }, sink);
    const [edited] = sink.of('message').map((m) => m.message);
    expect(edited).toMatchObject({ role: 'user', content: 'Question corrigée', parent_id: null, sibling_ids: [user.id, edited.id], sibling_index: 1 });
    expect((await store.branch(conv)).messages.map((m) => m.content)).toEqual(['Question corrigée', 'Réponse 2']);
    expect((await store.all(conv)).map((m) => m.content)).toEqual(['Question', 'Bonjour', 'Question corrigée', 'Réponse 2']);
    expect(await title()).not.toBe(DEFAULT_CHAT_TITLE);
    expect(chatBodies.every((b) => !JSON.stringify(b).includes('"Question",'))).toBe(true);
  });

  it('refuses requests that cannot work, before streaming (HTTP errors)', async () => {
    const sink = new Sink();
    const first = await send('Question');
    const [user, answer] = first.of('message').map((m) => m.message);
    await expect(service.send('nope', { content: 'x', attachments: [], parentId: undefined, modelId: undefined }, sink)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.send(conv, { content: 'x', attachments: [], parentId: user.id, modelId: undefined }, sink)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.send(conv, { content: 'x', attachments: [], parentId: 'ghost', modelId: undefined }, sink)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.regenerate(conv, user.id, {}, sink)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.edit(conv, answer.id, { content: 'x', attachments: undefined }, sink)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.send(conv, { content: 'x', attachments: ['chat_00000000deadbeef.png'], parentId: undefined, modelId: undefined }, sink)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(sink.events).toEqual([]);
    expect(gate.busy).toBe(false);
    const image = (await buildServices(dataSource).conversations.create({ mode: 'image' })).id;
    await expect(service.send(image, { content: 'x', attachments: [], parentId: undefined, modelId: undefined }, sink)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('can start a new root with parent_id null, a new branch of the conversation', async () => {
    await send('Premier sujet');
    play(reply('Autre'));
    const sink = await send('Deuxième sujet', { parentId: null });
    expect(sink.of('message')[0].message).toMatchObject({ parent_id: null, sibling_index: 1 });
    expect(chatBodies[0].messages.map((m: Json) => m.content)).toEqual(['Deuxième sujet']);
  });

  it('sends images by path and text files inside the message', async () => {
    const uploads = join(dataDir, 'uploads');
    const { mkdirSync } = await import('fs');
    mkdirSync(uploads, { recursive: true });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    const attachments = new ChatAttachmentService(store);
    writeFileSync(join(uploads, 'tmp_a'), png);
    writeFileSync(join(uploads, 'tmp_b'), 'texte du fichier');
    const image = await attachments.accept({ path: join(uploads, 'tmp_a'), originalname: 'photo.png', size: png.length });
    const text = await attachments.accept({ path: join(uploads, 'tmp_b'), originalname: 'notes.txt', size: 16 });
    await send('Décris', { attachments: await attachments.resolve([image.name, text.name]) .then((a) => a.map((x) => x.name)) });
    const content = chatBodies[0].messages[0].content;
    expect(content[0].text).toBe('<fichier nom="notes.txt">\ntexte du fichier\n</fichier>\n\nDécris');
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: join(uploads, image.name) } });
    const stored = (await store.all(conv))[0];
    expect(stored.attachments.map((a) => a.kind).sort()).toEqual(['image', 'text']);
  });

  describe('the title after done', () => {
    /** Call 1 answers at once; the title request (call 2) waits until `releaseTitle()`, or until the engine request is closed. */
    function slowTitle() {
      let release: () => void = () => undefined;
      const state = { titleClosed: false, titleAsked: false, calls: 0 };
      engine.handle((req, res) => {
        if (req.url !== '/engine/v1/llm/chat') return void res.writeHead(404).end();
        state.calls++;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (state.calls !== 2) {
          for (const e of reply('Bon', 'jour')) res.write(frame(e));
          return void res.end();
        }
        state.titleAsked = true;
        res.on('close', () => (state.titleClosed = true));
        release = () => {
          res.write(frame({ type: 'delta', content: 'Un bon titre' }));
          res.write(frame({ type: 'done', finish_reason: 'stop' }));
          res.end();
        };
      });
      return { state, releaseTitle: () => release() };
    }
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
      expect(check()).toBe(true);
    };
    const start = (content: string, extra: object = {}) => {
      const sink = new Sink();
      const finished = service.send(conv, { content, attachments: [], parentId: undefined, modelId: undefined, ...extra }, sink);
      return { sink, finished };
    };

    it('signals the end at once, then writes the title in the background and closes the stream with it', async () => {
      const { state, releaseTitle } = slowTitle();
      const { sink, finished } = start('Bonjour le monde');
      await until(() => sink.names().includes('done'));
      expect(sink.names()).not.toContain('title');
      await until(() => state.titleAsked);
      expect(gate.busy).toBe(true); // the model is in use for the title...
      expect(gate.preemptible).toBe(true); // ...but offered to whoever needs it
      expect(service.runningIn(conv)).toBe(false); // the reply itself is over: it can be deleted from, regenerated...
      expect(await store.getMessage(sink.of('done')[0].message.id)).toMatchObject({ status: 'done', content: 'Bonjour' });
      releaseTitle();
      await finished;
      expect(sink.names().slice(-2)).toEqual(['done', 'title']);
      expect(sink.of('title')).toEqual([{ title: 'Un bon titre' }]);
      expect(await title()).toBe('Un bon titre');
      expect(gate.busy).toBe(false);
    });

    it('closes the stream at done when no title is to be written (a second exchange, a title the user chose)', async () => {
      await send('Premier');
      chatBodies.length = 0;
      const second = await send('Second');
      expect(second.names().at(-1)).toBe('done');
      expect(chatBodies).toHaveLength(1);
    });

    it('a new message cancels the title and takes the engine at once: never busy because of a title', async () => {
      const { state, releaseTitle } = slowTitle();
      const first = start('Premier sujet');
      await until(() => state.titleAsked);
      const second = new Sink();
      const secondDone = service.send(conv, { content: 'Deuxième message', attachments: [], parentId: undefined, modelId: undefined }, second);
      await secondDone;
      expect(second.names()).not.toContain('error');
      expect(second.names()).toContain('done');
      await first.finished; // the first stream ends, without a title
      expect(first.sink.names().at(-1)).toBe('done');
      expect(first.sink.names()).not.toContain('title');
      await until(() => state.titleClosed); // the engine request was dropped
      expect(await title()).toBe('Premier sujet'); // the provisional title stays
      expect(gate.busy).toBe(false);
      releaseTitle();
    });

    it.each([
      ['a regeneration', (done: Json) => service.regenerate(conv, done.id, {}, new Sink())],
      ['an edit', (done: Json) => service.edit(conv, done.parent_id, { content: 'Corrigé', attachments: undefined }, new Sink())],
    ])('%s also takes the engine from a title in progress', async (_name, act) => {
      const { state } = slowTitle();
      const first = start('Sujet');
      await until(() => state.titleAsked);
      await act(first.sink.of('done')[0].message);
      await first.finished;
      await until(() => state.titleClosed);
      expect(gate.busy).toBe(false);
    });

    it('lets a queued generation go: the title is cancelled and the engine released', async () => {
      const { state } = slowTitle();
      const first = start('Sujet');
      await until(() => state.titleAsked);
      const released = gate.released$.pipe().subscribe(() => undefined);
      void gate.preempt(); // what the generation queue does when it has something to submit
      await first.finished;
      released.unsubscribe();
      await until(() => state.titleClosed);
      expect(gate.busy).toBe(false);
    });

    it('is cancelled without noise when the client leaves after done: the provisional title stays, the engine is released', async () => {
      const { state } = slowTitle();
      const { sink, finished } = start('Sujet du jour');
      await until(() => state.titleAsked);
      sink.controller.abort();
      await finished;
      expect(sink.names().at(-1)).toBe('done');
      expect(sink.names()).not.toContain('error');
      expect(sink.names()).not.toContain('title');
      expect(await title()).toBe('Sujet du jour');
      await until(() => state.titleClosed);
      expect(gate.busy).toBe(false);
      const message = sink.of('done')[0].message;
      expect(await store.getMessage(message.id)).toMatchObject({ status: 'done' }); // the reply itself is untouched
    });

    it('cancelConversation also stops a title in progress', async () => {
      const { state } = slowTitle();
      const { finished } = start('Sujet');
      await until(() => state.titleAsked);
      service.cancelConversation(conv);
      await finished;
      await until(() => state.titleClosed);
      expect(gate.busy).toBe(false);
    });

    it('does not start a title when the client already left at done', async () => {
      const { state } = slowTitle();
      const sink = new Sink();
      const emit = sink.emit.bind(sink);
      sink.emit = (event, data) => {
        emit(event, data);
        if (event === 'done') sink.controller.abort();
      };
      await service.send(conv, { content: 'Sujet', attachments: [], parentId: undefined, modelId: undefined }, sink);
      expect(state.titleAsked).toBe(false);
      expect(gate.busy).toBe(false);
    });
  });

  describe('web tools', () => {
    beforeEach(async () => {
      await store.updateSettings(conv, { tools: { web: true } });
      webTool.begin.mockImplementation((call: Json) => ({ id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments), status: 'running' }));
      webTool.run.mockImplementation(async (call: Json) => ({
        run: { id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments), status: 'done', result_preview: 'DuckDuckGo : 1 résultat', sources: [{ title: 'Doc', url: 'https://example.org' }] },
        content: '1. Doc\n   https://example.org',
      }));
    });

    it('runs the tools the model calls and answers with their results', async () => {
      play([toolCall('call_1', 'web_search', { query: 'llama.cpp' }), { type: 'done', finish_reason: 'tool_calls' }], reply('Voici', ' la réponse'));
      const sink = await send('Cherche llama.cpp');
      expect(chatBodies[0].tools.map((t: Json) => t.function.name)).toEqual(['web_search', 'fetch_url']);
      expect(chatBodies[1].messages.slice(-2)).toEqual([
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"llama.cpp"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', name: 'web_search', content: '1. Doc\n   https://example.org' },
      ]);
      const tools = sink.of('tool');
      expect(tools.map((t) => t.run.status)).toEqual(['running', 'done']);
      expect(tools[0].run.arguments).toEqual({ query: 'llama.cpp' });
      expect(sink.names().indexOf('tool')).toBeLessThan(sink.names().indexOf('done'));
      const done = sink.of('done')[0].message;
      expect(done.content).toBe('Voici la réponse');
      expect(done.tool_runs).toEqual([expect.objectContaining({ id: 'call_1', status: 'done', sources: [{ title: 'Doc', url: 'https://example.org' }] })]);
      expect(done.stats.completion_tokens).toBe(3); // the tool round produced no usage here
    });

    it('does not replay tool runs in the next question', async () => {
      play([toolCall('c', 'web_search', { query: 'x' }), { type: 'done', finish_reason: 'tool_calls' }], reply('Réponse finale'));
      await send('Cherche');
      play(reply('Suite'));
      chatBodies.length = 0;
      await send('Merci');
      expect(chatBodies[0].messages.map((m: Json) => m.role)).toEqual(['user', 'assistant', 'user']);
    });

    it('separates the text of two rounds', async () => {
      play([{ type: 'delta', content: 'Je cherche.' }, toolCall('c', 'web_search', { query: 'x' }), { type: 'done', finish_reason: 'tool_calls' }], reply('Trouvé.'));
      const sink = await send('Cherche');
      expect(sink.of('done')[0].message.content).toBe('Je cherche.\n\nTrouvé.');
      expect(chatBodies[1].messages.at(-2).content).toBe('Je cherche.');
    });

    it('stops offering tools after the last round, to force an answer', async () => {
      const again = [toolCall('c', 'web_search', { query: 'x' }), { type: 'done', finish_reason: 'tool_calls' }];
      play(again, again, again, again, again, reply('Voici ce que je sais.'));
      const sink = await send('Cherche sans fin');
      expect(chatBodies).toHaveLength(6 + 1); // 5 rounds of tools + the final request + the title request
      expect(chatBodies.slice(0, 5).every((b) => Array.isArray(b.tools))).toBe(true);
      expect(chatBodies[5].tools).toBeUndefined();
      expect(webTool.run).toHaveBeenCalledTimes(5);
      expect(sink.names()).toContain('done');
    });

    it('ignores a tool call made on the last round, when no tool is offered', async () => {
      const again = [toolCall('c', 'web_search', { query: 'x' }), { type: 'delta', content: 'Texte' }, { type: 'done', finish_reason: 'tool_calls' }];
      play(again);
      const sink = await send('Cherche sans fin');
      expect(webTool.run).toHaveBeenCalledTimes(5);
      expect(sink.of('done')[0].message.content).toBe('Texte\n\nTexte\n\nTexte\n\nTexte\n\nTexte\n\nTexte');
    });

    it('offers no tool when the conversation does not allow it or the model cannot call functions', async () => {
      await store.updateSettings(conv, { tools: { web: false } });
      await send('a');
      expect(chatBodies[0].tools).toBeUndefined();
      await store.updateSettings(conv, { tools: { web: true } });
      resolved = model({ tools: false });
      play(reply('b'));
      await send('b');
      expect(chatBodies[0].tools).toBeUndefined();
    });

    it('a failing tool is an error run the model reads, not a failed reply', async () => {
      webTool.run.mockImplementation(async (call: Json) => ({ run: { id: call.id, name: 'fetch_url', arguments: {}, status: 'error', result_preview: 'Adresse refusée' }, content: 'Erreur : Adresse refusée' }));
      play([toolCall('c', 'fetch_url', { url: 'http://127.0.0.1/' }), { type: 'done', finish_reason: 'tool_calls' }], reply('Je ne peux pas lire cette page.'));
      const sink = await send('Lis http://127.0.0.1/');
      expect(sink.of('done')[0].message).toMatchObject({ status: 'done', content: 'Je ne peux pas lire cette page.' });
      expect(chatBodies[1].messages.at(-1).content).toBe('Erreur : Adresse refusée');
    });

    it('cancels while a tool runs', async () => {
      play([toolCall('c', 'web_search', { query: 'x' }), { type: 'done', finish_reason: 'tool_calls' }]);
      const sink = new Sink();
      webTool.run.mockImplementation(async () => {
        sink.controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      });
      await service.send(conv, { content: 'Cherche', attachments: [], parentId: undefined, modelId: undefined }, sink);
      expect((await store.all(conv)).at(-1)).toMatchObject({ status: 'cancelled' });
      expect(gate.busy).toBe(false);
    });
  });

  describe('creation tools', () => {
    const stored = { id: 'g1', kind: 'image', model_id: 'flux', message_id: 'job1', prompt: 'un chat', params: {} };

    it('offers the creation schemas next to the model, runs the call and stores the generation in the message', async () => {
      const generations: object[] = [];
      const run = {
        schemas: [{ type: 'function', function: { name: 'generate_image' } }], generations,
        begin: jest.fn((call: Json) => ({ id: call.id, name: 'generate_image', arguments: {}, status: 'running' })),
        run: jest.fn(async (call: Json) => {
          generations.push(stored);
          return { run: { id: call.id, name: 'generate_image', arguments: {}, status: 'done' }, content: 'Génération lancée' };
        }),
      };
      creation.prepare.mockResolvedValue(run);
      play([toolCall('c1', 'generate_image', { prompt: 'un chat' }), { type: 'done', finish_reason: 'tool_calls' }], reply('Je la prépare.'));
      const sink = await send('Dessine un chat', { creationModels: { image: 'flux' } });
      expect(creation.prepare).toHaveBeenCalledWith(conv, { image: 'flux' });
      expect((chatBodies[0].tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual(['generate_image']);
      expect(run.run).toHaveBeenCalledTimes(1);
      expect(webTool.run).not.toHaveBeenCalled();
      expect(chatBodies[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'c1', name: 'generate_image', content: 'Génération lancée' });
      const done = sink.of('done')[0].message as Json;
      expect(done.content).toBe('Je la prépare.');
      expect(done.tool_runs).toMatchObject([{ id: 'c1', name: 'generate_image', status: 'done' }]);
      const message = await dataSource.getRepository(ChatMessageEntity).findOneByOrFail({ id: done.id as string });
      expect(message.generations).toEqual([stored]);
    });

    it('does not offer them when the conversation switched them off or the model cannot call functions', async () => {
      await store.updateSettings(conv, { tools: { creation: false } });
      await send('Dessine', { creationModels: { image: 'flux' } });
      expect(creation.prepare).not.toHaveBeenCalled();
      expect(chatBodies[0].tools).toBeUndefined();
      await store.updateSettings(conv, { tools: { creation: true } });
      resolved = model({ tools: false });
      await send('Encore', { creationModels: { image: 'flux' } });
      expect(creation.prepare).not.toHaveBeenCalled();
    });

    it('runs /image without the language model: nothing is asked of the engine, one fixed sentence answers', async () => {
      creation.runCommand.mockResolvedValue(stored);
      const sink = await send('/image un chat', { creationModels: { image: 'flux' } });
      expect(creation.runCommand).toHaveBeenCalledWith(conv, { kind: 'image', text: 'un chat', seconds: null, voiceName: null }, { image: 'flux' });
      expect(chatBodies).toHaveLength(0);
      expect(gate.busy).toBe(false);
      expect(sink.names()).toEqual(['message', 'message', 'done']);
      const done = sink.of('done')[0].message as Json;
      expect(done).toMatchObject({ role: 'assistant', status: 'done', model_id: null });
      expect(done.content).toMatch(/^Génération lancée/);
      const row = await dataSource.getRepository(ChatMessageEntity).findOneByOrFail({ id: done.id as string });
      expect(row.generations).toEqual([stored]);
      expect(await title()).toBe('/image un chat');
    });

    it('asks for the duration of a /video without one', async () => {
      creation.runCommand.mockResolvedValue({ ...stored, kind: 'video', message_id: null, pending: 'duration' });
      const sink = await send('/video une vague');
      expect((sink.of('done')[0].message as Json).content).toBe('Choisissez la durée de la vidéo ci-dessous.');
    });

    it('refuses a command whose studio has no model, creating nothing', async () => {
      creation.runCommand.mockRejectedValue(new ChatError('no_model', "Aucun modèle prêt n'est sélectionné dans le studio d'image."));
      const sink = await send('/image un chat');
      expect(sink.names()).toEqual(['error']);
      expect(sink.of('error')[0]).toMatchObject({ code: 'no_model' });
      expect(await dataSource.getRepository(ChatMessageEntity).count()).toBe(0);
    });

    it('treats /image as plain text when the creation tools are off', async () => {
      await store.updateSettings(conv, { tools: { creation: false } });
      await send('/image un chat');
      expect(creation.runCommand).not.toHaveBeenCalled();
      expect((chatBodies[0].messages as Json[])[0]).toMatchObject({ role: 'user', content: '/image un chat' });
    });
  });
});

describe('cleanTitle', () => {
  it('keeps the first line, without quotes, markdown marks, labels or final punctuation', () => {
    expect(cleanTitle('"Un joli titre."')).toBe('Un joli titre');
    expect(cleanTitle('Titre : Les chats\nExplication')).toBe('Les chats');
    expect(cleanTitle('## Résumé du jour !')).toBe('Résumé du jour !');
    expect(cleanTitle('«Bonjour»')).toBe('Bonjour');
    expect(cleanTitle('\n\n  Deuxième ligne  ')).toBe('Deuxième ligne');
    expect(cleanTitle('')).toBe('');
    expect(cleanTitle('x'.repeat(200)).length).toBe(80);
  });
});
