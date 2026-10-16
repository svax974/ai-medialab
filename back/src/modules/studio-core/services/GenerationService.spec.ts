/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { buildStudio, engineError, type Studio } from 'src/testing/studioHarness';

const input = (over: Record<string, unknown> = {}) => ({
  conversationId: null, prompt: '  Un chat roux  ', modelId: 'demo', params: {}, referenceIds: [], count: 1, ...over,
});

describe('GenerationService', () => {
  let dataSource: DataSource;
  let s: Studio;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
  });
  afterEach(async () => {
    await s.queue.idle();
    await dataSource.destroy();
  });

  describe('create', () => {
    it('stores a conversation titled from the prompt, the prompt, a queued generation, and queues it', async () => {
      const result = await s.generations.create(input({ params: { aspect: '1:1' }, count: 2 }));
      await s.queue.idle();
      expect(Object.keys(result).sort()).toEqual(['assistant_message', 'conversation_id', 'user_message']);
      const conversation = await s.conversations.get(result.conversation_id);
      expect(conversation).toMatchObject({ title: 'Un chat roux', mode: 'image', busy: true, generation_count: 1 });
      expect(result.user_message).toMatchObject({ role: 'user', prompt: 'Un chat roux', status: 'done', parent_id: null, model_id: null });
      expect(result.assistant_message).toMatchObject({ role: 'assistant', status: 'queued', parent_id: result.user_message.id, model_id: 'demo' });
      const params = result.assistant_message.params as Record<string, unknown>;
      expect(params).toMatchObject({ steps: 12, aspect: '1:1', count: 2 });
      expect((params.seeds as number[]).length).toBe(2);
      expect(conversation?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(s.engine.submitted()).toEqual([result.assistant_message.id]);
      expect(s.published.map((e) => e.type)).toEqual(['conversation.updated']);
      expect(s.published[0].data).toMatchObject({ id: result.conversation_id, busy: true });
    });

    it('attaches a generation to an existing conversation of another mode (the chat tools), keeping its title and mode, and removes it cleanly', async () => {
      const chat = await s.conversations.create({ title: 'Ma discussion', mode: 'chat' });
      const result = await s.generations.create(input({ conversationId: chat.id }));
      await s.queue.idle();
      expect(result.conversation_id).toBe(chat.id);
      expect(await s.conversations.getSummary(chat.id)).toMatchObject({ title: 'Ma discussion', mode: 'chat' });
      expect(s.engine.submitted()).toEqual([result.assistant_message.id]);
      await s.generations.remove(result.user_message.id);
      expect(await s.messages.get(result.assistant_message.id)).toBeNull();
    });

    it('counts up from a fixed seed and never asks for more results than the model allows', async () => {
      s.engine.on('POST /engine/v1/jobs/check', () => ({ kind: 'video', name: 'Vidéo', max_count: 2, default_params: {} }));
      const result = await s.generations.create(input({ modelId: 'vid', count: 4, params: { seed: 40 } }));
      expect(result.assistant_message.params).toMatchObject({ count: 2, seeds: [40, 41] });
      expect((await s.conversations.getSummary(result.conversation_id))?.mode).toBe('video');
    });

    it('asks the engine whether the model can do it, with the media of the references', async () => {
      await s.assets.create({ id: 'r1', kind: 'upload', filename: 'r1.png', media: 'image' });
      await s.assets.create({ id: 'r2', kind: 'upload', filename: 'r2.mp4', media: 'video' });
      await s.generations.create(input({ referenceIds: ['r1', 'r2'] }));
      const check = s.engine.calls.find((c) => c.path === '/engine/v1/jobs/check');
      expect(check?.options?.body).toEqual({ model_id: 'demo', reference_media: ['image', 'video'] });
    });

    it('links the references to the prompt, in order, and gives orphan uploads to the conversation', async () => {
      await s.assets.create({ id: 'r1', kind: 'upload', filename: 'r1.png' });
      await s.assets.create({ id: 'r2', kind: 'upload', filename: 'r2.png', conversationId: null });
      const result = await s.generations.create(input({ referenceIds: ['r2', 'r1'] }));
      expect(result.user_message.references.map((a) => a.id)).toEqual(['r2', 'r1']);
      expect((await s.assets.get('r1'))?.conversation_id).toBe(result.conversation_id);
    });

    it('titles an empty conversation from the first prompt and leaves a titled one alone', async () => {
      const empty = await s.conversations.create({});
      await s.generations.create(input({ conversationId: empty.id }));
      expect((await s.conversations.getSummary(empty.id))?.title).toBe('Un chat roux');
      const named = await s.conversations.create({ title: 'Mon titre' });
      await s.generations.create(input({ conversationId: named.id }));
      expect((await s.conversations.getSummary(named.id))?.title).toBe('Mon titre');
      const second = await s.generations.create(input({ conversationId: empty.id, prompt: 'autre' }));
      expect((await s.conversations.getSummary(second.conversation_id))?.title).toBe('Un chat roux');
    });

    it('writes nothing when something is refused: unknown conversation, empty prompt, missing reference, engine refusal', async () => {
      await expect(s.generations.create(input({ conversationId: 'ghost' }))).rejects.toBeInstanceOf(NotFoundException);
      await expect(s.generations.create(input({ prompt: '   ' }))).rejects.toThrow('Le prompt est vide.');
      await expect(s.generations.create(input({ referenceIds: ['nope'] }))).rejects.toThrow('Image de référence introuvable : nope');
      s.engine.on('POST /engine/v1/jobs/check', () => { throw engineError(422, 'Qwen a besoin d\'au moins une image de référence.'); });
      const refused = await s.generations.create(input()).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(HttpException);
      expect((refused as HttpException).getStatus()).toBe(422);
      expect((refused as HttpException).message).toBe('Qwen a besoin d\'au moins une image de référence.');
      expect(await s.conversations.list()).toEqual([]);
      expect(s.engine.submitted()).toEqual([]);
    });
  });

  describe('retry', () => {
    const first = async () => {
      s.engine.on('POST /engine/v1/jobs', (c) => ({ job_id: c.options?.body?.job_id }));
      const created = await s.generations.create(input({ params: { seed: 5 }, count: 2 }));
      await s.queue.idle();
      return created;
    };

    it('queues a sibling generation of the same prompt with new seeds, behind the others', async () => {
      const { assistant_message: original, user_message: user } = await first();
      const again = await s.generations.retry(original.id, { keepSeed: false });
      expect(again).toMatchObject({ role: 'assistant', status: 'queued', parent_id: user.id, model_id: 'demo', prompt: 'Un chat roux' });
      expect(again.id).not.toBe(original.id);
      const params = again.params as Record<string, unknown>;
      expect(params.seed).toBeNull();
      expect((params.seeds as number[]).length).toBe(2);
      expect(s.queue.snapshot().pending).toEqual([again.id]);
      expect(s.published.at(-1)).toMatchObject({ type: 'message.updated', data: { id: again.id, status: 'queued' } });
    });

    it('keeps the seeds when asked, and takes another model or parameters', async () => {
      const { assistant_message: original } = await first();
      const again = await s.generations.retry(original.id, { keepSeed: true, modelId: 'other', params: { steps: 3 } });
      expect(again.model_id).toBe('other');
      expect(again.params).toMatchObject({ steps: 3, seeds: [5, 6] });
    });

    it('answers 404 for a prompt or an unknown message', async () => {
      const { user_message: user } = await first();
      await expect(s.generations.retry(user.id, { keepSeed: false })).rejects.toBeInstanceOf(NotFoundException);
      await expect(s.generations.retry('ghost', { keepSeed: false })).rejects.toThrow('Génération introuvable.');
    });
  });

  describe('cancel', () => {
    it('answers 409 when the message is neither waiting nor running', async () => {
      await expect(s.generations.cancel('ghost')).rejects.toBeInstanceOf(ConflictException);
    });

    it('cancels a waiting generation', async () => {
      const a = await s.generations.create(input());
      const b = await s.generations.create(input({ prompt: 'deux' }));
      await s.queue.idle();
      expect(await s.generations.cancel(b.assistant_message.id)).toEqual({ ok: true });
      expect((await s.messages.get(b.assistant_message.id))?.status).toBe('cancelled');
      expect((await s.messages.get(a.assistant_message.id))?.status).toBe('queued');
    });
  });

  describe('remove', () => {
    const outputs = async (conversationId: string, messageId: string, ids: string[]) => {
      for (const id of ids) {
        await s.assets.create({ id, kind: 'generated', filename: `${id}.png`, thumb: `${id}.webp`, conversationId, messageId });
      }
    };

    it('deleting a prompt deletes the generations answering it, with their assets and files', async () => {
      await s.assets.create({ id: 'up', kind: 'upload', filename: 'up.png', thumb: 'up.webp' });
      const r = await s.generations.create(input({ referenceIds: ['up'] }));
      await s.queue.idle();
      await outputs(r.conversation_id, r.assistant_message.id, ['o1', 'o2']);
      s.published.length = 0;
      const result = await s.generations.remove(r.user_message.id);
      expect(result).toEqual({ ok: true, deleted: [r.user_message.id, r.assistant_message.id] });
      expect(await s.messages.get(r.assistant_message.id)).toBeNull();
      expect(await s.assets.get('o1')).toBeNull();
      expect(await s.assets.get('up')).toBeNull();
      const purge = s.engine.calls.filter((c) => c.path === '/engine/v1/media/purge').at(-1);
      expect((purge?.options?.body?.files as { filename: string }[]).map((f) => f.filename).sort()).toEqual(['o1.png', 'o2.png', 'up.png']);
      expect(s.published.map((e) => e.type)).toEqual(['message.deleted', 'conversation.updated']);
      expect(s.published[0].data).toEqual({ conversation_id: r.conversation_id, ids: result.deleted });
    });

    it('deleting one generation keeps the prompt and the references another message still uses', async () => {
      await s.assets.create({ id: 'up', kind: 'upload', filename: 'up.png' });
      const r = await s.generations.create(input({ referenceIds: ['up'] }));
      await s.queue.idle();
      await outputs(r.conversation_id, r.assistant_message.id, ['o1']);
      const result = await s.generations.remove(r.assistant_message.id);
      expect(result.deleted).toEqual([r.assistant_message.id]);
      expect(await s.messages.get(r.user_message.id)).not.toBeNull();
      expect(await s.assets.get('o1')).toBeNull();
      expect(await s.assets.get('up')).not.toBeNull(); // still the reference of the prompt
    });

    it('stops the running generation first and answers 404 for an unknown message', async () => {
      const r = await s.generations.create(input());
      await s.queue.idle();
      await s.generations.remove(r.assistant_message.id);
      expect(s.engine.paths('post')).toContain('/engine/v1/jobs/{job_id}/cancel');
      await expect(s.generations.remove('ghost')).rejects.toThrow('Message introuvable.');
    });

    it('deleting a conversation stops its generations and removes messages, assets and files', async () => {
      const r = await s.generations.create(input());
      await s.queue.idle();
      await outputs(r.conversation_id, r.assistant_message.id, ['o1']);
      s.published.length = 0;
      expect(await s.generations.removeConversation(r.conversation_id)).toEqual({ ok: true });
      expect(await s.conversations.get(r.conversation_id)).toBeNull();
      expect(await s.assets.get('o1')).toBeNull();
      expect(s.engine.paths('post')).toContain('/engine/v1/jobs/{job_id}/cancel');
      expect(s.published).toEqual([{ topic: 'studio.conversation.deleted', type: 'conversation.deleted', data: { id: r.conversation_id } }]);
    });

    it('is idempotent for a conversation that does not exist, like the legacy route', async () => {
      expect(await s.generations.removeConversation('ghost')).toEqual({ ok: true });
    });
  });

  it('validation errors are 422', async () => {
    await expect(s.generations.create(input({ prompt: '' }))).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
