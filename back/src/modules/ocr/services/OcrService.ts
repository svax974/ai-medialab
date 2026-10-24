/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { ConflictException, Injectable, NotFoundException, OnApplicationBootstrap, UnprocessableEntityException } from '@nestjs/common';
import { copyFile, mkdir, rename, rm } from 'fs/promises';
import { extname, join } from 'path';
import { tr } from 'src/modules/i18n';
import { StudioEvents, newId, nowSeconds } from 'src/modules/media-library';
import { ModelCatalogService, type ModelInfo } from 'src/modules/model-catalog';
import { OcrDocumentEntity } from '../entities/OcrDocumentEntity';
import { exportFileName, exportReading } from '../lib/exportText';
import { OcrQueueService, ocrDir } from './OcrQueueService';
import { OcrStoreService, toDocumentDto } from './OcrStoreService';
import {
  OCR_TASKS, type CreateOcrInput, type OcrDocumentDetailDto, type OcrDocumentDto, type OcrExportFormat, type OcrSourceKind, type OcrTask,
} from '../types/ocrTypes';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_PROMPT = 4000;

/** What a reading changes when it is started again: the model, the task, the instruction, the pages. */
export type RetryOverrides = Partial<Pick<CreateOcrInput, 'modelId' | 'task' | 'prompt' | 'pages'>> & { forceMemory?: boolean };

function sourceKindOf(path: string): OcrSourceKind {
  const extension = extname(path).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  throw new UnprocessableEntityException(tr('ocr.error.format'));
}

/**
 * The OCR tab: creates readings (an image or a PDF, an OCR model, a task), keeps them with their pages, and hands them to the
 * queue. The engine reads and cleans the text; this service owns what is kept (rows, files) and what the browser sees.
 */
@Injectable()
export class OcrService implements OnApplicationBootstrap {
  constructor(
    private readonly store: OcrStoreService,
    private readonly queue: OcrQueueService,
    private readonly catalog: ModelCatalogService,
    private readonly events: StudioEvents,
  ) {}

  /** A reading that was running when the application stopped cannot continue (the engine forgot it): it ends as failed; the waiting ones resume. */
  async onApplicationBootstrap(): Promise<void> {
    for (const doc of await this.store.active()) {
      if (doc.status === 'running') await this.store.update(doc.id, { status: 'failed', error: tr('ocr.error.interrupted') });
      else this.queue.enqueue(doc.id);
    }
  }

  async list(q?: string): Promise<OcrDocumentDto[]> {
    return (await this.store.list(q)).map(toDocumentDto);
  }

  async detail(id: string): Promise<OcrDocumentDetailDto> {
    const doc = await this.store.detail(id);
    if (!doc) throw new NotFoundException(tr('ocr.error.notFound'));
    return doc;
  }

  /** Creates a reading from a file on disk (moved into the reading's folder when `move`, else copied) and queues it. */
  async create(input: CreateOcrInput, move: boolean): Promise<OcrDocumentDto> {
    const kind = sourceKindOf(input.originalName || input.filePath);
    const task = input.task ?? 'default';
    const prompt = (input.prompt ?? '').trim();
    const model = await this.resolveModel(input.modelId);
    this.checkTask(model, task, prompt);
    const id = newId();
    const sourceFile = `source${extname(input.originalName || input.filePath).toLowerCase()}`;
    const dir = ocrDir(id);
    await mkdir(dir, { recursive: true });
    await (move ? rename(input.filePath, join(dir, sourceFile)) : copyFile(input.filePath, join(dir, sourceFile)));
    const now = nowSeconds();
    const row = await this.store.insert(Object.assign(new OcrDocumentEntity(), {
      id, title: input.originalName || sourceFile, sourceFile, sourceKind: kind, documentPages: kind === 'image' ? 1 : 0,
      pages: input.pages ?? null, modelId: model.id, modelName: model.name, task, prompt: prompt || null, status: 'queued', error: null,
      pagesDone: 0, pagesTotal: 0, createdAt: now, updatedAt: now,
    }));
    this.queue.enqueue(id);
    const dto = toDocumentDto(row);
    this.events.publish('ocr.updated', dto);
    return dto;
  }

  /** Starts a finished, failed or cancelled reading again (optionally with another model, task or pages): its pages are dropped. */
  async retry(id: string, overrides: RetryOverrides = {}): Promise<OcrDocumentDto> {
    const doc = await this.store.get(id);
    if (!doc) throw new NotFoundException(tr('ocr.error.notFound'));
    if (this.queue.isActive(id)) throw new ConflictException(tr('ocr.error.stillRunning'));
    const model = await this.resolveModel(overrides.modelId ?? doc.modelId);
    const task = overrides.task ?? doc.task;
    const prompt = overrides.prompt === undefined ? (doc.prompt ?? '') : overrides.prompt.trim();
    this.checkTask(model, task, prompt);
    await this.store.clearPages(id);
    const row = await this.store.update(id, {
      modelId: model.id, modelName: model.name, task, prompt: prompt || null, pages: overrides.pages === undefined ? doc.pages : overrides.pages,
      status: 'queued', error: null, errorCode: null, pagesDone: 0, pagesTotal: 0,
    });
    this.queue.enqueue(id, overrides.forceMemory);
    const dto = toDocumentDto(row as OcrDocumentEntity);
    this.events.publish('ocr.updated', dto);
    return dto;
  }

  async cancel(id: string): Promise<OcrDocumentDto> {
    const doc = await this.store.get(id);
    if (!doc) throw new NotFoundException(tr('ocr.error.notFound'));
    if (!this.queue.cancel(id)) throw new ConflictException(tr('ocr.error.notRunning'));
    if (doc.status === 'queued') {
      const row = await this.store.update(id, { status: 'cancelled' });
      this.events.publish('ocr.updated', toDocumentDto(row as OcrDocumentEntity));
      return toDocumentDto(row as OcrDocumentEntity);
    }
    return toDocumentDto(doc); // the running one reports `cancelled` itself once the engine has stopped
  }

  async remove(id: string): Promise<void> {
    this.queue.cancel(id);
    await this.store.remove(id);
    await rm(ocrDir(id), { recursive: true, force: true });
    this.events.publish('ocr.deleted', { id });
  }

  async exportFile(id: string, format: OcrExportFormat): Promise<{ body: string; mime: string; fileName: string }> {
    const doc = await this.detail(id);
    const { body, mime, extension } = exportReading(doc, format);
    return { body, mime, fileName: exportFileName(doc.title, extension) };
  }

  async sourcePath(id: string): Promise<{ path: string; name: string }> {
    const doc = await this.store.get(id);
    if (!doc) throw new NotFoundException(tr('ocr.error.notFound'));
    return { path: join(ocrDir(id), doc.sourceFile), name: doc.title };
  }

  private async resolveModel(requested: string | undefined): Promise<ModelInfo> {
    const catalog = await this.catalog.catalog().catch(() => {
      throw new ConflictException(tr('ocr.error.engineDown'));
    });
    const id = requested || catalog.ocr?.default_model_id;
    if (!id) throw new ConflictException(tr('ocr.error.noModel'));
    const model = catalog.models.find((m) => m.id === id && m.kind === 'ocr');
    if (!model) throw new NotFoundException(tr('ocr.error.unknownModel'));
    if (model.engine_available === false) throw new ConflictException(tr('ocr.error.noEngine'));
    if (!model.ready) throw new ConflictException(tr('ocr.error.modelNotDownloaded', [model.name]));
    return model;
  }

  private checkTask(model: ModelInfo, task: OcrTask, prompt: string): void {
    if (!(OCR_TASKS as readonly string[]).includes(task)) throw new UnprocessableEntityException(tr('ocr.error.task'));
    if (prompt.length > MAX_PROMPT) throw new UnprocessableEntityException(tr('ocr.error.promptTooLong', [MAX_PROMPT]));
    const caps = model.ocr;
    if (task === 'custom') {
      if (!caps?.free_prompt) throw new UnprocessableEntityException(tr('ocr.error.noFreePrompt', [model.name]));
      if (!prompt) throw new UnprocessableEntityException(tr('ocr.error.emptyPrompt'));
    } else if (task !== 'default' && caps && !(task in caps.tasks)) {
      throw new UnprocessableEntityException(tr('ocr.error.taskNotOffered', [model.name]));
    }
  }
}
