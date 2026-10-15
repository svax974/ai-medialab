/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { AnalysisJob } from './advice'

export type AdviceJobStatus = 'queued' | 'running' | 'done' | 'error'

/** An analysis asked for: waiting, running (one at a time), done or failed (`code`: the engine's reason, e.g. `busy`, `no_model`). */
export interface AdviceJob extends AnalysisJob {
  status: AdviceJobStatus
  error: string | null
  code: string | null
}

const ACTIVE: AdviceJobStatus[] = ['queued', 'running']
export const isActive = (job: AdviceJob): boolean => ACTIVE.includes(job.status)

/** Appends the jobs that are not already waiting or running; a finished or failed one is replaced (asked again). */
export function enqueueJobs(queue: AdviceJob[], jobs: AnalysisJob[]): AdviceJob[] {
  const active = new Set(queue.filter(isActive).map((j) => j.key))
  const fresh = jobs.filter((j) => !active.has(j.key)).map<AdviceJob>((j) => ({ ...j, status: 'queued', error: null, code: null }))
  const replaced = new Set(fresh.map((j) => j.key))
  return [...queue.filter((j) => !replaced.has(j.key)), ...fresh]
}

export function setJobStatus(queue: AdviceJob[], key: string, status: AdviceJobStatus, error: string | null = null, code: string | null = null): AdviceJob[] {
  return queue.map((j) => (j.key === key ? { ...j, status, error, code } : j))
}

/** Forgets the jobs that were still waiting (the running one finishes: its request cannot be called back). */
export const dropQueued = (queue: AdviceJob[]): AdviceJob[] => queue.filter((j) => j.status !== 'queued')

/** The job to run next: the first waiting one, only when none is running. */
export function nextJob(queue: AdviceJob[]): AdviceJob | null {
  return queue.some((j) => j.status === 'running') ? null : (queue.find((j) => j.status === 'queued') ?? null)
}

/** Progress of the analyses asked for since the last clear: `position` of the one running or next (1-based) out of `total`. */
export function adviceProgress(queue: AdviceJob[]): { position: number; total: number; current: AdviceJob } | null {
  const current = queue.find((j) => j.status === 'running') ?? queue.find((j) => j.status === 'queued')
  if (!current) return null
  const finished = queue.filter((j) => !isActive(j)).length
  return { position: finished + 1, total: queue.length, current }
}

/** After a failure that will repeat for every item (a generation is running, no model, no engine), the waiting jobs are pointless. */
export const STOPPING_CODES = ['busy', 'no_model', 'no_engine'] as const
export const stopsTheQueue = (code: string | null): boolean => !!code && (STOPPING_CODES as readonly string[]).includes(code)
