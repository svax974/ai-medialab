/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useRef } from 'react'
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import UploadRounded from '@mui/icons-material/UploadRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { AUDIO_ACCEPT } from '@/modules/media-library/lib/dropRules'
import { useVoiceStudio } from '../hooks/useVoiceStudio'
import { MAX_NAME_LENGTH, MAX_SAMPLE_SECONDS } from '../lib/voiceForm'
import { VOICE_HELP } from '../lib/voiceHelp'
import { readingFor, VOICE_LANGUAGES } from '../lib/reading'
import { recordDisabled, recordSubKey } from '../lib/recording'
import { useVoiceStudioStore } from '../state/voiceStudioStore'
import type { VoiceStudioTarget } from '../types'
import { RecordingPanel } from './RecordingPanel'
import { SamplePlayer } from './SamplePlayer'
import { inputSx } from '../lib/fieldStyles'
import { BigChoice, Field } from './StudioFields'
import { TranscriberInstall } from './TranscriberInstall'

function Tips() {
  const t = useT()
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12.5, color: 'var(--ink-2)' }}>
        {t('voices.studio.sample')} <InfoTip {...VOICE_HELP.sample} />
      </Box>
      <Box component="ul" sx={{ m: 0, mt: '-8px', display: 'grid', gap: '6px', listStyle: 'none', p: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--muted)' }}>
        {['voices.studio.tip.length', 'voices.studio.tip.clear', 'voices.studio.tip.consent'].map((key) => <li key={key}>· {t(key)}</li>)}
      </Box>
    </>
  )
}

function SourceStep({ studio }: { studio: ReturnType<typeof useVoiceStudio> }) {
  const t = useT()
  const picker = useRef<HTMLInputElement>(null)
  const { recorder, busy, draft } = studio
  if (recorder.state === 'recording') return <RecordingPanel seconds={recorder.seconds} level={recorder.level} onStop={recorder.stop} script={readingFor(draft.language)} />
  const sub = recordSubKey(recorder.state)
  return (
    <>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <BigChoice icon={<MicRounded sx={{ fontSize: 24 }} />} title={t('voices.studio.record')} sub={t(sub.key)} warn={sub.warn} disabled={recordDisabled(recorder.state)} onClick={() => void recorder.start()} />
        <BigChoice icon={busy === 'decode' ? <CircularProgress size={24} color="inherit" /> : <UploadRounded sx={{ fontSize: 24 }} />} title={t('voices.studio.import')} sub={t('voices.studio.import.sub')} onClick={() => picker.current?.click()} />
        <input ref={picker} type="file" accept={`${AUDIO_ACCEPT},video/mp4,video/webm`} hidden aria-label={t('voices.studio.import')} onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) void studio.load(picked, picked.name)
          event.target.value = ''
        }} />
      </Box>
      <Tips />
    </>
  )
}

function TranscriptField({ studio }: { studio: ReturnType<typeof useVoiceStudio> }) {
  const t = useT()
  const { draft, busy, recorded, prefilled, transcriberReady } = studio
  const action = transcriberReady ? (
    <Box component="button" type="button" onClick={() => void studio.transcribe()} disabled={!!busy} sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: 0, background: 'none', p: 0, fontFamily: 'inherit', fontSize: 12, color: 'var(--safe)', '&:hover': { filter: 'brightness(1.25)' }, '&:disabled': { opacity: 0.5 } }}>
      {busy === 'transcribe' ? <CircularProgress size={12} color="inherit" /> : <AutoAwesomeRounded sx={{ fontSize: 14 }} />} {t('voices.transcript.auto')}
    </Box>
  ) : (
    <Box component="span" sx={{ fontSize: 11.5, color: 'var(--faint)' }}>{t('voices.transcript.noModel')} · <TranscriberInstall /></Box>
  )
  return (
    <Field label={t('voices.transcript.label')} hint={t('voices.transcript.hint')} help={VOICE_HELP.transcript} action={action}>
      <Box component="textarea" value={draft.transcript} rows={4} placeholder={t('voices.transcript.placeholder')} aria-label={t('voices.transcript.label')} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => studio.patchDraft({ transcript: event.target.value })} sx={{ ...inputSx, height: 'auto', resize: 'none', py: 1, lineHeight: 1.6 }} />
      {(recorded || prefilled) && draft.transcript && <Box component="p" sx={{ m: 0, mt: '4px', fontSize: 11.5, color: 'var(--faint)' }}>{t(prefilled ? 'voices.transcript.transcribed' : 'voices.transcript.prefilled')}</Box>}
    </Field>
  )
}

function Editor({ studio, voiceId, onClose }: { studio: ReturnType<typeof useVoiceStudio>; voiceId?: string; onClose: () => void }) {
  const t = useT()
  const { draft, sample, preview, busy } = studio
  return (
    <>
      <SamplePlayer id={`studio-${studio.savedId ?? 'new'}`} url={sample.url} peaks={sample.peaks} duration={sample.duration} />
      {preview && !voiceId && !studio.savedId && (
        <Box component="button" type="button" onClick={studio.discardSample} sx={{ alignSelf: 'start', border: 0, background: 'none', p: 0, fontFamily: 'inherit', fontSize: 12, color: 'var(--faint)', textUnderlineOffset: '2px', '&:hover': { color: 'var(--ink)', textDecoration: 'underline' } }}>{t('voices.studio.another')}</Box>
      )}
      {sample.duration > MAX_SAMPLE_SECONDS && <Box component="p" sx={{ m: 0, fontSize: 12, color: 'var(--warn)' }}>{t('voices.studio.tooLong', [MAX_SAMPLE_SECONDS])}</Box>}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 170px' } }}>
        <Field label={t('voices.studio.name')}>
          <Box component="input" value={draft.name} maxLength={MAX_NAME_LENGTH} placeholder={t('voices.studio.name.placeholder')} aria-label={t('voices.studio.name')} onChange={(event: React.ChangeEvent<HTMLInputElement>) => studio.patchDraft({ name: event.target.value })} sx={inputSx} />
        </Field>
        <Field label={t('voices.studio.language')} help={VOICE_HELP.language}>
          <Box component="select" value={draft.language} aria-label={t('voices.studio.language')} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => studio.patchDraft({ language: event.target.value })} sx={{ ...inputSx, pr: 1 }}>
            {VOICE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </Box>
        </Field>
      </Box>
      <TranscriptField studio={studio} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, pt: '4px' }}>
        <Button variant="text" color="inherit" onClick={onClose}>{t('voices.studio.cancel')}</Button>
        <Button variant="contained" disabled={!studio.canSave} onClick={() => void studio.save()} startIcon={busy === 'save' ? <CircularProgress size={14} color="inherit" /> : undefined}>
          {voiceId ? t('voices.studio.save') : t('voices.studio.add')}
        </Button>
      </Box>
    </>
  )
}

function Studio({ target, onClose }: { target: VoiceStudioTarget; onClose: () => void }) {
  const t = useT()
  const studio = useVoiceStudio(target, onClose)
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id="voice-studio-title" sx={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 28 }}>{target.voiceId ? t('voices.studio.title.edit') : t('voices.studio.title.new')}</DialogTitle>
        <TipIconButton labelId="voices.studio.close" onClick={onClose} sx={{ borderRadius: '8px' }}><CloseRounded sx={{ fontSize: 16 }} /></TipIconButton>
      </Box>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2.5 }}>
          {studio.hasAudio ? <Editor studio={studio} voiceId={target.voiceId} onClose={onClose} /> : <SourceStep studio={studio} />}
        </Box>
      </DialogContent>
    </>
  )
}

/**
 * The voice studio: record with a text to read, import a file, then name the voice, say its language and write or fetch
 * (automatically, then editable) the transcript of the sample; or edit an existing voice. Opened by `useVoiceStudioStore`
 * (mounted once by the shell).
 */
export function VoiceStudioDialog() {
  const target = useVoiceStudioStore((s) => s.target)
  const close = useVoiceStudioStore((s) => s.close)
  return (
    <Dialog open={!!target} onClose={close} fullWidth aria-labelledby="voice-studio-title" slotProps={{ paper: { sx: { maxWidth: 600, maxHeight: 'min(780px, 92vh)' } } }}>
      {target && <Studio key={target.voiceId ?? 'new'} target={target} onClose={close} />}
    </Dialog>
  )
}
