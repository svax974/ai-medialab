/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { Box, ButtonBase, CircularProgress } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { SetupPrompt } from '@/modules/engines'
import { ModelPicker, useActiveModel, useModels, useWelcomeModel, type ModelInfo } from '@/modules/model-catalog'
import { registerFocusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { GenerationParams, LabelTooltip } from '@/modules/studio-core'
import { approxDuration, MAX_TEXT_LENGTH } from '../lib/audioText'
import { AUDIO_HELP, maxCharsHelp } from '../lib/audioHelp'
import { useAudioComposer } from '../hooks/useAudioComposer'
import { AutoplayToggle } from './AutoplayToggle'
import { CastPanel } from './CastPanel'
import { LanguagePicker } from './LanguagePicker'
import { TakesPicker } from './TakesPicker'
import { VoicePicker } from './VoicePicker'

function Notices({ notices }: { notices: ReturnType<typeof useAudioComposer>['notices'] }) {
  const t = useT()
  if (notices.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gap: '4px', px: 2.25, pb: '4px' }}>
      {notices.map((notice) => (
        <Box key={notice.id} role={notice.tone === 'warn' ? 'alert' : 'status'} sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: 12, lineHeight: 1.4, color: notice.tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>
          {notice.tone === 'warn' ? <ReportProblemOutlined sx={{ mt: '1px', fontSize: 14, flexShrink: 0 }} /> : <InfoOutlined sx={{ mt: '1px', fontSize: 14, flexShrink: 0 }} />}
          <Box component="span" sx={{ minWidth: 0, flex: 1 }}>{notice.text ?? t(notice.key as string, notice.params)}</Box>
        </Box>
      ))}
    </Box>
  )
}

/** The style (or, for a model that invents voices, the voice description): a line above the text. */
function InstructLine({ model, value, onChange }: { model: ModelInfo; value: string; onChange: (value: string) => void }) {
  const t = useT()
  const caps = model.audio!
  return (
    <Box component="label" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, borderBottom: '1px solid color-mix(in oklab, var(--line) 70%, transparent)', px: 2.25, pb: 1.25, pt: 1.75 }}>
      <Box component="span" sx={{ mt: '3px', display: 'flex', flexShrink: 0, alignItems: 'center', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--safe)' }}>
        <AutoAwesomeRounded sx={{ fontSize: 14 }} /> {t(caps.design ? 'audioStudio.instruct.voice' : 'audioStudio.instruct.style')}
        <InfoTip {...(caps.design ? AUDIO_HELP.instructDesign : AUDIO_HELP.instruct)} />
      </Box>
      <Box component="textarea" rows={1} value={value} placeholder={caps.instruct_help} aria-label={t(caps.design ? 'audioStudio.instruct.voice' : 'audioStudio.instruct.style')} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)} sx={{ minHeight: 24, minWidth: 0, flex: 1, resize: 'none', border: 0, background: 'transparent', p: 0, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: 'var(--ink)', outline: 'none', fieldSizing: 'content', '&::placeholder': { color: 'var(--faint)' } }} />
    </Box>
  )
}

function Counter({ composer }: { composer: ReturnType<typeof useAudioComposer> }) {
  const t = useT()
  const lang = useLang()
  const { draft, caps, seconds } = composer
  const approx = approxDuration(seconds)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.25, pb: '6px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>
      <span>{t('audioStudio.counter.chars', [draft.prompt.length.toLocaleString(lang)])}</span>
      {draft.prompt.trim() && <span>· {t('audioStudio.counter.audio', [t(approx.key, approx.params)])}</span>}
      <Box component="span" sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <InfoTip {...maxCharsHelp(caps.max_chars, MAX_TEXT_LENGTH, lang, t)} />
        <InfoTip {...AUDIO_HELP.script} />
      </Box>
    </Box>
  )
}

function SendButton({ enabled, sending, tipKey, onSend }: { enabled: boolean; sending: boolean; tipKey: string; onSend: () => void }) {
  const t = useT()
  return (
    <LabelTooltip label={t(tipKey)} kbd="↵">
      <ButtonBase onClick={onSend} disabled={!enabled} aria-label={t('audioStudio.send.aria')} sx={{ display: 'grid', width: 36, height: 36, placeItems: 'center', borderRadius: '12px', transition: 'all 0.15s', backgroundColor: enabled ? 'var(--safe)' : 'var(--surface-3)', color: enabled ? 'var(--safe-ink)' : 'var(--faint)', boxShadow: enabled ? '0 0 24px -4px var(--safe-glow)' : 'none', '&:hover': enabled ? { filter: 'brightness(1.1)' } : {} }}>
        {sending ? <CircularProgress size={16} color="inherit" /> : <ArrowUpwardRounded sx={{ fontSize: 18 }} />}
      </ButtonBase>
    </LabelTooltip>
  )
}

function ComposerCard({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const t = useT()
  const composer = useAudioComposer(model, conversationId)
  const { draft, caps, language, params, voice, instruct, speakers, state } = composer
  const welcomeShown = !!useWelcomeModel('audio')
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    registerFocusTarget('composer', textarea.current)
    return () => registerFocusTarget('composer', null)
  }, [])
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [draft.prompt])

  return (
    <Box sx={{ position: 'relative', borderRadius: '22px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', transition: 'border-color 0.15s', '&:focus-within': { borderColor: 'var(--line-strong)' }, ...(hero ? { boxShadow: '0 30px 80px -30px var(--safe-glow)' } : {}) }}>
      {(caps.instruct || caps.design) && <InstructLine model={model} value={instruct} onChange={(value) => draft.setInstruct(model.id, value)} />}
      <Box component="textarea" ref={textarea} value={draft.prompt} rows={hero ? 4 : 2} aria-label={t('audioStudio.prompt.aria')} placeholder={t(caps.design ? 'audioStudio.prompt.placeholder.design' : 'audioStudio.prompt.placeholder')}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => draft.setPrompt(event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            composer.submit()
          }
        }}
        sx={{ display: 'block', width: '100%', resize: 'none', border: 0, background: 'transparent', px: 2.25, pb: '4px', pt: 2, fontFamily: 'inherit', fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', outline: 'none', '&::placeholder': { color: 'var(--faint)' } }} />
      <Counter composer={composer} />
      {composer.scriptActive && <CastPanel model={model} language={language} speakers={speakers} voiceOf={composer.castOf} onCast={draft.setCast} onPlainText={() => composer.setScriptMode(false)} />}
      {!composer.scriptMode && speakers.length >= 2 && (
        <Box sx={{ mx: 2.25, mb: 1, fontSize: 11.5, color: 'var(--faint)' }}>
          {t('audioStudio.cast.detected')} <InfoTip {...AUDIO_HELP.script} />{' '}
          <ButtonBase onClick={() => composer.setScriptMode(true)} sx={{ fontSize: 'inherit', color: 'inherit', textUnderlineOffset: '2px', '&:hover': { color: 'var(--ink)', textDecoration: 'underline' } }}>{t('audioStudio.cast.assign')}</ButtonBase>
        </Box>
      )}
      {model.compatible && !model.ready && !(hero && welcomeShown) && <SetupPrompt model={model} />}
      <Notices notices={composer.notices} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', px: 1.25, pb: 1.25, pt: '6px' }}>
        <ModelPicker model={model} />
        {!composer.scriptActive && <VoicePicker model={model} language={language} value={voice.ref} onChange={(value) => draft.setVoice(model.id, value)} />}
        <LanguagePicker caps={caps} value={language} onChange={(code) => draft.setLanguage(model.id, code)} />
        <GenerationParams model={model} params={params} hasRefs={false} seed={draft.seed} onChange={(patch) => draft.setParams(model.id, patch)} onReset={() => draft.resetParams(model.id)} onSeed={draft.setSeed} />
        <TakesPicker value={draft.count} onChange={draft.setCount} />
        <AutoplayToggle enabled={draft.autoplay} onChange={draft.setAutoplay} />
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' }, pr: '4px', fontSize: 11, color: 'var(--faint)' }}>{t('audioStudio.send.newline')}</Box>
        <SendButton enabled={state.canSend} sending={composer.sending} tipKey={state.tipKey} onSend={composer.submit} />
      </Box>
    </Box>
  )
}

/**
 * The audio composer: style (or voice description) line, the text (Enter sends, Shift+Enter a new line) with its length and
 * estimated duration, the cast of a dialogue, notices, then model, voice, language, settings and seed, number of takes,
 * autoplay and send. `conversationId` null (home page): sending creates the conversation and opens it. `hero`: the larger variant.
 */
export function AudioComposer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const t = useT()
  const model = useActiveModel('audio')
  const { isError } = useModels()
  if (!model || !model.audio) {
    return (
      <Box sx={{ display: 'flex', height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: '24px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', fontSize: 14, color: 'var(--muted)' }}>
        {isError ? t('audioStudio.composer.unreachable') : <CircularProgress size={18} color="inherit" />}
      </Box>
    )
  }
  return <ComposerCard model={model} conversationId={conversationId} hero={hero} />
}
