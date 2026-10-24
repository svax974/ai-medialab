/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import { formatGb } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { isTranscription, lacksDiskRoom, remainingGb } from '../lib/catalogFormat'
import { useCancelDownload, useStartDownload } from '../hooks/useModelCatalog'
import type { useModelActions } from '../hooks/useModelActions'
import type { DownloadProgress, ModelInfo } from '../types'
import { QuantizeControl } from './QuantizeControl'

const MONO_SMALL = { fontFamily: 'var(--font-mono, monospace)', fontSize: 11, opacity: 0.8 } as const

interface ModelActionsProps {
  model: ModelInfo
  freeGb?: number
  download: DownloadProgress | null
  loaded: boolean
  actions: ReturnType<typeof useModelActions>
  onSetup: (model: ModelInfo) => void
  onUse: (model: ModelInfo) => void
}

/** The main button of a card: deleting, cancelling, installing the engine, using or downloading, by state. */
function MainActions({ model: m, freeGb, download, loaded, actions, onSetup, onUse }: ModelActionsProps) {
  const t = useT()
  const lang = useLang()
  const start = useStartDownload()
  const cancel = useCancelDownload()
  const need = remainingGb(m)
  const needText = need > 0 ? t('models.approxGb', [formatGb(need, lang)]) : ''
  if (actions.busy) {
    return (
      <Button variant="outlined" disabled startIcon={<CircularProgress size={14} />}>
        {t('models.deleting')} <Box component="span" sx={MONO_SMALL}>{t('models.approxGb', [formatGb(m.installed_gb, lang)])}</Box>
      </Button>
    )
  }
  if (download) {
    return (
      <Button variant="outlined" onClick={() => cancel.mutate(m.id)} disabled={cancel.isPending}>
        {t('models.cancel')}
      </Button>
    )
  }
  if (m.needs_engine_install) {
    const engineText = t('models.engine.sizeApprox', [m.engine_install_size_mb ?? 0])
    return (
      <Button variant="contained" disabled={!m.compatible} startIcon={<CloudDownloadOutlined />} onClick={() => onSetup(m)}>
        {t(m.install === 'installed' ? (m.engine_outdated ? 'models.engine.update' : 'models.engine.install') : (m.engine_outdated ? 'models.engine.updateBoth' : 'models.engine.installBoth'))}
        <Box component="span" sx={MONO_SMALL}>
          {engineText}
          {m.install !== 'installed' && need > 0 ? t('models.engine.plusModel', [formatGb(need, lang)]) : ''}
        </Box>
      </Button>
    )
  }
  if (m.install === 'installed') {
    return (
      <>
        {!isTranscription(m) && (
          <Button variant="contained" disabled={!m.compatible} onClick={() => onUse(m)}>
            {t('models.use')}
          </Button>
        )}
        <Button variant="text" onClick={() => void actions.remove()} disabled={loaded} startIcon={<DeleteOutlineRounded />}>
          {t('models.delete.button')}
        </Button>
      </>
    )
  }
  return (
    <Button variant="contained" disabled={!m.compatible || lacksDiskRoom(m, freeGb, false) || start.isPending} onClick={() => start.mutate(m.id)} startIcon={start.isPending ? <CircularProgress size={14} /> : <CloudDownloadOutlined />}>
      {t(m.install === 'partial' ? 'models.complete' : 'models.download')}
      {needText && <Box component="span" sx={MONO_SMALL}>{needText}</Box>}
    </Button>
  )
}

/** Whether at least one locally quantized variant is installed while the full-precision ("bf16") source it was
 * produced from is still on disk: freeing it is then safe (see `models.freeSource.*`). */
function freeableBf16(m: ModelInfo) {
  const bf16 = m.variants.find((v) => v.key === 'bf16')
  const hasDerived = m.variants.some((v) => v.key !== 'bf16' && v.install === 'installed')
  return bf16?.install === 'installed' && hasDerived ? bf16 : null
}

/** Action row of a model card (see `MainActions`), "remove from the list" for custom models, precision for MLX. */
export function ModelActions(props: ModelActionsProps) {
  const t = useT()
  const lang = useLang()
  const { model: m, download, loaded, actions } = props
  const bf16 = !download && !actions.busy ? freeableBf16(m) : null
  return (
    <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      <MainActions {...props} />
      {m.custom && !download && !actions.busy && (
        <Button variant="text" onClick={() => void actions.retire()} disabled={loaded} startIcon={<DeleteOutlineRounded />}>
          {t('models.retire.button')}
        </Button>
      )}
      {bf16 && (
        <Button variant="text" onClick={() => void actions.freeBf16()} startIcon={<DeleteOutlineRounded />}>
          {t('models.freeSource.button')} <Box component="span" sx={MONO_SMALL}>{t('models.approxGb', [formatGb(bf16.installed_gb, lang)])}</Box>
        </Button>
      )}
      {m.install === 'installed' && !actions.busy && m.backend === 'mlx' && m.quantize_options.length > 0 && <QuantizeControl model={m} />}
    </Box>
  )
}
