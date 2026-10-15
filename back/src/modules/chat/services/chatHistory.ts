/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { EngineSchemas } from 'src/modules/engine';
import type { ChatMessageEntity } from '../entities/ChatMessageEntity';

export type EngineChatMessage = EngineSchemas['schemas']['ChatMessage'];

/** What the history reads of a message: a stored one (`ChatMessageEntity`) or one the private chat gets in the request. */
export type HistoryMessage = Pick<ChatMessageEntity, 'role' | 'content' | 'attachments'>;

export interface HistorySources {
  /** Absolute path of a stored image attachment. */
  imagePath(name: string): string;
  /** Text of a stored text attachment. */
  readText(name: string): Promise<string>;
}

/** A text file as the model reads it: its name, then its content, between two marks. */
export const fileBlock = (name: string, text: string): string => `<fichier nom="${name.replace(/"/g, "'")}">\n${text}\n</fichier>`;

async function userMessage(m: HistoryMessage, sources: HistorySources): Promise<EngineChatMessage> {
  const blocks: string[] = [];
  const images: string[] = [];
  for (const a of m.attachments ?? []) {
    if (a.kind === 'image') images.push(sources.imagePath(a.name));
    else blocks.push(fileBlock(a.original_name || a.name, await sources.readText(a.name)));
  }
  const text = [...blocks, m.content].filter((part) => part.length > 0).join('\n\n');
  if (!images.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))],
  };
}

const textOf = (m: EngineChatMessage): string =>
  typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n') : '';

/**
 * The conversation the model reads: the system prompt, then the messages of the active branch up to the one being
 * answered. Final texts only (tool runs are not replayed); a reply that failed without text is left out, and two
 * messages of the same role that end up side by side are merged (chat templates need alternating roles).
 */
export async function buildHistory(systemPrompt: string, path: HistoryMessage[], sources: HistorySources): Promise<EngineChatMessage[]> {
  const out: EngineChatMessage[] = [];
  if (systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt.trim() });
  for (const m of path) {
    if (m.role === 'assistant' && !m.content.trim()) continue;
    const next: EngineChatMessage = m.role === 'user' ? await userMessage(m, sources) : { role: 'assistant', content: m.content };
    const previous = out[out.length - 1];
    if (previous && previous.role === next.role && typeof previous.content === 'string' && typeof next.content === 'string') {
      previous.content = `${previous.content}\n\n${next.content}`;
    } else if (previous && previous.role === 'user' && next.role === 'user') {
      out[out.length - 1] = { role: 'user', content: [{ type: 'text', text: `${textOf(previous)}\n\n${textOf(next)}`.trim() }, ...imagesOf(previous), ...imagesOf(next)] };
    } else {
      out.push(next);
    }
  }
  return out;
}

const imagesOf = (m: EngineChatMessage) => (Array.isArray(m.content) ? m.content.filter((part) => part.type === 'image_url') : []);
