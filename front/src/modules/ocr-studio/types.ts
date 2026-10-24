/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Shapes of `/api/ocr/*` (Nest, module `ocr`; `back/src/modules/ocr/types/ocrTypes.ts`). */

export type OcrStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export type OcrSourceKind = 'image' | 'pdf'
/** `default`: the model's own default task; `custom`: the user's instruction (models that follow any). */
export type OcrTask = 'default' | 'text' | 'markdown' | 'table' | 'formula' | 'chart' | 'custom'
export type OcrExportFormat = 'txt' | 'md' | 'json'

export const OCR_EXPORT_FORMATS: readonly OcrExportFormat[] = ['md', 'txt', 'json']

export interface OcrPage {
  /** Page of the document, from 1. */
  index: number
  text: string
  /** The model hit its length cap on this page: the text may be cut. */
  truncated: boolean
  tokens: number | null
}

export interface OcrDocument {
  id: string
  title: string
  source_kind: OcrSourceKind
  document_pages: number
  /** Pages asked for (1-based), null for all. */
  pages: number[] | null
  model_id: string
  model_name: string
  task: OcrTask
  prompt: string | null
  status: OcrStatus
  error: string | null
  /** `memory`: the free-memory check refused the load; "Continue anyway" retries with `force_memory`. */
  error_code?: string | null
  progress: { done: number; total: number }
  created_at: number
  updated_at: number
  source_url: string
}

export interface OcrDocumentDetail extends OcrDocument {
  pages_read: OcrPage[]
}

/** What the composer sends. `file` or `assetId`; `pages` is the text the user wrote ("1-3, 5"), empty for all. */
export interface CreateOcrRequest {
  file?: File
  assetId?: string
  modelId?: string
  task?: OcrTask
  prompt?: string
  pages?: string
}
