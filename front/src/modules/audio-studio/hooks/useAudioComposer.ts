/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useMemo, useState } from 'react'
import type { ModelInfo } from '@/modules/model-catalog'
import { useLang } from '@/modules/studio-shell/hooks/useT'
import { useVoices } from '@/modules/voices'
import { estimateSeconds, speakersIn } from '../lib/audioText'
import { audioNotices, audioSendState } from '../lib/composerRules'
import { buildAudioRequest } from '../lib/sendRequest'
import { castPool, castVoiceFor, defaultLanguage, effectiveVoice, isScriptActive } from '../lib/voiceChoice'
import { useAudioDraftStore } from '../state/audioDraftStore'
import { useSendAudio } from './useSendAudio'

/**
 * Everything the audio composer shows and sends for a model: the effective parameters, language and voice, the characters of a
 * dialogue and who speaks each (automatic casting unless the user chose), the estimated duration, whether the text can go
 * (and what the button's tooltip says), the notices, and `submit`.
 */
export function useAudioComposer(model: ModelInfo, conversationId: string | null) {
  const caps = model.audio!
  const draft = useAudioDraftStore()
  const lang = useLang()
  const { data: library } = useVoices()
  const send = useSendAudio(conversationId)
  const [scriptMode, setScriptMode] = useState(true)

  const language = defaultLanguage(caps, draft.languageByModel[model.id], lang)
  const params = { ...Object.fromEntries(model.params.map((spec) => [spec.key, spec.default])), ...draft.paramsByModel[model.id] }
  const voice = effectiveVoice(caps, draft.voiceByModel[model.id], language, library)
  const instruct = draft.instructByModel[model.id] ?? ''
  const speakers = useMemo(() => speakersIn(draft.prompt), [draft.prompt])
  const pool = useMemo(() => castPool(caps, language, library), [caps, language, library])
  const scriptActive = isScriptActive({ scriptMode, speakers, caps, poolSize: pool.length })
  const castOf = (name: string, index: number) => castVoiceFor({ name, index, cast: draft.cast, pool, main: voice, caps })

  const needsVoice = !caps.design && !voice.ref
  const state = audioSendState(model, { prompt: draft.prompt, hasVoice: !!voice.ref, instruct, sending: send.isPending })
  const notices = audioNotices(model, { prompt: draft.prompt, needsVoice })

  const submit = () => {
    if (!state.canSend) return
    send.mutate(buildAudioRequest({
      conversationId, prompt: draft.prompt, model, params, language, seed: draft.seed, voice: voice.ref, instruct,
      cast: scriptActive ? Object.fromEntries(speakers.map((name, index) => [name, castOf(name, index)])) : null,
      count: draft.count,
    }))
  }

  return {
    draft, caps, language, params, voice, instruct, speakers, scriptActive, scriptMode, setScriptMode, castOf, state, notices, submit, sending: send.isPending,
    seconds: estimateSeconds(draft.prompt, Number(params['speed']) || 1),
  }
}
