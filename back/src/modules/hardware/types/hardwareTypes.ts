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
