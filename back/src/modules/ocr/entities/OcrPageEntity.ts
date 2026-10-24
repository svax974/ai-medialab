/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { OcrDocumentEntity } from './OcrDocumentEntity';

/** The text of one page of a reading. */
@Entity({ name: 'ocr_pages' })
export class OcrPageEntity {
  @PrimaryColumn({ name: 'document_id', type: 'varchar' })
  documentId: string;

  /** Page of the document, from 1. */
  @PrimaryColumn({ name: 'page_index', type: 'integer' })
  pageIndex: number;

  @ManyToOne(() => OcrDocumentEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'document_id' })
  document?: OcrDocumentEntity;

  @Column({ type: 'text', default: '' })
  text: string;

  @Column({ type: 'boolean', default: false })
  truncated: boolean;

  @Column({ type: 'integer', nullable: true })
  tokens: number | null;
}
