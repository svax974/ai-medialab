/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { AssetEntity, toAssetDto } from 'src/modules/media-library';
import { MessageDto } from '../dto/MessageDto';
import { MessageEntity } from '../entities/MessageEntity';

/** Entity (with its reference and output assets) to the public shape of the legacy API (`message_public`). */
export function toMessageDto(message: MessageEntity, references: AssetEntity[], outputs: AssetEntity[]): MessageDto {
  return {
    id: message.id,
    conversation_id: message.conversationId,
    parent_id: message.parentId ?? null,
    role: message.role,
    prompt: message.prompt ?? '',
    model_id: message.modelId ?? null,
    params: message.params ?? {},
    status: message.status,
    error: message.error ?? null,
    error_code: message.errorCode ?? null,
    created_at: message.createdAt,
    started_at: message.startedAt ?? null,
    finished_at: message.finishedAt ?? null,
    references: references.map(toAssetDto),
    outputs: outputs.map(toAssetDto),
  };
}
