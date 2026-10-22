/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { MicRecorderState } from '@/modules_shared/common/components/ui/media'

/** Hint under the clock while recording: keep going until about 8 s, say it is plenty after 30 s. */
export function recordingHint(seconds: number): 'voices.recording.keepGoing' | 'voices.recording.enough' | null {
  if (seconds < 8) return 'voices.recording.keepGoing'
  return seconds > 30 ? 'voices.recording.enough' : null
}

/** Sub-line of the "Record" choice: the reason when the microphone cannot be used, else the invitation. */
export function recordSubKey(state: MicRecorderState): { key: string; warn: boolean } {
  switch (state) {
    case 'denied': return { key: 'voices.studio.record.denied', warn: true }
    case 'no-device': return { key: 'voices.studio.record.noDevice', warn: true }
    case 'error': return { key: 'voices.studio.record.error', warn: true }
    case 'unsupported': return { key: 'voices.studio.record.unsupported', warn: false }
    default: return { key: 'voices.studio.record.sub', warn: false }
  }
}

/** The record button cannot be used while the browser has no microphone API, a request is pending or a clip is being converted. */
export const recordDisabled = (state: MicRecorderState): boolean => state === 'unsupported' || state === 'requesting' || state === 'processing'
