/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocalAiSetup, type LocalAiSetup } from '@/modules/engines'
import { StudioApiError } from '@/modules/studio-shell/services/studioHttp'
import { analysisJobs, attachAdvisory, jobKey } from '../lib/advice'
import { adviceProgress, nextJob, stopsTheQueue, type AdviceJob } from '../lib/adviceQueue'
import { updatesKeys } from '../lib/updatesKeys'
import { updatesApi } from '../services/updatesApi'
import { useAdviceStore, useUpdatesPrefs } from '../state/adviceStore'
import type { UpdateKind, UpdateTarget, UpdatesReport } from '../types'

/** Runs the queued analyses one after the other; each answer is stored by the server and put into the check without reading the network again. */
function useAdviceRunner(): void {
  const queryClient = useQueryClient()
  const queue = useAdviceStore((s) => s.queue)
  const running = useRef(false)
  useEffect(() => {
    const job = nextJob(queue)
    if (running.current || !job) return
    running.current = true
    const { setStatus } = useAdviceStore.getState()
    setStatus(job.key, 'running')
    updatesApi
      .advise({ kind: job.kind, id: job.id, target: job.target })
      .then((advisory) => {
        queryClient.setQueryData<UpdatesReport>(updatesKeys.check, (report) => (report ? attachAdvisory(report, advisory) : report))
        void queryClient.invalidateQueries({ queryKey: updatesKeys.advisories })
        setStatus(job.key, 'done')
      })
      .catch((error: Error) => {
        const code = error instanceof StudioApiError ? (error.code ?? null) : null
        setStatus(job.key, 'error', error.message, code)
        if (stopsTheQueue(code)) useAdviceStore.getState().dropQueued()
      })
      .finally(() => {
        running.current = false
        useAdviceStore.setState((s) => ({ queue: [...s.queue] })) // run the effect again: the next analysis
      })
  }, [queue, queryClient])
  useEffect(() => () => useAdviceStore.getState().dropQueued(), []) // closing the dialog drops what was waiting
}

/** After each check, with "automatic analysis" on and a local model ready, queues the analysis of every update that has no advice for the version on offer. */
function useAutoAdvice(report: UpdatesReport | undefined, ready: boolean): void {
  const auto = useUpdatesPrefs((s) => s.autoAdvice)
  const seen = useRef<number | null>(null)
  useEffect(() => {
    if (!auto || !ready || !report) {
      if (!auto) seen.current = null
      return
    }
    if (seen.current === report.checked_at) return // one pass per check: a failed analysis is not asked again by itself
    seen.current = report.checked_at
    const jobs = analysisJobs({ engines: report.engines, models: report.models })
    if (jobs.length > 0) useAdviceStore.getState().enqueue(jobs)
  }, [auto, ready, report])
}

export interface Advisor {
  setup: LocalAiSetup
  /** A chat model and its engine are installed: analyses can run. */
  ready: boolean
  queue: AdviceJob[]
  jobFor: (kind: UpdateKind, id: string, target: UpdateTarget) => AdviceJob | undefined
  progress: ReturnType<typeof adviceProgress>
}

/** Everything the dialog needs about the adviser: the local AI setup, the analyses queue and its runner, and the automatic analysis. */
export function useAdvisor(report: UpdatesReport | undefined): Advisor {
  const setup = useLocalAiSetup()
  const queue = useAdviceStore((s) => s.queue)
  const ready = setup.state === 'ready'
  useAdviceRunner()
  useAutoAdvice(report, ready)
  return { setup, ready, queue, jobFor: (kind, id, target) => queue.find((j) => j.key === jobKey(kind, id, target)), progress: adviceProgress(queue) }
}
