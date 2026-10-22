/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Minutes of inactivity after which the server erases the session, when it says so (else the banner text stays general). */
export function ttlMinutes(info: { last_activity: number | null; expires_at: number | null } | null): number | null {
  if (!info?.last_activity || !info.expires_at) return null
  return Math.max(1, Math.round((info.expires_at - info.last_activity) / 60))
}
