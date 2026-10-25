/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { Box, ButtonBase, CircularProgress } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { SetupPrompt } from '@/modules/engines'
import { GatedNotice, LicenseWarning, useActiveModel, useModels, useWelcomeModel, type ModelInfo } from '@/modules/model-catalog'
import { registerFocusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { EnhancePromptButton } from '@/modules/chat/components/EnhancePromptButton'
import { AttachButton, GenerationParams, LabelTooltip, NegativePromptField, StudioModelPicker, usePromptHandoff } from '@/modules/studio-core'
import { useVideoComposer } from '../hooks/useVideoComposer'
import { useVideoInputs } from '../hooks/useVideoInputs'
import { placeholderKey } from '../lib/composerRules'
import { ATTACH_ACCEPT } from '../lib/slots'
import { VIDEO_HELP } from '../lib/videoHelp'
import { ClipCountPicker, DurationPicker, FormatPicker } from './VideoPickers'
import { SlotTile } from './SlotTile'

function Notices({ notices }: { notices: ReturnType<typeof useVideoComposer>['notices'] }) {
  const t = useT()
  if (notices.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gap: '4px', px: 2.25, pb: '4px' }}>
      {notices.map((notice) => (
        <Box key={notice.id} role={notice.tone === 'warn' ? 'alert' : 'status'} sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: 12, lineHeight: 1.4, color: notice.tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>
          {notice.tone === 'warn' ? <ReportProblemOutlined sx={{ mt: '1px', fontSize: 14, flexShrink: 0 }} /> : <InfoOutlined sx={{ mt: '1px', fontSize: 14, flexShrink: 0 }} />}
          <Box component="span" sx={{ minWidth: 0, flex: 1 }}>{notice.text ?? t(notice.key as string, notice.params)}</Box>
          {notice.help && <InfoTip {...notice.help} />}
        </Box>
      ))}
    </Box>
  )
}

function SendButton({ enabled, sending, tipKey, onSend }: { enabled: boolean; sending: boolean; tipKey: string; onSend: () => void }) {
  const t = useT()
  return (
    <LabelTooltip label={t(tipKey)} kbd="↵">
      <ButtonBase onClick={onSend} disabled={!enabled} aria-label={t('videoStudio.send.aria')} sx={{ display: 'grid', width: 36, height: 36, placeItems: 'center', borderRadius: '12px', transition: 'all 0.15s', backgroundColor: enabled ? 'var(--safe)' : 'var(--surface-3)', color: enabled ? 'var(--safe-ink)' : 'var(--faint)', boxShadow: enabled ? '0 0 24px -4px var(--safe-glow)' : 'none', '&:hover': enabled ? { filter: 'brightness(1.1)' } : {} }}>
        {sending ? <CircularProgress size={16} color="inherit" /> : <ArrowUpwardRounded sx={{ fontSize: 18 }} />}
      </ButtonBase>
    </LabelTooltip>
  )
}

function ComposerCard({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const t = useT()
  const composer = useVideoComposer(model, conversationId)
  const { importFiles, assignAsset } = useVideoInputs()
  const { draft, params, state } = composer
  usePromptHandoff('video', draft.setPrompt)
  const caps = model.video!
  const welcomeShown = !!useWelcomeModel('video')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)

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

  const { slots } = composer
  return (
    <Box sx={{ position: 'relative', borderRadius: '22px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', transition: 'border-color 0.15s', '&:focus-within': { borderColor: 'var(--line-strong)' }, ...(hero ? { boxShadow: '0 30px 80px -30px var(--safe-glow)' } : {}) }}>
      {(slots.start || slots.end || slots.source) && (
        <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', px: 1.75, pt: 1.75, pb: '6px' }}>
          {slots.source && <SlotTile slot="source" model={model} />}
          {slots.start && <SlotTile slot="start" model={model} />}
          {slots.end && <SlotTile slot="end" model={model} />}
        </Box>
      )}
      <Box
        component="textarea"
        ref={textarea}
        value={draft.prompt}
        rows={hero ? 3 : 1}
        aria-label={t('videoStudio.prompt.aria')}
        placeholder={t(placeholderKey(composer.editing, !!draft.start))}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => draft.setPrompt(event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            composer.submit()
          }
        }}
        onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length > 0) {
            event.preventDefault()
            void importFiles(files)
          }
        }}
        sx={{ display: 'block', width: '100%', resize: 'none', border: 0, background: 'transparent', px: 2.25, pb: 1, pt: 2, fontFamily: 'inherit', fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', outline: 'none', '&::placeholder': { color: 'var(--faint)' } }}
      />
      <NegativePromptField model={model} value={String(params.negative_prompt ?? '')} onChange={(negative_prompt) => draft.setParams(model.id, { negative_prompt })} onSubmit={composer.submit} />
      {model.compatible && !model.ready && !(hero && welcomeShown) && <SetupPrompt model={model} />}
      {caps.license_warning && <Box sx={{ mx: 2, mb: '6px' }}><LicenseWarning model={model} /></Box>}
      {model.gated && <Box sx={{ mx: 2, mb: '6px' }}><GatedNotice model={model} /></Box>}
      <Notices notices={composer.notices} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', px: 1.25, pb: 1.25, pt: '6px' }}>
        <AttachButton labelId="videoStudio.attach.aria" help={VIDEO_HELP.attach} onBrowse={() => filePicker.current?.click()} onPickAssets={(assets) => assets.slice(0, 2).forEach(assignAsset)} />
        <input
          ref={filePicker}
          type="file"
          accept={ATTACH_ACCEPT}
          multiple
          hidden
          aria-label={t('videoStudio.attach.aria')}
          onChange={(event) => {
            void importFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <StudioModelPicker model={model} />
        <DurationPicker model={model} seconds={Number(params['seconds'])} onChange={(seconds) => draft.setParams(model.id, { seconds })} />
        <FormatPicker model={model} aspect={String(params.aspect)} resolution={String(params['resolution'])} onChange={(patch) => draft.setParams(model.id, patch)} />
        <GenerationParams model={model} params={params} hasRefs={composer.editing} seed={draft.seed} onChange={(patch) => draft.setParams(model.id, patch)} onReset={() => draft.resetParams(model.id)} onSeed={draft.setSeed} />
        <ClipCountPicker value={Math.min(2, draft.count)} onChange={draft.setCount} />
        <EnhancePromptButton kind="video" prompt={draft.prompt} onChange={draft.setPrompt} />
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' }, pr: '4px', fontSize: 11, color: 'var(--faint)' }}>{t('videoStudio.send.newline')}</Box>
        <SendButton enabled={state.canSend} sending={composer.sending} tipKey={state.tipKey} onSend={composer.submit} />
      </Box>
    </Box>
  )
}

/**
 * The video composer: the inputs the model accepts above the prompt (source video, start image, end image: click, paste, drop
 * on a slot or on the window), the prompt (Enter sends, Shift+Enter a new line), licence and access notices, then model,
 * duration, format and definition, model settings and seed, number of clips (1 or 2) and send. `conversationId` null
 * (home page): sending creates the conversation and opens it. `hero`: the larger home variant.
 */
export function VideoComposer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const t = useT()
  const model = useActiveModel('video')
  const { isError } = useModels()
  if (!model || !model.video) {
    return (
      <Box sx={{ display: 'flex', height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: '24px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', fontSize: 14, color: 'var(--muted)' }}>
        {isError ? t('videoStudio.composer.unreachable') : <CircularProgress size={18} color="inherit" />}
      </Box>
    )
  }
  return <ComposerCard model={model} conversationId={conversationId} hero={hero} />
}
