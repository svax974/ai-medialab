/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { TranscriptStage, TranscriptStatus } from '../types/transcriptTypes';

@Entity({ name: 'transcripts' })
@Index('idx_transcripts_created', ['createdAt'])
export class TranscriptEntity {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ type: 'varchar' }) title: string;
  @Column({ name: 'source_kind', type: 'varchar' }) sourceKind: 'file' | 'youtube';
  @Column({ name: 'source_url', type: 'text', nullable: true }) sourceUrl: string | null;
  @Column({ name: 'source_file', type: 'varchar', nullable: true }) sourceFile: string | null;
  @Column({ name: 'model_id', type: 'varchar' }) modelId: string;
  @Column({ name: 'model_name', type: 'varchar' }) modelName: string;
  @Column({ type: 'varchar', nullable: true }) language: string | null;
  @Column({ type: 'varchar', default: 'queued' }) status: TranscriptStatus;
  @Column({ type: 'varchar', default: 'queued' }) stage: TranscriptStage;
  @Column({ type: 'float', nullable: true }) progress: number | null;
  @Column({ type: 'float', default: 0 }) duration: number;
  @Column({ name: 'processed_seconds', type: 'float', default: 0 }) processedSeconds: number;
  @Column({ type: 'text', default: '' }) text: string;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ name: 'created_at', type: 'float' }) createdAt: number;
  @Column({ name: 'updated_at', type: 'float' }) updatedAt: number;
}
