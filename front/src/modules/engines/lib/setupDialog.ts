/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { InstallPlan, InstallPlanStep, PlanStepKind, SetupRun } from '../types'

/** What the confirmation dialog of a model setup shows. */
export type DialogPhase = 'loading' | 'confirm' | 'ready' | 'blocked' | 'running' | 'done' | 'failed' | 'cancelled'

/** A run that has not started: what the store holds before any setup, and after a dialog is reopened. */
export const IDLE_RUN: SetupRun = {
  state: 'idle', model_id: null, model_name: null, steps: [], current: -1, total_mb: 0, message: '', detail: '',
  done: 0, total: 0, rate: 0, eta: null, error: null, started_at: null,
}

/** The phase of the dialog for a model: its own run when there is one, else what its plan says. */
export function dialogPhase(modelId: string, plan: InstallPlan | undefined, run: SetupRun): DialogPhase {
  if (run.model_id === modelId && run.state !== 'idle') {
    return run.state === 'running' ? 'running' : run.state === 'done' ? 'done' : run.state === 'error' ? 'failed' : 'cancelled'
  }
  if (!plan) return 'loading'
  if (plan.blocked) return 'blocked'
  return plan.ready ? 'ready' : 'confirm'
}

/** The steps that still have to be downloaded, in install order (base data, engine, model). */
export function missingSteps(plan: InstallPlan): InstallPlanStep[] {
  return plan.steps.filter((s) => !s.installed)
}

/** Locale key of the label that tells what a step is ("Données de base", "Moteur d'exécution", "Modèle"). */
export function stepKindKey(kind: PlanStepKind): string {
  return `engines.setup.kind.${kind}`
}

/** A size in MB as "320 Mo" or "4,5 Go" (decimal separator of the language). */
export function formatSize(mb: number, lang: string): string {
  if (mb >= 1024) return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(mb / 1024)} ${lang === 'fr' ? 'Go' : 'GB'}`
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(mb)))} ${lang === 'fr' ? 'Mo' : 'MB'}`
}

/** Whether the bar of the running step has a known length (an engine download), else it is indeterminate (a Python environment). */
export function hasKnownTotal(run: Pick<SetupRun, 'total'>): boolean {
  return run.total > 0
}
