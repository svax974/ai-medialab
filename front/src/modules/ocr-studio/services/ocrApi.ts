/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioApiBase, studioRequest, studioUpload } from '@/modules/studio-shell/services/studioHttp'
import type { CreateOcrRequest, OcrDocument, OcrDocumentDetail, OcrExportFormat, OcrTask } from '../types'

/** `/api/ocr/*` (Nest, module `ocr`): readings of images and PDFs by an OCR model, run in the background (progress by `studio.ocr.updated`). */
export const ocrApi = {
  list(query = ''): Promise<OcrDocument[]> {
    return studioRequest<OcrDocument[]>('get', query ? `/ocr/documents?q=${encodeURIComponent(query)}` : '/ocr/documents')
  },
  get(id: string): Promise<OcrDocumentDetail> {
    return studioRequest<OcrDocumentDetail>('get', `/ocr/documents/${encodeURIComponent(id)}`)
  },
  /** Starts a reading of an uploaded file, or of an image of the library (`assetId`). */
  create(request: CreateOcrRequest, onProgress?: (percent: number | null) => void): Promise<OcrDocument> {
    const form = new FormData()
    if (request.file) form.append('file', request.file, request.file.name)
    if (request.assetId) form.append('asset_id', request.assetId)
    if (request.modelId) form.append('model_id', request.modelId)
    if (request.task) form.append('task', request.task)
    if (request.prompt?.trim()) form.append('prompt', request.prompt.trim())
    if (request.pages?.trim()) form.append('pages', request.pages.trim())
    return studioUpload<OcrDocument>('/ocr/documents', form, { onProgress })
  },
  cancel(id: string): Promise<OcrDocument> {
    return studioRequest<OcrDocument>('post', `/ocr/documents/${encodeURIComponent(id)}/cancel`)
  },
  /** Starts a finished reading again, optionally with another model, task, instruction or pages (`pages`: "1-3, 5", empty for all). */
  retry(id: string, change: { modelId?: string; task?: OcrTask; prompt?: string; pages?: string } = {}): Promise<OcrDocument> {
    return studioRequest<OcrDocument>('post', `/ocr/documents/${encodeURIComponent(id)}/retry`, {
      model_id: change.modelId, task: change.task, prompt: change.prompt, pages: change.pages,
    })
  },
  remove(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('delete', `/ocr/documents/${encodeURIComponent(id)}`)
  },
  /** Address of a download of the text (the browser saves it). */
  exportUrl(id: string, format: OcrExportFormat): string {
    return `${studioApiBase()}/ocr/documents/${encodeURIComponent(id)}/export?format=${format}`
  },
  /** Address of the original file (for the preview). */
  sourceUrl(id: string): string {
    return `${studioApiBase()}/ocr/documents/${encodeURIComponent(id)}/source`
  },
}
