/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AssetEntity, nowSeconds } from 'src/modules/media-library';
import { MessageDto } from '../dto/MessageDto';
import { MessageEntity } from '../entities/MessageEntity';
import { MessageRefEntity } from '../entities/MessageRefEntity';
import { toMessageDto } from '../mappers/messageMapper';
import { BUSY_STATUSES, CreateMessageInput, UpdateMessageInput } from '../types/studioTypes';

export const INTERRUPTED_MESSAGE = "Interrompu par l'arrêt du serveur";

/** Reads and writes messages and their references. Queueing and cancelling jobs arrive with H4.3. */
@Injectable()
export class MessageService {
  constructor(
    @InjectRepository(MessageEntity) private readonly messages: Repository<MessageEntity>,
    @InjectRepository(MessageRefEntity) private readonly refs: Repository<MessageRefEntity>,
    @InjectRepository(AssetEntity) private readonly assets: Repository<AssetEntity>,
  ) {}

  async get(id: string): Promise<MessageDto | null> {
    const message = await this.messages.findOneBy({ id });
    return message ? (await this.toDtos([message]))[0] : null;
  }

  /** Messages of a conversation, oldest first. */
  async listByConversation(conversationId: string): Promise<MessageDto[]> {
    const messages = await this.messages.find({
      where: { conversationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return this.toDtos(messages);
  }

  async create(input: CreateMessageInput): Promise<MessageDto> {
    const message = await this.messages.save(
      this.messages.create({
        id: input.id,
        conversationId: input.conversationId,
        parentId: input.parentId ?? null,
        role: input.role,
        prompt: input.prompt ?? '',
        modelId: input.modelId ?? null,
        params: input.params ?? {},
        status: input.status ?? 'done',
        error: null,
        createdAt: input.createdAt ?? nowSeconds(),
        startedAt: null,
        finishedAt: null,
      }),
    );
    const assetIds = [...new Set(input.referenceIds ?? [])];
    if (assetIds.length) {
      await this.refs.insert(assetIds.map((assetId, position) => ({ messageId: message.id, assetId, position })));
    }
    return (await this.toDtos([message]))[0];
  }

  /** `null` when the message does not exist. */
  async update(id: string, fields: UpdateMessageInput): Promise<MessageDto | null> {
    if (Object.keys(fields).length) await this.messages.update({ id }, fields);
    return this.get(id);
  }

  /** Deletes the message row (its answers and reference links go with it); assets and files are not touched. */
  async remove(id: string): Promise<boolean> {
    const result = await this.messages.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Startup sweep of the legacy server: a generation interrupted by a stop is not resumed, it is marked as failed.
   * Returns the number of messages changed.
   */
  async failInterrupted(): Promise<number> {
    const result = await this.messages.update(
      { status: In(BUSY_STATUSES) },
      { status: 'error', error: INTERRUPTED_MESSAGE, finishedAt: nowSeconds() },
    );
    return result.affected ?? 0;
  }

  /** Attaches reference and output assets to messages with two queries, whatever the number of messages. */
  async toDtos(messages: MessageEntity[]): Promise<MessageDto[]> {
    if (!messages.length) return [];
    const ids = messages.map((m) => m.id);
    const refs = await this.refs.find({ where: { messageId: In(ids) }, order: { position: 'ASC' } });
    const outputs = await this.assets.find({
      where: { messageId: In(ids), kind: 'generated' },
      order: { position: 'ASC' },
    });
    const refAssets = refs.length ? await this.assets.findBy({ id: In([...new Set(refs.map((r) => r.assetId))]) }) : [];
    const assetById = new Map(refAssets.map((a) => [a.id, a]));
    return messages.map((message) => {
      const references = refs
        .filter((r) => r.messageId === message.id)
        .map((r) => assetById.get(r.assetId))
        .filter((a): a is AssetEntity => Boolean(a));
      return toMessageDto(message, references, outputs.filter((a) => a.messageId === message.id));
    });
  }
}
