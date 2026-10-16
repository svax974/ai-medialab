/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { ChatError, type StoredGeneration } from '../types/chatTypes';
import { CreationToolsService, parseCommand, videoBounds } from './CreationToolsService';
import type { LlmToolCall } from './EngineLlmClient';

const call = (name: string, args: unknown, id = 'call_1'): LlmToolCall => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

const image = { id: 'flux', kind: 'image', name: 'Flux', ready: true };
const video = { id: 'wan', kind: 'video', name: 'Wan', ready: true, video: { min_seconds: 1, max_seconds: 8, default_seconds: 5 } };
const cloner = { id: 'clone-tts', kind: 'audio', name: 'Cloneur', ready: true, audio: { task: 'tts', clone: 'required', voices: [], max_chars: 100, languages: [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }] } };
const presets = { id: 'preset-tts', kind: 'audio', name: 'Kokoro', ready: true, audio: { task: 'tts', clone: 'none', instruct: true, design: false, voices: [{ id: 'ff_siwis', name: 'Siwis' }], max_chars: 600, languages: [] } };
const whisper = { id: 'whisper', kind: 'audio', name: 'Whisper', ready: true, audio: { task: 'stt' } };
const sleeping = { id: 'sleep', kind: 'image', name: 'Pas prêt', ready: false };

const MARIE = { id: 'v1', name: 'Marie', kind: 'clone' };

function make(opts: { models?: unknown[]; defaultVoice?: string; voices?: unknown[]; stored?: StoredGeneration[] } = {}) {
  let counter = 0;
  const create = jest.fn(async () => ({ conversation_id: 'conv', user_message: {}, assistant_message: { id: `job${++counter}` } }));
  const remove = jest.fn(async () => ({ ok: true, deleted: [] }));
  const updateMessage = jest.fn(async () => undefined);
  const catalog = { catalog: async () => ({ models: opts.models ?? [image, video, cloner, presets, whisper, sleeping] }) };
  const voices = { list: async () => opts.voices ?? [MARIE], get: async (id: string) => (id === 'v1' ? MARIE : null) };
  const settings = { getPublic: async () => ({ chat_voice_id: opts.defaultVoice ?? '' }) };
  const studioMessages = { get: jest.fn(async (id: string) => (id === 'job1' ? { id, parent_id: 'prompt1', status: 'queued', error: null, outputs: [] } : null)) };
  const store = {
    requireMessage: jest.fn(async () => ({ id: 'm1', generations: opts.stored ?? [] })),
    updateMessage,
  };
  const service = new CreationToolsService(catalog as never, voices as never, settings as never, { create, remove } as never, studioMessages as never, store as never);
  return { service, create, remove, updateMessage, studioMessages };
}

describe('parseCommand', () => {
  it('reads /image, /video [Ns] and /audio [voix :]', () => {
    expect(parseCommand('/image un chat roux')).toEqual({ kind: 'image', text: 'un chat roux', seconds: null, voiceName: null });
    expect(parseCommand('/video 3s un chat qui court')).toMatchObject({ kind: 'video', seconds: 3, text: 'un chat qui court' });
    expect(parseCommand('/video 2,5 s vague')).toMatchObject({ seconds: 2.5, text: 'vague' });
    expect(parseCommand('/video une vague')).toMatchObject({ seconds: null, text: 'une vague' });
    expect(parseCommand('/audio Marie : Bonjour à tous')).toMatchObject({ kind: 'audio', voiceName: 'Marie', text: 'Bonjour à tous' });
    expect(parseCommand('/AUDIO Bonjour')).toMatchObject({ voiceName: null, text: 'Bonjour' });
  });

  it('ignores what is not a command', () => {
    expect(parseCommand('bonjour')).toBeNull();
    expect(parseCommand('/imagerie')).toBeNull();
    expect(parseCommand('dis /image')).toBeNull();
  });
});

describe('CreationToolsService.prepare', () => {
  it('offers nothing without a selected, ready model', async () => {
    const { service } = make();
    expect(await service.prepare('conv', undefined)).toBeNull();
    expect(await service.prepare('conv', {})).toBeNull();
    expect(await service.prepare('conv', { image: 'sleep', audio: 'whisper', video: 'unknown' })).toBeNull();
  });

  it('builds one schema per studio from the selected models', async () => {
    const run = await make().service.prepare('conv', { image: 'flux', video: 'wan', audio: 'preset-tts' });
    const names = (run?.schemas as { function: { name: string } }[]).map((s) => s.function.name);
    expect(names).toEqual(['generate_image', 'generate_video', 'generate_audio']);
  });

  it('puts the bounds of the video model in the description and the schema', async () => {
    const run = await make().service.prepare('conv', { video: 'wan' });
    const fn = (run?.schemas[0] as { function: { description: string; parameters: { properties: { seconds: { minimum: number; maximum: number } }; required: string[] } } }).function;
    expect(fn.description).toContain('1 à 8 s (5 s par défaut)');
    expect(fn.parameters.properties.seconds).toMatchObject({ minimum: 1, maximum: 8 });
    expect(fn.parameters.required).toEqual(['prompt']);
  });

  it('only exposes what the audio model accepts', async () => {
    const withVoices = await make().service.prepare('conv', { audio: 'clone-tts' });
    const cloneProps = (withVoices?.schemas[0] as { function: { parameters: { properties: Record<string, { description?: string; maxLength?: number }> } } }).function.parameters.properties;
    expect(Object.keys(cloneProps).sort()).toEqual(['language', 'text', 'voice']);
    expect(cloneProps.voice.description).toContain('Marie');
    expect(cloneProps.text.maxLength).toBe(100);

    const plain = await make().service.prepare('conv', { audio: 'preset-tts' });
    const props = (plain?.schemas[0] as { function: { parameters: { properties: Record<string, { description?: string }> } } }).function.parameters.properties;
    expect(Object.keys(props).sort()).toEqual(['style', 'text', 'voice']);
    expect(props.voice.description).toContain('Siwis');
    expect(props.voice.description).not.toContain('Marie'); // this model cannot clone: the library is not offered
  });
});

describe('CreationToolsService tool calls', () => {
  it('queues an image with the model defaults and answers at once', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { image: 'flux' });
    const out = await run?.run(call('generate_image', { prompt: 'un chat', aspect: '16:9' }));
    expect(create).toHaveBeenCalledWith({ conversationId: 'conv', prompt: 'un chat', modelId: 'flux', params: { aspect: '16:9' }, referenceIds: [], count: 1 });
    expect(out?.run).toMatchObject({ name: 'generate_image', status: 'done', arguments: { prompt: 'un chat', aspect: '16:9' } });
    expect(out?.content).toContain('Génération lancée');
    expect(run?.generations).toMatchObject([{ kind: 'image', model_id: 'flux', message_id: 'job1', prompt: 'un chat' }]);
  });

  it('ignores an aspect the tool does not offer', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { image: 'flux' });
    await run?.run(call('generate_image', { prompt: 'x', aspect: '99:1' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: {} }));
  });

  it('waits for a duration when the video call has none: no generation, a pending entry', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { video: 'wan' });
    const out = await run?.run(call('generate_video', { prompt: 'une vague' }));
    expect(create).not.toHaveBeenCalled();
    expect(out?.run).toMatchObject({ status: 'done', result_preview: 'Durée à choisir' });
    expect(run?.generations).toMatchObject([{ kind: 'video', message_id: null, pending: 'duration', prompt: 'une vague' }]);
  });

  it('starts a video whose duration is inside the bounds, and refuses one outside', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { video: 'wan' });
    expect((await run?.run(call('generate_video', { prompt: 'a', seconds: 12 })))?.run.status).toBe('error');
    expect(create).not.toHaveBeenCalled();
    expect((await run?.run(call('generate_video', { prompt: 'a', seconds: 3 })))?.run.status).toBe('done');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: { seconds: 3 } }));
  });

  it('answers an unknown voice with the list of the voices', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { audio: 'clone-tts' });
    const out = await run?.run(call('generate_audio', { text: 'Bonjour', voice: 'Zoé' }));
    expect(create).not.toHaveBeenCalled();
    expect(out?.run.status).toBe('error');
    expect(out?.content).toContain('Voix inconnue');
    expect(out?.content).toContain('Marie');
  });

  it('resolves a named voice from the library, whatever the case', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { audio: 'clone-tts' });
    await run?.run(call('generate_audio', { text: 'Bonjour', voice: ' marie ', language: 'fr' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: { language: 'fr', voice: { source: 'library', id: 'v1' } } }));
  });

  it('uses the built-in voice and the style of a model that has them', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { audio: 'preset-tts' });
    await run?.run(call('generate_audio', { text: 'Salut', voice: 'Siwis', style: 'calme' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: { instruct: 'calme', voice: { source: 'preset', id: 'ff_siwis' } } }));
  });

  it('falls back to the chat default voice when the model needs one, else waits for a choice', async () => {
    const withDefault = make({ defaultVoice: 'v1' });
    const run = await withDefault.service.prepare('conv', { audio: 'clone-tts' });
    await run?.run(call('generate_audio', { text: 'Bonjour' }));
    expect(withDefault.create).toHaveBeenCalledWith(expect.objectContaining({ params: { voice: { source: 'library', id: 'v1' } } }));

    const without = make();
    const other = await without.service.prepare('conv', { audio: 'clone-tts' });
    const out = await other?.run(call('generate_audio', { text: 'Bonjour' }));
    expect(without.create).not.toHaveBeenCalled();
    expect(other?.generations).toMatchObject([{ kind: 'audio', pending: 'voice', message_id: null }]);
    expect(out?.run.result_preview).toBe('Voix à choisir');
  });

  it('does not ask a voice from a model that does not require one', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { audio: 'preset-tts' });
    await run?.run(call('generate_audio', { text: 'Salut' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: {} }));
  });

  it('refuses a text longer than the model reads', async () => {
    const { service, create } = make();
    const run = await service.prepare('conv', { audio: 'clone-tts' });
    const out = await run?.run(call('generate_audio', { text: 'x'.repeat(101), voice: 'Marie' }));
    expect(create).not.toHaveBeenCalled();
    expect(out?.content).toMatch(/101 caractères.*100 au plus/);
  });

  it('returns the message of the engine when it refuses the generation', async () => {
    const { service, create } = make();
    create.mockRejectedValueOnce(new UnprocessableEntityException('Ce modèle ne sait pas faire cela.'));
    const run = await service.prepare('conv', { image: 'flux' });
    const out = await run?.run(call('generate_image', { prompt: 'x' }));
    expect(out?.run).toMatchObject({ status: 'error', result_preview: 'Ce modèle ne sait pas faire cela.' });
    expect(run?.generations).toEqual([]);
  });

  it('bounds the arguments shown in the message', async () => {
    const run = await make().service.prepare('conv', { image: 'flux' });
    const shown = run?.begin(call('generate_image', { prompt: 'x'.repeat(5000), junk: { deep: true } }));
    expect((shown?.arguments.prompt as string).length).toBe(2000);
    expect(shown?.arguments).not.toHaveProperty('junk');
  });
});

describe('CreationToolsService.runCommand', () => {
  it('starts an image, a video with its duration, and an audio with a named voice', async () => {
    const { service, create } = make();
    expect(await service.runCommand('conv', { kind: 'image', text: 'un chat', seconds: null, voiceName: null }, { image: 'flux' })).toMatchObject({ kind: 'image', message_id: 'job1' });
    await service.runCommand('conv', { kind: 'video', text: 'vague', seconds: 3, voiceName: null }, { video: 'wan' });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ params: { seconds: 3 } }));
    await service.runCommand('conv', { kind: 'audio', text: 'Bonjour', seconds: null, voiceName: 'Marie' }, { audio: 'clone-tts' });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Bonjour', params: { voice: { source: 'library', id: 'v1' } } }));
  });

  it('keeps a colon that is not a voice in the text, and a video without duration waits', async () => {
    const { service, create } = make();
    await service.runCommand('conv', { kind: 'audio', text: 'il a dit non', seconds: null, voiceName: 'Attention' }, { audio: 'preset-tts' });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Attention : il a dit non' }));
    const pending = await service.runCommand('conv', { kind: 'video', text: 'vague', seconds: null, voiceName: null }, { video: 'wan' });
    expect(pending).toMatchObject({ pending: 'duration', message_id: null });
  });

  it('says what is missing: a prompt, or a selected model', async () => {
    const { service } = make();
    await expect(service.runCommand('conv', { kind: 'image', text: '', seconds: null, voiceName: null }, { image: 'flux' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(service.runCommand('conv', { kind: 'image', text: 'x', seconds: null, voiceName: null }, {})).rejects.toBeInstanceOf(ChatError);
    await expect(service.runCommand('conv', { kind: 'image', text: 'x', seconds: null, voiceName: null }, { image: 'sleep' })).rejects.toMatchObject({ code: 'no_model' });
  });
});

describe('CreationToolsService.confirm', () => {
  const waitingVideo: StoredGeneration = { id: 'g1', kind: 'video', model_id: 'wan', message_id: null, prompt: 'vague', params: {}, pending: 'duration' };
  const waitingAudio: StoredGeneration = { id: 'g2', kind: 'audio', model_id: 'clone-tts', message_id: null, prompt: 'Bonjour', params: { language: 'fr' }, pending: 'voice' };

  it('starts the video with the chosen duration and records the job in the message', async () => {
    const { service, create, updateMessage } = make({ stored: [waitingVideo] });
    const gen = await service.confirm('conv', 'm1', 'g1', { seconds: 4 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'wan', prompt: 'vague', params: { seconds: 4 } }));
    expect(gen).toMatchObject({ id: 'g1', message_id: 'job1', state: 'queued', params: { seconds: 4 } });
    expect(gen.pending).toBeUndefined();
    expect(updateMessage).toHaveBeenCalledWith('m1', { generations: [expect.objectContaining({ message_id: 'job1', params: { seconds: 4 } })] });
  });

  it('checks the duration against the bounds of the model', async () => {
    const { service, create } = make({ stored: [waitingVideo] });
    await expect(service.confirm('conv', 'm1', 'g1', { seconds: 9 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(service.confirm('conv', 'm1', 'g1', {})).rejects.toMatchObject({ code: 'invalid' });
    expect(create).not.toHaveBeenCalled();
  });

  it('starts the audio with the chosen voice, and refuses a voice that is gone', async () => {
    const { service, create } = make({ stored: [waitingAudio] });
    await expect(service.confirm('conv', 'm1', 'g2', { voiceId: 'nope' })).rejects.toMatchObject({ code: 'invalid' });
    await service.confirm('conv', 'm1', 'g2', { voiceId: 'v1' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: { language: 'fr', voice: { source: 'library', id: 'v1' } } }));
  });

  it('refuses a generation that waits for nothing', async () => {
    const started: StoredGeneration = { ...waitingVideo, message_id: 'job9', pending: undefined };
    const { service } = make({ stored: [started] });
    await expect(service.confirm('conv', 'm1', 'g1', { seconds: 3 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(service.confirm('conv', 'm1', 'zzz', { seconds: 3 })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('CreationToolsService.discard', () => {
  it('removes the studio generation (its prompt, which takes the answer with it) of a deleted message', async () => {
    const { service, remove } = make();
    await service.discard([{ generations: [{ id: 'g', kind: 'image', model_id: 'flux', message_id: 'job1', prompt: 'x', params: {} }, { id: 'h', kind: 'video', model_id: 'wan', message_id: null, prompt: 'y', params: {}, pending: 'duration' }] }, { generations: null }] as never);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('prompt1');
  });
});

describe('videoBounds', () => {
  it('uses the caps of the model, sane defaults without, and keeps the default inside the bounds', () => {
    expect(videoBounds(video as never)).toEqual({ min: 1, max: 8, def: 5 });
    expect(videoBounds({ video: null } as never)).toEqual({ min: 1, max: 5, def: 5 });
    expect(videoBounds({ video: { min_seconds: 2, max_seconds: 4, default_seconds: 9 } } as never)).toEqual({ min: 2, max: 4, def: 4 });
  });
});

beforeEach(() => jest.clearAllMocks());
