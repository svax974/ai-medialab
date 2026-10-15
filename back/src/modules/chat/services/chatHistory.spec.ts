/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import type { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { buildHistory, fileBlock, type HistorySources } from './chatHistory';

const msg = (role: 'user' | 'assistant', content: string, extra: Partial<ChatMessageEntity> = {}): ChatMessageEntity =>
  ({ id: `${role}-${content}`, role, content, attachments: [], status: 'done', ...extra }) as ChatMessageEntity;

const sources: HistorySources = {
  imagePath: (name) => `/data/uploads/${name}`,
  readText: async (name) => (name === 'chat_t.txt' ? 'contenu du fichier' : '?'),
};

describe('buildHistory', () => {
  it('puts the system prompt first, then the branch in order', async () => {
    const history = await buildHistory('  Sois bref.  ', [msg('user', 'Salut'), msg('assistant', 'Bonjour !'), msg('user', 'Et toi ?')], sources);
    expect(history).toEqual([
      { role: 'system', content: 'Sois bref.' }, { role: 'user', content: 'Salut' }, { role: 'assistant', content: 'Bonjour !' }, { role: 'user', content: 'Et toi ?' },
    ]);
  });

  it('leaves out an empty system prompt and replies that failed without text', async () => {
    const history = await buildHistory('  ', [msg('user', 'a'), msg('assistant', '', { status: 'error' }), msg('user', 'b')], sources);
    expect(history).toEqual([{ role: 'user', content: 'a\n\nb' }]); // the two user messages side by side are merged
  });

  it('keeps the text of a cancelled reply', async () => {
    const history = await buildHistory('', [msg('user', 'q'), msg('assistant', 'début de rép', { status: 'cancelled' }), msg('user', 'continue')], sources);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('puts a text file before the question, between marks with its original name', async () => {
    const user = msg('user', 'Résume.', { attachments: [{ kind: 'text', name: 'chat_t.txt', original_name: 'notes "perso".txt', mime: 'text/plain', size: 5 }] });
    const [first] = await buildHistory('', [user], sources);
    expect(first.content).toBe(`${fileBlock("notes 'perso'.txt", 'contenu du fichier')}\n\nRésume.`);
  });

  it('sends images as parts with their path under the data folder', async () => {
    const user = msg('user', 'Que vois-tu ?', { attachments: [{ kind: 'image', name: 'chat_i.png', original_name: 'a.png', mime: 'image/png', size: 9 }] });
    expect(await buildHistory('', [user], sources)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Que vois-tu ?' }, { type: 'image_url', image_url: { url: '/data/uploads/chat_i.png' } }] },
    ]);
  });

  it('an image alone is a message', async () => {
    const user = msg('user', '', { attachments: [{ kind: 'image', name: 'chat_i.png', original_name: 'a.png', mime: 'image/png', size: 9 }] });
    const [first] = await buildHistory('', [user], sources);
    expect(first.content).toEqual([{ type: 'text', text: '' }, { type: 'image_url', image_url: { url: '/data/uploads/chat_i.png' } }]);
  });

  it('merges two user messages when one carries images and keeps every image', async () => {
    const withImage = msg('user', 'a', { attachments: [{ kind: 'image', name: 'chat_i.png', original_name: 'a.png', mime: 'image/png', size: 9 }] });
    const history = await buildHistory('', [withImage, msg('assistant', '', { status: 'error' }), msg('user', 'b')], sources);
    expect(history).toHaveLength(1);
    expect(history[0].content).toEqual([{ type: 'text', text: 'a\n\nb' }, { type: 'image_url', image_url: { url: '/data/uploads/chat_i.png' } }]);
  });
});
