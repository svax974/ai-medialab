/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, Tooltip } from '@mui/material'
import KeyOutlined from '@mui/icons-material/KeyOutlined'
import VolumeUpOutlined from '@mui/icons-material/VolumeUpOutlined'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { HelpBody, InfoTip, helpTooltipSlotProps, type Help } from '@/modules_shared/common/components/ui/help'
import { useSettings } from '@/modules/settings'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { formatSeconds } from '../lib/catalogFormat'
import { MODEL_HELP, TASK_HELP_KEY, TASK_LABEL_KEY } from '../lib/modelHelp'
import type { ModelInfo } from '../types'
import { Tag } from './panels'

/** A badge that explains itself in a tooltip (hover, focus). */
export function HelpTag({ help, children, size = 'sm' }: { help: Help | { body: ReactNode }; children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <Tooltip title={<HelpBody {...help} />} placement="top" slotProps={helpTooltipSlotProps}>
      <span tabIndex={0}>
        <Tag size={size} help>
          {children}
        </Tag>
      </span>
    </Tooltip>
  )
}

/** What a video model can do: tasks, maximum length, definitions, sound, language. Nothing for other kinds. */
export function VideoBadges({ model }: { model: ModelInfo }) {
  const t = useT()
  const lang = useLang()
  const v = model.video
  if (!v) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
      {v.tasks.map((task) => (
        <HelpTag key={task} help={{ body: t(TASK_HELP_KEY[task]) }}>
          {t(TASK_LABEL_KEY[task])}
        </HelpTag>
      ))}
      <HelpTag help={MODEL_HELP.seconds}>{t('models.video.upTo', [formatSeconds(v.max_seconds, lang)])}</HelpTag>
      {v.resolutions.length > 0 && <HelpTag help={MODEL_HELP.resolution}>{v.resolutions.map((r) => r.label).join(' · ')}</HelpTag>}
      {v.audio_out && (
        <HelpTag help={MODEL_HELP.audioOut}>
          <VolumeUpOutlined sx={{ fontSize: 12 }} /> {t('models.video.withSound')}
        </HelpTag>
      )}
      {v.english_only && <HelpTag help={MODEL_HELP.englishOnly}>{t('models.video.english')}</HelpTag>}
    </Box>
  )
}

/** Licence restriction in warning tone; nothing when the model has none. */
export function LicenseWarning({ model, compact }: { model: ModelInfo; compact?: boolean }) {
  const t = useT()
  const text = model.video?.license_warning
  if (!text) return null
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, borderRadius: '12px', border: '1px solid color-mix(in oklab, var(--warn) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)', px: compact ? 1.25 : 1.5, py: compact ? '6px' : 1, fontSize: compact ? 11.5 : 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>
      <WarningAmberRounded sx={{ fontSize: 14, mt: '1px', flexShrink: 0, color: 'var(--warn)' }} />
      <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
        <Box component="b" sx={{ fontWeight: 500, color: 'var(--warn)' }}>
          {t('models.license.label')}
        </Box>{' '}
        {text}
      </Box>
      <InfoTip {...MODEL_HELP.license} />
    </Box>
  )
}

/** Gated Hugging Face files: what to do before downloading. Nothing for the other models. */
export function GatedNotice({ model, compact }: { model: ModelInfo; compact?: boolean }) {
  const t = useT()
  const { data: settings } = useSettings(model.gated)
  if (!model.gated) return null
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, borderRadius: '12px', border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-2)', px: compact ? 1.25 : 1.5, py: compact ? '6px' : 1, fontSize: compact ? 11.5 : 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>
      <KeyOutlined sx={{ fontSize: 14, mt: '1px', flexShrink: 0, color: 'var(--muted)' }} />
      <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
        <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>
          {t('models.gated.label')}
        </Box>{' '}
        {t('models.gated.message')}
        {settings && (
          <Box component="span" sx={{ color: settings.has_hf_token ? 'var(--ok)' : 'var(--warn)' }}>
            {' '}
            {t(settings.has_hf_token ? 'models.gated.hasToken' : 'models.gated.noToken')}
          </Box>
        )}
      </Box>
    </Box>
  )
}
