/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import { ProgressBar } from '@/modules_shared/common/components/ui/progress'
import { formatGb, useEngineStatus, type SystemInfo } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { activeDownload, downloadError } from '../lib/downloads'
import { alternativeToShow, lacksDiskRoom, noteIsWarning, remainingGb } from '../lib/catalogFormat'
import { useDownloadStore } from '../state/downloadStore'
import type { ModelInfo } from '../types'
import { useModelActions } from '../hooks/useModelActions'
import { GatedNotice, LicenseWarning, LlmBadges, VideoBadges } from './ModelBadges'
import { ModelActions } from './ModelActions'
import { ModelHeader } from './ModelHeader'
import { Notice, Tag } from './panels'
import { VariantPicker } from './VariantPicker'

interface ModelCardProps {
  model: ModelInfo
  system?: SystemInfo
  /** Installs the engine (and then the model) for a model whose engine is missing (module `engines`). */
  onSetup: (model: ModelInfo) => void
  /** "Use" this model: select it, go to the composer of its kind. */
  onUse: (model: ModelInfo) => void
}

/** Tags and licence line under the description. */
function TagLine({ model }: { model: ModelInfo }) {
  return (
    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
      {model.tags.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
      {model.license && (
        <Box component="span" sx={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--faint)' }}>
          · {model.license}
        </Box>
      )}
    </Box>
  )
}

/** Compatibility, memory, disk and engine remarks of a model. */
function CardNotes({ model: m, freeGb, downloading }: { model: ModelInfo; freeGb?: number; downloading: boolean }) {
  const t = useT()
  const lang = useLang()
  const need = remainingGb(m)
  return (
    <>
      {(m.plan.note || m.engine_reason) && (
        <Notice tone={noteIsWarning(m) ? 'warn' : 'plain'} icon={<ErrorOutlineRounded sx={{ fontSize: 14 }} />} sx={{ mt: 1.25, fontSize: 12 }}>
          {m.engine_reason || m.plan.note}
        </Notice>
      )}
      {alternativeToShow(m) && (
        <Notice tone="warn" icon={<ErrorOutlineRounded sx={{ fontSize: 14 }} />} sx={{ mt: 1, fontSize: 12 }}>
          {t('models.slow.alternative', [alternativeToShow(m) ?? ''])}
        </Notice>
      )}
      {!m.plan.note && m.memory_hint && m.compatible && (
        <Box component="p" sx={{ m: 0, mt: 1, fontSize: 12, lineHeight: 1.4, color: 'var(--faint)' }}>
          {m.memory_hint}
        </Box>
      )}
      {lacksDiskRoom(m, freeGb, downloading) && (
        <Notice tone="warn" icon={<StorageOutlined sx={{ fontSize: 14 }} />} sx={{ mt: 1.25, fontSize: 12 }}>
          {t('models.noRoom', [formatGb(need, lang), formatGb(freeGb ?? 0, lang)])}
        </Notice>
      )}
    </>
  )
}

function EngineMissing({ model: m }: { model: ModelInfo }) {
  const t = useT()
  return (
    <Notice framed tone="warn" icon={<CloudDownloadOutlined sx={{ fontSize: 14 }} />} sx={{ mt: 1.25, fontSize: 12 }}>
      <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>
        {t('models.engine.toInstall', [m.engine_name ?? ''])}
      </Box>
      {m.engine_install_size_mb ? t('models.engine.size', [m.engine_install_size_mb]) : ''}. {m.engine_detail}
    </Notice>
  )
}

/** A model of the catalogue: description, badges, remarks, progress and the actions that fit its state. */
export function ModelCard({ model: m, system, onSetup, onUse }: ModelCardProps) {
  const live = useDownloadStore((s) => s.downloads[m.id])
  const { data: status } = useEngineStatus()
  const actions = useModelActions(m)
  const dl = activeDownload(live, m)
  const error = downloadError(live, m)
  const loaded = status?.model_id === m.id
  return (
    <Box
      component="article"
      aria-busy={actions.busy}
      sx={{ borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface-2) 50%, transparent)', p: 2, opacity: m.compatible ? 1 : 0.8 }}
    >
      <ModelHeader model={m} system={system} loaded={loaded} downloading={!!dl} />
      <Box component="p" sx={{ m: 0, mt: '6px', fontSize: 13, lineHeight: 1.6, color: 'var(--muted)' }}>
        {m.description}
      </Box>
      {m.kind === 'video' && (
        <Box sx={{ mt: 1 }}>
          <VideoBadges model={m} />
        </Box>
      )}
      {m.kind === 'llm' && (
        <Box sx={{ mt: 1 }}>
          <LlmBadges model={m} />
        </Box>
      )}
      {m.kind === 'video' && (
        <Box sx={{ mt: 1.25 }}>
          <LicenseWarning model={m} />
        </Box>
      )}
      <Box sx={{ mt: 1.25 }}>
        <GatedNotice model={m} />
      </Box>
      <TagLine model={m} />
      {m.variants.length > 1 && <VariantPicker model={m} disabled={actions.busy} />}
      <CardNotes model={m} freeGb={system?.disk.free_gb} downloading={!!dl} />
      {dl && <ProgressBar done={dl.done} total={dl.total} rate={dl.rate} etaSeconds={dl.eta} />}
      {error && !dl && (
        <Notice framed tone="danger" sx={{ mt: 1.25 }}>
          {error}
        </Notice>
      )}
      {m.needs_engine_install && !dl && <EngineMissing model={m} />}
      <ModelActions model={m} freeGb={system?.disk.free_gb} download={dl} loaded={loaded} actions={actions} onSetup={onSetup} onUse={onUse} />
    </Box>
  )
}
