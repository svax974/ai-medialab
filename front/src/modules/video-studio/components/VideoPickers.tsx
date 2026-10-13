/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, Popover, Slider } from '@mui/material'
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded'
import AspectRatioOutlined from '@mui/icons-material/AspectRatioOutlined'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import type { ModelInfo } from '@/modules/model-catalog'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { HelpTooltip, ratioOf } from '@/modules/studio-core'
import { formatSeconds } from '@/modules/studio-core/lib/format'
import { frameCount, videoSize, VIDEO_ASPECTS } from '../lib/videoMath'
import { resolutionHelp, VIDEO_HELP } from '../lib/videoHelp'
import { MAX_CLIPS } from '../lib/sendRequest'

const ACCENT = 'color-mix(in oklab, var(--safe) 60%, transparent)'

const triggerSx = (open: boolean) => ({ display: 'flex', height: 32, gap: '6px', borderRadius: '8px', border: '1px solid', borderColor: open ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 13, color: open ? 'var(--ink)' : 'var(--ink-2)', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } })

/** The duration of the clip: a button with the length, opening a slider (steps of half a second) with the frames the model will really render. */
export function DurationPicker({ model, seconds, onChange }: { model: ModelInfo; seconds: number; onChange: (seconds: number) => void }) {
  const t = useT()
  const lang = useLang()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const caps = model.video!
  const frames = frameCount(seconds, caps)
  const actual = frames / caps.fps
  return (
    <>
      <HelpTooltip help={VIDEO_HELP.seconds}>
        <ButtonBase onClick={(event) => setAnchor(event.currentTarget)} aria-label={t('videoStudio.duration.aria')} aria-haspopup="dialog" aria-expanded={!!anchor} sx={triggerSx(!!anchor)}>
          <AccessTimeRounded sx={{ fontSize: 14 }} />
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{formatSeconds(seconds, lang)}</Box>
        </ButtonBase>
      </HelpTooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 320, maxWidth: 'calc(100vw - 24px)', p: 1.75, mt: -1 } } }}>
        <Box className="cn-eyebrow" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {t('videoStudio.duration.title')} <InfoTip {...VIDEO_HELP.seconds} />
        </Box>
        <Box sx={{ mb: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--ink)' }}>{formatSeconds(seconds, lang)}</Box>
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{t('videoStudio.duration.frames', [frames, caps.fps])}</Box>
        </Box>
        <Slider size="small" min={caps.min_seconds} max={Math.max(caps.max_seconds, caps.min_seconds + 0.5)} step={0.5} value={seconds} onChange={(_event, value) => onChange(value as number)} aria-label={t('videoStudio.duration.slider')} />
        <Box sx={{ mt: '6px', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>
          <span>{formatSeconds(caps.min_seconds, lang)}</span>
          <span>{formatSeconds(caps.max_seconds, lang)}</span>
        </Box>
        {Math.abs(actual - seconds) > 0.05 && <Box component="p" sx={{ m: 0, mt: 1, fontSize: 11, lineHeight: 1.4, color: 'var(--faint)' }}>{t('videoStudio.duration.steps', [formatSeconds(actual, lang)])}</Box>}
      </Popover>
    </>
  )
}

/** Rectangle drawn at the proportions of a format. */
function Shape({ ratio, active }: { ratio: number; active: boolean }) {
  const width = ratio >= 1 ? 22 : 22 * ratio
  const height = ratio >= 1 ? 22 / ratio : 22
  return (
    <Box component="span" sx={{ display: 'grid', width: 24, height: 24, placeItems: 'center' }}>
      <Box component="span" sx={{ width, height, borderRadius: '3px', border: '1.5px solid', borderColor: active ? 'var(--safe)' : 'currentColor', backgroundColor: active ? 'var(--safe-soft)' : 'transparent', transition: 'border-color 0.15s' }} />
    </Box>
  )
}

/** Format and definition: a button with the format and the definition, opening five format tiles, the definitions of the model and the resulting size. */
export function FormatPicker({ model, aspect, resolution, onChange }: { model: ModelInfo; aspect: string; resolution: string; onChange: (patch: { aspect?: string; resolution?: string }) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const caps = model.video!
  const res = caps.resolutions.find((candidate) => candidate.id === resolution)
  const size = videoSize(aspect, res)
  return (
    <>
      <HelpTooltip help={{ title: t('videoStudio.format.aria'), bodyId: VIDEO_HELP.resolution.bodyId, tipId: VIDEO_HELP.resolution.tipId }}>
        <ButtonBase onClick={(event) => setAnchor(event.currentTarget)} aria-label={t('videoStudio.format.aria')} aria-haspopup="dialog" aria-expanded={!!anchor} sx={triggerSx(!!anchor)}>
          <AspectRatioOutlined sx={{ fontSize: 14 }} />
          <span>{aspect}</span>
          {res && <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{res.label}</Box>}
        </ButtonBase>
      </HelpTooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 340, maxWidth: 'calc(100vw - 24px)', p: 1.5, mt: -1 } } }}>
        <Box className="cn-eyebrow" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {t('videoStudio.format.title')} <InfoTip {...VIDEO_HELP.aspect} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {VIDEO_ASPECTS.map((item) => {
            const active = aspect === item.id
            return (
              <ButtonBase key={item.id} onClick={() => onChange({ aspect: item.id })} aria-pressed={active} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '12px', border: '1px solid', px: '4px', py: 1, transition: 'border-color 0.15s, color 0.15s', borderColor: active ? ACCENT : 'var(--line)', backgroundColor: active ? 'var(--safe-soft)' : 'var(--surface)', color: active ? 'var(--ink)' : 'var(--muted)', '&:hover': { borderColor: active ? ACCENT : 'var(--line-strong)', color: 'var(--ink)' } }}>
                <Shape ratio={ratioOf(item.id) ?? 1} active={active} />
                <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1 }}>{item.id}</Box>
                <Box component="span" sx={{ fontSize: 10, lineHeight: 1, color: 'var(--faint)' }}>{t(item.labelKey)}</Box>
              </ButtonBase>
            )
          })}
        </Box>
        <Box className="cn-eyebrow" sx={{ mb: 1, mt: 2, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {t('videoStudio.format.definition')} <InfoTip {...resolutionHelp(caps, t)} />
        </Box>
        <Box sx={{ display: 'flex', gap: '4px', borderRadius: '12px', backgroundColor: 'var(--surface)', p: '4px', boxShadow: '0 0 0 1px var(--line)' }}>
          {caps.resolutions.map((item) => (
            <ButtonBase key={item.id} onClick={() => onChange({ resolution: item.id })} aria-pressed={item.id === resolution} sx={{ minWidth: 0, flex: 1, borderRadius: '8px', px: '4px', py: '6px', fontSize: 12, transition: 'background-color 0.15s, color 0.15s', backgroundColor: item.id === resolution ? 'var(--surface-3)' : 'transparent', color: item.id === resolution ? 'var(--ink)' : 'var(--muted)', '&:hover': { color: 'var(--ink)' } }}>
              {item.label}
            </ButtonBase>
          ))}
        </Box>
        {size && (
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>
            <span>{t('videoStudio.format.output')}</span>
            <Box component="span" sx={{ color: 'var(--ink-2)' }}>{t('videoStudio.format.size', [size.width, size.height])}</Box>
          </Box>
        )}
      </Popover>
    </>
  )
}

const COUNTS = Array.from({ length: MAX_CLIPS }, (_, index) => index + 1)

/** Number of clips to generate (1 or 2), each with its own seed. */
export function ClipCountPicker({ value, onChange }: { value: number; onChange: (count: number) => void }) {
  const t = useT()
  return (
    <HelpTooltip help={VIDEO_HELP.count}>
      <Box role="group" aria-label={t('videoStudio.count.aria')} sx={{ display: 'flex', height: 32, alignItems: 'center', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', p: '2px' }}>
        {COUNTS.map((count) => (
          <Box key={count} component="button" type="button" aria-pressed={value === count} onClick={() => onChange(count)} sx={{ height: '100%', width: 24, border: 0, borderRadius: '6px', fontFamily: 'var(--font-mono)', fontSize: 12, transition: 'background-color 0.15s, color 0.15s', backgroundColor: value === count ? 'var(--surface-3)' : 'transparent', color: value === count ? 'var(--ink)' : 'var(--faint)', '&:hover': { color: 'var(--ink)' } }}>{count}</Box>
        ))}
      </Box>
    </HelpTooltip>
  )
}
