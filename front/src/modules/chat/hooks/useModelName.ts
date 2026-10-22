/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useModels } from '@/modules/model-catalog'

/** Name of the model that wrote a message (the catalogue's, else its id). */
export function useModelName(id: string | null): string {
  const { data } = useModels()
  return (id && data?.models.find((m) => m.id === id)?.name) || id || ''
}
