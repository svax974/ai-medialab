/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import type { VoiceKind } from '../entities/VoiceEntity';

export const MAX_VOICE_NAME_LENGTH = 80;
export const DEFAULT_VOICE_NAME = 'Voix sans nom';

export interface CreateVoiceInput {
  /** Chosen by the caller when the sample file is named after it (`voice_<id>.wav`). */
  id?: string;
  /** Trimmed and cut to 80 characters; empty gives `Voix sans nom`. */
  name: string;
  kind: VoiceKind;
  filename?: string | null;
  transcript?: string;
  description?: string;
  language?: string | null;
  duration?: number | null;
  peaks?: number[];
}

/** Editable fields of a voice (the transcript is user-editable: it improves cloning). */
export interface UpdateVoiceInput {
  name?: string;
  transcript?: string;
  description?: string;
  language?: string;
}

export const MAX_TRANSCRIPT_LENGTH = 600;
export const defaultUploadedVoiceName = (): string => tr('audioStudio.voice.defaultUploadedName');
export const defaultSavedVoiceName = (): string => tr('audioStudio.voice.defaultSavedName');

/** Fields of `POST /api/voices` (multipart) after validation. */
export interface UploadVoiceInput {
  name: string;
  transcript: string;
  language: string | null;
  description: string;
  kind: VoiceKind;
}

/** Body of `POST /api/voices/from-asset` after validation. */
export interface VoiceFromAssetInput {
  assetId: string;
  name: string;
  description: string;
  transcript: string;
  language: string | null;
  kind: VoiceKind;
}

/** Body of `POST /api/voices/:id/transcribe` after validation. */
export interface TranscribeVoiceInput {
  language: string | null;
  modelId: string | null;
}
