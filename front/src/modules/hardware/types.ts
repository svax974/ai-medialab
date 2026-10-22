/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
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

export type InstallStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

/** Audio/video pack installation (isolated Python environment): no percentage, a message and a detail line. */
export interface PackInstallState {
  state: InstallStatus
  pack?: string
  name?: string
  message?: string
  detail?: string
  error?: string | null
  /** Epoch seconds. */
  started_at?: number
  size_mb?: number
}

/** stable-diffusion.cpp installation: bytes downloaded of the release archive. */
export interface EngineInstallState {
  state: InstallStatus
  variant?: string
  done?: number
  total?: number
  message?: string
  error?: string | null
}

/** One inference engine (`mlx`, `torch`, `sdcpp`) as detected by the engine. */
export interface EngineInfo {
  available: boolean
  reason?: string
  device?: string
  variant?: string
  installable?: boolean
  install_variant?: string
  install_size_mb?: number
  /** Pack that installs this engine (PyTorch, MLX): installed through the pack routes. */
  pack?: string
  install?: EngineInstallState
}

/** An audio/video pack (isolated environment installed on demand). */
export interface PackInfo {
  name: string
  size_mb: number
  installed: boolean
  installable?: boolean
  reason?: string
}

/** `GET /api/system`: the machine, the engines and packs (the installers are the `engines` module's business). */
export interface SystemInfo {
  os: string
  arch: string
  ram_gb: number
  ram_free_gb: number
  accelerators: Accelerator[]
  unusable_gpus: UnusableGpu[]
  disk: { free_gb: number; total_gb: number }
  paths: { data: string; models: string }
  engines: Record<string, EngineInfo>
  packs: Record<string, PackInfo>
  pack_install: PackInstallState
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
