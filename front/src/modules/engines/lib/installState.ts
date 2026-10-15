/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { EngineInfo, EngineInstallState, InstallStatus, PackInfo, PackInstallState } from '../types'
import type { ModelInfo, ModelKind } from '@/modules/model-catalog'

/** Topics of the engine's installer events, relayed by Nest (back/src/modules/engine/README.md). */
export const PACK_INSTALL_TOPIC = 'engine.pack.install'
export const SDCPP_INSTALL_TOPIC = 'engine.engine.install'
export const LLAMACPP_INSTALL_TOPIC = 'engine.llamacpp.install'

/** The live state (events) when something is happening or happened since the page loaded, else the one read with the system. */
export function selectInstall<T extends { state: InstallStatus }>(live: T, fromSystem: T | undefined): T {
  return live.state !== 'idle' ? live : (fromSystem ?? live)
}

/** Narrows an event payload to an install state (the stream carries untrusted JSON). */
export function parseInstallState<T extends { state: InstallStatus }>(data: unknown): T | null {
  const d = data as { state?: unknown } | null | undefined
  return d && typeof d.state === 'string' ? (d as T) : null
}

export type EngineDot = 'ok' | 'warn' | 'faint'

export interface EngineRow {
  id: string
  available: boolean
  /** Not installed, but the app can install it (stable-diffusion.cpp only). */
  installable: boolean
  variant?: string
  reason?: string
  installSizeMb?: number
}

/** The image engines shown in the "Engines" card, in display order (MLX is hidden when it cannot exist on this machine). */
export const ENGINE_IDS = ['sdcpp', 'mlx', 'torch'] as const

export function engineRows(engines: Record<string, EngineInfo>): EngineRow[] {
  const rows: EngineRow[] = []
  for (const id of ENGINE_IDS) {
    const e = engines[id]
    if (!e) continue
    const installable = id === 'sdcpp' && !e.available && !!e.installable
    if (!e.available && !installable && id !== 'sdcpp' && (e.reason ?? '').includes('Mac')) continue
    rows.push({ id, available: e.available, installable, variant: e.variant, reason: e.reason, installSizeMb: e.install_size_mb })
  }
  return rows
}

export const engineDot = (row: Pick<EngineRow, 'available' | 'installable'>): EngineDot => (row.available ? 'ok' : row.installable ? 'warn' : 'faint')

export interface PackRow {
  id: string
  name: string
  sizeMb: number
  installed: boolean
  installable: boolean
  reason?: string
}

/**
 * The packs of a tab: a pack belongs to the kind of the models that use it; a pack no model uses stays with audio.
 * (Same rule as the old interface.)
 */
export function packRows(packs: Record<string, PackInfo> | undefined, models: Pick<ModelInfo, 'kind' | 'engine_pack'>[], kind: Exclude<ModelKind, 'image'>): PackRow[] {
  const used = (id: string, k: ModelKind) => models.some((m) => m.kind === k && m.engine_pack === id)
  return Object.entries(packs ?? {})
    .filter(([id]) => (kind === 'video' ? used(id, 'video') : !used(id, 'video') || used(id, 'audio')))
    .map(([id, p]) => ({ id, name: p.name, sizeMb: p.size_mb, installed: p.installed, installable: !!p.installable, reason: p.reason }))
}

export const packDot = (row: Pick<PackRow, 'installed' | 'installable'>): EngineDot => (row.installed ? 'ok' : row.installable ? 'warn' : 'faint')

/** What still has to be installed to use a model; null when nothing. */
export interface SetupPlan {
  needEngine: boolean
  needModel: boolean
  engineMb: number
  modelGb: number
}

export function setupPlan(model: ModelInfo): SetupPlan | null {
  const needEngine = model.needs_engine_install
  const needModel = model.install !== 'installed'
  if (!needEngine && !needModel) return null
  return { needEngine, needModel, engineMb: model.engine_install_size_mb ?? 0, modelGb: Math.max(0, (model.download_size_gb ?? 0) - model.installed_gb) }
}

/** The installer to follow: only one runs at a time, so the one working (or just done) is the relevant one. */
export function relevantInstall(sd: EngineInstallState, pack: PackInstallState, llama: EngineInstallState = { state: 'idle' }): EngineInstallState | PackInstallState {
  if (llama.state === 'running' || (sd.state === 'idle' && pack.state === 'idle' && llama.state !== 'idle')) return llama
  return pack.state === 'running' || (sd.state === 'idle' && pack.state !== 'idle') ? pack : sd
}

export type SetupStep = 'wait' | 'abort' | 'download'

/** After an engine install that was started for a model: wait, give up (error, cancelled) or download the model. */
export function nextSetupStep(pending: string | null, engineState: InstallStatus): SetupStep {
  if (!pending) return 'wait'
  if (engineState === 'error' || engineState === 'cancelled') return 'abort'
  return engineState === 'done' ? 'download' : 'wait'
}
