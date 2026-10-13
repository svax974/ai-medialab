/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { classifyDrop } from '@/modules/media-library/lib/dropRules'
import type { Voice, VoicePatch } from '../types'

/** The engine refuses a clip shorter than this (seconds); it keeps 30 seconds at most. */
export const MIN_SAMPLE_SECONDS = 1
export const MAX_SAMPLE_SECONDS = 30
export const MAX_NAME_LENGTH = 80
export const DEFAULT_NAME = 'Ma voix'
/** Transcription model the studio offers to install when none is (the lightest Whisper; about 0.5 GB). */
export const TRANSCRIBER_ID = 'whisper-small'

/** Name proposed for an imported file: its name without extension, separators as spaces, 60 characters at most. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60)
}

/** A decoded sample that is known to be too short (an unknown duration, 0, never blocks: the server decides). */
export function isTooShort(duration: number | null | undefined): boolean {
  return !!duration && duration < MIN_SAMPLE_SECONDS
}

/** Keeps the first audio file of a drop or a pick; `null` when none is a sound (the caller warns). */
export function firstAudioFile<T extends { name: string; type: string; size: number }>(files: readonly T[]): T | null {
  return classifyDrop('audio', files).accepted[0] ?? null
}

export interface VoiceDraft {
  name: string
  language: string
  transcript: string
}

/** Multipart body of `POST /api/voices` (a new voice from a sample). */
export function buildVoiceForm(file: File, draft: VoiceDraft): FormData {
  const form = new FormData()
  form.append('file', file)
  form.append('name', draft.name.trim() || DEFAULT_NAME)
  form.append('transcript', draft.transcript)
  form.append('language', draft.language)
  return form
}

/** Body of `PATCH /api/voices/:id` (an existing voice: name, transcript, language). */
export function buildVoicePatch(draft: VoiceDraft): VoicePatch {
  return { name: draft.name.trim() || DEFAULT_NAME, transcript: draft.transcript, language: draft.language }
}

/** What the dialog shows from the voice being edited, once it is loaded. */
export function draftOfVoice(voice: Pick<Voice, 'name' | 'language' | 'transcript'>): VoiceDraft {
  return { name: voice.name, language: voice.language ?? 'fr', transcript: voice.transcript }
}

/** The save button: a sample (new or existing), a name, nothing running, and not a too-short sample. */
export function canSaveVoice(input: { hasAudio: boolean; name: string; busy: boolean; previewDuration: number | null | undefined }): boolean {
  return input.hasAudio && input.name.trim().length > 0 && !input.busy && !isTooShort(input.previewDuration)
}
