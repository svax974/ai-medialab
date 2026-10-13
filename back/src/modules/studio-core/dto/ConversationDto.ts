/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { AssetDto } from 'src/modules/media-library';
import type { ConversationMode } from '../entities/ConversationEntity';

/**
 * Public shape of a conversation in a list or after an update: identical to `conversation_summary()` of the legacy
 * engine (`engine/app/repo.py`).
 */
export class ConversationDto {
  id: string;
  title: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  mode: ConversationMode;
  /** Latest generated image or video (never an audio take), `null` when there is none. */
  cover: AssetDto | null;
  /** Number of assistant messages (generations), whatever their status. */
  generation_count: number;
  /** A generation is queued, loading or running. */
  busy: boolean;
}
