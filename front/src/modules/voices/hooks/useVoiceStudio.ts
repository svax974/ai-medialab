/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { readAudioPeaks, toMonoWavFile, useMicRecorder, type MicRecording } from '@/modules_shared/common/components/ui/media'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useModels } from '@/modules/model-catalog'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { buildVoiceForm, buildVoicePatch, canSaveVoice, draftOfVoice, isTooShort, nameFromFile, DEFAULT_NAME, type VoiceDraft } from '../lib/voiceForm'
import { DEFAULT_VOICE_LANGUAGE, readingFor } from '../lib/reading'
import { voiceKeys } from '../lib/voiceKeys'
import { voicesApi } from '../services/voicesApi'
import type { Voice, VoiceStudioTarget } from '../types'
import { useVoices } from './useVoices'

export interface SamplePreview {
  peaks: number[]
  duration: number
  url: string
}

export type StudioBusy = '' | 'save' | 'transcribe' | 'decode'

/**
 * State of the voice studio: the sample (recorded or imported, or the stored one of a voice being edited), the draft
 * (name, language, transcript), and the three actions. A voice is created **once**: transcribing a new sample first
 * saves it (the engine reads the stored clip), after which every save only updates it. The transcript is a
 * suggestion that stays editable in the field; saving stores whatever the field holds.
 */
export function useVoiceStudio(target: VoiceStudioTarget, onClose: () => void) {
  const queryClient = useQueryClient()
  const { data: voices } = useVoices()
  const { data: catalog } = useModels()
  const existing = target.voiceId ? voices?.find((voice) => voice.id === target.voiceId) : undefined
  const transcriberReady = catalog?.models.some((model) => model.audio?.task === 'stt' && model.ready) ?? false

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<SamplePreview | null>(null)
  const [savedId, setSavedId] = useState<string | undefined>(target.voiceId)
  const [draft, setDraft] = useState<VoiceDraft>({ name: '', language: DEFAULT_VOICE_LANGUAGE, transcript: '' })
  const [recorded, setRecorded] = useState(false)
  const [prefilled, setPrefilled] = useState(false)
  const [busy, setBusy] = useState<StudioBusy>('')
  const patchDraft = (patch: Partial<VoiceDraft>) => setDraft((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (existing && !draft.name) setDraft(draftOfVoice(existing))
  }, [existing]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Decodes the sample for the preview (the browser's formats become a mono WAV; the others go to the server as they are). */
  const load = useCallback(async (raw: Blob, fileName: string) => {
    setBusy('decode')
    try {
      const wav = await toMonoWavFile(raw, fileName).catch(() => (raw instanceof File ? raw : new File([raw], fileName)))
      const info = await readAudioPeaks(wav).catch(() => ({ peaks: [] as number[], duration: 0 }))
      if (isTooShort(info.duration)) {
        toast.error(i18n.get('voices.error.tooShort'))
        return
      }
      setFile(wav)
      setPreview({ ...info, url: URL.createObjectURL(wav) })
      setDraft((current) => (current.name ? current : { ...current, name: nameFromFile(fileName) || DEFAULT_NAME }))
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => {
    if (target.file) void load(target.file, target.file.name)
  }, [target.file, load])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  const recorder = useMicRecorder({
    fileName: 'Enregistrement',
    onDone: (recording: MicRecording) => {
      setRecorded(true)
      setDraft((current) => (current.transcript ? current : { ...current, transcript: readingFor(current.language) }))
      void load(recording.wav ?? recording.blob, 'Enregistrement.wav')
    },
  })

  // An imported sample is transcribed as soon as it is read, to prefill the field (a quiet failure: the button stays there).
  useEffect(() => {
    if (!file || recorded || savedId || !transcriberReady || draft.transcript) return
    let cancelled = false
    setBusy('transcribe')
    voicesApi
      .transcribeSample(file, draft.language)
      .then((suggestion) => {
        if (cancelled || !suggestion.text) return
        setDraft((current) => (current.transcript ? current : { ...current, transcript: suggestion.text }))
        setPrefilled(true)
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setBusy('') })
    return () => {
      cancelled = true
      setBusy((current) => (current === 'transcribe' ? '' : current))
    }
  }, [file, transcriberReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const ensureSaved = async (): Promise<Voice | null> => {
    if (savedId) return voicesApi.patch(savedId, buildVoicePatch(draft))
    if (!file) return null
    const voice = await voicesApi.create(buildVoiceForm(file, draft))
    setSavedId(voice.id)
    return voice
  }

  const run = async (kind: StudioBusy, action: () => Promise<void>) => {
    setBusy(kind)
    try {
      await action()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  const save = () =>
    run('save', async () => {
      const voice = await ensureSaved()
      if (voice) {
        await queryClient.invalidateQueries({ queryKey: voiceKeys.all })
        toast.success(i18n.get('voices.studio.saved', [voice.name]))
      }
      onClose()
    })

  const transcribe = () =>
    run('transcribe', async () => {
      if (!savedId && file) {
        const suggestion = await voicesApi.transcribeSample(file, draft.language)
        patchDraft({ transcript: suggestion.text })
        setPrefilled(true)
        return
      }
      const voice = await ensureSaved()
      if (!voice) return
      const suggestion = await voicesApi.transcribe(voice.id, { language: draft.language })
      patchDraft({ transcript: suggestion.text })
      await voicesApi.patch(voice.id, { transcript: suggestion.text })
      void queryClient.invalidateQueries({ queryKey: voiceKeys.all })
    })

  const discardSample = () => {
    setFile(null)
    setPreview(null)
    setRecorded(false)
    setPrefilled(false)
  }

  const hasAudio = !!file || !!existing
  const sampleUrl = preview?.url ?? (existing?.url ? resolveMediaUrl(existing.url) : null)
  return {
    existing, draft, patchDraft, preview, recorder, recorded, prefilled, busy, hasAudio, transcriberReady, savedId,
    sample: { url: sampleUrl, peaks: preview?.peaks ?? existing?.peaks ?? [], duration: preview?.duration || existing?.duration || 0 },
    canSave: canSaveVoice({ hasAudio, name: draft.name, busy: !!busy, previewDuration: preview?.duration }),
    load, save, transcribe, discardSample,
  }
}
