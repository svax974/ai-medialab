/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import PowerSettingsNewRounded from '@mui/icons-material/PowerSettingsNewRounded'
import { toast } from 'react-toastify'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useMemoryFeed } from '../hooks/useMemoryFeed'
import { gaugeTone, gaugeWidth, swapIsHeavy, type GaugeTone } from '../lib/memoryGauge'
import { formatGb } from '../lib/machine'
import { hardwareApi } from '../services/hardwareApi'

const TONE_COLOR: Record<GaugeTone, string> = { ok: 'var(--safe)', warn: 'var(--warn)', danger: 'var(--danger)' }

function EmergencyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const stop = () => {
    setBusy(true)
    hardwareApi
      .emergencyStop()
      .then((result) => toast.success(t('hardware.memory.stopped', [result.stopped.length, result.cancelled])))
      .catch((error: Error) => toast.error(error.message))
      .finally(() => {
        setBusy(false)
        onClose()
      })
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} aria-labelledby="emergency-title">
      <DialogTitle id="emergency-title">{t('hardware.memory.confirm.title')}</DialogTitle>
      <DialogContent sx={{ fontSize: 14, lineHeight: 1.6 }}>{t('hardware.memory.confirm.body')}</DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('hardware.memory.confirm.cancel')}</Button>
        <Button onClick={stop} disabled={busy} color="error" variant="contained" startIcon={<PowerSettingsNewRounded />}>{t('hardware.memory.confirm.stop')}</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Memory of the machine in the left panel: a gauge and the share in use, as the system itself counts it (on macOS Activity Monitor's
 * "Memory Used": app + wired + compressed, not the file cache), the system's pressure, the swap, the models held against their
 * ceiling, and the emergency stop that kills the running jobs and the models when things go wrong.
 */
export function MemoryMeter() {
  const t = useT()
  const lang = useLang()
  const sample = useMemoryFeed()
  const [confirm, setConfirm] = useState(false)
  if (!sample) return null
  const tone = gaugeTone(sample)
  const color = TONE_COLOR[tone]
  const { activity, budget } = sample
  const detail = sample.breakdown
    ? t('hardware.memory.breakdown', [formatGb(sample.breakdown.app, lang), formatGb(sample.breakdown.wired, lang), formatGb(sample.breakdown.compressed, lang)])
    : undefined
  return (
    <Box sx={{ borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', px: 1.5, py: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: '6px' }}>
        <Box className="cn-eyebrow">{t('hardware.memory.title')}</Box>
        <Box title={detail} sx={{ fontFamily: 'var(--font-mono)', fontSize: 13, color }}>{Math.round(sample.used_pct)} %</Box>
      </Box>
      <Box
        role="meter"
        aria-label={t('hardware.memory.aria')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sample.used_pct)}
        aria-valuetext={t('hardware.memory.valueText', [Math.round(sample.used_pct), t(`hardware.memory.pressure.${sample.pressure}`)])}
        sx={{ height: 6, overflow: 'hidden', borderRadius: 3, backgroundColor: 'var(--surface-3)' }}
      >
        <Box sx={{ height: '100%', width: `${gaugeWidth(sample.used_pct)}%`, borderRadius: 3, backgroundColor: color, transition: 'width 0.6s ease, background-color 0.3s' }} />
      </Box>
      <Box sx={{ mt: '6px', display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 11.5, color: 'var(--muted)' }}>
        <span>{t('hardware.memory.used', [formatGb(sample.used_gb, lang), formatGb(sample.total_gb, lang)])}</span>
        <Box component="span" sx={{ color: tone === 'ok' ? 'var(--muted)' : color }}>{t(`hardware.memory.pressure.${sample.pressure}`)}</Box>
      </Box>
      {(swapIsHeavy(sample) || sample.swap_used_gb >= 0.1) && (
        <Box sx={{ mt: '2px', fontSize: 11.5, color: swapIsHeavy(sample) ? 'var(--warn)' : 'var(--faint)' }}>
          {t('hardware.memory.swap', [formatGb(sample.swap_used_gb, lang)])}
        </Box>
      )}
      <Box sx={{ mt: '2px', fontSize: 11.5, color: 'var(--faint)' }}>
        {budget.models.length > 0
          ? t('hardware.memory.models', [formatGb(budget.used_gb, lang), formatGb(budget.ceiling_gb, lang), budget.models.map((m) => m.name).join(', ')])
          : t('hardware.memory.noModel')}
      </Box>
      <ButtonBase
        onClick={() => setConfirm(true)}
        disabled={!activity.can_stop}
        aria-label={t('hardware.memory.emergency.aria')}
        sx={{ mt: 1, display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: '6px', height: 30, borderRadius: '8px', border: '1px solid', borderColor: tone === 'ok' ? 'var(--line)' : 'var(--danger)', fontSize: 12.5, fontFamily: 'inherit', color: activity.can_stop ? 'var(--danger)' : 'var(--faint)', backgroundColor: tone === 'danger' && activity.can_stop ? 'color-mix(in oklab, var(--danger) 14%, transparent)' : 'transparent', transition: 'background-color 0.15s', '&:hover:not(:disabled)': { backgroundColor: 'color-mix(in oklab, var(--danger) 18%, transparent)' } }}
      >
        <PowerSettingsNewRounded sx={{ fontSize: 15 }} />
        {t('hardware.memory.emergency.label')}
      </ButtonBase>
      <EmergencyDialog open={confirm} onClose={() => setConfirm(false)} />
    </Box>
  )
}
