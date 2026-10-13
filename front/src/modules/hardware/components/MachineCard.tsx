/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, Button, CircularProgress } from '@mui/material'
import MemoryOutlined from '@mui/icons-material/MemoryOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import DeveloperBoardOutlined from '@mui/icons-material/DeveloperBoardOutlined'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useSystemInfo } from '../hooks/useHardware'
import { formatGb, gpuKind, isDiskLow } from '../lib/machine'
import type { SystemInfo } from '../types'

function Stat({ icon, label, value, sub, warn }: { icon: ReactNode; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '2px', fontSize: 11, color: 'var(--muted)' }}>
        {icon}
        {label}
      </Box>
      <Box title={value} sx={{ fontSize: 14, color: warn ? 'var(--warn)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </Box>
      {sub && <Box sx={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, color: 'var(--faint)' }}>{sub}</Box>}
    </Box>
  )
}

/** The three figures of the machine (chip or GPU, memory, models disk) and the GPUs the engines cannot use. */
export function MachineSummary({ system }: { system: SystemInfo }) {
  const t = useT()
  const lang = useLang()
  const gpu = system.accelerators[0]
  const gb = (n: number) => formatGb(n, lang)
  const gpuSub = gpu?.memory_gb ? t(gpu.unified ? 'hardware.gpu.memoryUnified' : 'hardware.gpu.memoryVram', [gb(gpu.memory_gb)]) : undefined
  return (
    <>
      <Box sx={{ display: 'grid', gap: '10px 24px', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
        <Stat
          icon={<DeveloperBoardOutlined sx={{ fontSize: 16 }} />}
          label={t(`hardware.gpu.${gpuKind(gpu)}`)}
          value={gpu ? gpu.name : t('hardware.gpu.noneValue')}
          sub={gpuSub}
          warn={!gpu}
        />
        <Stat icon={<MemoryOutlined sx={{ fontSize: 16 }} />} label={t('hardware.ram.label')} value={t('hardware.ram.value', [gb(system.ram_gb)])} sub={t('hardware.ram.free', [gb(system.ram_free_gb)])} />
        <Stat
          icon={<StorageOutlined sx={{ fontSize: 16 }} />}
          label={t('hardware.disk.label')}
          value={t('hardware.disk.value', [gb(system.disk.free_gb)])}
          sub={t('hardware.disk.total', [gb(system.disk.total_gb)])}
          warn={isDiskLow(system)}
        />
      </Box>
      {system.unusable_gpus.map((g) => (
        <Box
          key={g.name}
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 1.5, px: 1.5, py: 1, borderRadius: '12px', fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink-2)', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)' }}
        >
          <WarningAmberRounded sx={{ fontSize: 16, mt: '2px', flexShrink: 0, color: 'var(--warn)' }} />
          <span>
            <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>
              {g.name}
            </Box>{' '}
            {t('hardware.gpu.unusable', [g.reason])}
          </span>
        </Box>
      ))}
    </>
  )
}

/**
 * "This machine" card. Loads `GET /api/system` itself (states: loading, error with retry, content) and refreshes
 * the free memory and disk every 8 s while it is mounted. Mounted by the models dialog (H4.2).
 */
export function MachineCard({ pollMs = 8_000 }: { pollMs?: number | false }) {
  const t = useT()
  const { data, isPending, isError, refetch } = useSystemInfo({ pollMs })
  return (
    <Box component="section" sx={{ border: '1px solid var(--line)', borderRadius: '16px', backgroundColor: 'color-mix(in oklab, var(--surface-2) 50%, transparent)', p: 2 }}>
      <Box className="cn-eyebrow" sx={{ mb: 1.5 }}>
        {t('hardware.machine.title')}
      </Box>
      {isPending && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'var(--muted)' }}>
          <CircularProgress size={14} /> {t('hardware.machine.loading')}
        </Box>
      )}
      {isError && (
        <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 13, color: 'var(--danger)' }}>
          {t('hardware.machine.error')}
          <Button size="small" variant="text" onClick={() => void refetch()}>
            {t('hardware.machine.retry')}
          </Button>
        </Box>
      )}
      {data && <MachineSummary system={data} />}
    </Box>
  )
}

/** Where models and data are stored (footer of the models dialog). */
export function StoragePaths({ system }: { system: Pick<SystemInfo, 'paths'> }) {
  const t = useT()
  return (
    <Box sx={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, color: 'var(--faint)', wordBreak: 'break-all' }}>
      <div>{t('hardware.paths.models', [system.paths.models])}</div>
      <div>{t('hardware.paths.data', [system.paths.data])}</div>
    </Box>
  )
}
