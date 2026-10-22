/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, CircularProgress, MenuItem, Select, Slider } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useModels } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useVoices } from '@/modules/voices'
import { chatKeys } from '../lib/chatKeys'
import { durationBounds } from '../lib/creation'
import { chatApi } from '../services/chatApi'
import type { ChatGeneration } from '../types'

/** Starts the generation once the user chose; the card then follows it like any other (the server answers with its new state). */
function useConfirm(messageId: string, generation: ChatGeneration, choice: { seconds: number } | { voice_id: string } | null) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const confirm = async (): Promise<void> => {
    if (!choice) return
    setBusy(true)
    try {
      await chatApi.confirmGeneration(messageId, generation.id, choice)
      await queryClient.invalidateQueries({ queryKey: chatKeys.conversation(generation.conversation_id) })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, confirm }
}

function StartButton({ busy, disabled, onClick }: { busy: boolean; disabled?: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <Button size="small" variant="contained" disabled={busy || disabled} onClick={onClick} startIcon={busy ? <CircularProgress size={12} color="inherit" /> : undefined}>
      {t('chat.generation.start')}
    </Button>
  )
}

/** The duration of a video the answer did not decide: a slider bounded by what the model makes, its default pre-filled. */
export function DurationChoice({ messageId, generation }: { messageId: string; generation: ChatGeneration }) {
  const t = useT()
  const { data } = useModels()
  const bounds = durationBounds(data?.models.find((m) => m.id === generation.model_id)?.video)
  const [seconds, setSeconds] = useState<number | null>(null)
  const value = seconds ?? bounds.initial
  const { busy, confirm } = useConfirm(messageId, generation, { seconds: value })
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box role="note" sx={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{t('chat.generation.duration.ask')}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Slider size="small" min={bounds.min} max={bounds.max} step={bounds.step} value={value} disabled={busy} onChange={(_event, next) => setSeconds(next as number)} aria-label={t('chat.generation.duration.slider')} sx={{ maxWidth: 260 }} />
        <Box component="span" sx={{ minWidth: 40, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)' }}>{t('chat.generation.duration.value', [value])}</Box>
        <StartButton busy={busy} onClick={() => void confirm()} />
      </Box>
    </Box>
  )
}

/** The voice of a sound the answer could not give one to (the model needs a voice and none was named or set as the default). */
export function VoiceChoice({ messageId, generation }: { messageId: string; generation: ChatGeneration }) {
  const t = useT()
  const { data: voices = [] } = useVoices()
  const usable = voices.filter((voice) => voice.url !== null)
  const [voiceId, setVoiceId] = useState('')
  const { busy, confirm } = useConfirm(messageId, generation, voiceId ? { voice_id: voiceId } : null)
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box role="note" sx={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{t(usable.length > 0 ? 'chat.generation.voice.ask' : 'chat.generation.voice.none')}</Box>
      {usable.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Select size="small" displayEmpty value={voiceId} disabled={busy} onChange={(event) => setVoiceId(event.target.value)} inputProps={{ 'aria-label': t('chat.generation.voice.aria') }} sx={{ minWidth: 200 }}>
            <MenuItem value="" disabled>{t('chat.generation.voice.placeholder')}</MenuItem>
            {usable.map((voice) => <MenuItem key={voice.id} value={voice.id}>{voice.name}</MenuItem>)}
          </Select>
          <StartButton busy={busy} disabled={!voiceId} onClick={() => void confirm()} />
        </Box>
      )}
    </Box>
  )
}
