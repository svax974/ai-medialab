/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { DownloadProgress, ModelKind } from '@/modules/model-catalog'
import type { EngineInstallState, InstallStatus, PackInstallState } from '@/modules/engines'
import type { EngineUpdate, KindFilter, ModelUpdate, UpdateItem, UpdateKind, UpdateTarget, UpdatesReport } from '../types'

export const itemKey = (kind: UpdateKind, id: string): string => `${kind}:${id}`

export const matchesKind = (kinds: ModelKind[], filter: KindFilter): boolean => filter === 'all' || kinds.includes(filter)

const RANK = { update: 0, error: 1, current: 2 } as const

/** What the dialog lists for a kind filter: updates first, then failed checks, then what is up to date. */
export function visibleRows(report: UpdatesReport | undefined, filter: KindFilter): { engines: EngineUpdate[]; models: ModelUpdate[] } {
  const byState = <T extends { state: keyof typeof RANK }>(a: T, b: T) => RANK[a.state] - RANK[b.state]
  return {
    engines: (report?.engines ?? []).filter((e) => matchesKind(e.kinds, filter)).sort(byState),
    models: (report?.models ?? []).filter((m) => matchesKind([m.kind], filter)).sort(byState),
  }
}

export const toEngineItem = (e: EngineUpdate, target: UpdateTarget = 'pinned'): UpdateItem => ({ key: itemKey('engine', e.id), kind: 'engine', id: e.id, name: e.name, target, status: 'queued', error: null })
export const toModelItem = (m: ModelUpdate): UpdateItem => ({ key: itemKey('model', m.id), kind: 'model', id: m.id, name: m.name, target: 'pinned', status: 'queued', error: null })

/** The updates the bulk buttons start from the visible rows (nothing already queued or running): the tested ones only, never a `latest`. */
export function pendingItems(rows: { engines: EngineUpdate[]; models: ModelUpdate[] }, queue: UpdateItem[], scope: 'all' | 'engines' | 'models' = 'all'): UpdateItem[] {
  const busy = new Set(queue.filter((i) => i.status === 'queued' || i.status === 'running').map((i) => i.key))
  const engines = scope === 'models' ? [] : rows.engines.filter((e) => e.state === 'update').map((e) => toEngineItem(e))
  const models = scope === 'engines' ? [] : rows.models.filter((m) => m.state === 'update').map((m) => toModelItem(m))
  return [...engines, ...models].filter((i) => !busy.has(i.key))
}

/** Live state of the installers (event stream), as the stores of `engines` and `model-catalog` hold it. */
export interface InstallContext {
  downloads: Record<string, DownloadProgress>
  engineInstall: EngineInstallState
  packInstall: PackInstallState
}

export interface UpdateOutcome {
  phase: 'running' | 'done' | 'error'
  error: string | null
}

const RUNNING: UpdateOutcome = { phase: 'running', error: null }

function fromState(state: InstallStatus | DownloadProgress['state'], error: string | null | undefined, cancelled: string): UpdateOutcome {
  if (state === 'done') return { phase: 'done', error: null }
  if (state === 'error') return { phase: 'error', error: error ?? null }
  return state === 'cancelled' ? { phase: 'error', error: cancelled } : RUNNING
}

/** Where a started update stands, read from the installer it runs on. Call it only once the start request was answered (the stores may hold an older run). */
export function outcomeOf(item: Pick<UpdateItem, 'kind' | 'id'>, ctx: InstallContext, cancelled = ''): UpdateOutcome {
  if (item.kind === 'model') {
    const d = ctx.downloads[item.id]
    return d ? fromState(d.state, d.error, cancelled) : RUNNING
  }
  if (item.id === 'sdcpp') return fromState(ctx.engineInstall.state, ctx.engineInstall.error, cancelled)
  return ctx.packInstall.pack === item.id ? fromState(ctx.packInstall.state, ctx.packInstall.error, cancelled) : RUNNING
}

export interface UpdateProgress {
  done: number
  total: number
  rate?: number
  eta?: number | null
  /** Step the installer reports (a pack has no byte count). */
  message?: string
}

/** The progress to draw for a running item: bytes for a model and stable-diffusion.cpp, a message for a pack. */
export function progressOf(item: Pick<UpdateItem, 'kind' | 'id'>, ctx: InstallContext): UpdateProgress | null {
  if (item.kind === 'model') {
    const d = ctx.downloads[item.id]
    return d ? { done: d.done, total: d.total, rate: d.rate, eta: d.eta } : null
  }
  if (item.id === 'sdcpp') return { done: ctx.engineInstall.done ?? 0, total: ctx.engineInstall.total ?? 0, message: ctx.engineInstall.message }
  return ctx.packInstall.pack === item.id ? { done: 0, total: 0, message: [ctx.packInstall.message, ctx.packInstall.detail].filter(Boolean).join(' — ') } : null
}
