/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { UnprocessableEntityException } from '@nestjs/common';
import {
  ATTACHMENT_NAME, DEFAULT_CHAT_SETTINGS, ID_PATTERN, MAX_ATTACHMENTS, MAX_CONTENT_CHARS, cleanName, parseSettingsPatch,
  type ChatRole, type ChatSettings,
} from 'src/modules/chat';

/** Server-side validation of the stateless private chat: the whole history comes in the request, nothing is trusted. */

const MAX_MESSAGES = 400;
/** The request body is capped at 5 MB by the server; this keeps one history well under it. */
const MAX_HISTORY_CHARS = 2_000_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const unprocessable = (message: string): never => { throw new UnprocessableEntityException(message); };

export interface PrivateAttachmentRef {
  /** Stored name (`chat_<16 hex>.<ext>` in the session folder). */
  name: string;
  /** Name the user picked, shown to the model above a text file. */
  originalName: string;
}

export interface PrivateChatMessage {
  role: ChatRole;
  content: string;
  attachments: PrivateAttachmentRef[];
}

export interface PrivateChatBody {
  /** Id the browser gave the answer: every event of the stream carries it. */
  replyId: string;
  messages: PrivateChatMessage[];
  settings: ChatSettings;
}

function parseAttachments(value: unknown): PrivateAttachmentRef[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return unprocessable(`attachments : ${MAX_ATTACHMENTS} pièces jointes au plus.`);
  const seen = new Set<string>();
  const refs: PrivateAttachmentRef[] = [];
  for (const item of value) {
    const name = isRecord(item) ? item.name : undefined;
    if (typeof name !== 'string' || !ATTACHMENT_NAME.test(name)) return unprocessable('attachments : nom de pièce jointe invalide.');
    if (seen.has(name)) continue;
    seen.add(name);
    const original = isRecord(item) && typeof item.original_name === 'string' ? cleanName(item.original_name) : name;
    refs.push({ name, originalName: original });
  }
  return refs;
}

function parseMessage(value: unknown, index: number): PrivateChatMessage {
  if (!isRecord(value)) return unprocessable(`messages[${index}] : objet attendu.`);
  if (value.role !== 'user' && value.role !== 'assistant') return unprocessable(`messages[${index}].role : user ou assistant attendu.`);
  const attachments = value.role === 'user' ? parseAttachments(value.attachments) : [];
  const content = value.content ?? '';
  if (typeof content !== 'string' || content.length > MAX_CONTENT_CHARS) return unprocessable(`messages[${index}].content : texte de ${MAX_CONTENT_CHARS} caractères au plus attendu.`);
  if (value.role === 'user' && !content.trim() && !attachments.length) return unprocessable(`messages[${index}] : message vide.`);
  return { role: value.role, content, attachments };
}

/** Body of `POST /api/private/chat`: `{ reply_id, messages (the history up to the last user message), settings }`. */
export function parsePrivateChatBody(body: unknown): PrivateChatBody {
  if (!isRecord(body)) return unprocessable('Corps JSON attendu.');
  if (typeof body.reply_id !== 'string' || !ID_PATTERN.test(body.reply_id)) return unprocessable('reply_id : identifiant invalide.');
  const raw = body.messages;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_MESSAGES) return unprocessable(`messages : de 1 à ${MAX_MESSAGES} messages attendus.`);
  const messages = raw.map(parseMessage);
  if (messages[messages.length - 1].role !== 'user') return unprocessable('messages : le dernier message doit être celui de l\'utilisateur.');
  if (messages.reduce((sum, m) => sum + m.content.length, 0) > MAX_HISTORY_CHARS) return unprocessable('messages : la conversation est trop longue pour une requête.');
  const patch = body.settings === undefined ? {} : parseSettingsPatch(body.settings);
  return { replyId: body.reply_id, messages, settings: { ...DEFAULT_CHAT_SETTINGS, ...patch, params: { ...patch.params }, leaf_id: null } };
}
