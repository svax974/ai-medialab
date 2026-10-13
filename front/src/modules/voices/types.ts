/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export type VoiceKind = 'clone' | 'design'

/** Which voice an audio generation speaks with: one of the model's built-in voices, or one of the user's library. */
export interface VoiceRef {
  source: 'preset' | 'library'
  id: string
}

/** Public shape of a voice of the library (`/api/voices`, same as the former engine API). */
export interface Voice {
  id: string
  name: string
  kind: VoiceKind
  transcript: string
  description: string
  language: string | null
  /** Seconds. */
  duration: number | null
  /** 120 waveform values in [0, 1]. */
  peaks: number[]
  /** `/media/uploads/voice_<id>.wav`, `null` without a sample. */
  url: string | null
  created_at: number
}

/** What `POST /api/voices/:id/transcribe` suggests: nothing is stored until the user saves the (edited) text. */
export interface VoiceTranscription {
  text: string
  language?: string | null
  duration?: number | null
  model: string
}

export interface VoicePatch {
  name?: string
  transcript?: string
  description?: string
  language?: string
}

export interface VoiceFromAssetBody {
  asset_id: string
  name?: string
  description?: string
  transcript?: string
  language?: string | null
  kind?: VoiceKind
}

/** Content of the voice studio dialog: a file dropped or picked on opening, or an existing voice to edit. */
export interface VoiceStudioTarget {
  file?: File
  voiceId?: string
}
