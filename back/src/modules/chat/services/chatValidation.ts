/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  MAX_ATTACHMENTS, MAX_CONTENT_CHARS, MAX_SYSTEM_PROMPT_CHARS,
  type ChatParams, type ChatReasoning, type ChatSettingsPatch, type CreationModels,
} from '../types/chatTypes';

/** Server-side validation of every body and parameter of the chat routes: allow-lists and bounds, nothing trusted. */

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Names the upload route gives to the files it stores: the only ones a message may attach. */
export const ATTACHMENT_NAME = /^chat_[0-9a-f]{16}\.[a-z0-9]{1,5}$/;
export const REASONING_LEVELS: ChatReasoning[] = ['auto', 'off', 'low', 'medium', 'high'];
export const PROMPT_KINDS = ['image', 'audio', 'video'] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];
export const EXPORT_FORMATS = ['md', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
const MAX_MODEL_ID = 200;
const MAX_PROMPT_CHARS = 8000;
const MAX_QUERY_CHARS = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function bad(message: string): never {
  throw new BadRequestException(message);
}

function unprocessable(message: string): never {
  throw new UnprocessableEntityException(message);
}

export function parseId(value: unknown, name: string): string {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : bad(tr('chat.validation.invalidId', [name]));
}

function parseModelId(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_MODEL_ID ? value : unprocessable(tr('chat.validation.modelId'));
}

function parseContent(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string') return unprocessable(tr('chat.validation.contentText'));
  if (value.length > MAX_CONTENT_CHARS) return unprocessable(tr('chat.validation.contentMax', [MAX_CONTENT_CHARS]));
  if (!allowEmpty && !value.trim()) return unprocessable(tr('chat.validation.contentEmpty'));
  return value;
}

function parseAttachmentNames(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return unprocessable(tr('chat.validation.attachmentsMax', [MAX_ATTACHMENTS]));
  const names = value.map((item) => (isRecord(item) && typeof item.name === 'string' && ATTACHMENT_NAME.test(item.name) ? item.name : unprocessable(tr('chat.validation.attachmentName'))));
  return [...new Set(names)];
}

/**
 * `creation_models` of a message: the model each studio has selected (the browser holds that choice). Only the shape is
 * checked here; a model the catalog does not know or that is not ready simply makes its tool unavailable.
 */
export function parseCreationModels(value: unknown): CreationModels | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) return unprocessable(tr('chat.validation.creationModels'));
  const out: CreationModels = {};
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (value[kind] != null) out[kind] = parseModelId(value[kind]);
  }
  return out;
}

export interface SendBody {
  content: string;
  attachments: string[];
  /** `undefined`: the current leaf; `null`: a new root. */
  parentId: string | null | undefined;
  modelId: string | undefined;
  creationModels?: CreationModels | undefined;
}

/** Body of `POST /api/chat/conversations/:id/messages`: a message needs text or an attachment. */
export function parseSendBody(body: unknown): SendBody {
  if (!isRecord(body)) return unprocessable(tr('chat.validation.jsonBody'));
  const attachments = parseAttachmentNames(body.attachments);
  const content = parseContent(body.content ?? '', attachments.length > 0);
  const parent = body.parent_id;
  if (parent !== undefined && parent !== null && typeof parent !== 'string') return unprocessable(tr('chat.validation.parentId'));
  return {
    content,
    attachments,
    parentId: parent === undefined ? undefined : parent === null ? null : parseId(parent, 'parent_id'),
    modelId: body.model_id == null ? undefined : parseModelId(body.model_id),
    creationModels: parseCreationModels(body.creation_models),
  };
}

export interface RegenerateBody {
  modelId?: string | undefined;
  creationModels?: CreationModels | undefined;
}

export function parseRegenerateBody(body: unknown): RegenerateBody {
  if (body == null) return { modelId: undefined, creationModels: undefined };
  if (!isRecord(body)) return unprocessable(tr('chat.validation.jsonBody'));
  return { modelId: body.model_id == null ? undefined : parseModelId(body.model_id), creationModels: parseCreationModels(body.creation_models) };
}

export interface EditBody {
  content: string;
  /** `undefined`: the attachments of the original message stay. */
  attachments: string[] | undefined;
  creationModels?: CreationModels | undefined;
}

export function parseEditBody(body: unknown): EditBody {
  if (!isRecord(body)) return unprocessable(tr('chat.validation.jsonBody'));
  const attachments = body.attachments === undefined ? undefined : parseAttachmentNames(body.attachments);
  const kept = attachments === undefined ? true : attachments.length > 0;
  return { content: parseContent(body.content ?? '', kept), attachments, creationModels: parseCreationModels(body.creation_models) };
}

export function parseLeafBody(body: unknown): string {
  return isRecord(body) ? parseId(body.message_id, 'message_id') : unprocessable(tr('chat.validation.jsonBody'));
}

function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  const ok = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
  return ok ? (value as number) : unprocessable(integer ? tr('chat.validation.integerRange', [name, min, max]) : tr('chat.validation.numberRange', [name, min, max]));
}

const PARAM_BOUNDS: Record<string, [number, number, boolean]> = {
  temperature: [0, 2, false], top_p: [0, 1, false], top_k: [0, 1000, true], min_p: [0, 1, false],
  repeat_penalty: [0, 2, false], presence_penalty: [-2, 2, false], frequency_penalty: [-2, 2, false],
  max_tokens: [1, 262_144, true],
};

/** `params` of the settings: known members only, each bounded like the engine does; `null` removes one. */
export function parseParams(value: unknown): ChatParams {
  if (!isRecord(value)) return unprocessable(tr('chat.validation.params'));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (key in PARAM_BOUNDS) {
      const [min, max, integer] = PARAM_BOUNDS[key];
      out[key] = number(item, `params.${key}`, min, max, integer);
    } else if (key === 'seed') {
      out.seed = number(item, 'params.seed', 0, 4_294_967_295, true);
    } else if (key === 'stop') {
      const ok = Array.isArray(item) && item.length <= 8 && item.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 64);
      out.stop = ok ? item : unprocessable(tr('chat.validation.stop'));
    } else {
      unprocessable(tr('chat.validation.unknownParam', [key]));
    }
  }
  return out as ChatParams;
}

/** Body of `PATCH .../settings`: any subset of the settings but `leaf_id` (changed by `.../leaf`). */
export function parseSettingsPatch(body: unknown): ChatSettingsPatch {
  if (!isRecord(body)) return unprocessable(tr('chat.validation.jsonBody'));
  const patch: ChatSettingsPatch = {};
  if ('model_id' in body) patch.model_id = body.model_id === null ? null : parseModelId(body.model_id);
  if ('system_prompt' in body) {
    const prompt = body.system_prompt;
    patch.system_prompt = typeof prompt === 'string' && prompt.length <= MAX_SYSTEM_PROMPT_CHARS ? prompt : unprocessable(tr('chat.validation.systemPrompt', [MAX_SYSTEM_PROMPT_CHARS]));
  }
  if ('params' in body) patch.params = parseParams(body.params);
  if ('context_size' in body) patch.context_size = body.context_size === null ? null : number(body.context_size, 'context_size', 256, 1_048_576, true);
  if ('reasoning' in body) {
    patch.reasoning = REASONING_LEVELS.includes(body.reasoning as ChatReasoning) ? (body.reasoning as ChatReasoning) : unprocessable(tr('chat.validation.reasoning', [REASONING_LEVELS.join(', ')]));
  }
  if ('tools' in body) {
    const tools = body.tools;
    const known = isRecord(tools) && Object.keys(tools).length > 0 && Object.entries(tools).every(([k, v]) => (k === 'web' || k === 'creation') && typeof v === 'boolean');
    if (!known) return unprocessable(tr('chat.validation.tools'));
    patch.tools = tools as { web?: boolean; creation?: boolean };
  }
  return patch;
}

export function parseEnhanceBody(body: unknown): { kind: PromptKind; prompt: string; modelId: string | undefined } {
  if (!isRecord(body)) return unprocessable(tr('chat.validation.jsonBody'));
  if (!PROMPT_KINDS.includes(body.kind as PromptKind)) return unprocessable(tr('chat.validation.kind', [PROMPT_KINDS.join(', ')]));
  const prompt = body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) return unprocessable(tr('chat.validation.prompt', [MAX_PROMPT_CHARS]));
  return { kind: body.kind as PromptKind, prompt, modelId: body.model_id == null ? undefined : parseModelId(body.model_id) };
}

export function parseSearchQuery(q: unknown): string {
  const text = typeof q === 'string' ? q.trim() : '';
  return text.length > 0 && text.length <= MAX_QUERY_CHARS ? text : bad(tr('chat.validation.query', [MAX_QUERY_CHARS]));
}

export function parseExportFormat(format: unknown): ExportFormat {
  return EXPORT_FORMATS.includes(format as ExportFormat) ? (format as ExportFormat) : bad(tr('chat.validation.format', [EXPORT_FORMATS.join(tr('chat.validation.formatOr'))]));
}

export interface ConfirmBody {
  seconds?: number;
  voiceId?: string;
}

/** Body of `POST .../generations/:gid/confirm`: the duration of a video or the voice of an audio, whichever the card asked for. */
export function parseConfirmBody(body: unknown): ConfirmBody {
  if (!isRecord(body)) return unprocessable(tr('chat.validation.jsonBody'));
  const out: ConfirmBody = {};
  if (body.seconds != null) out.seconds = number(body.seconds, 'seconds', 0.1, 600);
  if (body.voice_id != null) out.voiceId = typeof body.voice_id === 'string' && ID_PATTERN.test(body.voice_id) ? body.voice_id : unprocessable(tr('chat.validation.voiceId'));
  return out;
}
