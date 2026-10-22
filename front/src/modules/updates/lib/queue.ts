/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { UpdateItem, UpdateItemStatus } from '../types'
import type { UpdateOutcome } from './updateItems'

/** Adds items to the queue; an item already waiting or running is kept as it is, a finished one starts again. */
export function enqueueItems(queue: UpdateItem[], items: UpdateItem[]): UpdateItem[] {
  const active = new Set(queue.filter((i) => i.status === 'queued' || i.status === 'running').map((i) => i.key))
  const fresh = items.filter((i) => !active.has(i.key))
  const replaced = new Set(fresh.map((i) => i.key))
  return [...queue.filter((i) => !replaced.has(i.key)), ...fresh]
}

export function setItemStatus(queue: UpdateItem[], key: string, status: UpdateItemStatus, error: string | null = null): UpdateItem[] {
  return queue.map((i) => (i.key === key ? { ...i, status, error } : i))
}

/** The updates run one after the other (each installer takes one job at a time): nothing starts while one runs. */
export function nextToStart(queue: UpdateItem[]): UpdateItem | null {
  if (queue.some((i) => i.status === 'running')) return null
  return queue.find((i) => i.status === 'queued') ?? null
}

export const isActive = (queue: UpdateItem[]): boolean => queue.some((i) => i.status === 'queued' || i.status === 'running')

export const findItem = (queue: UpdateItem[], key: string): UpdateItem | undefined => queue.find((i) => i.key === key)

export type RunnerAction =
  | { type: 'finish'; key: string; status: 'done' | 'error'; error: string | null }
  | { type: 'start'; item: UpdateItem }
  | { type: 'refresh' }
  | { type: 'idle' }

/**
 * What the runner does next. `started`: keys whose start request was answered (only then can the installers' state be read as
 * theirs: it may still hold an older run). `starting`: a start request is in flight. `wasActive`: updates ran since the last refresh.
 */
export function decideNext(queue: UpdateItem[], outcome: (item: UpdateItem) => UpdateOutcome, started: ReadonlySet<string>, starting: boolean, wasActive: boolean): RunnerAction {
  const running = queue.find((i) => i.status === 'running')
  if (running) {
    if (!started.has(running.key)) return { type: 'idle' }
    const result = outcome(running)
    return result.phase === 'running' ? { type: 'idle' } : { type: 'finish', key: running.key, status: result.phase, error: result.error }
  }
  const next = starting ? null : nextToStart(queue)
  if (next) return { type: 'start', item: next }
  return !isActive(queue) && !starting && wasActive ? { type: 'refresh' } : { type: 'idle' }
}
