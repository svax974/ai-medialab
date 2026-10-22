/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ConversationSummary } from '../types'
import { formatMonth, groupConversations, periodLabelKey, periodOf, sortConversations } from './periods'

// Wednesday 14 October 2026, 15:00 local time.
const NOW = new Date(2026, 9, 14, 15, 0, 0)
const seconds = (date: Date) => Math.floor(date.getTime() / 1000)
const daysAgo = (days: number, hour = 9) => seconds(new Date(2026, 9, 14 - days, hour, 0, 0))

function conv(id: string, updatedAt: number, pinned = false): ConversationSummary {
  return { id, mode: 'image', title: id, pinned, created_at: updatedAt, updated_at: updatedAt, cover: null, generation_count: 1, busy: false }
}

describe('periodOf', () => {
  it('splits today, yesterday, 7 days, 30 days then months', () => {
    expect(periodOf(daysAgo(0), NOW)).toEqual({ kind: 'today' })
    expect(periodOf(daysAgo(0, 0), NOW)).toEqual({ kind: 'today' })
    expect(periodOf(daysAgo(1, 23), NOW)).toEqual({ kind: 'yesterday' })
    expect(periodOf(daysAgo(2), NOW)).toEqual({ kind: 'last7' })
    expect(periodOf(daysAgo(6), NOW)).toEqual({ kind: 'last7' })
    expect(periodOf(daysAgo(7), NOW)).toEqual({ kind: 'last30' })
    expect(periodOf(daysAgo(29), NOW)).toEqual({ kind: 'last30' })
    expect(periodOf(daysAgo(30), NOW)).toEqual({ kind: 'month', year: 2026, month: 8 })
  })

  it('treats a future timestamp as today', () => {
    expect(periodOf(daysAgo(-3), NOW)).toEqual({ kind: 'today' })
  })

  it('counts calendar days across a month boundary', () => {
    const now = new Date(2026, 10, 1, 8, 0, 0) // 1 November
    expect(periodOf(seconds(new Date(2026, 9, 31, 22, 0, 0)), now)).toEqual({ kind: 'yesterday' })
  })
})

describe('sortConversations', () => {
  it('puts pinned first, then most recent first, and is stable for ties', () => {
    const list = [conv('old', 10), conv('pin-old', 5, true), conv('new', 30), conv('tie-a', 20), conv('tie-b', 20), conv('pin-new', 8, true)]
    expect(sortConversations(list).map((c) => c.id)).toEqual(['pin-new', 'pin-old', 'new', 'tie-a', 'tie-b', 'old'])
  })

  it('does not mutate its input', () => {
    const list = [conv('a', 1), conv('b', 2)]
    sortConversations(list)
    expect(list.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('groupConversations', () => {
  it('builds a pinned group first, then one group per period, in order', () => {
    const groups = groupConversations(
      [conv('a', daysAgo(0)), conv('p', daysAgo(40), true), conv('b', daysAgo(1)), conv('c', daysAgo(0, 1)), conv('d', daysAgo(45)), conv('e', daysAgo(50))],
      NOW,
    )
    expect(groups.map((g) => g.id)).toEqual(['pinned', 'today', 'yesterday', 'month-2026-7'])
    expect(groups[1].items.map((c) => c.id)).toEqual(['a', 'c'])
    expect(groups[3].items.map((c) => c.id)).toEqual(['d', 'e']) // 30 Aug and 25 Aug: same month, one group
  })

  it('returns no group for an empty list', () => {
    expect(groupConversations([], NOW)).toEqual([])
  })
})

describe('labels', () => {
  it('gives an i18n key to fixed periods and none to months', () => {
    expect(periodLabelKey({ kind: 'last7' })).toBe('studio.period.last7')
    expect(periodLabelKey({ kind: 'month', year: 2026, month: 8 })).toBeNull()
  })

  it('formats a month in the given language', () => {
    expect(formatMonth({ year: 2026, month: 8 }, 'fr')).toBe('septembre 2026')
    expect(formatMonth({ year: 2026, month: 8 }, 'en')).toBe('September 2026')
  })
})
