/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { Box, ButtonBase, CircularProgress } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import { LabelTooltip, StudioModelPicker, usePromptHandoff } from '@/modules/studio-core'
import { SetupPrompt } from '@/modules/engines'
import { useActiveModel, useModels, type ModelInfo } from '@/modules/model-catalog'
import { registerFocusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useSendDiagram } from '../hooks/useSendDiagram'
import { sendState } from '../lib/composerRules'
import { useDiagramDraftStore } from '../state/diagramDraftStore'
import { DiagramTypePicker } from './DiagramTypePicker'
import { ThemePicker } from './ThemePicker'

function SendButton({ enabled, sending, tipKey, onSend }: { enabled: boolean; sending: boolean; tipKey: string; onSend: () => void }) {
  const t = useT()
  return (
    <LabelTooltip label={t(tipKey)} kbd="↵">
      <ButtonBase onClick={onSend} disabled={!enabled} aria-label={t('diagramStudio.send.aria')} sx={{ display: 'grid', width: 36, height: 36, placeItems: 'center', borderRadius: '12px', transition: 'all 0.15s', backgroundColor: enabled ? 'var(--safe)' : 'var(--surface-3)', color: enabled ? 'var(--safe-ink)' : 'var(--faint)', boxShadow: enabled ? '0 0 24px -4px var(--safe-glow)' : 'none', '&:hover': enabled ? { filter: 'brightness(1.1)' } : {} }}>
        {sending ? <CircularProgress size={16} color="inherit" /> : <ArrowUpwardRounded sx={{ fontSize: 18 }} />}
      </ButtonBase>
    </LabelTooltip>
  )
}

function ComposerCard({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const t = useT()
  const draft = useDiagramDraftStore()
  usePromptHandoff('diagram', draft.setPrompt)
  const send = useSendDiagram(conversationId)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const state = sendState(model, draft.prompt, send.isPending)

  useEffect(() => {
    registerFocusTarget('composer', textarea.current)
    return () => registerFocusTarget('composer', null)
  }, [])

  // The field grows with its text, up to 40 % of the window.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [draft.prompt])

  const submit = () => {
    if (!state.canSend) return
    send.mutate({ prompt: draft.prompt, modelId: model.id, diagramType: draft.diagramType, theme: draft.theme })
  }

  return (
    <Box sx={{ position: 'relative', borderRadius: '22px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', transition: 'border-color 0.15s', '&:focus-within': { borderColor: 'var(--line-strong)' }, ...(hero ? { boxShadow: '0 30px 80px -30px var(--safe-glow)' } : {}) }}>
      <Box
        component="textarea"
        ref={textarea}
        value={draft.prompt}
        rows={hero ? 3 : 1}
        aria-label={t('diagramStudio.prompt.aria')}
        placeholder={t('diagramStudio.prompt.placeholder')}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => draft.setPrompt(event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        sx={{ display: 'block', width: '100%', resize: 'none', border: 0, background: 'transparent', px: 2.25, pb: 1, pt: 2, fontFamily: 'inherit', fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', outline: 'none', '&::placeholder': { color: 'var(--faint)' } }}
      />
      {model.compatible && !model.ready && <SetupPrompt model={model} />}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', px: 1.25, pb: 1.25, pt: '6px' }}>
        <StudioModelPicker model={model} />
        <DiagramTypePicker value={draft.diagramType} onChange={draft.setDiagramType} />
        <ThemePicker value={draft.theme} onChange={draft.setTheme} />
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' }, pr: '4px', fontSize: 11, color: 'var(--faint)' }}>{t('diagramStudio.send.newline')}</Box>
        <SendButton enabled={state.canSend} sending={send.isPending} tipKey={state.tipKey} onSend={submit} />
      </Box>
    </Box>
  )
}

/**
 * The diagram composer: prompt (Enter sends, Shift+Enter a new line), model picker, diagram type, visual theme, send.
 * No references, no size/steps params: a diagram is prompt + type + theme only (see `useSendDiagram`). `conversationId`
 * null (home page): sending creates the conversation and opens it. `hero`: the larger home variant.
 */
export function Composer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const t = useT()
  const model = useActiveModel('diagram')
  const { isError } = useModels()
  if (!model) {
    return (
      <Box sx={{ display: 'flex', height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: '24px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', fontSize: 14, color: 'var(--muted)' }}>
        {isError ? t('diagramStudio.composer.unreachable') : <CircularProgress size={18} color="inherit" />}
      </Box>
    )
  }
  return <ComposerCard model={model} conversationId={conversationId} hero={hero} />
}
