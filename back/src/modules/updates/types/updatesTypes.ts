/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { EngineInstallState, PackInstallState } from 'src/modules/engines';
import type { DownloadProgress, ModelKind } from 'src/modules/model-catalog';

/** `current`: up to date. `update`: a newer version can be installed. `error`: the check failed (models only). */
export type UpdateState = 'current' | 'update' | 'error';

/** Which release an engine update installs: the one the application was tested with, or the newest upstream one (untested). */
export type UpdateTarget = 'pinned' | 'latest';

/** What an update is about: an engine or a model. */
export type UpdateItemKind = 'engine' | 'model';

/** `none`: nothing notable; `caution`: points to watch; `discouraged`: a critical report or a documented regression. Computed by the engine's code, never by the model. */
export type AdviceVerdict = 'none' | 'caution' | 'discouraged';

/** One problem the adviser found. `quote` is an excerpt of the source (checked word for word by the engine) or the documented regression. */
export interface AdviceFinding {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  quote: string;
  /** The page it comes from; empty for a regression the repository documents. */
  url: string;
  /** `release` | `issue` | `commit` | `discussion` | `card` | `known`. */
  source_kind: string;
}

export interface AdviceSource {
  title: string;
  url: string;
}

/** The advice about one update as the engine answers (`POST /engine/v1/updates/advice`). */
export interface EngineAdvice {
  kind: UpdateItemKind;
  id: string;
  target: UpdateTarget;
  from_version: string | null;
  to_version: string | null;
  verdict: AdviceVerdict;
  summary: string;
  findings: AdviceFinding[];
  sources: AdviceSource[];
  notes: string[];
  truncated: number;
  rejected: number;
  llm_model_id: string;
  generated_at: number;
}

/**
 * A stored advice (`update_advisories`). Informative only, and shown with "automatic advice, to be checked". `stale`: the
 * version it is about is no longer the one the last check offers (null when no check has been seen since the start).
 */
export interface UpdateAdvisory {
  id: string;
  kind: UpdateItemKind;
  item_id: string;
  from_version: string | null;
  to_version: string;
  verdict: AdviceVerdict;
  summary: string;
  findings: AdviceFinding[];
  sources: AdviceSource[];
  notes: string[];
  llm_model_id: string;
  /** Seconds since the epoch. */
  created_at: number;
  stale: boolean | null;
}

/** Body of `POST /api/updates/advise`. */
export interface AdviseBody {
  kind: UpdateItemKind;
  id: string;
  /** Engines: the tested release (`pinned`, default) or the newest upstream one (`latest`, untested). */
  target: UpdateTarget;
}

/** A defect of upstream builds that the repository documents (`KNOWN_REGRESSIONS` in `engine/app/updates.py`). */
export interface KnownRegression {
  effect: string;
  source: string;
}

/** An installed engine (`engine/app/updates.py`): stable-diffusion.cpp, audio.cpp or a Python pack. */
export interface EngineUpdate {
  id: string;
  name: string;
  /** The kinds of models the engine runs. */
  kinds: ModelKind[];
  state: Exclude<UpdateState, 'error'>;
  /** Installed release tag, or the install date of a pack (`?` when unknown). */
  installed: string;
  /** The release the application pins (null for a pack). */
  target: string | null;
  /** Newest upstream release, for information: it is never installed by an update. */
  upstream: string | null;
  /** A newer upstream release than the installed one and the pin: an untested update the user may choose, with its known regressions (empty when none). */
  latest: { tag: string; regressions: KnownRegression[]; /** Stored advice about that release. */ advice: UpdateAdvisory | null } | null;
  /** The installed build is newer than the pin (installed as `latest`): `pinned` goes back to the tested release. */
  rollback: boolean;
  variant: string | null;
  size_mb: number;
  /** `pinned`: installed build older than the pin; `recipe`: the dependencies pinned for the pack changed. */
  reason: 'pinned' | 'recipe';
  /** The stored advice about the release the update installs (`target`), when there is one (`stale` when it is about another). */
  advice: UpdateAdvisory | null;
}

/** An installed model: how many of its files changed on Hugging Face and how much has to come over. */
export interface ModelUpdate {
  id: string;
  name: string;
  kind: ModelKind;
  state: UpdateState;
  files: number;
  size_gb: number;
  error: string | null;
  /** Short revision of the cache, and the fingerprint of what changed on the Hub (set when `state` is `update`): the advice is tied to it. */
  revision: string | null;
  fingerprint: string | null;
  /** The stored advice about this update, when there is one (`stale` when the Hub changed again since). */
  advice: UpdateAdvisory | null;
}

export interface UpdatesReport {
  engines: EngineUpdate[];
  models: ModelUpdate[];
  /** Seconds since the epoch. */
  checked_at: number;
}

/** What starting an update answers: the installer's state, whose progress then comes through its events. */
export type UpdateStarted = DownloadProgress | EngineInstallState | PackInstallState;
