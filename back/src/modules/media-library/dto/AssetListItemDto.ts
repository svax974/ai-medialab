/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { AssetDto } from './AssetDto';

/** An asset of the gallery: the public asset plus the context of the message that produced it. */
export class AssetListItemDto extends AssetDto {
  conversation_title: string | null;
  prompt: string | null;
  model_id: string | null;
}

/** Page of the gallery; `next_before` is the cursor of the next page (`before`), `null` on the last one. */
export class AssetPageDto {
  items: AssetListItemDto[];
  next_before: number | null;
}
