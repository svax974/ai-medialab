/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export type { EngineInfo, EngineInstallState, InstallStatus, PackInfo, PackInstallState } from '@/modules/hardware'

/** Level of a component: "base" data shared by several engines, an "engine", or the model files themselves. */
export type ComponentKind = 'base' | 'engine'
export type PlanStepKind = ComponentKind | 'model'

/** A model the engine lists as needing a component (`GET /api/engines/components`). */
export interface DependantModel {
  id: string
  name: string
  kind: string
}

/** An installable component (`engine/app/components.py`): state, size, and the installed models that need it. */
export interface ComponentInfo {
  id: string
  kind: ComponentKind
  name: string
  contents: string
  installed: boolean
  removable: boolean
  size_mb: number
  blocked: string | null
  disk_mb: number
  dependants: DependantModel[]
}

export interface InstallPlanStep {
  id: string
  kind: PlanStepKind
  name: string
  installed: boolean
  size_mb: number
  blocked: string | null
}

/** What setting a model up downloads; installed steps cost nothing (`GET /api/engines/setup/plan/:modelId`). */
export interface InstallPlan {
  model_id: string
  steps: InstallPlanStep[]
  ready: boolean
  total_mb: number
  blocked: string | null
}

export type SetupStepState = 'pending' | 'running' | 'done' | 'error' | 'cancelled'

export interface SetupRunStep {
  id: string
  kind: PlanStepKind
  name: string
  size_mb: number
  state: SetupStepState
}

/** The run that installs what a model lacks, also the payload of the `engine.setup.progress` event. */
export interface SetupRun {
  state: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  model_id: string | null
  model_name: string | null
  steps: SetupRunStep[]
  current: number
  total_mb: number
  message: string
  detail: string
  done: number
  total: number
  rate: number
  eta: number | null
  error: string | null
  started_at: number | null
}
