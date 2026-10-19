/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { hardwareKeys } from '@/modules/hardware'
import { modelCatalogKeys } from '@/modules/model-catalog'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { formatSize } from '../lib/setupDialog'
import { enginesApi } from '../services/enginesApi'
import { useSetupStore } from '../state/setupStore'
import type { ComponentInfo } from '../types'

export const componentsKey = ['engines', 'components'] as const

/** The components with their state and disk usage; read again when a setup finishes (it installs some). */
export function useComponents(enabled = true) {
  const queryClient = useQueryClient()
  const runState = useSetupStore((s) => s.run.state)
  useEffect(() => {
    if (enabled) void queryClient.invalidateQueries({ queryKey: componentsKey })
  }, [enabled, runState, queryClient])
  return useQuery({ queryKey: componentsKey, queryFn: () => enginesApi.components(true), enabled, staleTime: 0 })
}

/**
 * Removing a component: asks first, naming the installed models that need it (they are deleted with it), then refreshes
 * the lists. `removing` is the id being removed.
 */
export function useRemoveComponent(): { removing: string | null; remove: (component: ComponentInfo) => Promise<void> } {
  const t = useT()
  const lang = useLang()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<string | null>(null)
  const remove = async (component: ComponentInfo) => {
    const models = component.dependants
    const size = formatSize(component.disk_mb, lang)
    const ok = await confirm({
      titleId: 'engines.remove.title',
      messageId: models.length ? 'engines.remove.messageWithModels' : 'engines.remove.message',
      params: models.length ? [component.name, size, String(models.length), models.map((m) => m.name).join(', ')] : [component.name, size],
      confirmLabelId: 'engines.remove.confirm',
      danger: true,
    })
    if (!ok) return
    setRemoving(component.id)
    try {
      const result = await enginesApi.removeComponent(component.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: componentsKey }),
        queryClient.invalidateQueries({ queryKey: modelCatalogKeys.models }),
        queryClient.invalidateQueries({ queryKey: hardwareKeys.system }),
      ])
      toast.success(t(result.removed_models.length ? 'engines.remove.doneWithModels' : 'engines.remove.done', [component.name, result.removed_models.length]))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRemoving(null)
    }
  }
  return { removing, remove }
}
