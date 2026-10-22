/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { toast } from 'react-toastify'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { formatGb } from '@/modules/hardware'
import { modelCatalogApi } from '../services/modelCatalogApi'
import type { ModelInfo } from '../types'
import { useRefreshCatalog } from './useModelCatalog'

/**
 * Deleting a model's files, or removing a user-added model from the list (which deletes its files too). Both ask for
 * confirmation, wait until the files are actually gone (the engine answers when the space is freed) and report errors.
 */
export function useModelActions(model: ModelInfo) {
  const t = useT()
  const lang = useLang()
  const refresh = useRefreshCatalog()
  const [busy, setBusy] = useState(false)
  const gb = formatGb(model.installed_gb, lang)

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const ok = await confirm({ titleId: 'models.delete.title', messageId: 'models.delete.message', params: [model.name, gb], confirmLabelId: 'models.delete.confirm', danger: true })
    if (!ok) return
    await run(async () => {
      const result = await modelCatalogApi.deleteModel(model.id)
      await refresh()
      toast.success(t(result.also_affects.length ? 'models.delete.doneShared' : 'models.delete.done', [formatGb(result.freed_gb, lang)]))
    })
  }

  const retire = async () => {
    const ok = await confirm({ titleId: 'models.retire.title', messageId: 'models.retire.message', params: [model.name, gb], confirmLabelId: 'models.retire.confirm', danger: true })
    if (!ok) return
    await run(async () => {
      await modelCatalogApi.removeCustom(model.id)
      await refresh()
    })
  }

  const freeBf16 = async () => {
    const bf16Gb = formatGb(model.variants.find((v) => v.key === 'bf16')?.installed_gb ?? 0, lang)
    const ok = await confirm({ titleId: 'models.freeSource.title', messageId: 'models.freeSource.message', params: [model.name, bf16Gb], confirmLabelId: 'models.freeSource.confirm', danger: true })
    if (!ok) return
    await run(async () => {
      const result = await modelCatalogApi.freeBf16Source(model.id)
      await refresh()
      toast.success(t('models.freeSource.done', [formatGb(result.freed_gb, lang)]))
    })
  }

  return { busy, remove, retire, freeBf16 }
}
