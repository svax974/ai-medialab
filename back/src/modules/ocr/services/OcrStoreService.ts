/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { nowSeconds } from 'src/modules/media-library';
import { OcrDocumentEntity } from '../entities/OcrDocumentEntity';
import { OcrPageEntity } from '../entities/OcrPageEntity';
import { OCR_ACTIVE_STATUSES, type OcrDocumentDetailDto, type OcrDocumentDto, type OcrPageDto } from '../types/ocrTypes';

export function toPageDto(page: OcrPageEntity): OcrPageDto {
  return { index: page.pageIndex, text: page.text, truncated: page.truncated, tokens: page.tokens };
}

export function toDocumentDto(doc: OcrDocumentEntity): OcrDocumentDto {
  return {
    id: doc.id, title: doc.title, source_kind: doc.sourceKind, document_pages: doc.documentPages, pages: doc.pages,
    model_id: doc.modelId, model_name: doc.modelName, task: doc.task, prompt: doc.prompt, status: doc.status, error: doc.error, error_code: doc.errorCode ?? null,
    progress: { done: doc.pagesDone, total: doc.pagesTotal }, created_at: doc.createdAt, updated_at: doc.updatedAt,
    source_url: `/api/ocr/documents/${doc.id}/source`,
  };
}

/** The tables of the OCR tab (`ocr_documents`, `ocr_pages`). The files of a reading are the service's business. */
@Injectable()
export class OcrStoreService {
  constructor(
    @InjectRepository(OcrDocumentEntity) private readonly documents: Repository<OcrDocumentEntity>,
    @InjectRepository(OcrPageEntity) private readonly pages: Repository<OcrPageEntity>,
  ) {}

  insert(doc: OcrDocumentEntity): Promise<OcrDocumentEntity> {
    return this.documents.save(doc);
  }

  get(id: string): Promise<OcrDocumentEntity | null> {
    return this.documents.findOne({ where: { id } });
  }

  /** Newest first; `q` searches the title and the text of the pages. */
  async list(q?: string): Promise<OcrDocumentEntity[]> {
    const text = q?.trim();
    if (!text) return this.documents.find({ order: { createdAt: 'DESC' } });
    const byText = await this.pages.find({ where: { text: ILike(`%${text}%`) }, select: { documentId: true } });
    const ids = [...new Set(byText.map((p) => p.documentId))];
    const byTitle = await this.documents.find({ where: { title: ILike(`%${text}%`) }, select: { id: true } });
    const all = [...new Set([...ids, ...byTitle.map((d) => d.id)])];
    return all.length ? this.documents.find({ where: { id: In(all) }, order: { createdAt: 'DESC' } }) : [];
  }

  async detail(id: string): Promise<OcrDocumentDetailDto | null> {
    const doc = await this.get(id);
    if (!doc) return null;
    const pages = await this.pages.find({ where: { documentId: id }, order: { pageIndex: 'ASC' } });
    return { ...toDocumentDto(doc), pages_read: pages.map(toPageDto) };
  }

  /** Applies a patch and stamps `updated_at`; returns the new row (null when it was deleted meanwhile). */
  async update(id: string, patch: Partial<OcrDocumentEntity>): Promise<OcrDocumentEntity | null> {
    await this.documents.update({ id }, { ...patch, updatedAt: nowSeconds() });
    return this.get(id);
  }

  savePage(documentId: string, page: OcrPageDto): Promise<OcrPageEntity> {
    return this.pages.save({ documentId, pageIndex: page.index, text: page.text, truncated: page.truncated, tokens: page.tokens });
  }

  async clearPages(id: string): Promise<void> {
    await this.pages.delete({ documentId: id });
  }

  async remove(id: string): Promise<void> {
    await this.documents.delete({ id });
  }

  /** Readings that were waiting or running when the application stopped. */
  active(): Promise<OcrDocumentEntity[]> {
    return this.documents.find({ where: { status: In([...OCR_ACTIVE_STATUSES]) }, order: { createdAt: 'ASC' } });
  }
}
