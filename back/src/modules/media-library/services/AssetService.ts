/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetDto } from '../dto/AssetDto';
import { AssetPageDto } from '../dto/AssetListItemDto';
import { AssetEntity } from '../entities/AssetEntity';
import { toAssetDto, toAssetListItemDto } from '../mappers/assetMapper';
import { CreateAssetInput, ListAssetsQuery } from '../types/assetTypes';

const MEDIA_FILTERS = ['image', 'audio', 'video'];
const DEFAULT_PAGE = 60;
const MAX_PAGE = 200;

/** Reads and writes assets in the database. Files on disk (and thumbnails) are handled by the engine and by H4.4. */
@Injectable()
export class AssetService {
  constructor(@InjectRepository(AssetEntity) private readonly assets: Repository<AssetEntity>) {}

  async get(id: string): Promise<AssetDto | null> {
    const asset = await this.assets.findOneBy({ id });
    return asset ? toAssetDto(asset) : null;
  }

  async create(input: CreateAssetInput): Promise<AssetDto> {
    const asset = await this.assets.save(
      this.assets.create({
        id: input.id,
        kind: input.kind,
        media: input.media ?? 'image',
        filename: input.filename,
        thumb: input.thumb ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        originalName: input.originalName ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        seed: input.seed ?? null,
        duration: input.duration ?? null,
        position: input.position ?? 0,
        favorite: input.favorite ?? false,
        meta: input.meta ?? {},
        createdAt: input.createdAt ?? Date.now() / 1000,
      }),
    );
    return toAssetDto(asset);
  }

  /** `null` when the asset does not exist. */
  async setFavorite(id: string, favorite: boolean): Promise<AssetDto | null> {
    await this.assets.update({ id }, { favorite });
    return this.get(id);
  }

  /** Deletes the row only; returns the deleted asset (so the caller can remove its files), `null` if unknown. */
  async remove(id: string): Promise<AssetEntity | null> {
    const asset = await this.assets.findOneBy({ id });
    if (!asset) return null;
    await this.assets.delete({ id });
    return asset;
  }

  /** Gallery page, newest first. Same filters and cursor as the legacy `GET /assets`. */
  async list(query: ListAssetsQuery = {}): Promise<AssetPageDto> {
    const limit = Math.max(1, Math.min(MAX_PAGE, query.limit ?? DEFAULT_PAGE));
    const qb = this.assets
      .createQueryBuilder('a')
      .leftJoin('conversations', 'c', 'c.id = a.conversationId')
      .leftJoin('messages', 'm', 'm.id = a.messageId')
      .addSelect('c.title', 'conversation_title')
      .addSelect('m.prompt', 'prompt')
      .addSelect('m.model_id', 'model_id')
      .where('a.kind = :kind', { kind: query.kind ?? 'generated' });
    const media = query.media ?? 'image';
    if (MEDIA_FILTERS.includes(media)) qb.andWhere('a.media = :media', { media });
    if (query.favorites) qb.andWhere('a.favorite = :fav', { fav: true });
    if (query.q) qb.andWhere('(m.prompt LIKE :q OR c.title LIKE :q)', { q: `%${query.q}%` });
    if (query.before) qb.andWhere('a.createdAt < :before', { before: query.before });
    qb.orderBy('a.createdAt', 'DESC').limit(limit);

    const { entities, raw } = await qb.getRawAndEntities();
    const items = entities.map((asset, i) =>
      toAssetListItemDto(asset, {
        conversationTitle: raw[i].conversation_title ?? null,
        prompt: raw[i].prompt ?? null,
        modelId: raw[i].model_id ?? null,
      }),
    );
    return { items, next_before: items.length === limit ? items[items.length - 1].created_at : null };
  }
}
