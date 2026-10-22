/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase, CircularProgress, Tooltip } from '@mui/material'
import LockOutlined from '@mui/icons-material/LockOutlined'
import LockRounded from '@mui/icons-material/LockRounded'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { usePrivateSession } from '../hooks/usePrivateSession'
import { usePrivateStore } from '../state/privateStore'
import { PRIVATE_COLOR } from './privateTheme'

/**
 * « Private generation » entry of the sidebar footer. Off: asks for confirmation (the dialog lists what is and is not
 * kept). On: shows a lit lock; a click leaves (with confirmation). The tooltip says exactly what the mode does.
 */
export function PrivateToggle() {
  const t = useT()
  const { enter, leave } = usePrivateSession()
  const active = usePrivateStore((s) => s.active)
  const busy = usePrivateStore((s) => s.busy)
  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line', fontSize: 12, lineHeight: 1.5 }}>{t('private.toggle.tip')}</Box>} placement="right" enterDelay={400} slotProps={{ tooltip: { sx: { maxWidth: 340 } } }}>
      <span>
        <ButtonBase
          onClick={() => void (active ? leave() : enter())}
          disabled={busy}
          aria-pressed={active}
          aria-label={t(active ? 'private.toggle.leaveAria' : 'private.toggle.enterAria')}
          sx={{
            display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '10px', height: 36, width: '100%', px: 1.5, borderRadius: '12px',
            fontSize: 14, fontFamily: 'inherit', color: active ? PRIVATE_COLOR : 'var(--ink-2)',
            backgroundColor: active ? `color-mix(in oklab, ${PRIVATE_COLOR} 14%, transparent)` : 'transparent',
            transition: 'background-color 0.15s, color 0.15s',
            '&:hover': { backgroundColor: active ? `color-mix(in oklab, ${PRIVATE_COLOR} 22%, transparent)` : 'var(--surface-3)', color: active ? PRIVATE_COLOR : 'var(--ink)' },
          }}
        >
          {busy ? <CircularProgress size={14} color="inherit" /> : active ? <LockRounded sx={{ fontSize: 16 }} /> : <LockOutlined sx={{ fontSize: 16 }} />}
          {t(active ? 'private.toggle.on' : 'private.toggle.label')}
        </ButtonBase>
      </span>
    </Tooltip>
  )
}
