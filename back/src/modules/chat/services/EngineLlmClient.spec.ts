/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ServerResponse } from 'http';
import { EngineClient } from 'src/modules/engine';
import { ENGINE_TOKEN_HEADER, startFakeEngine, testConfig, TEST_TOKEN, type FakeEngine } from 'src/modules/engine/testing/fakeEngine';
import { ChatError } from '../types/chatTypes';
import { frame, GOOD_REPLY } from '../testing/sse';
import { EngineLlmClient, refusalFromHttp, type LlmChatRequest, type LlmEvent } from './EngineLlmClient';

const body = (): LlmChatRequest => ({ model_id: 'llm-a', messages: [{ role: 'user', content: 'Bonjour' }], reasoning: 'auto' });
const stream = (res: ServerResponse, events: string[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(e);
  res.end();
};

async function collect(client: EngineLlmClient, signal?: AbortSignal): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of client.chat(body(), signal)) out.push(event);
  return out;
}

describe('EngineLlmClient', () => {
  let engine: FakeEngine;
  let client: EngineLlmClient;

  beforeEach(async () => {
    engine = await startFakeEngine();
    client = new EngineLlmClient(new EngineClient(testConfig(engine.url)));
  });
  afterEach(() => engine.close());
  const chatCalls = () => engine.requests.filter((r) => r.url === '/engine/v1/llm/chat');

  it('streams the events of a reply in order and sends the token and the body', async () => {
    engine.handle((_req, res) => stream(res, GOOD_REPLY.map(frame)));
    expect(await collect(client)).toEqual(GOOD_REPLY);
    expect(chatCalls()).toHaveLength(1);
    expect(chatCalls()[0].method).toBe('POST');
    expect(chatCalls()[0].headers[ENGINE_TOKEN_HEADER.toLowerCase()]).toBe(TEST_TOKEN);
    expect(chatCalls()[0].headers.accept).toBe('text/event-stream');
    expect(JSON.parse(chatCalls()[0].body.toString())).toEqual({ private: false, ...body() }); // a normal reply says so explicitly
  });

  it('marks a reply of the private session', async () => {
    engine.handle((_req, res) => stream(res, GOOD_REPLY.map(frame)));
    const seen: LlmEvent[] = [];
    for await (const event of client.chat({ ...body(), private: true })) seen.push(event);
    expect(seen).toEqual(GOOD_REPLY);
    expect(JSON.parse(chatCalls()[0].body.toString()).private).toBe(true);
  });

  it('reads frames split across chunks and ignores pings and unparsable data', async () => {
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const text = `: ping\n\n${frame({ type: 'delta', content: 'é' })}event: delta\ndata: {not json}\n\n${frame({ type: 'done', finish_reason: 'stop' })}`;
      const bytes = Buffer.from(text);
      for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7)); // splits a UTF-8 character too
      res.end();
    });
    expect(await collect(client)).toEqual([{ type: 'delta', content: 'é' }, { type: 'done', finish_reason: 'stop' }]);
  });

  it('stops after done or error', async () => {
    engine.handle((_req, res) => stream(res, [frame({ type: 'delta', content: 'a' }), frame({ type: 'done', finish_reason: 'stop' }), frame({ type: 'delta', content: 'after' })]));
    expect((await collect(client)).map((e) => e.type)).toEqual(['delta', 'done']);
  });

  it('yields an engine error event with a known code, and maps an unknown code to upstream', async () => {
    engine.handle((_req, res) => stream(res, [frame({ type: 'error', code: 'context_exceeded', message: 'trop long', n_prompt_tokens: 20000, n_ctx: 16384 } as never)]));
    expect(await collect(client)).toEqual([{ type: 'error', code: 'context_exceeded', message: 'trop long', n_prompt_tokens: 20000, n_ctx: 16384 }]);
    engine.handle((_req, res) => stream(res, [frame({ type: 'error', code: 'weird', message: 'm' } as never)]));
    expect((await collect(client))[0]).toMatchObject({ type: 'error', code: 'upstream', message: 'm' });
  });

  it('reports a stream cut before the end (server killed by the memory guard) as a closed error, never as a done', async () => {
    engine.handle((_req, res) => stream(res, [frame({ type: 'delta', content: 'a' })]));
    const events = await collect(client);
    expect(events.map((e) => e.type)).toEqual(['delta', 'error']);
    expect(events[1]).toMatchObject({ code: 'closed' });
  });

  it('maps the refusals the engine sends before any byte', async () => {
    const answer = (status: number, detail: string) =>
      engine.handle((_req, res) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail }));
      });
    const cases: [number, string, string][] = [
      [404, 'Modèle de chat inconnu.', 'no_model'],
      [409, "Le moteur de chat (llama.cpp) n'est pas installé : ouvrez Modèles pour l'installer.", 'no_engine'],
      [409, "Le modèle « Qwen » n'est pas (entièrement) téléchargé. Ouvrez Modèles pour le télécharger.", 'no_model'],
      [409, 'Fichiers de « Qwen » introuvables : téléchargez le modèle.', 'no_model'],
      [409, 'Une réponse est déjà en cours de génération.', 'busy'],
      [409, 'Une génération de médias est en cours : attendez sa fin ou annulez-la avant de discuter.', 'busy'],
      [422, 'Ce modèle ne lit pas les images : choisissez un modèle avec la mention « vision ».', 'refused'],
      [500, 'boom', 'upstream'],
    ];
    for (const [status, detail, code] of cases) {
      answer(status, detail);
      await expect(collect(client)).rejects.toMatchObject({ code, message: detail });
    }
  });

  it('turns an unreachable engine into an upstream error', async () => {
    const down = new EngineLlmClient(new EngineClient(testConfig('http://127.0.0.1:1')));
    await expect(collect(down)).rejects.toMatchObject({ code: 'upstream' });
  });

  it('stops the request when the caller aborts, and throws the abort', async () => {
    let closed = false;
    engine.handle((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(frame({ type: 'delta', content: 'a' }));
      res.on('close', () => (closed = true));
    });
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of client.chat(body(), controller.signal)) {
          seen.push(event.type);
          controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual(['delta']);
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
  });

  it('complete() gathers the text and the usage, and throws a ChatError on an error event', async () => {
    engine.handle((_req, res) => stream(res, GOOD_REPLY.map(frame)));
    const done = await client.complete(body());
    expect(done.content).toBe('Bonjour');
    expect(done.usage).toMatchObject({ prompt_tokens: 5, completion_tokens: 2 });
    engine.handle((_req, res) => stream(res, [frame({ type: 'error', code: 'upstream', message: 'planté' } as never)]));
    await expect(client.complete(body())).rejects.toEqual(new ChatError('upstream', 'planté'));
  });
});

describe('refusalFromHttp', () => {
  it('has a text even without detail', () => {
    expect(refusalFromHttp(404, '').message).toMatch(/inconnu/);
    expect(refusalFromHttp(409, '').code).toBe('busy');
    expect(refusalFromHttp(503, '').code).toBe('upstream');
  });

  it('tells the missing engine and the missing model from the engine detail, in either language', () => {
    for (const detail of ["Le moteur de chat (llama.cpp) n'est pas installé : ouvrez Modèles pour l'installer.", 'The chat engine (llama.cpp) is not installed: open Models to install it.']) {
      expect(refusalFromHttp(409, detail).code).toBe('no_engine');
    }
    for (const detail of ['Le modèle « X » n\'est pas (entièrement) téléchargé.', 'The model "X" is not (fully) downloaded.', 'Files of "X" not found: download the model.']) {
      expect(refusalFromHttp(409, detail).code).toBe('no_model');
    }
  });
});
