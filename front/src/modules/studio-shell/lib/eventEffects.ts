/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { hardwareKeys } from '@/modules/hardware/lib/hardwareKeys'
import { modelCatalogKeys } from '@/modules/model-catalog/lib/modelCatalogKeys'
import { studioKeys } from './queryKeys'

/**
 * Subscribed topics: the engine events relayed by Nest as `engine.<name>` (back/src/modules/engine/README.md). The
 * conversations and messages come as `studio.*` (module `studio-core`, `useStudioEvents`): the engine no longer knows them.
 */
export const ENGINE_TOPICS = [
  'engine.engine.status',
  'engine.models.changed',
  'engine.download.progress',
  'engine.engine.install',
  'engine.pack.install',
  'engine.llamacpp.install',
  'engine.link',
] as const

export interface EventLike {
  topic: string
  data?: Record<string, unknown>
}

/** What to do in the query cache for an event: queries to invalidate and to remove. */
export interface CacheEffect {
  invalidate: (readonly unknown[])[]
  remove: (readonly unknown[])[]
}

const NONE: CacheEffect = { invalidate: [], remove: [] }

/**
 * Maps an engine event to cache invalidations (the stream carries invalidations, the client re-reads by REST).
 * `engine.link` reconnecting re-reads everything: events may have been missed while the link was down.
 */
export function effectOfEvent(event: EventLike): CacheEffect {
  const data = event.data ?? {}
  switch (event.topic) {
    case 'engine.engine.status':
      return { invalidate: [hardwareKeys.status], remove: [] }
    case 'engine.models.changed':
      return { invalidate: [modelCatalogKeys.models, hardwareKeys.system], remove: [] }
    case 'engine.engine.install':
    case 'engine.pack.install':
    case 'engine.llamacpp.install':
    case 'engine.download.progress':
      // Only a finished install or download changes what the machine can run (a running one emits many progress
      // events: the live progress is kept in the model-catalog and engines stores, not in the query cache).
      return data['state'] === 'running' ? NONE : { invalidate: [modelCatalogKeys.models, hardwareKeys.system], remove: [] }
    case 'engine.link':
      return data['connected'] === true ? effectOfResync() : NONE
    default:
      return NONE
  }
}

/** Server asked to reload everything (replay impossible after a reconnection). */
export function effectOfResync(): CacheEffect {
  return { invalidate: [studioKeys.conversations, studioKeys.conversationAll, modelCatalogKeys.models, hardwareKeys.system, hardwareKeys.status], remove: [] }
}
