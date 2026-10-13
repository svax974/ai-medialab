/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioRequest, studioUpload } from '@/modules/studio-shell/services/studioHttp'
import type { Voice, VoiceFromAssetBody, VoicePatch, VoiceTranscription } from '../types'

const path = (id: string, suffix = '') => `/voices/${encodeURIComponent(id)}${suffix}`

/**
 * `/api/voices*` (Nest, module `audio-studio`). The sample file is prepared by the engine (mono, 24 kHz, edges trimmed,
 * 30 s at most) and the transcription is suggested by it; both are only reached through these routes.
 */
export const voicesApi = {
  list: () => studioRequest<Voice[]>('get', '/voices'),
  /** Creates a voice from a sample (multipart: `file`, `name`, `transcript`, `language`). */
  create: (form: FormData) => studioUpload<Voice>('/voices', form),
  /** Keeps a generated take as a library voice. */
  fromAsset: (body: VoiceFromAssetBody) => studioRequest<Voice>('post', '/voices/from-asset', body),
  patch: (id: string, patch: VoicePatch) => studioRequest<Voice>('patch', path(id), patch),
  remove: (id: string) => studioRequest<{ ok: true }>('delete', path(id)),
  /** A suggested text for the sample (nothing is stored): the user corrects it, then saves with `patch`. */
  transcribe: (id: string, body: { language?: string | null; model_id?: string | null } = {}) => studioRequest<VoiceTranscription>('post', path(id, '/transcribe'), body),
}
