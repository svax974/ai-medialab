/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { fileIssue, isTranscriptActive, isYoutubeLink, MAX_MEDIA_BYTES, mediaDuration, transcriptionModels } from './transcriptRules'

it('accepts supported video and audio files, rejecting empty, oversized and unknown formats', () => {
  for (const name of ['Film.MP4', 'audio.wav', 'clip.webm', 'voice.m4a']) expect(fileIssue({ name, size: 32 })).toBeNull()
  expect(fileIssue({ name: 'x.mp4', size: 0 })).toBe('transcription.error.empty')
  expect(fileIssue({ name: 'x.mp4', size: MAX_MEDIA_BYTES + 1 })).toBe('transcription.error.size')
  expect(fileIssue({ name: 'x.html', size: 12 })).toBe('transcription.error.format')
})

describe('YouTube boundary', () => {
  it.each(['https://youtu.be/abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk&list=discard', 'https://www.youtube.com/shorts/abcdefghijk'])('accepts %s', (value) => expect(isYoutubeLink(value)).toBe(true))
  it.each(['file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://127.0.0.1/watch?v=abcdefghijk', 'https://x@youtube.com/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=x', 'https://youtu.be/bad', '--exec=command'])('rejects %s', (value) => expect(isYoutubeLink(value)).toBe(false))
})

it('offers speech-to-text only and formats progress over an hour', () => {
  const models = [{ id: 'whisper', kind: 'audio', audio: { task: 'stt' } }, { id: 'tts', kind: 'audio', audio: { task: 'tts' } }, { id: 'ocr', kind: 'ocr' }] as ModelInfo[]
  expect(transcriptionModels(models).map((model) => model.id)).toEqual(['whisper'])
  expect(isTranscriptActive('queued')).toBe(true)
  expect(isTranscriptActive('running')).toBe(true)
  expect(isTranscriptActive('done')).toBe(false)
  expect(mediaDuration(3661.9)).toBe('61:01')
  expect(mediaDuration(-1)).toBe('0:00')
})
