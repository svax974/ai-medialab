/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { UnprocessableEntityException } from '@nestjs/common';
import type {
  TranscribeVoiceInput, UpdateVoiceInput, UploadVoiceInput, VoiceFromAssetInput,
} from '../types/voiceTypes';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(message: string): never {
  throw new UnprocessableEntityException(message);
}

function optionalText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value == null) return undefined;
  if (typeof value !== 'string') return fail(tr('audioStudio.error.textExpected', [key]));
  return value;
}

/** Multipart text fields of `POST /api/voices`; missing ones are empty (the file name then names the voice). */
export function parseUploadVoice(body: unknown): UploadVoiceInput {
  const fields = isRecord(body) ? body : {};
  return {
    name: optionalText(fields, 'name') ?? '',
    transcript: optionalText(fields, 'transcript') ?? '',
    language: optionalText(fields, 'language') || null,
    description: optionalText(fields, 'description') ?? '',
    kind: optionalText(fields, 'kind') === 'design' ? 'design' : 'clone',
  };
}

/** Body of `POST /api/voices/from-asset`: `asset_id` required, the rest falls back on the take's own metadata. */
export function parseVoiceFromAsset(body: unknown): VoiceFromAssetInput {
  if (!isRecord(body)) return fail(tr('audioStudio.error.jsonBodyExpected'));
  if (typeof body.asset_id !== 'string' || !body.asset_id) return fail(tr('audioStudio.error.textExpected', ['asset_id']));
  return {
    assetId: body.asset_id,
    name: optionalText(body, 'name') ?? '',
    description: optionalText(body, 'description') ?? '',
    transcript: optionalText(body, 'transcript') ?? '',
    language: optionalText(body, 'language') || null,
    kind: body.kind === 'clone' ? 'clone' : 'design',
  };
}

/** Body of `PATCH /api/voices/:id`: only the fields that are present change (an empty transcript clears it). */
export function parseUpdateVoice(body: unknown): UpdateVoiceInput {
  if (!isRecord(body)) return fail(tr('audioStudio.error.jsonBodyExpected'));
  const input: UpdateVoiceInput = {};
  for (const key of ['name', 'transcript', 'description', 'language'] as const) {
    const value = optionalText(body, key);
    if (value !== undefined) input[key] = value;
  }
  return input;
}

/** Body of `POST /api/voices/:id/transcribe` (both fields optional). */
export function parseTranscribeVoice(body: unknown): TranscribeVoiceInput {
  const fields = isRecord(body) ? body : {};
  return { language: optionalText(fields, 'language') || null, modelId: optionalText(fields, 'model_id') || null };
}
