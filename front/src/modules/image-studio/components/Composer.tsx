/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { Box, ButtonBase, CircularProgress, Tooltip } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { HelpBody, helpTooltipSlotProps } from '@/modules_shared/common/components/ui/help'
import { SetupPrompt } from '@/modules/engines'
import { useActiveModel, useModels, useWelcomeModel, useModelSelectionStore, type ModelInfo } from '@/modules/model-catalog'
import { pickerBackendKey } from '@/modules/model-catalog/lib/catalogFormat'
import { registerFocusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { EnhancePromptButton } from '@/modules/chat/components/EnhancePromptButton'
import { AttachButton, GenerationParams, LabelTooltip, NegativePromptField, StudioModelPicker, useImageDraftStore, usePromptHandoff } from '@/modules/studio-core'
import { useSendMessage } from '../hooks/useSendMessage'
import { composerNotices, multiAlternative, placeholderKey, sendState } from '../lib/composerRules'
import { attachHelp } from '../lib/help'
import { effectiveParams } from '../lib/params'
import { resolveSize, sizeReferenceIndex } from '../lib/size'
import { buildSendRequest } from '../lib/sendRequest'
import { uploadReferences } from '../lib/uploadReferences'
import { AspectPicker } from './AspectPicker'
import { CountPicker } from './CountPicker'
import { ReferenceStrip } from './ReferenceStrip'

function Notices({ model, referenceCount, alternative }: { model: ModelInfo; referenceCount: number; alternative: ModelInfo | undefined }) {
  const t = useT()
  const select = useModelSelectionStore((s) => s.select)
  const notices = composerNotices(model, referenceCount, !!alternative)
  if (notices.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gap: '4px', px: 2.25, pb: '4px' }}>
      {notices.map((notice) => (
        <Box key={notice.id} role={notice.tone === 'warn' ? 'alert' : 'status'} sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: 12, lineHeight: 1.4, color: notice.tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>
          {notice.tone === 'warn' ? <ReportProblemOutlined sx={{ mt: '1px', fontSize: 14, flexShrink: 0 }} /> : <InfoOutlined sx={{ mt: '1px', fontSize: 14, flexShrink: 0 }} />}
          <Box component="span" sx={{ minWidth: 0, flex: 1 }}>{notice.text ?? t(notice.key as string, notice.params)}</Box>
          {notice.withSwitch && alternative && (
            <ButtonBase onClick={() => select('image', alternative.id)} sx={{ flexShrink: 0, borderRadius: '8px', backgroundColor: 'var(--safe)', px: 1.25, py: '4px', fontSize: 11.5, fontWeight: 500, color: 'var(--safe-ink)', '&:hover': { filter: 'brightness(1.1)' } }}>
              {t('imageStudio.notice.switchTo', [alternative.name, t(pickerBackendKey(alternative))])}
            </ButtonBase>
          )}
        </Box>
      ))}
    </Box>
  )
}

function SendButton({ enabled, sending, tipKey, onSend }: { enabled: boolean; sending: boolean; tipKey: string; onSend: () => void }) {
  const t = useT()
  return (
    <LabelTooltip label={t(tipKey)} kbd="↵">
      <ButtonBase onClick={onSend} disabled={!enabled} aria-label={t('imageStudio.send.aria')} sx={{ display: 'grid', width: 36, height: 36, placeItems: 'center', borderRadius: '12px', transition: 'all 0.15s', backgroundColor: enabled ? 'var(--safe)' : 'var(--surface-3)', color: enabled ? 'var(--safe-ink)' : 'var(--faint)', boxShadow: enabled ? '0 0 24px -4px var(--safe-glow)' : 'none', '&:hover': enabled ? { filter: 'brightness(1.1)' } : {} }}>
        {sending ? <CircularProgress size={16} color="inherit" /> : <ArrowUpwardRounded sx={{ fontSize: 18 }} />}
      </ButtonBase>
    </LabelTooltip>
  )
}

function ComposerCard({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const t = useT()
  const draft = useImageDraftStore()
  usePromptHandoff('image', draft.setPrompt)
  const { data: catalog } = useModels()
  const welcomeShown = !!useWelcomeModel('image')
  const send = useSendMessage(conversationId)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const hasRefs = draft.references.length > 0
  const sizeIndex = sizeReferenceIndex(model, draft.references.length)
  const params = effectiveParams(model, draft.paramsByModel[model.id], hasRefs, draft.referenceSize)
  const alternative = multiAlternative(catalog?.models ?? [], model, draft.references.length)
  const state = sendState(model, { prompt: draft.prompt, referenceCount: draft.references.length, uploading: draft.uploading.length, sending: send.isPending })

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
    if (hasRefs && params.aspect === 'auto') draft.setReferenceSize(resolveSize(params, model, draft.references[sizeIndex]))
    send.mutate(buildSendRequest({ conversationId, prompt: draft.prompt, modelId: model.id, params, seed: draft.seed, references: draft.references, count: draft.count }))
  }

  return (
    <Box sx={{ position: 'relative', borderRadius: '22px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', transition: 'border-color 0.15s', '&:focus-within': { borderColor: 'var(--line-strong)' }, ...(hero ? { boxShadow: '0 30px 80px -30px var(--safe-glow)' } : {}) }}>
      <ReferenceStrip model={model} sizeIndex={sizeIndex} references={draft.references} uploading={draft.uploading} onRemove={draft.removeReference} onMove={draft.moveReference} />
      <Box
        component="textarea"
        ref={textarea}
        value={draft.prompt}
        rows={hero ? 3 : 1}
        aria-label={t('imageStudio.prompt.aria')}
        placeholder={t(placeholderKey(model, hasRefs))}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => draft.setPrompt(event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length > 0) {
            event.preventDefault()
            void uploadReferences(files)
          }
        }}
        sx={{ display: 'block', width: '100%', resize: 'none', border: 0, background: 'transparent', px: 2.25, pb: 1, pt: 2, fontFamily: 'inherit', fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', outline: 'none', '&::placeholder': { color: 'var(--faint)' } }}
      />
      <NegativePromptField model={model} value={String(params.negative_prompt ?? '')} onChange={(negative_prompt) => draft.setParams(model.id, { negative_prompt })} onSubmit={submit} />
      {model.compatible && !model.ready && !(hero && welcomeShown) && <SetupPrompt model={model} />}
      <Notices model={model} referenceCount={draft.references.length} alternative={alternative} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', px: 1.25, pb: 1.25, pt: '6px' }}>
        <Tooltip title={<HelpBody {...attachHelp(t)} />} placement="top" enterDelay={350} slotProps={helpTooltipSlotProps}>
          <Box component="span" sx={{ display: 'inline-flex' }}>
            <AttachButton labelId="imageStudio.attach.aria" onBrowse={() => filePicker.current?.click()} onPickAssets={draft.addReferences} />
          </Box>
        </Tooltip>
        <input
          ref={filePicker}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label={t('imageStudio.attach.aria')}
          onChange={(event) => {
            void uploadReferences(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <StudioModelPicker model={model} />
        <AspectPicker model={model} params={params} reference={draft.references[sizeIndex]} referenceSize={draft.referenceSize} onChange={(patch) => draft.setParams(model.id, patch)} />
        <GenerationParams model={model} params={params} hasRefs={hasRefs} seed={draft.seed} onChange={(patch) => draft.setParams(model.id, patch)} onReset={() => draft.resetParams(model.id)} onSeed={draft.setSeed} />
        <CountPicker value={draft.count} onChange={draft.setCount} />
        <EnhancePromptButton kind="image" prompt={draft.prompt} onChange={draft.setPrompt} />
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' }, pr: '4px', fontSize: 11, color: 'var(--faint)' }}>{t('imageStudio.send.newline')}</Box>
        <SendButton enabled={state.canSend} sending={send.isPending} tipKey={state.tipKey} onSend={submit} />
      </Box>
    </Box>
  )
}

/**
 * The image composer: reference images (clic, paste, drop on the window), prompt (Enter sends, Shift+Enter a new line),
 * model picker, format and definition, model settings and seed, number of images, send. Notices explain what the model
 * does with the references and why it cannot run; a model that is not installed offers its installation. `conversationId`
 * null (home page): sending creates the conversation and opens it. `hero`: the larger home variant.
 */
export function Composer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const t = useT()
  const model = useActiveModel('image')
  const { isError } = useModels()
  if (!model) {
    return (
      <Box sx={{ display: 'flex', height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: '24px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', fontSize: 14, color: 'var(--muted)' }}>
        {isError ? t('imageStudio.composer.unreachable') : <CircularProgress size={18} color="inherit" />}
      </Box>
    )
  }
  return <ComposerCard model={model} conversationId={conversationId} hero={hero} />
}
