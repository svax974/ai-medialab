/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Message } from '@/modules/studio-core'
import { audioStatus } from './audioStatus'

const caps = { languages: [{ code: 'fr', label: 'Français' }] } as never
const message = (extra: Partial<Message> = {}): Message => ({ id: 'a', status: 'done', params: { count: 1, language: 'fr' }, created_at: 100, started_at: 110, finished_at: 125, ...extra }) as Message
const context = { now: 200, queueIndex: -1, caps }

describe('audioStatus', () => {
  it('waits: no position for the first message in the queue, "position N" from the second', () => {
    expect(audioStatus(message({ status: 'queued' }), undefined, { ...context, queueIndex: 0 })).toEqual({ kind: 'queued', position: null })
    expect(audioStatus(message({ status: 'queued' }), undefined, { ...context, queueIndex: 2 })).toEqual({ kind: 'queued', position: 3 })
    expect(audioStatus(message({ status: 'queued' }), undefined, context)).toEqual({ kind: 'queued', position: null })
  })

  it('loads: the elapsed time since the model started loading (from the progress, else from the start of the job)', () => {
    expect(audioStatus(message({ status: 'loading' }), { message_id: 'a', load_started_at: 190 }, context)).toEqual({ kind: 'loading', elapsed: 10 })
    expect(audioStatus(message({ status: 'loading' }), undefined, context)).toEqual({ kind: 'loading', elapsed: 90 })
  })

  it('runs: the pass, the take number only with several takes, the remaining time once a pass is done', () => {
    expect(audioStatus(message({ status: 'running' }), undefined, context)).toEqual({ kind: 'running', pass: null, total: null, take: null, eta: null })
    const progress = { message_id: 'a', step: 2, total: 5, index: 1, eta: 8 }
    expect(audioStatus(message({ status: 'running', params: { count: 3 } }), progress, context)).toEqual({ kind: 'running', pass: 2, total: 5, take: 2, eta: 8 })
    expect(audioStatus(message({ status: 'running' }), { message_id: 'a', eta: 8 }, context)).toMatchObject({ eta: null })
  })

  it('summarizes: the language of the model, the time it took (only when done), the time of the message', () => {
    expect(audioStatus(message(), undefined, context)).toEqual({ kind: 'meta', language: 'Français', duration: 15, createdAt: 100 })
    expect(audioStatus(message({ status: 'cancelled' }), undefined, context)).toMatchObject({ duration: null })
    expect(audioStatus(message(), undefined, { ...context, caps: null })).toMatchObject({ language: null })
  })
})
