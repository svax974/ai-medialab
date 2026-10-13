/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { AssetDto } from '../dto/AssetDto';
import { AssetListItemDto } from '../dto/AssetListItemDto';
import { AssetEntity } from '../entities/AssetEntity';

/** URL of a file served by the media route: `/media/<folder>/<filename>`; `null` without a file name. */
export function mediaUrl(folder: string, filename: string | null | undefined): string | null {
  return filename ? `/media/${folder}/${filename}` : null;
}

/** Entity to the public shape of the legacy API (`asset_public`). */
export function toAssetDto(asset: AssetEntity): AssetDto {
  const folder = asset.kind === 'upload' ? 'uploads' : 'outputs';
  const meta = asset.meta ?? {};
  const media = asset.media || 'image';
  const fps = media === 'video' ? ((meta.fps as number | undefined) ?? null) : null;
  const url = mediaUrl(folder, asset.filename) as string;
  return {
    id: asset.id,
    kind: asset.kind,
    media,
    duration: asset.duration ?? null,
    fps,
    url,
    thumb_url: mediaUrl('thumbs', asset.thumb) ?? url,
    width: asset.width ?? null,
    height: asset.height ?? null,
    seed: asset.seed ?? null,
    original_name: asset.originalName ?? null,
    favorite: Boolean(asset.favorite),
    meta,
    conversation_id: asset.conversationId ?? null,
    message_id: asset.messageId ?? null,
    created_at: asset.createdAt,
  };
}

/** Gallery item: the public asset plus the title of its conversation and the prompt / model of its message. */
export function toAssetListItemDto(
  asset: AssetEntity,
  context: { conversationTitle: string | null; prompt: string | null; modelId: string | null },
): AssetListItemDto {
  return {
    ...toAssetDto(asset),
    conversation_title: context.conversationTitle,
    prompt: context.prompt,
    model_id: context.modelId,
  };
}
