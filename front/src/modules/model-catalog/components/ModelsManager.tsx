/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import { formatGb } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useModelActions } from '../hooks/useModelActions'
import { useModels } from '../hooks/useModelCatalog'
import { groupModelsByKind } from '../lib/modelsView'
import type { ModelInfo } from '../types'

const DOT: Record<ModelInfo['install'], string> = { installed: 'var(--ok)', partial: 'var(--warn)', missing: 'var(--faint)' }

function ModelRow({ model }: { model: ModelInfo }) {
  const t = useT()
  const lang = useLang()
  const { busy, remove } = useModelActions(model)
  const onDisk = model.install !== 'missing'
  const state = model.install === 'installed' ? t('models.manage.installed', [formatGb(model.installed_gb, lang)]) : model.install === 'partial' ? t('models.manage.partial', [formatGb(model.installed_gb, lang)]) : t('models.manage.missing')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: onDisk ? 1 : 0.65 }}>
      <Box component="span" aria-hidden sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: '50%', backgroundColor: DOT[model.install] }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ fontSize: 13.5, color: 'var(--ink)' }}>{model.name}</Box>
        <Box sx={{ fontSize: 11.5, color: 'var(--faint)' }}>{state}</Box>
      </Box>
      {onDisk && (
        <Button variant="text" disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : <DeleteOutlineRounded />} onClick={() => void remove()}>
          {t('models.delete.button')}
        </Button>
      )}
    </Box>
  )
}

/**
 * Settings, "Models" tab: the catalogue by category (chat, audio, image, video) with whether each model is downloaded and the
 * space it takes, and a delete button for those on disk (asks first). Downloading happens when a model is selected.
 */
export function ModelsManager({ enabled = true }: { enabled?: boolean }) {
  const t = useT()
  const { data, isPending, isError, refetch } = useModels({ enabled })
  if (isPending) return <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'var(--muted)' }}><CircularProgress size={14} /> {t('settings.loading')}</Box>
  if (isError) return <Box role="alert" sx={{ color: 'var(--danger)' }}>{t('settings.error')} <Button size="small" variant="text" onClick={() => void refetch()}>{t('settings.retry')}</Button></Box>
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {groupModelsByKind(data.models).map((group) => (
        <section key={group.kind}>
          <Box component="h3" className="cn-eyebrow" sx={{ m: 0, mb: 1.5 }}>{t(`models.tabs.${group.kind}`)}</Box>
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {group.models.map((model) => <ModelRow key={model.id} model={model} />)}
          </Box>
        </section>
      ))}
    </Box>
  )
}
