/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';
import type { AdviceFinding, AdviceSource, AdviceVerdict, UpdateItemKind } from '../types/updatesTypes';

/**
 * What the adviser found out about one update, kept so that it can be shown again without running the model (and when the
 * machine is offline). Up to `ADVISORY_HISTORY` rows per item; for one (kind, item, target version) the most recent row is
 * the one that counts. Never read back by the engine.
 */
@Entity({ name: 'update_advisories' })
@Index('idx_update_advisories_item', ['kind', 'itemId', 'createdAt'])
export class UpdateAdvisoryEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  kind: UpdateItemKind;

  /** The engine id (`sdcpp`) or the model id. */
  @Column({ name: 'item_id', type: 'varchar' })
  itemId: string;

  /** Installed release (engines) or short revision of the cache (models). */
  @Column({ name: 'from_version', type: 'varchar', nullable: true })
  fromVersion: string | null;

  /** Target release (engines) or fingerprint of what changed on the Hub (models). */
  @Column({ name: 'to_version', type: 'varchar' })
  toVersion: string;

  @Column({ type: 'varchar' })
  verdict: AdviceVerdict;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: jsonColumnType(), default: () => "'[]'" })
  findings: AdviceFinding[];

  @Column({ type: jsonColumnType(), default: () => "'[]'" })
  sources: AdviceSource[];

  /** What could not be read (rate limit, network). */
  @Column({ type: jsonColumnType(), default: () => "'[]'" })
  notes: string[];

  @Column({ name: 'llm_model_id', type: 'varchar' })
  llmModelId: string;

  /** Epoch seconds (float), like every timestamp of the application tables. */
  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;
}
