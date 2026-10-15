/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, ToggleButton, ToggleButtonGroup } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { DEFAULT_WINDOW, markSeen, readSeen, WINDOWS } from '../lib/whatsNew'
import { useRefreshWhatsNew, useWhatsNew } from '../hooks/useWhatsNew'
import type { TrendingKind } from '../types'
import { Notice } from './panels'
import { WhatsNewRow } from './WhatsNewRow'

interface Props {
  kind: TrendingKind
  open: boolean
  onClose: () => void
}

/** When the engine read the Hub, as « 12 min » / « 3 h » (it keeps its answer for an hour). */
function minutesAgo(epochSeconds: number): number {
  return Math.max(0, Math.round((Date.now() / 1000 - epochSeconds) / 60))
}

/**
 * « What's new »: recent Hugging Face models of a kind that have had success and that this machine can run (ranked by the
 * Hub's own signals, no language model), each with an "Add" that uses the add flow of the Hugging Face search.
 */
export function WhatsNewDialog({ kind, open, onClose }: Props) {
  const t = useT()
  const [days, setDays] = useState<number>(DEFAULT_WINDOW)
  const [heavy, setHeavy] = useState(false)
  const [seenBefore] = useState(() => readSeen(kind))
  const query = useWhatsNew(kind, { days, includeHeavy: heavy, enabled: open })
  const refresh = useRefreshWhatsNew(kind, { days, includeHeavy: heavy })
  useEffect(() => {
    if (open) markSeen(kind)
  }, [open, kind])
  const data = query.data
  const busy = query.isFetching || refresh.isPending
  return (
    <Dialog open={open} onClose={onClose} fullWidth aria-labelledby="whatsnew-title" slotProps={{ paper: { sx: { maxWidth: 720 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id="whatsnew-title">{t('models.new.title', [t(`models.new.kind.${kind}`)])}</DialogTitle>
        <TipIconButton labelId="models.close" onClick={onClose} sx={{ borderRadius: '8px' }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 1.75 }}>
          <Box component="p" sx={{ m: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>{t('models.new.intro', [days])}</Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <ToggleButtonGroup size="small" exclusive value={days} aria-label={t('models.new.window')} onChange={(_event, value: number | null) => value && setDays(value)}>
              {[...WINDOWS].sort((a, b) => a - b).map((w) => (
                <ToggleButton key={w} value={w} sx={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>{t('models.new.window.days', [w])}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, fontSize: 11.5, color: 'var(--faint)' }}>
              {data && <span>{t('models.new.updated', [minutesAgo(data.generated_at)])}</span>}
              <Button size="small" variant="text" disabled={busy} onClick={() => refresh.mutate()} startIcon={busy ? <CircularProgress size={12} /> : <RefreshRounded sx={{ fontSize: 14 }} />}>
                {t('models.new.refresh')}
              </Button>
            </Box>
          </Box>

          {query.isPending && (
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 3, justifyContent: 'center', fontSize: 13, color: 'var(--muted)' }}>
              <CircularProgress size={16} /> {t('models.new.loading')}
            </Box>
          )}
          {(query.isError || refresh.isError) && (
            <Notice framed tone="danger">
              {((query.error ?? refresh.error) as Error).message}
              <Button size="small" variant="text" sx={{ ml: 1 }} onClick={() => (query.isError ? void query.refetch() : refresh.mutate())}>{t('models.retry')}</Button>
            </Notice>
          )}
          {data && data.results.length === 0 && (
            <Box sx={{ py: 2, textAlign: 'center' }}>
              <Box component="p" sx={{ m: 0, fontSize: 13, color: 'var(--muted)' }}>{t('models.new.empty', [days])}</Box>
              <Box component="p" sx={{ m: 0, mt: '6px', fontSize: 12, lineHeight: 1.5, color: 'var(--faint)' }}>{t('models.new.emptyHint')}</Box>
            </Box>
          )}
          {data && data.results.length > 0 && (
            <Box component="ul" aria-label={t('models.new.list')} sx={{ m: 0, p: 0, display: 'grid', gap: '8px' }}>
              {data.results.map((entry) => (
                <WhatsNewRow key={entry.repo} entry={entry} isNew={Date.parse(entry.created_at) > seenBefore} />
              ))}
            </Box>
          )}
          {data && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, fontSize: 12, color: 'var(--faint)' }}>
              {(data.hidden.heavy > 0 || heavy) && (
                <Button size="small" variant="text" onClick={() => setHeavy(!heavy)} startIcon={heavy ? <VisibilityOffOutlined sx={{ fontSize: 16 }} /> : <VisibilityOutlined sx={{ fontSize: 16 }} />}>
                  {heavy ? t('models.new.hideHeavy') : t('models.new.showHeavy', [data.hidden.heavy])}
                </Button>
              )}
              {data.hidden.existing > 0 && <span>{t('models.new.existing', [data.hidden.existing])}</span>}
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  )
}
