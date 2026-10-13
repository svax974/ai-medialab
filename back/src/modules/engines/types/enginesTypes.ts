/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** State of an installer, as the engine reports it (`engine_install.py`, `audio_packs.py`) and in its events. */
export type InstallStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

/** Audio/video pack installation (isolated Python environment): no percentage, a message and a detail line. */
export interface PackInstallState {
  state: InstallStatus;
  pack?: string;
  name?: string;
  message?: string;
  detail?: string;
  error?: string | null;
  started_at?: number;
  size_mb?: number;
}

/** stable-diffusion.cpp installation: bytes downloaded of the release archive. */
export interface EngineInstallState {
  state: InstallStatus;
  variant?: string;
  done?: number;
  total?: number;
  message?: string;
  error?: string | null;
}
