/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { HubResult, TrendingEntry, TrendingKind, TrendingOption } from '../types'

/** Windows offered, in days (the engine accepts 7 to 365); the first one is what the button reads. */
export const WINDOWS = [90, 30, 180] as const
export const DEFAULT_WINDOW = WINDOWS[0]

export type AgeUnit = 'today' | 'days' | 'weeks' | 'months'

/** Age of a repository as the list says it: today, N days (under two weeks), N weeks (under two months), N months. */
export function ageOf(days: number): { unit: AgeUnit; count: number } {
  if (days < 1) return { unit: 'today', count: 0 }
  if (days < 14) return { unit: 'days', count: Math.floor(days) }
  if (days < 60) return { unit: 'weeks', count: Math.floor(days / 7) }
  return { unit: 'months', count: Math.floor(days / 30) }
}

/** What adding the proposed variant downloads, in GB (the file plus the shared files still missing); null when unknown. */
export function downloadGb(option: TrendingOption | null): number | null {
  if (!option) return null
  return option.download_gb ?? option.size_gb
}

/** The shape the add detail of the Hugging Face search needs (`repo`, `already`). */
export const toHubResult = (entry: Pick<TrendingEntry, 'repo'>): Pick<HubResult, 'repo' | 'already'> => ({ repo: entry.repo, already: null })

/** Locale key of the note shown next to a licence that is not plainly open. */
export const licenseNoteKey = (note: NonNullable<TrendingEntry['license_note']>): string => `models.new.license.${note}`

const SEEN_PREFIX = 'cn-whatsnew-seen-'

/** The browser storage, or null when it is unavailable (private window, blocked site data): everything works without it. */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** When the list of a kind was last opened (epoch milliseconds), 0 when never or when storage is unavailable. */
export function readSeen(kind: TrendingKind, store: Storage | null = storage()): number {
  try {
    const value = Number(store?.getItem(SEEN_PREFIX + kind))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function markSeen(kind: TrendingKind, now: number = Date.now(), store: Storage | null = storage()): void {
  try {
    store?.setItem(SEEN_PREFIX + kind, String(now))
  } catch {
    // a convenience only: nothing to do without storage
  }
}

/** Entries published since the list was last opened (all of them when it never was): what the badge counts. */
export function newSince(entries: readonly Pick<TrendingEntry, 'created_at'>[], seenMs: number): number {
  return entries.filter((e) => Date.parse(e.created_at) > seenMs).length
}
