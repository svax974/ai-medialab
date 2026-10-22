/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from '@mui/material'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import { Notice } from '@/modules/model-catalog'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useComponents, useRemoveComponent } from '../hooks/useComponents'
import { componentRemark, groupComponents } from '../lib/componentsView'
import type { ComponentInfo } from '../types'
import { InstallRow } from './InstallRow'

function ComponentRow({ component, removing, onRemove }: { component: ComponentInfo; removing: boolean; onRemove: (c: ComponentInfo) => void }) {
  const t = useT()
  const lang = useLang()
  const remark = componentRemark(component, lang)
  return (
    <InstallRow
      dot={component.installed ? 'ok' : component.blocked ? 'faint' : 'warn'}
      name={component.name}
      remark={t(remark.key, remark.params)}
      actions={
        component.removable ? (
          <Button variant="text" disabled={removing} startIcon={removing ? <CircularProgress size={14} /> : <DeleteOutlineRounded />} onClick={() => onRemove(component)}>
            {t(removing ? 'engines.uninstalling' : 'engines.remove.button')}
          </Button>
        ) : undefined
      }
    />
  )
}

/**
 * Settings, "Engines" tab: every component the app downloads on demand, in two groups ("Données de base", shared by several
 * engines, then "Moteurs d'exécution"), with whether it is downloaded and, if so, a delete button. Deleting asks first and lists
 * the installed models that need the component: they are deleted with it. Installing happens when a model is selected.
 */
export function ComponentsManager({ enabled = true }: { enabled?: boolean }) {
  const t = useT()
  const { data, isPending, isError, refetch } = useComponents(enabled)
  const { removing, remove } = useRemoveComponent()
  if (isPending) return <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'var(--muted)' }}><CircularProgress size={14} /> {t('settings.loading')}</Box>
  if (isError) return <Box role="alert" sx={{ color: 'var(--danger)' }}>{t('settings.error')} <Button size="small" variant="text" onClick={() => void refetch()}>{t('settings.retry')}</Button></Box>
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Notice framed tone="neutral">{t('engines.manage.intro')}</Notice>
      {groupComponents(data).map((group) => (
        <section key={group.kind}>
          <Box component="h3" className="cn-eyebrow" sx={{ m: 0, mb: 0.5 }}>{t(`engines.manage.group.${group.kind}`)}</Box>
          <Box component="p" sx={{ m: 0, mb: 1.5, fontSize: 12, color: 'var(--faint)' }}>{t(`engines.manage.group.${group.kind}.hint`)}</Box>
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {group.items.map((component) => <ComponentRow key={component.id} component={component} removing={removing === component.id} onRemove={(c) => void remove(c)} />)}
          </Box>
        </section>
      ))}
    </Box>
  )
}
