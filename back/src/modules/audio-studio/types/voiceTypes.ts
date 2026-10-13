/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { VoiceKind } from '../entities/VoiceEntity';

export const MAX_VOICE_NAME_LENGTH = 80;
export const DEFAULT_VOICE_NAME = 'Voix sans nom';

export interface CreateVoiceInput {
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
