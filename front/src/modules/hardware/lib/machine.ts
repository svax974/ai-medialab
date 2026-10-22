/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Accelerator, SystemInfo } from '../types'

/** Free disk space (GB) under which the models folder is flagged. */
export const LOW_DISK_GB = 40

/** Number of GB as the old interface wrote it: no decimal from 10 up, one below; localised separator. */
export function formatGb(value: number, lang = 'fr'): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: value >= 10 ? 0 : 1, minimumFractionDigits: value >= 10 ? 0 : 1 }).format(value)
}

export type GpuKind = 'metal' | 'rocm' | 'cuda' | 'none'

/** The label family of the first accelerator (the one the engines use). */
export function gpuKind(gpu: Accelerator | undefined): GpuKind {
  if (!gpu) return 'none'
  return gpu.backend === 'metal' ? 'metal' : gpu.backend === 'rocm' ? 'rocm' : 'cuda'
}

export function isDiskLow(system: Pick<SystemInfo, 'disk'>): boolean {
  return system.disk.free_gb < LOW_DISK_GB
}
