/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/modules/model-catalog'
import { fileProblem, isActiveStatus, joinPages, MAX_FILE_BYTES, progressRatio, sendState, taskAfterModelChange, tasksOf } from './ocrRules'

const model = (over: Partial<ModelInfo> = {}, caps: Partial<NonNullable<ModelInfo['ocr']>> = {}): ModelInfo =>
  ({
    id: 'ocr-x', kind: 'ocr', name: 'X', ready: true,
    ocr: { tasks: { text: 'a', table: 'b' }, default_task: 'text', free_prompt: false, languages: '', strengths: [], weaknesses: [], max_tokens: 1, ...caps },
    ...over,
  }) as unknown as ModelInfo

describe('fileProblem', () => {
  it('accepts images and PDFs whatever the case', () => {
    expect(fileProblem({ name: 'Scan.PNG', size: 10 })).toBeNull()
    expect(fileProblem({ name: 'a.pdf', size: 10 })).toBeNull()
  })

  it('refuses other formats and files that are too big', () => {
    expect(fileProblem({ name: 'a.docx', size: 10 })).toBe('ocrStudio.file.unsupported')
    expect(fileProblem({ name: 'a.pdf', size: MAX_FILE_BYTES + 1 })).toBe('ocrStudio.file.tooBig')
  })
})

describe('tasksOf', () => {
  it('puts the default task first and offers a free instruction only to models that follow one', () => {
    expect(tasksOf(model({}, { tasks: { table: 'b', text: 'a' }, default_task: 'text' }))).toEqual(['text', 'table'])
    expect(tasksOf(model({}, { free_prompt: true }))).toEqual(['text', 'table', 'custom'])
    expect(tasksOf(undefined)).toEqual(['default'])
  })

  it('keeps the chosen task across models when offered, else falls back to the default', () => {
    expect(taskAfterModelChange(model(), 'table')).toBe('table')
    expect(taskAfterModelChange(model(), 'formula')).toBe('text')
    expect(taskAfterModelChange(model({}, { free_prompt: true }), 'custom')).toBe('custom')
  })
})

describe('sendState', () => {
  const file = { name: 'a.png', size: 1 }
  it('can send a file with a ready model', () => {
    expect(sendState(model(), file, 'text', '', false).canSend).toBe(true)
  })

  it.each([
    [{ m: undefined, f: file, task: 'text', p: '', busy: false }, 'ocrStudio.send.noModel'],
    [{ m: model({ ready: false }), f: file, task: 'text', p: '', busy: false }, 'ocrStudio.send.notReady'],
    [{ m: model(), f: null, task: 'text', p: '', busy: false }, 'ocrStudio.send.noFile'],
    [{ m: model(), f: file, task: 'custom', p: '  ', busy: false }, 'ocrStudio.send.noPrompt'],
    [{ m: model(), f: file, task: 'text', p: '', busy: true }, 'ocrStudio.send.busy'],
    [{ m: model(), f: { name: 'a.txt', size: 1 }, task: 'text', p: '', busy: false }, 'ocrStudio.file.unsupported'],
  ] as const)('cannot send: %#', ({ m, f, task, p, busy }, tipKey) => {
    expect(sendState(m, f, task, p, busy)).toEqual({ canSend: false, tipKey })
  })
})

describe('progress and text', () => {
  it('measures the pages read, and a finished reading is complete', () => {
    expect(progressRatio({ status: 'running', progress: { done: 1, total: 4 } })).toBe(0.25)
    expect(progressRatio({ status: 'running', progress: { done: 0, total: 0 } })).toBe(0)
    expect(progressRatio({ status: 'done', progress: { done: 0, total: 0 } })).toBe(1)
    expect(isActiveStatus('queued') && isActiveStatus('running') && !isActiveStatus('done')).toBe(true)
  })

  it('joins the pages with headings only when there are several', () => {
    expect(joinPages([{ index: 3, text: 'seule' }])).toBe('seule')
    expect(joinPages([{ index: 1, text: 'a' }, { index: 2, text: 'b' }])).toBe('--- Page 1 ---\na\n\n--- Page 2 ---\nb')
    expect(joinPages([])).toBe('')
  })
})
