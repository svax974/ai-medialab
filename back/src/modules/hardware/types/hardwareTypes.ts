/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Accelerator reported by the engine (`engine/app/system.py`). */
export interface Accelerator {
  vendor: string;
  backend: string;
  name: string;
  memory_gb: number | null;
  unified: boolean;
  torch_mps?: boolean;
}

export interface UnusableGpu {
  vendor: string;
  name: string;
  memory_gb: number | null;
  reason: string;
}

/**
 * `GET /api/system`. The engine owns the detection (it probes PyTorch in a subprocess); Nest relays the answer. Only
 * the hardware part is typed here: `engines`, `packs` and `pack_install` belong to the model/engine installers (H4.2).
 */
export interface SystemInfo {
  os: string;
  arch: string;
  ram_gb: number;
  ram_free_gb: number;
  accelerators: Accelerator[];
  unusable_gpus: UnusableGpu[];
  disk: { free_gb: number; total_gb: number };
  paths: { data: string; models: string };
  engines: Record<string, Record<string, unknown>>;
  packs: Record<string, Record<string, unknown>>;
  pack_install: Record<string, unknown>;
}

/** `GET /api/memory` and the `memory.sample` event (`engine/app/emergency.py` `live`): memory as Activity Monitor reads it, the models held, what runs. */
export interface MemoryLive {
  total_gb: number;
  used_gb: number;
  used_pct: number;
  free_gb: number;
  /** macOS only: what the used part is made of (GB). */
  breakdown: { app: number; wired: number; compressed: number; cached: number } | null;
  swap_used_gb: number;
  swap_total_gb: number;
  pressure: 'normal' | 'warning' | 'critical';
  source: 'vm_stat' | 'psutil';
  budget: { ceiling_gb: number; used_gb: number; models: { model_id: string; name: string; gb: number }[] };
  activity: { working: boolean; queued: number; loaded: number; can_stop: boolean };
}

/** `POST /api/engine/emergency-stop`: what was killed and how many waiting jobs were cancelled. */
export interface EmergencyStopResult {
  stopped: string[];
  cancelled: number;
}

/** `GET /api/status`: the generation worker (one model loaded at a time). */
export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'busy';
  model_id: string | null;
  quantize: number | null;
  load_started_at: number | null;
  current_message_id: string | null;
  queue: string[];
  last_error: string | null;
}
