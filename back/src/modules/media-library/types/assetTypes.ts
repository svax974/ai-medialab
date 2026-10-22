/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { AssetKind, AssetMedia } from '../entities/AssetEntity';

/** Fields of a new asset; `createdAt` defaults to now (epoch seconds). */
export interface CreateAssetInput {
  id: string;
  kind: AssetKind;
  media?: AssetMedia;
  filename: string;
  thumb?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  originalName?: string | null;
  width?: number | null;
  height?: number | null;
  seed?: number | null;
  duration?: number | null;
  position?: number;
  favorite?: boolean;
  meta?: Record<string, unknown>;
  createdAt?: number;
}

/** Filters of the gallery listing (`GET /assets` of the legacy API). */
export interface ListAssetsQuery {
  /** Default `generated`. */
  kind?: AssetKind;
  /** Default `image`; a value other than image / audio / video disables the filter. */
  media?: string;
  favorites?: boolean;
  /** Substring of the prompt or of the conversation title. */
  q?: string;
  /** Cursor: only assets created before this time (epoch seconds). */
  before?: number;
  /** Clamped to 1..200, default 60. */
  limit?: number;
}
