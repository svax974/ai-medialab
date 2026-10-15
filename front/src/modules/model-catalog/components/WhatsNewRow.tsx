/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, CircularProgress } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import DownloadRounded from '@mui/icons-material/DownloadRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import { ProgressBar } from '@/modules_shared/common/components/ui/progress'
import { formatGb } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { activeDownload } from '../lib/downloads'
import { compactCount } from '../lib/hubSearch'
import { ageOf, downloadGb, licenseNoteKey, toHubResult } from '../lib/whatsNew'
import { useAddCustomModel } from '../hooks/useHubSearch'
import { useDownloadStore } from '../state/downloadStore'
import type { TrendingEntry } from '../types'
import { Detail } from './HubSearch'
import { Notice, Tag } from './panels'

const MONO = 'var(--font-mono, monospace)'

function Facts({ entry, isNew }: { entry: TrendingEntry; isNew: boolean }) {
  const t = useT()
  const lang = useLang()
  const age = ageOf(entry.age_days)
  const size = downloadGb(entry.option)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontFamily: MONO, fontSize: 10.5, color: 'var(--faint)' }}>
      {isNew && <Tag tone="ok" pill>{t('models.new.row.new')}</Tag>}
      <Tag>{entry.family_label}</Tag>
      {entry.option?.label && <Box component="span" sx={{ color: 'var(--ink-2)' }}>{entry.option.label}</Box>}
      {size != null && size > 0 && <span>≈ {t('models.size.gb', [formatGb(size, lang)])}</span>}
      <span>· {t(`models.new.age.${age.unit}`, [age.count])}</span>
      <span>· {t('models.new.stats.downloads', [compactCount(entry.downloads, lang)])}</span>
      <span>· {t('models.new.stats.likes', [compactCount(entry.likes, lang)])}</span>
      <span>· {t('models.hub.license')} {entry.license || t('models.hub.seeRepo')}</span>
      {entry.license_note && <Tag tone="warn" title={t(licenseNoteKey(entry.license_note))}>{t(`models.new.license.${entry.license_note}.short`)}</Tag>}
      {!entry.compatible && <Tag tone="danger" title={entry.reason || undefined}>{t('models.new.row.tooHeavy')}</Tag>}
    </Box>
  )
}

/** The "Add" action: the add flow of the Hugging Face search with its default variant, then the progress of the download it started. */
function AddAction({ entry }: { entry: TrendingEntry }) {
  const t = useT()
  const add = useAddCustomModel(entry.repo)
  const live = useDownloadStore((s) => (add.data ? s.downloads[add.data] : undefined))
  const download = activeDownload(live, { download: null })
  const key = entry.option?.key
  if (add.isSuccess) {
    return (
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12.5, color: 'var(--ok)' }}>
          <CheckRounded sx={{ fontSize: 14 }} /> {t(download ? 'models.new.row.downloading' : 'models.new.row.added')}
        </Box>
        {download && <ProgressBar done={download.done} total={download.total} rate={download.rate} etaSeconds={download.eta} />}
      </Box>
    )
  }
  const blocked = !entry.compatible || !key
  return (
    <Button variant="contained" size="small" disabled={blocked || add.isPending} onClick={() => key && add.mutate(key)}
      startIcon={add.isPending ? <CircularProgress size={14} /> : <DownloadRounded />}>
      {t('models.new.row.add')}
    </Button>
  )
}

/** One new model: its facts, the add action (default variant), the variants (the detail of the search) and the link to Hugging Face. */
export function WhatsNewRow({ entry, isNew }: { entry: TrendingEntry; isNew: boolean }) {
  const t = useT()
  const [variants, setVariants] = useState(false)
  return (
    <Box component="li" sx={{ listStyle: 'none', borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', opacity: entry.compatible ? 1 : 0.8 }}>
      <Box sx={{ display: 'grid', gap: '6px', px: 1.5, py: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, color: 'var(--ink)' }}>{entry.name}</Box>
          <Box component="span" sx={{ flexShrink: 0, fontFamily: MONO, fontSize: 10.5, color: 'var(--faint)' }}>{entry.author}</Box>
        </Box>
        <Facts entry={entry} isNew={isNew} />
        {!entry.compatible && entry.reason && <Notice tone="warn" sx={{ fontSize: 12 }}>{entry.reason}</Notice>}
        {entry.option?.fit_note && entry.compatible && <Notice sx={{ fontSize: 12 }}>{entry.option.fit_note}</Notice>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <AddAction entry={entry} />
          {entry.options > 1 && (
            <Button size="small" variant="text" aria-expanded={variants} onClick={() => setVariants(!variants)} endIcon={<ExpandMoreRounded sx={{ transform: variants ? 'rotate(180deg)' : 'none' }} />}>
              {t('models.new.row.variants', [entry.options])}
            </Button>
          )}
          <Box component="a" href={entry.url} target="_blank" rel="noreferrer" sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12, color: 'var(--muted)', textDecoration: 'none', '&:hover': { color: 'var(--ink)' } }}>
            <OpenInNewRounded sx={{ fontSize: 14 }} /> {t('models.hub.openLink')}
          </Box>
        </Box>
      </Box>
      {variants && <Detail result={toHubResult(entry)} />}
    </Box>
  )
}
