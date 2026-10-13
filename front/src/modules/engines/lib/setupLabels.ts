/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { SetupPlan } from './installState'

/** Locale keys and parameters of the "what is to install" summary (`engine ≈ 120 Mo + model ≈ 4,5 Go`). */
export function setupParts(plan: SetupPlan, engineName: string | null, formatGb: (gb: number) => string): { key: string; params: string[] }[] {
  const parts: { key: string; params: string[] }[] = []
  if (plan.needEngine) {
    const mb = String(Math.round(plan.engineMb))
    parts.push(engineName ? { key: 'engines.setup.engineNamed', params: [engineName, mb] } : { key: 'engines.setup.engine', params: [mb] })
  }
  if (plan.needModel) parts.push({ key: 'engines.setup.model', params: [formatGb(plan.modelGb)] })
  return parts
}

/** Label of the main button. */
export function setupButtonKey(plan: SetupPlan): string {
  return plan.needEngine && plan.needModel ? 'engines.setup.all' : plan.needEngine ? 'engines.setup.engineOnly' : 'engines.setup.modelOnly'
}
