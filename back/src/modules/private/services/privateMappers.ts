/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { mediaUrl, type AssetDto } from 'src/modules/media-library';
import type { ConversationDetailDto, ConversationDto, MessageDto } from 'src/modules/studio-core';
import type { PrivateAsset, PrivateConversation, PrivateMessage } from '../types/privateTypes';

/**
 * The public shapes of the studio (`AssetDto`, `MessageDto`, `ConversationDto`) for what the session holds in memory,
 * so that the interface shows a private generation with the components of a normal one. Only the URLs differ: the
 * files are under `/media/private/<session>/<folder>/` (the engine serves them uncacheable).
 */
export function toPrivateAssetDto(asset: PrivateAsset, sessionId: string): AssetDto {
  const folder = `private/${sessionId}/${asset.kind === 'upload' ? 'inputs' : 'outputs'}`;
  const url = mediaUrl(folder, asset.filename) as string;
  return {
    id: asset.id,
    kind: asset.kind,
    media: asset.media,
    duration: asset.duration,
    fps: asset.media === 'video' ? ((asset.meta.fps as number | undefined) ?? null) : null,
    url,
    thumb_url: mediaUrl(`private/${sessionId}/thumbs`, asset.thumb) ?? url,
    width: asset.width,
    height: asset.height,
    seed: asset.seed,
    original_name: asset.originalName,
    favorite: asset.favorite,
    meta: asset.meta,
    conversation_id: asset.conversationId,
    message_id: asset.messageId,
    created_at: asset.createdAt,
  };
}

export function toPrivateMessageDto(
  message: PrivateMessage, references: PrivateAsset[], outputs: PrivateAsset[], sessionId: string,
): MessageDto {
  return {
    id: message.id,
    conversation_id: message.conversationId,
    parent_id: message.parentId,
    role: message.role,
    prompt: message.prompt,
    model_id: message.modelId,
    params: message.params,
    status: message.status,
    error: message.error,
    created_at: message.createdAt,
    started_at: message.startedAt,
    finished_at: message.finishedAt,
    references: references.map((a) => toPrivateAssetDto(a, sessionId)),
    outputs: outputs.map((a) => toPrivateAssetDto(a, sessionId)),
  };
}

export interface PrivateStats {
  cover: PrivateAsset | null;
  generationCount: number;
  busy: boolean;
}

export function toPrivateConversationDto(conversation: PrivateConversation, stats: PrivateStats, sessionId: string): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    pinned: conversation.pinned,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    mode: conversation.mode,
    cover: stats.cover ? toPrivateAssetDto(stats.cover, sessionId) : null,
    generation_count: stats.generationCount,
    busy: stats.busy,
  };
}

export function toPrivateConversationDetail(
  conversation: PrivateConversation, stats: PrivateStats, messages: MessageDto[], sessionId: string,
): ConversationDetailDto {
  return { ...toPrivateConversationDto(conversation, stats, sessionId), messages };
}
