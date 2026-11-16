/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { nowSeconds } from 'src/modules/media-library';
import { TranscriptEntity } from '../entities/TranscriptEntity';
import type { TranscriptDto } from '../types/transcriptTypes';

export function transcriptDto(row: TranscriptEntity): TranscriptDto {
  return { id: row.id, title: row.title, source_kind: row.sourceKind, source_url: row.sourceUrl,
    model_id: row.modelId, model_name: row.modelName, language: row.language, status: row.status, stage: row.stage,
    progress: row.progress, duration: row.duration, processed_seconds: row.processedSeconds, error: row.error,
    created_at: row.createdAt, updated_at: row.updatedAt };
}

@Injectable()
export class TranscriptStore {
  constructor(@InjectRepository(TranscriptEntity) private readonly rows: Repository<TranscriptEntity>) {}

  get(id: string): Promise<TranscriptEntity | null> { return this.rows.findOneBy({ id }); }
  save(row: TranscriptEntity): Promise<TranscriptEntity> { return this.rows.save(row); }
  active(): Promise<TranscriptEntity[]> { return this.rows.find({ where: { status: In(['queued', 'running']) }, order: { createdAt: 'ASC' } }); }

  /** Lists summaries only; long text stays in the detail response. */
  async list(query?: string): Promise<TranscriptDto[]> {
    const q = query?.trim();
    const select = ['id', 'title', 'sourceKind', 'sourceUrl', 'modelId', 'modelName', 'language', 'status', 'stage', 'progress', 'duration', 'processedSeconds', 'error', 'createdAt', 'updatedAt'];
    const rows = await this.rows.find({
      where: q ? [{ title: ILike(`%${q}%`) }, { text: ILike(`%${q}%`) }] : {},
      order: { createdAt: 'DESC' }, take: 100,
      select: Object.fromEntries(select.map((key) => [key, true])),
    });
    return rows.map(transcriptDto);
  }

  async update(id: string, patch: Partial<TranscriptEntity>): Promise<TranscriptEntity | null> {
    await this.rows.update({ id }, { ...patch, updatedAt: nowSeconds() });
    return this.get(id);
  }

  async remove(id: string): Promise<void> { await this.rows.delete({ id }); }
}
