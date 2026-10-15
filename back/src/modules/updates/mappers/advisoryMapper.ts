/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { UpdateAdvisoryEntity } from '../entities/UpdateAdvisoryEntity';
import type { UpdateAdvisory } from '../types/updatesTypes';

/** Public shape of a stored advice (snake_case like the rest of the API); `stale` is decided by the caller. */
export function toAdvisoryDto(row: UpdateAdvisoryEntity, stale: boolean | null): UpdateAdvisory {
  return {
    id: row.id,
    kind: row.kind,
    item_id: row.itemId,
    from_version: row.fromVersion,
    to_version: row.toVersion,
    verdict: row.verdict,
    summary: row.summary,
    findings: row.findings,
    sources: row.sources,
    notes: row.notes,
    llm_model_id: row.llmModelId,
    created_at: row.createdAt,
    stale,
  };
}
