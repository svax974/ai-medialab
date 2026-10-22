/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { VoiceKind } from '../entities/VoiceEntity';

/** Public shape of a voice: identical to `voice_public()` of the legacy engine (`engine/app/voices.py`). */
export class VoiceDto {
  id: string;
  name: string;
  kind: VoiceKind;
  transcript: string;
  description: string;
  language: string | null;
  duration: number | null;
  peaks: number[];
  /** `/media/uploads/<filename>`, `null` without a sample. */
  url: string | null;
  created_at: number;
}
