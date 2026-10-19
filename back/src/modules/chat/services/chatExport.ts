/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import type { ConversationDto } from 'src/modules/studio-core';
import type { ChatMessage, ChatSettings } from '../types/chatTypes';

/** Exports of a conversation (its active branch): Markdown to read, JSON to keep everything. */

const stamp = (seconds: number): string => new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16);

/** A file name from the title: letters, digits, dots, dashes and underscores only. */
export function exportFileName(title: string, format: 'md' | 'json'): string {
  const base = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${base || 'conversation'}.${format}`;
}

export function toMarkdown(conversation: ConversationDto, settings: ChatSettings, messages: ChatMessage[]): string {
  const lines = [`# ${conversation.title}`, ''];
  if (settings.system_prompt.trim()) lines.push('> **' + tr('chat.export.systemPrompt') + '** : ' + settings.system_prompt.trim().replace(/\n/g, '\n> '), '');
  for (const m of messages) {
    lines.push(`## ${m.role === 'user' ? tr('chat.export.you') : `${tr('chat.export.assistant')}${m.model_id ? ` (${m.model_id})` : ''}`} — ${stamp(m.created_at)}`, '');
    for (const a of m.attachments) lines.push(`*${tr('chat.export.attachment', [a.original_name])}*`, '');
    if (m.reasoning) lines.push(`<details><summary>${tr('chat.export.reasoning')}</summary>`, '', m.reasoning.trim(), '', '</details>', '');
    for (const run of m.tool_runs) {
      lines.push(`*${tr('chat.export.tool', [run.name, JSON.stringify(run.arguments)])}${run.result_preview ? ` → ${run.result_preview}` : ''}*`);
      for (const s of run.sources ?? []) lines.push(`- [${s.title}](${s.url})`);
      lines.push('');
    }
    lines.push(m.content.trim(), '');
    if (m.error) lines.push(`*${tr('chat.export.error', [m.error])}*`, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function toJson(conversation: ConversationDto, settings: ChatSettings, messages: ChatMessage[]): string {
  return JSON.stringify({ conversation, settings, messages }, null, 2);
}
