/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { VoiceDto } from '../dto/VoiceDto';
import { VoiceEntity } from '../entities/VoiceEntity';

/** Entity to the public shape of the legacy API (`voice_public`). */
export function toVoiceDto(voice: VoiceEntity): VoiceDto {
  return {
    id: voice.id,
    name: voice.name,
    kind: voice.kind,
    transcript: voice.transcript ?? '',
    description: voice.description ?? '',
    language: voice.language ?? null,
    duration: voice.duration ?? null,
    peaks: voice.peaks ?? [],
    url: voice.filename ? `/media/uploads/${voice.filename}` : null,
    created_at: voice.createdAt,
  };
}
