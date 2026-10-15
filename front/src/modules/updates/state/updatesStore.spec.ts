/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useUpdatesStore } from './updatesStore'

const item = (id: string) => ({ key: `model:${id}`, kind: 'model' as const, id, name: id, target: 'pinned' as const, status: 'queued' as const, error: null })

describe('updates store', () => {
  beforeEach(() => useUpdatesStore.setState({ open: false, queue: [] }))

  it('opens and closes the dialog', () => {
    useUpdatesStore.getState().setOpen(true)
    expect(useUpdatesStore.getState().open).toBe(true)
  })

  it('queues once, follows the status and forgets the finished items', () => {
    const s = useUpdatesStore.getState()
    s.enqueue([item('a'), item('b')])
    s.enqueue([item('a')])
    expect(useUpdatesStore.getState().queue.map((i) => i.id)).toEqual(['a', 'b'])
    useUpdatesStore.getState().setStatus('model:a', 'done')
    useUpdatesStore.getState().setStatus('model:b', 'running')
    useUpdatesStore.getState().clearFinished()
    expect(useUpdatesStore.getState().queue.map((i) => `${i.id}:${i.status}`)).toEqual(['b:running'])
  })
})
