/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useModels } from '@/modules/model-catalog'
import { useComponents } from '@/modules/engines/hooks/useComponents'
import { usePrivateStore } from '@/modules/private/state/privateStore'
import { fileIssue, isYoutubeLink, transcriptionModels } from '../lib/transcriptRules'
import { transcriptApi } from '../services/transcriptApi'

/** Source form and upload lifecycle, separate from its presentation. */
export function useTranscriptComposer() {
  const navigate = useNavigate()
  const { data } = useModels()
  const components = useComponents()
  const readerReady = Boolean(components.data?.some((item) => item.id === 'ffmpeg' && item.installed))
  const privateMode = usePrivateStore((state) => state.active)
  const models = useMemo(() => transcriptionModels(data?.models ?? []), [data])
  const [chosen, setChosen] = useState('')
  const model = models.find((item) => item.id === chosen) ?? models.find((item) => item.ready) ?? models[0]
  const [kind, setKind] = useState<'file' | 'youtube'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [language, setLanguage] = useState('auto')
  const [issue, setIssue] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<number | null>(null)
  const create = useMutation({ mutationFn: () => transcriptApi.create({ ...(kind === 'file' && file ? { file } : { url: url.trim() }), modelId: model?.id ?? '', language }, setUploaded), onSuccess: (row) => navigate(`/transcriptions/${row.id}`) })
  const submit = () => {
    const problem = kind === 'file' ? file ? fileIssue(file) : 'transcription.error.source' : isYoutubeLink(url) ? null : 'transcription.error.url'
    setIssue(problem)
    if (!problem && model?.ready && readerReady && !privateMode) create.mutate()
  }
  return { models, model, chosen, setChosen, kind, setKind, file, setFile, url, setUrl, language, setLanguage, issue, setIssue, uploaded, create, privateMode, readerReady, submit }
}
