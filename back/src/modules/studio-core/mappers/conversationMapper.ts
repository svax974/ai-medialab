/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { AssetEntity, toAssetDto } from 'src/modules/media-library';
import { ConversationDetailDto } from '../dto/ConversationDetailDto';
import { ConversationDto } from '../dto/ConversationDto';
import { MessageDto } from '../dto/MessageDto';
import { ConversationEntity } from '../entities/ConversationEntity';

/** What the summary adds to the stored columns: computed from the latest cover asset and the assistant messages. */
export interface ConversationStats {
  cover: AssetEntity | null;
  generationCount: number;
  busy: boolean;
}

/** Entity to the public summary of the legacy API (`conversation_summary`). */
export function toConversationDto(conversation: ConversationEntity, stats: ConversationStats): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    pinned: Boolean(conversation.pinned),
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    mode: conversation.mode || 'image',
    cover: stats.cover ? toAssetDto(stats.cover) : null,
    generation_count: stats.generationCount,
    busy: stats.busy,
  };
}

export function toConversationDetailDto(
  conversation: ConversationEntity,
  stats: ConversationStats,
  messages: MessageDto[],
): ConversationDetailDto {
  return { ...toConversationDto(conversation, stats), messages };
}
