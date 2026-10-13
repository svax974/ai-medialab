/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { AssetKind, AssetMedia } from '../entities/AssetEntity';

/**
 * Public shape of an asset: identical to `asset_public()` of the legacy engine (`engine/app/repo.py`), so the migrated
 * screens keep their contract. Field names stay snake_case on purpose; absent values are `null`, never omitted.
 */
export class AssetDto {
  id: string;
  kind: AssetKind;
  media: AssetMedia;
  duration: number | null;
  /** Frame rate (`meta.fps`), videos only. */
  fps: number | null;
  /** `/media/<uploads|outputs>/<filename>` */
  url: string;
  /** `/media/thumbs/<thumb>`, or `url` when the asset has no thumbnail. */
  thumb_url: string;
  width: number | null;
  height: number | null;
  seed: number | null;
  original_name: string | null;
  favorite: boolean;
  meta: Record<string, unknown>;
  conversation_id: string | null;
  message_id: string | null;
  created_at: number;
}
