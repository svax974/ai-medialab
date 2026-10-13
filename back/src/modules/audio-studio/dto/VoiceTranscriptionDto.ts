/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** What `POST /api/voices/:id/transcribe` answers: a suggestion, never stored (the user corrects it, then saves). */
export class VoiceTranscriptionDto {
  text: string;
  language?: string | null;
  duration?: number | null;
  /** The transcription model that ran. */
  model: string;
}
