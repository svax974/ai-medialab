/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { UpdateItem, UpdateItemStatus } from '../types'
import { decideNext, enqueueItems, nextToStart, setItemStatus } from './queue'

const item = (id: string, status: UpdateItemStatus = 'queued', kind: UpdateItem['kind'] = 'model'): UpdateItem => ({ key: `${kind}:${id}`, kind, id, name: id, status, error: null })
const running = { phase: 'running', error: null } as const

describe('enqueueItems', () => {
  it('appends new items and leaves a waiting or running one as it is', () => {
    const queue = [item('a', 'running'), item('b')]
    expect(enqueueItems(queue, [item('a'), item('b'), item('c')]).map((i) => `${i.id}:${i.status}`)).toEqual(['a:running', 'b:queued', 'c:queued'])
  })

  it('starts a finished or failed item again, at the end', () => {
    const queue = [item('a', 'done'), item('b', 'error'), item('c')]
    expect(enqueueItems(queue, [item('a'), item('b')]).map((i) => `${i.id}:${i.status}`)).toEqual(['c:queued', 'a:queued', 'b:queued'])
  })
})

describe('nextToStart', () => {
  it('takes the first waiting item, in order', () => {
    expect(nextToStart([item('a', 'done'), item('b'), item('c')])?.id).toBe('b')
  })

  it('waits while one runs: the installers take one job at a time', () => {
    expect(nextToStart([item('a', 'running'), item('b')])).toBeNull()
  })

  it('has nothing to start without a waiting item', () => {
    expect(nextToStart([item('a', 'done'), item('b', 'error')])).toBeNull()
  })
})

describe('setItemStatus', () => {
  it('changes one item and keeps the error of a failure', () => {
    const next = setItemStatus([item('a'), item('b')], 'model:b', 'error', 'Pas de réseau.')
    expect(next.map((i) => i.status)).toEqual(['queued', 'error'])
    expect(next[1].error).toBe('Pas de réseau.')
  })
})

describe('decideNext', () => {
  const none = new Set<string>()

  it('starts the first waiting item', () => {
    expect(decideNext([item('a'), item('b')], () => running, none, false, false)).toEqual({ type: 'start', item: item('a') })
  })

  it('does not read the installers for an item whose start request has not been answered', () => {
    const queue = [item('a', 'running')]
    expect(decideNext(queue, () => ({ phase: 'done', error: null }), none, true, true)).toEqual({ type: 'idle' })
  })

  it('finishes a running item once its installer says so, with the error of a failure', () => {
    const queue = [item('a', 'running'), item('b')]
    const started = new Set(['model:a'])
    expect(decideNext(queue, () => ({ phase: 'done', error: null }), started, false, true)).toEqual({ type: 'finish', key: 'model:a', status: 'done', error: null })
    expect(decideNext(queue, () => ({ phase: 'error', error: 'Espace disque insuffisant.' }), started, false, true)).toEqual({
      type: 'finish', key: 'model:a', status: 'error', error: 'Espace disque insuffisant.',
    })
    expect(decideNext(queue, () => running, started, false, true)).toEqual({ type: 'idle' })
  })

  it('waits for an answer in flight before starting the next one', () => {
    expect(decideNext([item('a')], () => running, none, true, true)).toEqual({ type: 'idle' })
  })

  it('refreshes the check once, when the queue is done and updates ran', () => {
    const queue = [item('a', 'done'), item('b', 'error')]
    expect(decideNext(queue, () => running, none, false, true)).toEqual({ type: 'refresh' })
    expect(decideNext(queue, () => running, none, false, false)).toEqual({ type: 'idle' })
  })
})
