/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Tooltip } from '@mui/material'
import { helpTooltipSlotProps } from '@/modules_shared/common/components/ui/help'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import type { ContextUsage } from '../lib/context'

const COLOR = { ok: 'var(--safe)', warn: 'var(--warn)', full: 'var(--danger)' } as const

const compact = (n: number, lang: string) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** How full the context is: a thin bar and `used / limit`, in warning colours from 75 % (tooltip: what happens when it is full). */
export function ContextGauge({ usage, draftTokens }: { usage: ContextUsage; draftTokens: number }) {
  const t = useT()
  const lang = useLang()
  const percent = Math.min(100, Math.round(usage.ratio * 100))
  const label = t('chat.context.gauge', [compact(usage.used, lang), compact(usage.limit, lang), percent])
  return (
    <Tooltip title={<Box>{t('chat.context.tip')}{draftTokens > 0 ? ` ${t('chat.context.draft', [draftTokens])}` : ''}</Box>} placement="top" slotProps={helpTooltipSlotProps}>
      <Box role="meter" tabIndex={0} aria-label={t('chat.context.aria')} aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={Math.min(usage.used, usage.limit)} aria-valuetext={label} sx={{ display: 'flex', alignItems: 'center', gap: '6px', height: 32, px: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: usage.level === 'ok' ? 'var(--faint)' : COLOR[usage.level] }}>
        <Box aria-hidden sx={{ width: 36, height: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: 'var(--surface-3)' }}>
          <Box sx={{ width: `${percent}%`, height: '100%', backgroundColor: COLOR[usage.level], transition: 'width 0.2s' }} />
        </Box>
        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{label}</Box>
      </Box>
    </Tooltip>
  )
}
