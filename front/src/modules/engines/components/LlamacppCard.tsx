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
import { useCancelInstall, useInstallLlamacpp } from '../hooks/useEngineInstaller'
import { selectInstall } from '../lib/installState'
import { useInstallStore } from '../state/installStore'
import { InstallRow } from './InstallRow'

const DEVICE_LABEL: Record<string, string> = { metal: 'Metal', cuda: 'CUDA', rocm: 'ROCm', vulkan: 'Vulkan', cpu: 'CPU' }

/** The chat's engine, llama.cpp: install (with the download progress), cancel, uninstall. */
export function LlamacppCard({ system }: { system: SystemInfo }) {
  const t = useT()
  const info = system.engines['llamacpp']
  const live = useInstallStore((s) => s.llamacppInstall)
  const install = selectInstall(live, info?.install)
  const start = useInstallLlamacpp()
  const cancel = useCancelInstall('llamacpp')
  if (!info) return null
  const running = install.state === 'running'
  const installable = !info.available && !!info.installable
  const hint = t('engines.engine.llamacpp.hint')
  return (
    <Section title={t('engines.llm.title')}>
      <InstallRow
        dot={info.available ? 'ok' : installable ? 'warn' : 'faint'}
        name={t('engines.engine.llamacpp.name')}
        extra={info.available && info.variant ? <Box component="span" sx={{ ml: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--muted)' }}>{DEVICE_LABEL[info.variant] ?? info.variant}</Box> : undefined}
        remark={info.available ? hint : installable ? t('engines.notInstalledHint', [hint]) : (info.reason ?? t('engines.unavailable'))}
        actions={
          running ? (
            <Button variant="outlined" onClick={() => cancel.mutate()}>{t('engines.cancel')}</Button>
          ) : installable ? (
            <Button variant="contained" startIcon={<CloudDownloadOutlined />} disabled={start.isPending} onClick={() => start.mutate()}>{t('engines.install', [info.install_size_mb ?? 0])}</Button>
          ) : undefined
        }
      />
      {running && (
        <>
          <ProgressBar done={install.done ?? 0} total={install.total ?? 0} />
          <Box component="p" sx={{ m: 0, mt: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--faint)' }}>{install.message}</Box>
        </>
      )}
      {install.state === 'error' && <Notice framed tone="danger" sx={{ mt: 1.5 }}>{install.error}</Notice>}
    </Section>
  )
}
