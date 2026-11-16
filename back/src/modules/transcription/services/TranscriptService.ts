/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnApplicationBootstrap, UnprocessableEntityException } from '@nestjs/common';
import { mkdir, rename, rm } from 'fs/promises';
import { join } from 'path';
import { tr } from 'src/modules/i18n';
import { newId, nowSeconds, StudioEvents } from 'src/modules/media-library';
import { ModelCatalogService, type ModelInfo } from 'src/modules/model-catalog';
import { PrivateSessionService } from 'src/modules/private';
import { vtrace } from 'src/modules_shared/common/validation';
import { TranscriptEntity } from '../entities/TranscriptEntity';
import { MAX_TEXT_CHARACTERS, sourceExtension, youtubeUrl } from '../lib/transcriptRules';
import type { TranscriptDetailDto, TranscriptDto, TranscriptInput } from '../types/transcriptTypes';
import { transcriptDir, TranscriptQueue } from './TranscriptQueue';
import { TranscriptStore, transcriptDto } from './TranscriptStore';

@Injectable()
export class TranscriptService implements OnApplicationBootstrap {
  constructor(private readonly store: TranscriptStore, private readonly queue: TranscriptQueue,
    private readonly catalog: ModelCatalogService, private readonly events: StudioEvents, private readonly session: PrivateSessionService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.cleanupAll();
    for (const row of await this.store.active()) {
      if (row.status === 'queued') this.queue.enqueue(row.id);
      else await this.store.update(row.id, { status: 'failed', stage: 'failed', error: tr('transcription.error.interrupted') });
    }
  }

  list(query?: string): Promise<TranscriptDto[]> { return this.store.list(query); }

  async detail(id: string): Promise<TranscriptDetailDto> {
    const row = await this.require(id);
    return { ...transcriptDto(row), text: row.text };
  }

  async create(input: TranscriptInput): Promise<TranscriptDto> {
    this.requirePersistentMode();
    if (Boolean(input.url) === Boolean(input.filePath)) throw new UnprocessableEntityException(tr('transcription.error.source'));
    const url = input.url ? youtubeUrl(input.url) : null;
    const extension = input.filePath ? sourceExtension(input.originalName || '') : '';
    const model = await this.model(input.modelId);
    const id = newId();
    const folder = transcriptDir(id);
    await mkdir(folder, { recursive: true });
    try {
      const sourceFile = input.filePath ? `source${extension}` : null;
      if (input.filePath && sourceFile) await rename(input.filePath, join(folder, sourceFile));
      const now = nowSeconds();
      const row = await this.store.save(Object.assign(new TranscriptEntity(), {
        id, title: (input.originalName || tr('transcription.youtube')).slice(0, 240), sourceKind: url ? 'youtube' : 'file',
        sourceUrl: url, sourceFile, modelId: model.id, modelName: model.name, language: input.language,
        status: 'queued', stage: 'queued', progress: null, duration: 0, processedSeconds: 0, text: '', error: null,
        createdAt: now, updatedAt: now,
      }));
      this.events.publish('transcription.updated', transcriptDto(row));
      vtrace('transcription.created', 'ok', { id, source: row.sourceKind });
      this.queue.enqueue(id);
      return transcriptDto(row);
    } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  }

  async edit(id: string, text: unknown): Promise<TranscriptDetailDto> {
    this.requirePersistentMode();
    const row = await this.require(id);
    this.requireIdle(row);
    if (typeof text !== 'string' || text.length > MAX_TEXT_CHARACTERS) throw new UnprocessableEntityException(tr('transcription.error.text'));
    const saved = await this.store.update(id, { text });
    this.events.publish('transcription.updated', transcriptDto(saved as TranscriptEntity));
    vtrace('transcription.edited', 'ok', { id });
    return this.detail(id);
  }

  async retry(id: string): Promise<TranscriptDto> {
    this.requirePersistentMode();
    const row = await this.require(id);
    this.requireIdle(row);
    await this.model(row.modelId);
    const saved = await this.store.update(id, { status: 'queued', stage: 'queued', error: null, text: '', duration: 0, processedSeconds: 0, progress: null });
    this.events.publish('transcription.updated', transcriptDto(saved as TranscriptEntity));
    this.queue.enqueue(id);
    return transcriptDto(saved as TranscriptEntity);
  }

  async cancel(id: string): Promise<TranscriptDto> {
    await this.require(id);
    if (!this.queue.isActive(id)) throw new ConflictException(tr('transcription.error.notRunning'));
    await this.queue.cancel(id);
    return transcriptDto(await this.require(id));
  }

  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.queue.cancel(id);
    await this.store.remove(id);
    await rm(transcriptDir(id), { recursive: true, force: true });
    this.events.publish('transcription.deleted', { id });
    vtrace('transcription.deleted', 'ok', { id });
  }

  private async require(id: string): Promise<TranscriptEntity> {
    const row = await this.store.get(id);
    if (!row) throw new NotFoundException(tr('transcription.error.notFound'));
    return row;
  }

  private requirePersistentMode(): void {
    if (!this.session.active) return;
    vtrace('transcription.private_refused', 'ok', { reason: 'private' });
    throw new ForbiddenException(tr('transcription.error.private'));
  }

  private requireIdle(row: TranscriptEntity): void {
    if (this.queue.isActive(row.id) || row.status === 'queued' || row.status === 'running') throw new ConflictException(tr('transcription.error.busy'));
  }

  private async model(id?: string): Promise<ModelInfo> {
    const catalog = await this.catalog.catalog();
    const matches = catalog.models.filter((model) => model.kind === 'audio' && model.audio?.task === 'stt');
    const model = id ? matches.find((item) => item.id === id) : matches.find((item) => item.ready && item.engine_available !== false);
    if (!model || !model.ready || model.engine_available === false) throw new ConflictException(tr('transcription.error.model'));
    return model;
  }
}
