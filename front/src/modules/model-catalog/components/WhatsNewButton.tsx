/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { memo, useEffect, useState } from 'react'
import { Box, Tooltip } from '@mui/material'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { DEFAULT_WINDOW, newSince, readSeen } from '../lib/whatsNew'
import { useWhatsNew } from '../hooks/useWhatsNew'
import type { TrendingKind } from '../types'
import { WhatsNewDialog } from './WhatsNewDialog'

/** The badge reads the list a few seconds after the page appears, so that opening a page never waits for the Hub. */
const BADGE_DELAY_MS = 3000

/**
 * « What's new ? » button of a page: opens the list of recent, successful models of its kind (image, audio, video or llm)
 * that this machine can run. A dot tells when some appeared since the list was last opened (kept in the browser, per kind).
 */
export const WhatsNewButton = memo(function WhatsNewButton({ kind }: { kind: TrendingKind }) {
  // Scoped out for v1: "diagram" models are the same GGUF chat checkpoints under another catalog entry (see
  // engine/app/engines/diagram_models.py), not their own Hugging Face family to search or rank by novelty. Every
  // hook below still runs (never make a hook conditional): `enabled: armed` below just keeps it from ever fetching.
  const scoped = kind !== 'diagram' && kind !== 'ocr'
  const t = useT()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(() => readSeen(kind))
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), BADGE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => setSeen(readSeen(kind)), [kind])
  const { data } = useWhatsNew(kind, { days: DEFAULT_WINDOW, enabled: armed && scoped })
  const fresh = data ? newSince(data.results, seen) : 0
  const close = () => {
    setOpen(false)
    setSeen(readSeen(kind))
  }
  if (!scoped) return null
  return (
    <>
      <Tooltip title={t('models.new.tip')} placement="top" enterDelay={350}>
        <Box
          component="button"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={fresh > 0 ? t('models.new.aria.fresh', [fresh]) : t('models.new.aria')}
          onClick={() => setOpen(true)}
          sx={{ position: 'relative', display: 'flex', height: 32, alignItems: 'center', gap: '6px', px: 1.25, borderRadius: '8px', border: '1px solid', borderColor: open ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'var(--surface-2)', color: open ? 'var(--ink)' : 'var(--ink-2)', fontSize: 13, cursor: 'pointer', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}
        >
          <AutoAwesomeOutlined sx={{ fontSize: 14, color: 'var(--safe)' }} />
          <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{t('models.new.button')}</Box>
          {fresh > 0 && <Box component="span" aria-hidden sx={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--safe)', boxShadow: '0 0 8px var(--safe-glow, var(--safe))' }} />}
        </Box>
      </Tooltip>
      {open && <WhatsNewDialog kind={kind} open={open} onClose={close} />}
    </>
  )
})
