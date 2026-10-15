/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it, jest } from '@jest/globals';
import { EngineBusyGate } from 'src/modules/studio-core';
import { ChatError } from '../types/chatTypes';
import { ENHANCE_INSTRUCTIONS, PromptEnhanceService, cleanPrompt } from './PromptEnhanceService';

function make(over: { complete?: () => Promise<{ content: string }>; status?: object | Error; occupied?: boolean; resolve?: (id: string | undefined) => unknown } = {}) {
  const gate = new EngineBusyGate();
  const complete = jest.fn(async (_body?: unknown): Promise<{ content: string }> => (over.complete ? over.complete() : { content: 'A fox.' }));
  const resolve = jest.fn(async (id: string | undefined) => {
    const r = over.resolve ? over.resolve(id) : { id: id ?? 'llm-default', name: 'M', caps: {} };
    if (r instanceof ChatError) throw r;
    return r;
  });
  const engine = { get: async () => { if (over.status instanceof Error) throw over.status; return over.status ?? { state: 'idle', model_id: null }; } };
  const service = new PromptEnhanceService({ complete } as never, { resolve } as never, engine as never, { occupied: over.occupied ?? false } as never, gate);
  return { service, gate, complete, resolve };
}

describe('cleanPrompt', () => {
  it('removes quotes, a label and code fences around the answer', () => {
    expect(cleanPrompt('"A red fox."')).toBe('A red fox.');
    expect(cleanPrompt('Prompt amélioré : A red fox, soft light')).toBe('A red fox, soft light');
    expect(cleanPrompt('```text\nA red fox\n```')).toBe('A red fox');
    expect(cleanPrompt('«Un renard roux»')).toBe('Un renard roux');
    expect(cleanPrompt('   ')).toBe('');
  });
});

describe('PromptEnhanceService', () => {
  it('has an instruction for each studio, in French, saying what to answer', () => {
    for (const kind of ['image', 'video', 'audio'] as const) expect(ENHANCE_INSTRUCTIONS[kind]).toMatch(/Réponds uniquement/);
    expect(ENHANCE_INSTRUCTIONS.audio).toMatch(/synthèse vocale/);
    expect(ENHANCE_INSTRUCTIONS.image).toMatch(/anglais/);
  });

  it('prefers the model already in memory, then the default one, and an explicit choice over both', async () => {
    const loaded = make({ status: { state: 'ready', model_id: 'llm-loaded' } });
    await loaded.service.enhance('image', 'un renard', undefined);
    expect(loaded.resolve).toHaveBeenCalledWith('llm-loaded');
    const idle = make({ status: { state: 'idle', model_id: 'llm-old' } });
    await idle.service.enhance('image', 'un renard', undefined);
    expect(idle.resolve).toHaveBeenCalledWith(undefined);
    const asked = make({ status: { state: 'ready', model_id: 'llm-loaded' } });
    expect((await asked.service.enhance('image', 'un renard', 'llm-b')).model_id).toBe('llm-b');
    const down = make({ status: new Error('down') });
    await down.service.enhance('video', 'x', undefined);
    expect(down.resolve).toHaveBeenCalledWith(undefined); // an unreachable status is "no model loaded"
  });

  it('sends the instruction and the prompt with no reasoning, and returns the cleaned answer', async () => {
    const { service, complete, gate } = make({ complete: async () => ({ content: '"A red fox, snow."' }) });
    expect(await service.enhance('image', 'un renard', undefined)).toEqual({ prompt: 'A red fox, snow.', model_id: 'llm-default' });
    expect(complete.mock.calls[0][0]).toMatchObject({ reasoning: 'off', messages: [{ role: 'system', content: ENHANCE_INSTRUCTIONS.image }, { role: 'user', content: 'un renard' }] });
    expect(gate.busy).toBe(false);
  });

  it('refuses while a generation runs or a reply holds the engine, and releases what it took', async () => {
    const generation = make({ occupied: true });
    await expect(generation.service.enhance('image', 'x', undefined)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'busy' }) });
    expect(generation.complete).not.toHaveBeenCalled();
    const reply = make();
    reply.gate.tryAcquire('chat');
    await expect(reply.service.enhance('image', 'x', undefined)).rejects.toMatchObject({ status: 409 });
    expect(reply.gate.busy).toBe(true); // still the other owner's
  });

  it('takes the engine from a chat title being written instead of answering busy', async () => {
    const { service, gate, complete } = make();
    gate.tryAcquire('chat');
    gate.setYield('chat', () => setTimeout(() => gate.release('chat'), 5));
    expect(await service.enhance('image', 'un renard', undefined)).toMatchObject({ prompt: 'A fox.' });
    expect(complete).toHaveBeenCalled();
    expect(gate.busy).toBe(false);
  });

  it('answers 409 with the code of a model problem, and releases the gauge', async () => {
    const { service, gate } = make({ resolve: () => new ChatError('no_engine', "Le moteur de chat (llama.cpp) n'est pas installé.") });
    await expect(service.enhance('audio', 'x', undefined)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'no_engine' }) });
    expect(gate.busy).toBe(false);
  });

  it('turns an empty answer into an error and keeps other failures as they are', async () => {
    const empty = make({ complete: async () => ({ content: '  ' }) });
    await expect(empty.service.enhance('image', 'x', undefined)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'upstream' }) });
    expect(empty.gate.busy).toBe(false);
    const boom = make({ complete: async () => { throw new Error('boom'); } });
    await expect(boom.service.enhance('image', 'x', undefined)).rejects.toThrow('boom');
    expect(boom.gate.busy).toBe(false);
  });
});
