/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { AssetDto } from 'src/modules/media-library';
import type { MessageRole, MessageStatus } from '../entities/MessageEntity';

/**
 * Public shape of a message: identical to `message_public()` of the legacy engine (`engine/app/repo.py` (removed in H6)).
 * `references` are the assets the prompt uses (in order), `outputs` the generated assets of the answer.
 */
export class MessageDto {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: MessageRole;
  prompt: string;
  model_id: string | null;
  params: Record<string, unknown>;
  status: MessageStatus;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  references: AssetDto[];
  outputs: AssetDto[];
}
