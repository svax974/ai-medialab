/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AssetEntity, newId, nowSeconds } from 'src/modules/media-library';
import { ConversationDetailDto } from '../dto/ConversationDetailDto';
import { ConversationDto } from '../dto/ConversationDto';
import { ConversationEntity, ConversationMode } from '../entities/ConversationEntity';
import { MessageEntity } from '../entities/MessageEntity';
import { ConversationStats, toConversationDetailDto, toConversationDto } from '../mappers/conversationMapper';
import {
  BUSY_STATUSES,
  CreateConversationInput,
  DEFAULT_CONVERSATION_TITLE,
  ListConversationsQuery,
  MAX_TITLE_LENGTH,
  UpdateConversationInput,
} from '../types/studioTypes';
import { MessageService } from './MessageService';

/** Reads and writes conversations. Same summaries and ordering as the legacy `GET /conversations`. */
@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(ConversationEntity) private readonly conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity) private readonly messages: Repository<MessageEntity>,
    @InjectRepository(AssetEntity) private readonly assets: Repository<AssetEntity>,
    private readonly messageService: MessageService,
  ) {}

  /** Pinned first, then most recently updated. */
  async list(query: ListConversationsQuery = {}): Promise<ConversationDto[]> {
    const qb = this.conversations.createQueryBuilder('c');
    if (query.mode) qb.andWhere('c.mode = :mode', { mode: query.mode });
    if (query.q) {
      qb.andWhere(
        '(c.title LIKE :q OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.prompt LIKE :q))',
        { q: `%${query.q}%` },
      );
    }
    const rows = await qb.orderBy('c.pinned', 'DESC').addOrderBy('c.updatedAt', 'DESC').getMany();
    return Promise.all(rows.map(async (c) => toConversationDto(c, await this.statsOf(c.id))));
  }

  async getSummary(id: string): Promise<ConversationDto | null> {
    const conversation = await this.conversations.findOneBy({ id });
    return conversation ? toConversationDto(conversation, await this.statsOf(id)) : null;
  }

  async get(id: string): Promise<ConversationDetailDto | null> {
    const conversation = await this.conversations.findOneBy({ id });
    if (!conversation) return null;
    const messages = await this.messageService.listByConversation(id);
    return toConversationDetailDto(conversation, await this.statsOf(id), messages);
  }

  async create(input: CreateConversationInput = {}): Promise<ConversationDetailDto> {
    const now = nowSeconds();
    const conversation = await this.conversations.save(
      this.conversations.create({
        id: newId(),
        title: input.title?.trim() || DEFAULT_CONVERSATION_TITLE,
        pinned: false,
        mode: input.mode === 'audio' || input.mode === 'video' ? (input.mode as ConversationMode) : 'image',
        createdAt: now,
        updatedAt: now,
      }),
    );
    return (await this.get(conversation.id)) as ConversationDetailDto;
  }

  /** `null` when the conversation does not exist. */
  async update(id: string, input: UpdateConversationInput): Promise<ConversationDto | null> {
    const fields: Partial<ConversationEntity> = {};
    if (input.title !== undefined) fields.title = input.title.trim().slice(0, MAX_TITLE_LENGTH);
    if (input.pinned !== undefined) fields.pinned = input.pinned;
    if (Object.keys(fields).length) await this.conversations.update({ id }, fields);
    return this.getSummary(id);
  }

  /** Moves the conversation to the top of the recent list. */
  async touch(id: string): Promise<void> {
    await this.conversations.update({ id }, { updatedAt: nowSeconds() });
  }

  /**
   * Deletes the conversation row and, by cascade, its messages and reference links. Assets are kept (their
   * conversation / message link is cleared): purging them and their files is part of H4.3 / H4.4.
   */
  async remove(id: string): Promise<boolean> {
    const result = await this.conversations.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  private async statsOf(conversationId: string): Promise<ConversationStats> {
    const cover = await this.assets.findOne({
      where: { conversationId, kind: 'generated', media: In(['image', 'video']) },
      order: { createdAt: 'DESC' },
    });
    const generationCount = await this.messages.countBy({ conversationId, role: 'assistant' });
    const busyCount = await this.messages.countBy({ conversationId, role: 'assistant', status: In(BUSY_STATUSES) });
    return { cover, generationCount, busy: busyCount > 0 };
  }
}
