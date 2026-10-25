/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
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

/** A model the engine lists as depending on a component (`engine/app/api/setup.py`). */
export interface DependantModel {
  id: string;
  name: string;
  kind: string;
}

/** Installable component: "base" data shared by several engines, or an "engine" (`engine/app/components.py`). */
export interface ComponentInfo {
  id: string;
  kind: 'base' | 'engine';
  name: string;
  contents: string;
  installed: boolean;
  removable: boolean;
  size_mb: number;
  blocked: string | null;
  disk_mb: number;
  dependants: DependantModel[];
}

export interface SetupStepPlan {
  id: string;
  kind: 'base' | 'engine' | 'model';
  name: string;
  installed: boolean;
  size_mb: number;
  blocked: string | null;
  /** Added along with the asked model (a speech model brings a transcription model). */
  purpose?: 'transcription' | null;
}

/** What setting a model up downloads (`GET /api/engines/setup/plan/:modelId`); installed steps cost nothing. */
export interface SetupPlan {
  model_id: string;
  steps: SetupStepPlan[];
  ready: boolean;
  total_mb: number;
  blocked: string | null;
}

export interface SetupStep {
  id: string;
  kind: 'base' | 'engine' | 'model';
  name: string;
  size_mb: number;
  state: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  purpose?: 'transcription' | null;
}

/** Run that installs what a model lacks; also the payload of the `engine.setup.progress` event. */
export interface SetupState {
  state: InstallStatus;
  model_id: string | null;
  model_name: string | null;
  steps: SetupStep[];
  current: number;
  total_mb: number;
  message: string;
  detail: string;
  done: number;
  total: number;
  rate: number;
  eta: number | null;
  error: string | null;
  started_at: number | null;
}
