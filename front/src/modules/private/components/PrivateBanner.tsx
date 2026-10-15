/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import LockRounded from '@mui/icons-material/LockRounded'
import { useLocation } from 'react-router-dom'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { matchStudioRoute } from '@/modules/studio-shell/lib/routes'
import { usePrivateSession } from '../hooks/usePrivateSession'
import { usePrivateStore } from '../state/privateStore'
import { ttlMinutes } from '../lib/ttl'
import { PRIVATE_COLOR } from './privateTheme'

/** Pages that list what is stored (the gallery and the libraries): empty in a private session (the chat has no library: its conversations live in the page). */
const LIBRARY_ROUTES: ReadonlySet<string> = new Set(['gallery', 'audio-library', 'video-library', 'voices'])

/**
 * Strip at the top of every page while the private mode is on: says that nothing is kept, how many results are held in
 * memory, and offers to erase everything now or to leave. Shown on top of a coloured frame (`PrivateFrame`).
 */
export function PrivateBanner() {
  const t = useT()
  const { leave, erase } = usePrivateSession()
  const active = usePrivateStore((s) => s.active)
  const busy = usePrivateStore((s) => s.busy)
  const info = usePrivateStore((s) => s.info)
  const { pathname } = useLocation()
  if (!active) return null
  const minutes = ttlMinutes(info)
  const route = matchStudioRoute(pathname)?.route.name
  const unavailable = route && LIBRARY_ROUTES.has(route) ? 'private.gallery.unavailable' : null
  return (
    <Box
      role="status"
      sx={{
        position: 'sticky', top: 0, zIndex: 40, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', px: 2, py: '6px', fontSize: 12.5,
        color: 'var(--ink)', backgroundColor: `color-mix(in oklab, ${PRIVATE_COLOR} 20%, var(--bg))`, borderBottom: `1px solid ${PRIVATE_COLOR}`,
      }}
    >
      <LockRounded sx={{ fontSize: 15, color: PRIVATE_COLOR }} />
      <Box component="span" sx={{ flex: 1, minWidth: 220 }}>
        <strong>{t('private.banner.title')}</strong> · {minutes ? t('private.banner.textTtl', [minutes]) : t('private.banner.text')}
      </Box>
      <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>{t('private.banner.results', [info?.results ?? 0])}</Box>
      <Button size="small" disabled={busy} onClick={() => void erase()} sx={{ fontSize: 12 }}>{t('private.banner.eraseNow')}</Button>
      <Button size="small" disabled={busy} onClick={() => void leave()} sx={{ fontSize: 12, color: PRIVATE_COLOR }}>{t('private.banner.leave')}</Button>
      {unavailable && <Box sx={{ flexBasis: '100%', fontSize: 12, color: 'var(--muted)' }}>{t(unavailable)}</Box>}
    </Box>
  )
}
