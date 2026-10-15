/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** What `GET /api/private/session` tells (no content). Epoch seconds. */
export interface PrivateSessionInfo {
  active: boolean
  created_at: number | null
  last_activity: number | null
  expires_at: number | null
  conversations: number
  /** Results (files) the session holds. */
  results: number
}
