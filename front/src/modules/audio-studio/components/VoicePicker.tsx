/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, Popover } from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import { Waveform } from '@/modules_shared/common/components/ui/media'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import type { ModelInfo } from '@/modules/model-catalog'
import { HelpTooltip } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useVoices, useVoiceStudioStore, VoiceAvatar, type VoiceRef } from '@/modules/voices'
import { AUDIO_HELP } from '../lib/audioHelp'
import { effectiveVoice, presetsFor } from '../lib/voiceChoice'

interface Props {
  model: ModelInfo
  language: string
  value: VoiceRef | undefined
  onChange: (voice: VoiceRef) => void
  /** Smaller button with the character's name in front (the cast of a dialogue). */
  compact?: boolean
  label?: string
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <ButtonBase onClick={onClick} sx={{ display: 'flex', height: 32, flex: 1, alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '8px', fontSize: 12.5, transition: 'background-color 0.15s, color 0.15s', backgroundColor: active ? 'var(--surface-3)' : 'transparent', color: active ? 'var(--ink)' : 'var(--muted)', '&:hover': { color: 'var(--ink)' } }}>{children}</ButtonBase>
  )
}

function Row({ selected, onSelect, avatar, title, sub, tag, extra, disabled }: { selected: boolean; onSelect: () => void; avatar: React.ReactNode; title: string; sub?: string; tag?: string; extra?: React.ReactNode; disabled?: boolean }) {
  return (
    <ButtonBase disabled={disabled} onClick={onSelect} sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1.5, borderRadius: '12px', px: 1.25, py: 1, textAlign: 'left', backgroundColor: selected ? 'color-mix(in oklab, var(--surface-3) 70%, transparent)' : 'transparent', '&:hover': { backgroundColor: 'var(--surface-3)' }, '&:disabled': { opacity: 0.4 } }}>
      {avatar}
      <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 13.5, color: 'var(--ink)' }}>{title}{tag && <Box component="span" sx={{ fontSize: 11, color: 'var(--faint)' }}>{tag}</Box>}</Box>
        {sub && <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, lineHeight: 1.35, color: 'var(--muted)' }}>{sub}</Box>}
      </Box>
      {extra}
      <Box component="span" sx={{ display: 'grid', width: 16, height: 16, flexShrink: 0, placeItems: 'center' }}>{selected && <CheckRounded sx={{ fontSize: 16, color: 'var(--safe)' }} />}</Box>
    </ButtonBase>
  )
}

/** Voice of a model that invents it from a description: no choice, a reminder that the description is above. */
function DesignedVoice() {
  const t = useT()
  return (
    <HelpTooltip help={AUDIO_HELP.instructDesign}>
      <Box component="span" tabIndex={0} sx={{ display: 'flex', height: 32, alignItems: 'center', gap: '6px', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 13, color: 'var(--ink-2)' }}>
        <AutoAwesomeRounded sx={{ fontSize: 14, color: 'var(--safe)' }} /> {t('audioStudio.voice.described')}
      </Box>
    </HelpTooltip>
  )
}

/**
 * The voice of the text: a button with the current voice opening two tabs, the model's built-in voices for the language and
 * "My voices" (cloned or designed; disabled with a warning when the model cannot clone), and a link to record or import one.
 * A model that invents the voice shows a reminder instead.
 */
export function VoicePicker({ model, language, value, onChange, compact = false, label }: Props) {
  const t = useT()
  const caps = model.audio!
  const { data: library } = useVoices()
  const openStudio = useVoiceStudioStore((s) => s.open)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [tab, setTab] = useState<'model' | 'library'>(value?.source === 'library' ? 'library' : 'model')
  if (caps.design) return <DesignedVoice />
  const current = effectiveVoice(caps, value, language, library)
  const presets = presetsFor(caps, language)
  const canClone = caps.clone !== 'none'
  const choose = (voice: VoiceRef) => {
    onChange(voice)
    setAnchor(null)
  }
  const name = current.name || (canClone ? t('audioStudio.voice.choose') : '—')
  return (
    <>
      <HelpTooltip help={AUDIO_HELP.voice}>
        <ButtonBase onClick={(event) => setAnchor(event.currentTarget)} aria-haspopup="dialog" sx={{ display: 'flex', height: 32, maxWidth: 208, alignItems: 'center', gap: 1, borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', pl: '6px', pr: compact ? 1 : 1.25, fontSize: 13, color: anchor ? 'var(--ink)' : 'var(--ink-2)', borderColor: anchor ? 'var(--line-strong)' : 'var(--line)', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}>
          <VoiceAvatar name={name} size={20} library={current.ref?.source === 'library'} />
          {label && <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--faint)' }}>{label}</Box>}
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Box>
          <ExpandMoreRounded sx={{ fontSize: 14, flexShrink: 0, opacity: 0.6 }} />
        </ButtonBase>
      </HelpTooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { mt: -1, width: 390, maxWidth: 'calc(100vw - 24px)' } } }}>
        <Box sx={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--line)', p: 1 }}>
          <Tab active={tab === 'model'} onClick={() => setTab('model')}>{t('audioStudio.voice.tab.model')} <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{presets.length}</Box></Tab>
          <Tab active={tab === 'library'} onClick={() => setTab('library')}>{t('audioStudio.voice.tab.library')} <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{library?.length ?? 0}</Box></Tab>
        </Box>
        <Box sx={{ maxHeight: 320, overflowY: 'auto', p: '6px' }}>
          {tab === 'model' && (
            <>
              {presets.length === 0 && <Box sx={{ px: 1.5, py: 3, textAlign: 'center', fontSize: 12.5, lineHeight: 1.6, color: 'var(--faint)' }}>{canClone ? t('audioStudio.voice.noPresetClone') : t('audioStudio.voice.noPreset')}</Box>}
              {presets.map((preset) => (
                <Row key={preset.id} selected={current.ref?.source === 'preset' && current.ref.id === preset.id} onSelect={() => choose({ source: 'preset', id: preset.id })} avatar={<VoiceAvatar name={preset.name} />} title={preset.name} sub={preset.description} tag={preset.gender === 'f' ? '♀' : preset.gender === 'm' ? '♂' : undefined} />
              ))}
            </>
          )}
          {tab === 'library' && (
            <>
              {!canClone && <Box sx={{ px: 1.5, py: 2, textAlign: 'center', fontSize: 12.5, lineHeight: 1.6, color: 'var(--warn)' }}>{t('audioStudio.voice.cannotClone', [model.name])}</Box>}
              {library?.length === 0 && <Box sx={{ px: 1.5, py: 3, textAlign: 'center', fontSize: 12.5, lineHeight: 1.6, color: 'var(--faint)' }}>{t('audioStudio.voice.emptyLibrary')}</Box>}
              {library?.map((voice) => (
                <Row key={voice.id} disabled={!canClone} selected={current.ref?.source === 'library' && current.ref.id === voice.id} onSelect={() => choose({ source: 'library', id: voice.id })} avatar={<VoiceAvatar name={voice.name} library />} title={voice.name}
                  sub={[t(voice.kind === 'design' ? 'voices.card.kind.design' : 'voices.card.kind.clone'), voice.duration ? formatClock(voice.duration) : null, voice.transcript ? null : t('voices.card.noTranscript')].filter(Boolean).join(' · ')}
                  extra={<Box sx={{ width: 80, opacity: 0.7 }}><Waveform peaks={voice.peaks} height={20} /></Box>} />
              ))}
            </>
          )}
        </Box>
        <Box sx={{ borderTop: '1px solid var(--line)', p: '6px' }}>
          <ButtonBase onClick={() => { setAnchor(null); openStudio() }} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1.25, borderRadius: '8px', px: 1.25, py: 1, fontSize: 13.5, color: 'var(--ink-2)', '&:hover': { backgroundColor: 'var(--surface-3)', color: 'var(--ink)' } }}>
            <AddRounded sx={{ fontSize: 16 }} /> {t('audioStudio.voice.record')}
          </ButtonBase>
        </Box>
      </Popover>
    </>
  )
}
