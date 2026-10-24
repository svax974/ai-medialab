/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { MemoryLive } from '../types'

export type GaugeTone = 'ok' | 'warn' | 'danger'

/** Share in use from which the gauge turns amber, then red, whatever the system says (the system's pressure can only raise the tone). */
export const WARN_PCT = 85
export const DANGER_PCT = 93

/** Colour of the gauge: the system's own pressure verdict and the share in use, the worse of the two. */
export function gaugeTone(sample: Pick<MemoryLive, 'used_pct' | 'pressure'>): GaugeTone {
  if (sample.pressure === 'critical' || sample.used_pct >= DANGER_PCT) return 'danger'
  if (sample.pressure === 'warning' || sample.used_pct >= WARN_PCT) return 'warn'
  return 'ok'
}

/** Swap in use beyond a quarter of the memory is the usual sign of a runaway model on a Mac. */
export function swapIsHeavy(sample: Pick<MemoryLive, 'swap_used_gb' | 'total_gb'>): boolean {
  return sample.swap_used_gb > sample.total_gb * 0.25
}

export const gaugeWidth = (pct: number): number => Math.max(0, Math.min(100, Math.round(pct)))
