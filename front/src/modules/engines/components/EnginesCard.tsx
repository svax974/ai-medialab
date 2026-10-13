/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import { ProgressBar } from '@/modules_shared/common/components/ui/progress'
import { type SystemInfo } from '@/modules/hardware'
import { Notice, Section } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useCancelInstall, useInstallSdcpp } from '../hooks/useEngineInstaller'
import { engineDot, engineRows, selectInstall } from '../lib/installState'
import { useInstallStore } from '../state/installStore'
import { InstallRow } from './InstallRow'

const DEVICE_LABEL: Record<string, string> = { metal: 'Metal', cuda: 'CUDA', rocm: 'ROCm', vulkan: 'Vulkan', cpu: 'CPU' }

/** The image engines (GGUF, MLX, PyTorch): what is available, and installing stable-diffusion.cpp with its progress. */
export function EnginesCard({ system }: { system: SystemInfo }) {
  const t = useT()
  const live = useInstallStore((s) => s.engineInstall)
  const install = selectInstall(live, system.engines.sdcpp?.install)
  const start = useInstallSdcpp()
  const cancel = useCancelInstall('sdcpp')
  const running = install.state === 'running'
  return (
    <Section title={t('engines.image.title')}>
      <Box sx={{ display: 'grid', gap: 1.25 }}>
        {engineRows(system.engines).map((row) => {
          const hint = t(`engines.engine.${row.id}.hint`)
          return (
            <InstallRow
              key={row.id}
              dot={engineDot(row)}
              name={t(`engines.engine.${row.id}.name`)}
              extra={row.available && row.variant ? <Box component="span" sx={{ ml: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--muted)' }}>{DEVICE_LABEL[row.variant] ?? row.variant}</Box> : undefined}
              remark={row.available ? hint : row.installable ? t('engines.notInstalledHint', [hint]) : (row.reason ?? t('engines.unavailable'))}
              actions={
                row.installable && !running ? (
                  <Button variant="contained" startIcon={<CloudDownloadOutlined />} disabled={start.isPending} onClick={() => start.mutate()}>
                    {t('engines.install', [row.installSizeMb ?? 0])}
                  </Button>
                ) : row.id === 'sdcpp' && running ? (
                  <Button variant="outlined" onClick={() => cancel.mutate()}>
                    {t('engines.cancel')}
                  </Button>
                ) : undefined
              }
            />
          )
        })}
      </Box>
      {running && (
        <>
          <ProgressBar done={install.done ?? 0} total={install.total ?? 0} />
          <Box component="p" sx={{ m: 0, mt: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--faint)' }}>
            {install.message}
          </Box>
        </>
      )}
      {install.state === 'error' && (
        <Notice framed tone="danger" sx={{ mt: 1.5 }}>
          {install.error}
        </Notice>
      )}
    </Section>
  )
}
