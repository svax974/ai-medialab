/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import type { OcrDocument, OcrStatus, OcrTask } from '../types'

export const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf'] as const
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',')
/** The engine refuses a PDF above this size (`engine/app/ocr.py` `MAX_PDF_BYTES`), Nest an upload above 200 MB. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024

export function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf')
}

/** Why a file cannot be read, as a locale key, or null when it can. */
export function fileProblem(file: Pick<File, 'name' | 'size'>): string | null {
  const lower = file.name.toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'ocrStudio.file.unsupported'
  if (file.size > MAX_FILE_BYTES) return 'ocrStudio.file.tooBig'
  return null
}

/** Tasks a model offers, in display order; `custom` only for a model that follows any instruction. */
export function tasksOf(model: ModelInfo | undefined): OcrTask[] {
  const caps = model?.ocr
  if (!caps) return ['default']
  const known = Object.keys(caps.tasks) as OcrTask[]
  const ordered = [caps.default_task as OcrTask, ...known.filter((task) => task !== caps.default_task)]
  return caps.free_prompt ? [...ordered, 'custom'] : ordered
}

/** The task to keep when the model changes: the same one if the new model offers it, else its default. */
export function taskAfterModelChange(model: ModelInfo | undefined, task: OcrTask): OcrTask {
  const offered = tasksOf(model)
  return offered.includes(task) ? task : ((model?.ocr?.default_task as OcrTask | undefined) ?? 'default')
}

export interface SendState {
  canSend: boolean
  /** Locale key of what is missing or why the button is off; empty when it can send. */
  tipKey: string
}

export function sendState(model: ModelInfo | undefined, file: Pick<File, 'name' | 'size'> | null, task: OcrTask, prompt: string, busy: boolean): SendState {
  if (busy) return { canSend: false, tipKey: 'ocrStudio.send.busy' }
  if (!model) return { canSend: false, tipKey: 'ocrStudio.send.noModel' }
  if (!model.ready) return { canSend: false, tipKey: 'ocrStudio.send.notReady' }
  if (!file) return { canSend: false, tipKey: 'ocrStudio.send.noFile' }
  if (fileProblem(file)) return { canSend: false, tipKey: fileProblem(file) as string }
  if (task === 'custom' && !prompt.trim()) return { canSend: false, tipKey: 'ocrStudio.send.noPrompt' }
  return { canSend: true, tipKey: 'ocrStudio.send.tip' }
}

export const isActiveStatus = (status: OcrStatus): boolean => status === 'queued' || status === 'running'

/** 0..1 share of the pages read (0 until the engine has opened the document). */
export function progressRatio(doc: Pick<OcrDocument, 'progress' | 'status'>): number {
  if (doc.status === 'done') return 1
  return doc.progress.total > 0 ? Math.min(1, doc.progress.done / doc.progress.total) : 0
}

/** The text of every page as one block (what "copy all" gives): page headings only when there are several. */
export function joinPages(pages: { index: number; text: string }[]): string {
  if (pages.length <= 1) return pages[0]?.text ?? ''
  return pages.map((page) => `--- Page ${page.index} ---\n${page.text}`).join('\n\n')
}
