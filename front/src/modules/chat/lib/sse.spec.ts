/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { readSse, SseParser } from '@/modules_shared/common/core/events'
import { toChatEvent } from './sse'

const bytes = (text: string) => new TextEncoder().encode(text)

/** A response body that delivers the given chunks one by one. */
function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function read(chunks: Uint8Array[]) {
  const events: ReturnType<typeof toChatEvent>[] = []
  await readSse(stream(chunks), new SseParser(), (block) => events.push(toChatEvent(block)))
  return events
}

const wire = 'event: delta\ndata: {"id":"m1","content":"Bonjour é — ✓ 🙂"}\n\n'

describe('the answer stream through the template parser', () => {
  it('reads blocks that arrive whole', async () => {
    const events = await read([bytes(`: ping\n\n${wire}event: done\ndata: {"message":{"id":"m1"}}\n\n`)])
    expect(events.map((e) => e?.type)).toEqual(['delta', 'done'])
  })

  it('reads a block cut anywhere, byte by byte, with multi-byte characters split in the middle', async () => {
    const all = bytes(wire)
    const events = await read(Array.from(all, (b) => Uint8Array.of(b)))
    expect(events).toEqual([{ type: 'delta', id: 'm1', content: 'Bonjour é — ✓ 🙂' }])
  })

  it('reads CRLF terminators and a CR split from its LF', async () => {
    const events = await read([bytes('event: delta\r\ndata: {"id":"m1","content":"a"}\r'), bytes('\n\r\n')])
    expect(events).toEqual([{ type: 'delta', id: 'm1', content: 'a' }])
  })

  it('skips comments and blocks without data', async () => {
    expect(await read([bytes(': ping\n\nevent: delta\n\n: ping\n\n')])).toEqual([])
  })
})

describe('toChatEvent', () => {
  const event = (name: string, data: unknown) => toChatEvent({ event: name, data: typeof data === 'string' ? data : JSON.stringify(data) })

  it('types every event of the contract', () => {
    expect(event('message', { message: { id: 'm' } })).toMatchObject({ type: 'message', message: { id: 'm' } })
    expect(event('done', { message: { id: 'm' } })).toMatchObject({ type: 'done' })
    expect(event('delta', { id: 'm', content: 'x' })).toEqual({ type: 'delta', id: 'm', content: 'x' })
    expect(event('reasoning', { id: 'm', content: 'y' })).toEqual({ type: 'reasoning', id: 'm', content: 'y' })
    expect(event('tool', { id: 'm', run: { id: 'r', name: 'web_search' } })).toMatchObject({ type: 'tool', id: 'm' })
    expect(event('usage', { id: 'm', stats: { prompt_tokens: 3 } })).toMatchObject({ type: 'usage' })
    expect(event('title', { title: 'Un titre' })).toEqual({ type: 'title', title: 'Un titre' })
    expect(event('loading', { phase: 'loading', model_id: 'q', elapsed_s: 4 })).toEqual({ type: 'loading', phase: 'loading', model_id: 'q', elapsed_s: 4 })
    expect(event('error', { code: 'busy', message: 'Occupé', id: 'm' })).toEqual({ type: 'error', code: 'busy', message: 'Occupé', id: 'm' })
  })

  it('ignores what it does not know or cannot read, so a bad block never stops an answer', () => {
    expect(event('nope', {})).toBeNull()
    expect(event('delta', '{not json')).toBeNull()
    expect(event('delta', '[]')).toBeNull()
    expect(event('delta', { id: 'm' })).toBeNull()
    expect(event('loading', { phase: 'weird', model_id: 'q' })).toBeNull()
    expect(event('message', { message: 'not an object' })).toBeNull()
  })

  it('gives an error without a code the upstream code', () => {
    expect(event('error', { message: 'boom' })).toMatchObject({ code: 'upstream' })
  })
})
