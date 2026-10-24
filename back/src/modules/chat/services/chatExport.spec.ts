/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import type { ConversationDto } from 'src/modules/studio-core';
import { exportFileName, toJson, toMarkdown } from './chatExport';
import type { ChatMessage, ChatSettings } from '../types/chatTypes';

const conversation = { id: 'c', title: 'Les élans du Nord', mode: 'chat' } as ConversationDto;
const settings = { model_id: 'llm-a', system_prompt: 'Sois bref.\nSois clair.', params: {}, context_size: null, reasoning: 'auto', tools: { web: false }, leaf_id: null } as ChatSettings;
const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm', conversation_id: 'c', parent_id: null, role: 'user', content: 'Bonjour', reasoning: null, tool_runs: [], generations: [], attachments: [], model_id: null, params: null,
  status: 'done', error: null, error_code: null, stats: null, created_at: 1_700_000_000, sibling_ids: ['m'], sibling_index: 0, ...over,
});

describe('exports', () => {
  it('names the file from the title with safe characters', () => {
    expect(exportFileName('Les élans du Nord !', 'md')).toBe('Les_elans_du_Nord.md');
    expect(exportFileName('../../etc/passwd', 'json')).not.toContain('/');
    expect(exportFileName('', 'md')).toBe('conversation.md');
    expect(exportFileName('日本語', 'md')).toBe('conversation.md');
    expect(exportFileName('x'.repeat(200), 'md').length).toBeLessThanOrEqual(63);
  });

  it('writes Markdown: title, system prompt, each message with its date, thoughts, tool runs, attachments and errors', () => {
    const md = toMarkdown(conversation, settings, [
      message({ attachments: [{ kind: 'image', name: 'chat_1.png', original_name: 'élan.png', mime: 'image/png', size: 3 }] }),
      message({
        id: 'a', role: 'assistant', model_id: 'llm-a', content: 'Voici.', reasoning: 'Je pense.', error: 'coupé',
        tool_runs: [{ id: 't', name: 'web_search', arguments: { query: 'élans' }, status: 'done', result_preview: 'DuckDuckGo : 1 résultat', sources: [{ title: 'Doc', url: 'https://example.org' }] }],
      }),
    ]);
    expect(md).toContain('# Les élans du Nord');
    expect(md).toContain('> **Instruction système** : Sois bref.\n> Sois clair.');
    expect(md).toMatch(/## Vous — 2023-11-14 \d\d:\d\d/);
    expect(md).toContain('## Assistant (llm-a)');
    expect(md).toContain('*Pièce jointe : élan.png*');
    expect(md).toContain('<details><summary>Réflexion</summary>\n\nJe pense.\n\n</details>');
    expect(md).toContain('*Outil web_search : {"query":"élans"} → DuckDuckGo : 1 résultat*');
    expect(md).toContain('- [Doc](https://example.org)');
    expect(md).toContain('*Erreur : coupé*');
    expect(md.endsWith('\n')).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('writes the whole branch as JSON', () => {
    const parsed = JSON.parse(toJson(conversation, settings, [message({})]));
    expect(parsed).toMatchObject({ conversation: { id: 'c' }, settings: { model_id: 'llm-a' }, messages: [{ id: 'm', content: 'Bonjour' }] });
  });
});
