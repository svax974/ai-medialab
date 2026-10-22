/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { EngineBusyGate } from 'src/modules/studio-core';
import { uploadsDir } from 'src/modules/media-library';
import { buildStudio, type Studio } from 'src/testing/studioHarness';
import { createTestDataSource } from 'src/testing/testDataSource';
import { DiagramsService } from './DiagramsService';

const graphJson = JSON.stringify({ nodes: [{ id: 'a', label: 'A', shape: 'rect' }], edges: [] });

function service(s: Studio, content = graphJson) {
  const llm = { complete: async () => ({ content, usage: null }) } as never;
  const models = { resolve: async () => ({ id: 'diagram-x', name: 'X', caps: {} }) } as never;
  return new DiagramsService(llm, models, s.conversations, s.messages, s.files, s.queue, new EngineBusyGate());
}

describe('DiagramsService', () => {
  let dataSource: DataSource;
  let s: Studio;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildStudio(dataSource);
  });
  afterEach(() => dataSource.destroy());

  it('generates a diagram: a new conversation, the prompt and a done assistant message with the Mermaid source', async () => {
    const result = await service(s).generate({ prompt: 'a flow', diagramType: 'flowchart' });
    expect(result.mermaid_source).toBe('flowchart TD\n  a["A"]');
    expect(result.diagram_type).toBe('flowchart');
    expect(result.user_message).toMatchObject({ role: 'user', prompt: 'a flow' });
    expect(result.assistant_message).toMatchObject({ role: 'assistant', model_id: 'diagram-x', status: 'done' });
  });

  it('reuses an existing conversation when given one', async () => {
    const c = await s.conversations.create({ mode: 'diagram' });
    const result = await service(s).generate({ conversationId: c.id, prompt: 'a flow', diagramType: 'flowchart' });
    expect(result.conversation_id).toBe(c.id);
  });

  it('refuses an empty prompt', async () => {
    await expect(service(s).generate({ prompt: '   ', diagramType: 'flowchart' })).rejects.toBeInstanceOf(HttpException);
  });

  it("refuses an unknown conversation id before calling the model", async () => {
    await expect(service(s).generate({ conversationId: 'ghost', prompt: 'x', diagramType: 'flowchart' })).rejects.toMatchObject({ status: 404 });
  });

  it('turns an unparsable model answer into a clear refusal instead of a crash', async () => {
    const error = await service(s, 'not json').generate({ prompt: 'x', diagramType: 'flowchart' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'upstream' });
  });

  it('attaches a rendered PNG to the assistant message as a generated image asset, with the diagram metadata', async () => {
    const svc = service(s);
    const result = await svc.generate({ prompt: 'a flow', diagramType: 'flowchart' });
    s.engine.on('POST /engine/v1/media/ingest', (call) => ({
      media: 'image', filename: `${call.options?.body?.asset_id}.png`, thumb: 't.webp', meta: {},
    }));
    const asset = await svc.attachRender(
      result.assistant_message.id,
      { path: join(uploadsDir(), 'tmp_x'), originalName: 'diagram.png', mimeType: 'image/png' },
      'flowchart',
    );
    expect(asset).toMatchObject({
      kind: 'generated', message_id: result.assistant_message.id, conversation_id: result.conversation_id,
      meta: { diagram_type: 'flowchart', mermaid_source: result.mermaid_source },
    });
  });

  it('refuses to attach a render to a message that is not a diagram generation', async () => {
    await expect(
      service(s).attachRender('ghost', { path: join(uploadsDir(), 'tmp_x'), originalName: 'd.png', mimeType: 'image/png' }, 'flowchart'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
