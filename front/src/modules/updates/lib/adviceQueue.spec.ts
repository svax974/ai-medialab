/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { makeJob } from './advice'
import { adviceProgress, dropQueued, enqueueJobs, nextJob, setJobStatus, stopsTheQueue } from './adviceQueue'

const a = makeJob('engine', 'sdcpp', 'sd.cpp', 'pinned')
const b = makeJob('engine', 'sdcpp', 'sd.cpp latest', 'latest')
const c = makeJob('model', 'wan', 'Wan', 'pinned')

describe('analyses queue', () => {
  it('adds what is not already waiting or running, in order', () => {
    const q = enqueueJobs([], [a, b])
    expect(q.map((j) => [j.key, j.status])).toEqual([[a.key, 'queued'], [b.key, 'queued']])
    expect(enqueueJobs(q, [b, c]).map((j) => j.key)).toEqual([a.key, b.key, c.key])
  })

  it('asks again for a job that finished or failed (it replaces the old one)', () => {
    let q = enqueueJobs([], [a, b])
    q = setJobStatus(q, a.key, 'error', 'Pas de réseau', 'no_sources')
    const again = enqueueJobs(q, [a])
    expect(again.map((j) => j.key)).toEqual([b.key, a.key])
    expect(again[1]).toMatchObject({ status: 'queued', error: null, code: null })
  })

  it('runs one at a time, the first waiting one first', () => {
    let q = enqueueJobs([], [a, b])
    expect(nextJob(q)?.key).toBe(a.key)
    q = setJobStatus(q, a.key, 'running')
    expect(nextJob(q)).toBeNull()
    q = setJobStatus(q, a.key, 'done')
    expect(nextJob(q)?.key).toBe(b.key)
    expect(nextJob(setJobStatus(q, b.key, 'done'))).toBeNull()
  })

  it('forgets what was waiting when stopped; the running one stays', () => {
    let q = setJobStatus(enqueueJobs([], [a, b, c]), a.key, 'running')
    q = dropQueued(q)
    expect(q.map((j) => j.key)).toEqual([a.key])
  })

  it('reports where it stands: position and total, the running one first', () => {
    let q = enqueueJobs([], [a, b, c])
    expect(adviceProgress(q)).toMatchObject({ position: 1, total: 3, current: { key: a.key } })
    q = setJobStatus(setJobStatus(q, a.key, 'done'), b.key, 'running')
    expect(adviceProgress(q)).toMatchObject({ position: 2, total: 3, current: { key: b.key } })
    expect(adviceProgress(setJobStatus(setJobStatus(setJobStatus(q, a.key, 'done'), b.key, 'done'), c.key, 'error'))).toBeNull()
    expect(adviceProgress([])).toBeNull()
  })

  it('stops the waiting jobs after a failure that would repeat for each of them', () => {
    for (const code of ['busy', 'no_model', 'no_engine']) expect(stopsTheQueue(code)).toBe(true)
    for (const code of ['no_sources', 'llm', 'llm_output', null, 'nothing_to_analyse']) expect(stopsTheQueue(code)).toBe(false)
  })
})
