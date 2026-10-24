/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Share of the machine's memory the models may take when the ceiling is automatic (`engine/app/memory_budget.py`). */
export const AUTO_FRACTION = 0.8
/** Smallest ceiling offered (GB): under it no useful model loads. */
export const MIN_LIMIT_GB = 4

/** Memory the engine keeps free for the system (`memory_guard.reserve_gb`: 8 % of the RAM, 2.5 GB at least). */
export function reserveGb(ramGb: number): number {
  return Math.round(Math.max(2.5, ramGb * 0.08) * 10) / 10
}

/** The ceiling the engine uses when the setting is 0. */
export function autoLimitGb(ramGb: number): number {
  return Math.round(ramGb * AUTO_FRACTION * 10) / 10
}

/** Slider range: from `MIN_LIMIT_GB` to what the safety reserve leaves (the engine clamps anything above). */
export function limitBounds(ramGb: number): { min: number; max: number } {
  return { min: MIN_LIMIT_GB, max: Math.max(MIN_LIMIT_GB, Math.floor(ramGb - reserveGb(ramGb))) }
}

/** Ceiling actually in force for a setting value (0: automatic). */
export function effectiveLimitGb(setting: number, ramGb: number): number {
  const { max } = limitBounds(ramGb)
  return setting > 0 ? Math.min(setting, max) : Math.min(autoLimitGb(ramGb), max)
}
