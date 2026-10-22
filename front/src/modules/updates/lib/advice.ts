/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { AdviceFinding, AdviceVerdict, EngineUpdate, ModelUpdate, UpdateAdvisory, UpdateItem, UpdateKind, UpdateTarget, UpdatesReport } from '../types'

/** What to analyse: one release of an engine (the tested one or the newest) or the changed files of a model. */
export interface AnalysisJob {
  key: string
  kind: UpdateKind
  id: string
  /** Shown while it runs ("analysis of …"). */
  name: string
  target: UpdateTarget
}

export const jobKey = (kind: UpdateKind, id: string, target: UpdateTarget): string => `advice:${kind}:${id}:${target}`

/** An advice that is about the version on offer (a stale one is about another: it is shown as such, and the analysis can be run again). */
export const isFresh = (advice: UpdateAdvisory | null | undefined): boolean => !!advice && advice.stale !== true

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const

/** The findings, the most serious first (the order the engine returned them in breaks ties). */
export function sortFindings(findings: AdviceFinding[]): AdviceFinding[] {
  return findings.map((f, i) => ({ f, i })).sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i).map(({ f }) => f)
}

/** Tone of the badge of a verdict. */
export const verdictTone = (verdict: AdviceVerdict): 'ok' | 'warn' | 'danger' => (verdict === 'none' ? 'ok' : verdict === 'caution' ? 'warn' : 'danger')

/** The analysis of one update (`target`: the tested release of an engine or the untested newest one; models and packs use `pinned`). */
export const makeJob = (kind: UpdateKind, id: string, name: string, target: UpdateTarget): AnalysisJob => ({ key: jobKey(kind, id, target), kind, id, name, target })

const analysableEngine = (e: EngineUpdate): boolean => e.reason === 'pinned' && !!e.target

/**
 * The analyses a check calls for: the update each row installs (engines: the tested release; models: what changed on the Hub) and
 * the untested newest release of an engine, each without an advice that is about the version on offer. Packs have no public page to read.
 */
export function analysisJobs(rows: { engines: EngineUpdate[]; models: ModelUpdate[] }): AnalysisJob[] {
  const jobs: AnalysisJob[] = []
  for (const e of rows.engines.filter(analysableEngine)) {
    if (e.state === 'update' && !isFresh(e.advice)) jobs.push(makeJob('engine', e.id, `${e.name} ${e.target}`, 'pinned'))
    if (e.latest && !isFresh(e.latest.advice)) jobs.push(makeJob('engine', e.id, `${e.name} ${e.latest.tag}`, 'latest'))
  }
  for (const m of rows.models) {
    if (m.state === 'update' && !isFresh(m.advice)) jobs.push(makeJob('model', m.id, m.name, 'pinned'))
  }
  return jobs
}

/** The check with `advisory` attached where it belongs (the row whose offered version it is about); the report is returned as it is when none matches. */
export function attachAdvisory(report: UpdatesReport, advisory: UpdateAdvisory): UpdatesReport {
  const { kind, item_id: id, to_version: to } = advisory
  if (kind === 'model') {
    return { ...report, models: report.models.map((m) => (m.id === id && m.fingerprint === to ? { ...m, advice: advisory } : m)) }
  }
  return {
    ...report,
    engines: report.engines.map((e) => {
      if (e.id !== id) return e
      if (e.latest?.tag === to) return { ...e, latest: { ...e.latest, advice: advisory } }
      return e.target === to ? { ...e, advice: advisory } : e
    }),
  }
}

/** The fresh advice about the release/files an update item installs, if any. */
export function adviceForItem(item: Pick<UpdateItem, 'kind' | 'id' | 'target'>, report: UpdatesReport | undefined): UpdateAdvisory | null {
  if (!report) return null
  if (item.kind === 'model') return pick(report.models.find((m) => m.id === item.id)?.advice)
  const row = report.engines.find((e) => e.id === item.id)
  return pick(item.target === 'latest' ? row?.latest?.advice : row?.advice)
}

const pick = (advice: UpdateAdvisory | null | undefined): UpdateAdvisory | null => (isFresh(advice) ? (advice ?? null) : null)

/** The items whose fresh advice discourages the update (the confirmation lists them; nothing is blocked). */
export function discouragedItems(items: UpdateItem[], report: UpdatesReport | undefined): { name: string; advice: UpdateAdvisory }[] {
  return items.flatMap((item) => {
    const advice = adviceForItem(item, report)
    return advice?.verdict === 'discouraged' ? [{ name: item.name, advice }] : []
  })
}

/** The serious findings of an advice as plain text for a confirmation: `title (« quote »)`, at most `max`. */
export function findingsText(advice: UpdateAdvisory, max = 3): string {
  const serious = sortFindings(advice.findings).filter((f) => f.severity !== 'info')
  const picked = (serious.length > 0 ? serious : sortFindings(advice.findings)).slice(0, max)
  return picked.map((f) => (f.quote && f.quote !== f.title ? `${f.title} (« ${f.quote} »)` : f.title)).join(' ; ')
}

/** The check without the advice `id` (it was forgotten): the row it was attached to has none until a new analysis. */
export function dropAdvisory(report: UpdatesReport, id: string): UpdatesReport {
  const drop = <T extends { advice: UpdateAdvisory | null }>(row: T): T => (row.advice?.id === id ? { ...row, advice: null } : row)
  return {
    ...report,
    engines: report.engines.map((e) => {
      const next = drop(e)
      return next.latest?.advice?.id === id ? { ...next, latest: { ...next.latest, advice: null } } : next
    }),
    models: report.models.map(drop),
  }
}
