/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { ChatError } from '../types/chatTypes';
import { ChatModelService } from './ChatModelService';

const llm = { context_default: 16384, context_max: 65536, vision: true, tools: false, reasoning: 'toggle', moe: false, params_b: 8, active_params_b: null };
const model = (over: object = {}) => ({ id: 'llm-a', kind: 'llm', name: 'Modèle A', ready: true, engine_available: true, llm, ...over });
const service = (catalog: object | Error) =>
  new ChatModelService({ catalog: async () => { if (catalog instanceof Error) throw catalog; return catalog; } } as never);
const full = (models: object[], def: string | null = 'llm-a') => ({ models, llm: { default_model_id: def, recommended_model_id: def, ready: true } });

describe('ChatModelService', () => {
  it('takes the model asked for, else the default one, with its capabilities', async () => {
    const s = service(full([model(), model({ id: 'llm-b', name: 'B', llm: { ...llm, tools: true } })]));
    expect(await s.resolve('llm-b')).toMatchObject({ id: 'llm-b', name: 'B', caps: { tools: true, vision: true } });
    expect((await s.resolve(undefined)).id).toBe('llm-a');
    expect((await s.resolve(null)).id).toBe('llm-a');
    expect((await s.resolve('')).caps).toMatchObject({ context_max: 65536, tools: false });
  });

  it('fills missing capabilities with prudent ones', async () => {
    const s = service(full([model({ llm: null })]));
    expect((await s.resolve('llm-a')).caps).toMatchObject({ vision: false, tools: false, reasoning: 'none' });
  });

  it.each([
    ['no model at all', full([], null), undefined, 'no_model', /ouvrez « Modèles »/],
    ['an unknown model', full([model()]), 'ghost', 'no_model', /inconnu/],
    ['a model of another studio', full([model({ kind: 'image' })]), 'llm-a', 'no_model', /inconnu/],
    ['a model not downloaded', full([model({ ready: false })]), 'llm-a', 'no_model', /n'est pas \(entièrement\) téléchargé/],
    ['a missing runtime', full([model({ engine_available: false, ready: false })]), 'llm-a', 'no_engine', /llama\.cpp/],
  ])('refuses %s with an explicit text', async (_name, catalog, asked, code, message) => {
    await expect(service(catalog).resolve(asked as string | undefined)).rejects.toEqual(expect.objectContaining({ code, message: expect.stringMatching(message) }));
  });

  it('resolves a diagram model against the diagram catalog entry, not the chat one', async () => {
    const s = service({
      models: [model({ id: 'llm-a' }), model({ id: 'diagram-a', kind: 'diagram' })],
      llm: { default_model_id: 'llm-a', recommended_model_id: 'llm-a', ready: true },
      diagram: { default_model_id: 'diagram-a', recommended_model_id: 'diagram-a', ready: true },
    });
    expect((await s.resolve(undefined, 'diagram')).id).toBe('diagram-a');
    await expect(s.resolve('llm-a', 'diagram')).rejects.toMatchObject({ code: 'no_model' });
  });

  it('reports an engine that does not answer', async () => {
    const error = await service(new Error('Engine unreachable')).resolve('llm-a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({ code: 'upstream', message: expect.stringContaining('Engine unreachable') });
  });
});
