/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useQuery } from '@tanstack/react-query'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { messagesApi } from '../services/messagesApi'

const NONE: Record<string, number> = {}

/** Finished generations per model id (refreshed when a generation ends or is deleted); empty until known. */
export function useModelUsage(): Record<string, number> {
  const { data } = useQuery({ queryKey: studioKeys.modelUsage, queryFn: () => messagesApi.modelUsage() })
  return data?.counts ?? NONE
}
