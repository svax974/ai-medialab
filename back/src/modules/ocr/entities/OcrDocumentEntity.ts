/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';
import type { OcrSourceKind, OcrStatus, OcrTask } from '../types/ocrTypes';

/**
 * One reading: a file (image or PDF) read by an OCR model. The file lives in `<data>/ocr/<id>/` (`source.<ext>`), owned by the
 * reading: deleting it deletes the folder. Timestamps are epoch seconds (floats), like the rest of the application.
 */
@Entity({ name: 'ocr_documents' })
@Index('idx_ocr_documents_created', ['createdAt'])
export class OcrDocumentEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  /** File name inside the reading's folder. */
  @Column({ name: 'source_file', type: 'varchar' })
  sourceFile: string;

  @Column({ name: 'source_kind', type: 'varchar' })
  sourceKind: OcrSourceKind;

  @Column({ name: 'document_pages', type: 'integer', default: 0 })
  documentPages: number;

  /** Pages asked for (1-based), null for all. */
  @Column({ type: jsonColumnType(), nullable: true })
  pages: number[] | null;

  @Column({ name: 'model_id', type: 'varchar' })
  modelId: string;

  @Column({ name: 'model_name', type: 'varchar' })
  modelName: string;

  @Column({ type: 'varchar', default: 'default' })
  task: OcrTask;

  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  @Column({ type: 'varchar', default: 'queued' })
  status: OcrStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'pages_done', type: 'integer', default: 0 })
  pagesDone: number;

  @Column({ name: 'pages_total', type: 'integer', default: 0 })
  pagesTotal: number;

  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'float' })
  updatedAt: number;
}
