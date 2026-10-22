/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { InfoTip, type Help } from '@/modules_shared/common/components/ui/help'

/** A labelled field: label with its "?" tip, an optional action on the right, the control, an optional hint. */
export function Field({ label, hint, help, action, children }: { label: string; hint?: string; help?: Help; action?: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Box sx={{ mb: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 12.5, color: 'var(--ink-2)' }}>
          {label} {help && <InfoTip {...help} />}
        </Box>
        {action}
      </Box>
      {children}
      {hint && <Box component="p" sx={{ m: 0, mt: '4px', fontSize: 11.5, lineHeight: 1.35, color: 'var(--faint)' }}>{hint}</Box>}
    </Box>
  )
}

/** A big choice of the first step (record / import): icon, title and one line. */
export function BigChoice({ icon, title, sub, onClick, disabled, warn }: { icon: ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean; warn?: boolean }) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={disabled} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1.5, borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface-2) 60%, transparent)', p: 2, textAlign: 'left', color: 'inherit', fontFamily: 'inherit', transition: 'border-color 0.15s, background-color 0.15s', '&:hover:not(:disabled)': { borderColor: 'color-mix(in oklab, var(--safe) 50%, transparent)', backgroundColor: 'var(--safe-soft)' }, '&:hover:not(:disabled) .icon': { backgroundColor: 'var(--safe)', color: 'var(--safe-ink)' }, '&:disabled': { opacity: 0.5 } }}>
      <Box className="icon" component="span" sx={{ display: 'grid', width: 44, height: 44, placeItems: 'center', borderRadius: '12px', backgroundColor: 'var(--surface-3)', color: 'var(--ink-2)', transition: 'background-color 0.15s, color 0.15s' }}>{icon}</Box>
      <Box component="span">
        <Box component="span" sx={{ display: 'block', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{title}</Box>
        <Box component="span" sx={{ mt: '2px', display: 'block', fontSize: 12, lineHeight: 1.35, color: warn ? 'var(--warn)' : 'var(--muted)' }}>{sub}</Box>
      </Box>
    </Box>
  )
}
