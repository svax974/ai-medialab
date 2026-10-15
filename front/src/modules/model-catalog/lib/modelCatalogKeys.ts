/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelKind, TrendingKind } from '../types'

/** TanStack Query keys. `models` is also the key the settings module invalidates when a quantization changes. */
export const modelCatalogKeys = {
  models: ['models'] as const,
  hub: (kind: ModelKind, query: string) => ['hub', kind, query] as const,
  hubInspect: (repo: string) => ['hub-inspect', repo] as const,
  trending: (kind: TrendingKind, days: number, includeHeavy: boolean) => ['hub-trending', kind, days, includeHeavy] as const,
}
