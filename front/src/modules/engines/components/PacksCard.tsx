/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import { IndeterminateBar } from '@/modules_shared/common/components/ui/progress'
import { type SystemInfo } from '@/modules/hardware'
import { Notice, Section, type ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useCancelInstall, useInstallPack } from '../hooks/useEngineInstaller'
import { packDot, packRows, selectInstall, type PackRow } from '../lib/installState'
import { useInstallStore } from '../state/installStore'
import { InstallRow } from './InstallRow'

interface PackActionsProps {
  row: PackRow
  /** A pack installation is running (only one at a time), and whether it is this one. */
  running: boolean
  mine: boolean
}

function PackActions({ row, running, mine }: PackActionsProps) {
  const t = useT()
  const install = useInstallPack()
  const cancel = useCancelInstall('pack')
  if (mine) {
    return (
      <Button variant="outlined" onClick={() => cancel.mutate()}>
        {t('engines.cancel')}
      </Button>
    )
  }
  if (!row.installed && row.installable && !running) {
    return (
      <Button variant="contained" startIcon={<CloudDownloadOutlined />} disabled={install.isPending} onClick={() => install.mutate(row.id)}>
        {t('engines.install', [row.sizeMb])}
      </Button>
    )
  }
  return null
}

/** The audio or video engines (packs, isolated Python environments installed on demand): install and cancel. */
export function PacksCard({ system, kind, models }: { system: SystemInfo; kind: 'audio' | 'video'; models: ModelInfo[] }) {
  const t = useT()
  const live = useInstallStore((s) => s.packInstall)
  const install = selectInstall(live, system.pack_install)
  const running = install.state === 'running'
  return (
    <Section title={t(kind === 'video' ? 'engines.video.title' : 'engines.audio.title')} hint={t('engines.packs.hint')}>
      <Box sx={{ display: 'grid', gap: 1.25 }}>
        {packRows(system.packs, models, kind).map((row) => (
          <InstallRow
            key={row.id}
            dot={packDot(row)}
            name={row.name}
            remark={row.installed ? t('engines.pack.installed') : row.installable ? t('engines.pack.notInstalled', [row.sizeMb]) : (row.reason ?? t('engines.unavailable'))}
            actions={<PackActions row={row} running={running} mine={running && install.pack === row.id} />}
          />
        ))}
      </Box>
      {running && <IndeterminateBar message={install.message} detail={install.detail} sinceEpochSeconds={install.started_at} />}
      {install.state === 'error' && (
        <Notice framed tone="danger" sx={{ mt: 1.5 }}>
          {install.error}
        </Notice>
      )}
    </Section>
  )
}
