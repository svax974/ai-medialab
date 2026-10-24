/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

export type AssetMedia = 'image' | 'audio' | 'video'

/** Public shape of an asset (`/api/assets`, same as the legacy API). */
export interface Asset {
  id: string
  kind: 'upload' | 'generated'
  media: AssetMedia
  /** Seconds (audio, video). */
  duration: number | null
  fps?: number | null
  url: string
  thumb_url: string
  width: number | null
  height: number | null
  seed: number | null
  original_name: string | null
  favorite: boolean
  meta: Record<string, unknown>
  conversation_id: string | null
  message_id: string | null
  created_at: number
  /** Gallery results only. */
  conversation_title?: string | null
  prompt?: string | null
  model_id?: string | null
}

/** One page of the gallery (newest first); `next_before` is the cursor of the next page, `null` at the end. */
export interface AssetPage {
  items: Asset[]
  next_before: number | null
}

export interface AssetListQuery {
  media?: AssetMedia
  favorites?: boolean
  q?: string
  before?: number | null
  limit?: number
}

/** Weight of the copy of a video made to be sent. */
export type VideoPreset = 'light' | 'tiny'

export interface VideoCopy {
  url: string
  width: number
  height: number
  fps: number
  bytes: number
}
