/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** What a reading goes through: waiting for the engine, being read page by page, then one of the three ends. */
export type OcrStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export const OCR_ACTIVE_STATUSES: readonly OcrStatus[] = ['queued', 'running'];

export type OcrSourceKind = 'image' | 'pdf';

/** Tasks the engine knows (`engine/app/api/ocr.py` `OcrBody.task`); the model says which ones it offers. */
export const OCR_TASKS = ['default', 'text', 'markdown', 'table', 'formula', 'chart', 'custom'] as const;
export type OcrTask = (typeof OCR_TASKS)[number];

export type OcrExportFormat = 'txt' | 'md' | 'json';
export const OCR_EXPORT_FORMATS: readonly OcrExportFormat[] = ['txt', 'md', 'json'];

/** Public shape of a page read. */
export interface OcrPageDto {
  /** Page of the document, from 1. */
  index: number;
  text: string;
  /** The model hit its length cap on this page: the text may be cut. */
  truncated: boolean;
  tokens: number | null;
}

/** Public shape of a reading, without its pages. */
export interface OcrDocumentDto {
  id: string;
  title: string;
  source_kind: OcrSourceKind;
  /** Pages of the document (1 for an image). */
  document_pages: number;
  /** Pages asked for (1-based), null for all. */
  pages: number[] | null;
  model_id: string;
  model_name: string;
  task: OcrTask;
  prompt: string | null;
  status: OcrStatus;
  error: string | null;
  /** Pages read so far, and how many will be read (0 until the engine has opened the document). */
  progress: { done: number; total: number };
  created_at: number;
  updated_at: number;
  /** URL of the original file (served by this module). */
  source_url: string;
}

export interface OcrDocumentDetailDto extends OcrDocumentDto {
  pages_read: OcrPageDto[];
}

export interface CreateOcrInput {
  /** A file already on disk (an upload that was moved, or a library asset copied); its name is kept as the title. */
  filePath: string;
  originalName: string;
  modelId?: string;
  task?: OcrTask;
  prompt?: string;
  pages?: number[];
}

/** Events of the engine's reading stream (`engine/app/api/ocr.py`). */
export type OcrEvent =
  | { type: 'loading'; phase: string; model_id: string; elapsed_s?: number }
  | { type: 'pages'; total: number; document_pages: number }
  | { type: 'page_start'; index: number; position: number; total: number }
  | { type: 'page'; index: number; position: number; total: number; text: string; truncated: boolean; usage?: { completion_tokens?: number | null } }
  | { type: 'done'; pages: number }
  | { type: 'error'; code: string; message: string };
