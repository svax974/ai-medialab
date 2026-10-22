/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Box, Button, CircularProgress, Popover } from '@mui/material'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import UndoRounded from '@mui/icons-material/UndoRounded'
import { toast } from 'react-toastify'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useModels } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { useElapsedSeconds } from '../hooks/useElapsedSeconds'
import { canApply, canUndo, enhanceFailure, enhanceFailureKey, enhanceState, type EnhanceFailure, type EnhanceUndo } from '../lib/enhance'
import { chatApi } from '../services/chatApi'

export type EnhanceKind = 'image' | 'audio' | 'video'

interface Props {
  kind: EnhanceKind
  /** The prompt now in the composer. */
  prompt: string
  /** Replaces the prompt of the composer. */
  onChange: (prompt: string) => void
}

const STATE_TIP = { ready: 'chat.enhance.tip', empty: 'chat.enhance.empty', no_model: 'chat.enhance.unavailable' } as const

/**
 * The ✨ button of a composer: the chat model rewrites the prompt (a richer image or video prompt, a text made easy to read
 * aloud) and the composer takes the result. The original is kept: while the prompt is still the improved one the button
 * turns into "go back". A model that has to load can take a while (a clock shows it); a refusal says why and what to do
 * (a generation or an answer is running, no chat model or engine installed) instead of a bare error.
 */
export function EnhancePromptButton({ kind, prompt, onChange }: Props) {
  const t = useT()
  const { data } = useModels()
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)
  const [undo, setUndo] = useState<EnhanceUndo | null>(null)
  const [failure, setFailure] = useState<EnhanceFailure | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const latest = useRef(prompt)
  latest.current = prompt
  const enhance = useMutation({
    mutationFn: (asked: string) => chatApi.enhancePrompt(kind, asked),
    onSuccess: ({ prompt: improved }, asked) => {
      if (!canApply(latest.current, asked)) return void toast.info(i18n.get('chat.enhance.stale'))
      setUndo({ original: asked, improved })
      onChange(improved)
    },
    onError: (error) => setFailure(enhanceFailure(error)),
  })
  const seconds = useElapsedSeconds(enhance.isPending)
  const state = enhanceState(prompt, data?.llm?.ready === true)
  const close = () => setFailure(null)
  const openModels = () => {
    close()
    setModelsOpen(true)
  }
  return (
    <>
      <Box ref={anchor} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {enhance.isPending ? (
          <TipIconButton labelId="chat.enhance.working" size="small" disabled aria-busy sx={{ width: 32, height: 32 }}>
            <CircularProgress size={14} color="inherit" />
          </TipIconButton>
        ) : canUndo(prompt, undo) ? (
          <TipIconButton labelId="chat.enhance.undo" size="small" onClick={() => { onChange((undo as EnhanceUndo).original); setUndo(null) }} sx={{ width: 32, height: 32 }}>
            <UndoRounded sx={{ fontSize: 16 }} />
          </TipIconButton>
        ) : (
          <TipIconButton labelId={STATE_TIP[state]} hintId={state === 'ready' ? `chat.enhance.hint.${kind}` : undefined} size="small" disabled={state !== 'ready'} onClick={() => enhance.mutate(prompt)} sx={{ width: 32, height: 32 }}>
            <AutoAwesomeRounded sx={{ fontSize: 16 }} />
          </TipIconButton>
        )}
        {enhance.isPending && seconds >= 3 && <Box component="span" role="status" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{t('chat.enhance.clock', [seconds])}</Box>}
      </Box>
      <Popover open={!!failure} anchorEl={anchor.current} onClose={close} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 300, maxWidth: 'calc(100vw - 24px)', p: 1.75, mt: -1 } } }}>
        {failure && (
          <Box role="alert" sx={{ display: 'grid', gap: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)' }}>
            <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>{t(enhanceFailureKey(failure.code))}</Box>
            {failure.message && <Box sx={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{failure.message}</Box>}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              {(failure.code === 'no_model' || failure.code === 'no_engine') && <Button size="small" variant="outlined" onClick={openModels}>{t('chat.enhance.action.models')}</Button>}
              <Button size="small" color="inherit" onClick={close}>{t('chat.enhance.close')}</Button>
            </Box>
          </Box>
        )}
      </Popover>
    </>
  )
}
