/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Accelerator reported by the engine (`GET /api/system`). */
export interface Accelerator {
  vendor: string
  backend: string
  name: string
  memory_gb: number | null
  unified: boolean
}

export interface UnusableGpu {
  vendor: string
  name: string
  memory_gb: number | null
  reason: string
}

/** The hardware part of `GET /api/system` (engines, packs and installers belong to the models module). */
export interface SystemInfo {
  os: string
  arch: string
  ram_gb: number
  ram_free_gb: number
  accelerators: Accelerator[]
  unusable_gpus: UnusableGpu[]
  disk: { free_gb: number; total_gb: number }
  paths: { data: string; models: string }
}

/** `GET /api/status`: the generation worker (one model loaded at a time). */
export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'busy'
  model_id: string | null
  quantize: number | null
  load_started_at: number | null
  current_message_id: string | null
  queue: string[]
  last_error: string | null
}
