/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ConversationSummary } from '../types'

/** Period a conversation belongs to; `month` carries the first day of the month for the localized heading. */
export type PeriodKey =
  | { kind: 'pinned' }
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'last7' }
  | { kind: 'last30' }
  | { kind: 'month'; year: number; month: number }

export interface ConversationGroup {
  /** Stable identifier (React key). */
  id: string
  period: PeriodKey
  items: ConversationSummary[]
}

const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Period of a timestamp (epoch seconds), like chat apps: today, yesterday, 7 and 30 days, then one group per month.
 * Day differences are rounded: a daylight-saving change makes a calendar day 23 or 25 hours long.
 */
export function periodOf(timestampSeconds: number, now: Date = new Date()): PeriodKey {
  const date = new Date(timestampSeconds * 1000)
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (diff <= 0) return { kind: 'today' }
  if (diff === 1) return { kind: 'yesterday' }
  if (diff < 7) return { kind: 'last7' }
  if (diff < 30) return { kind: 'last30' }
  return { kind: 'month', year: date.getFullYear(), month: date.getMonth() }
}

function periodId(period: PeriodKey): string {
  return period.kind === 'month' ? `month-${period.year}-${period.month}` : period.kind
}

/** Pinned first, then most recently updated first; stable for equal dates. */
export function sortConversations(conversations: readonly ConversationSummary[]): ConversationSummary[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((a, b) => {
      if (a.conversation.pinned !== b.conversation.pinned) return a.conversation.pinned ? -1 : 1
      return b.conversation.updated_at - a.conversation.updated_at || a.index - b.index
    })
    .map(({ conversation }) => conversation)
}

/** Sorted conversations split into consecutive groups: a "pinned" group, then one per period. */
export function groupConversations(conversations: readonly ConversationSummary[], now: Date = new Date()): ConversationGroup[] {
  const groups: ConversationGroup[] = []
  for (const conversation of sortConversations(conversations)) {
    const period: PeriodKey = conversation.pinned ? { kind: 'pinned' } : periodOf(conversation.updated_at, now)
    const id = periodId(period)
    const last = groups[groups.length - 1]
    if (last?.id === id) last.items.push(conversation)
    else groups.push({ id, period, items: [conversation] })
  }
  return groups
}

/** i18n key of a period heading, or `null` for a month (formatted with `Intl`, see `formatMonth`). */
export function periodLabelKey(period: PeriodKey): string | null {
  switch (period.kind) {
    case 'pinned':
      return 'studio.period.pinned'
    case 'today':
      return 'studio.period.today'
    case 'yesterday':
      return 'studio.period.yesterday'
    case 'last7':
      return 'studio.period.last7'
    case 'last30':
      return 'studio.period.last30'
    case 'month':
      return null
  }
}

export function formatMonth(period: { year: number; month: number }, lang: string): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(period.year, period.month, 1))
}

export function formatClock(timestampSeconds: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestampSeconds * 1000))
}
