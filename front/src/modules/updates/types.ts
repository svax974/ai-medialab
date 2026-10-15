/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelKind } from '@/modules/model-catalog'

/** What an update is about: an engine or a model. */
export type UpdateKind = 'engine' | 'model'

export type AdviceVerdict = 'none' | 'caution' | 'discouraged'

/** One problem the adviser found: `quote` is an excerpt of the source (checked word for word by the engine) or the documented regression. */
export interface AdviceFinding {
  severity: 'info' | 'warning' | 'critical'
  title: string
  quote: string
  /** The page it comes from; empty for a regression the repository documents. */
  url: string
  /** `release` | `issue` | `commit` | `discussion` | `card` | `known`. */
  source_kind: string
}

export interface AdviceSource {
  title: string
  url: string
}

/**
 * A stored advice about one update (`GET /api/updates/advisories`, merged into the rows of the check). Informative, never blocking.
 * `stale`: it is about another version than the one on offer (null: no check seen yet).
 */
export interface UpdateAdvisory {
  id: string
  kind: UpdateKind
  item_id: string
  from_version: string | null
  to_version: string
  verdict: AdviceVerdict
  summary: string
  findings: AdviceFinding[]
  sources: AdviceSource[]
  notes: string[]
  llm_model_id: string
  /** Seconds since the epoch. */
  created_at: number
  stale: boolean | null
}

/** Body of `POST /api/updates/advise`. */
export interface AdviseBody {
  kind: UpdateKind
  id: string
  target: UpdateTarget
}

/** `GET /api/updates/check` (back/src/modules/updates/README.md). `error`: the check of a model failed (network, access). */
export type UpdateState = 'current' | 'update' | 'error'

export interface EngineUpdate {
  id: string
  name: string
  kinds: ModelKind[]
  state: Exclude<UpdateState, 'error'>
  /** Release tag of the installed build, or the install date of a pack; `?` when unknown. */
  installed: string
  /** The release the application pins (null for a pack). */
  target: string | null
  /** Newest upstream release: information only, an update never installs it. */
  upstream: string | null
  /** A newer upstream release than the installed one and the pin, never installed by the bulk buttons: its known regressions, if any. */
  latest: { tag: string; regressions: KnownRegression[]; /** The stored advice about that release. */ advice: UpdateAdvisory | null } | null
  /** The installed build is newer than the pin: `pinned` goes back to the tested release. */
  rollback: boolean
  variant: string | null
  size_mb: number
  /** `pinned`: build older than the pin; `recipe`: the dependencies pinned for a pack changed since it was installed. */
  reason: 'pinned' | 'recipe'
  /** The stored advice about the release the update installs, when there is one (`stale` when it is about another). */
  advice: UpdateAdvisory | null
}

/** A defect of upstream builds the repository documents (`KNOWN_REGRESSIONS` of the engine). */
export interface KnownRegression {
  effect: string
  source: string
}

/** The release an engine update installs: the tested one, or the newest upstream one (untested). */
export type UpdateTarget = 'pinned' | 'latest'

export interface ModelUpdate {
  id: string
  name: string
  kind: ModelKind
  state: UpdateState
  /** Files that changed on Hugging Face and the size to download again. */
  files: number
  size_gb: number
  error: string | null
  /** Short revision of the cache and fingerprint of what changed on the Hub (the advice is tied to it). */
  revision: string | null
  fingerprint: string | null
  /** The stored advice about this update, when there is one. */
  advice: UpdateAdvisory | null
}

export interface UpdatesReport {
  engines: EngineUpdate[]
  models: ModelUpdate[]
  /** Seconds since the epoch. */
  checked_at: number
}

export type UpdateItemStatus = 'queued' | 'running' | 'done' | 'error'

/** One update asked for: waiting, running (its progress comes from the installer's events), done or failed. */
export interface UpdateItem {
  key: string
  kind: UpdateKind
  id: string
  name: string
  /** Engines only: which release to install. */
  target: UpdateTarget
  status: UpdateItemStatus
  error: string | null
}

/** The kind tabs of the dialog; `all` shows everything. */
export type KindFilter = 'all' | ModelKind
