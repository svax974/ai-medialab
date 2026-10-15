/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UnprocessableEntityException, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StudioEvents } from 'src/modules/media-library';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { ConversationDetailDto } from '../dto/ConversationDetailDto';
import { ConversationDto } from '../dto/ConversationDto';
import { ConversationMode } from '../entities/ConversationEntity';
import { ConversationService } from '../services/ConversationService';
import { GenerationService } from '../services/GenerationService';

const MODES: string[] = ['image', 'audio', 'video', 'chat'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `/api/conversations*`: same URLs and shapes as the engine's legacy routes. Admin only. */
@ApiExcludeController()
@Controller('api/conversations')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class ConversationController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly generations: GenerationService,
    private readonly events: StudioEvents,
  ) {}

  @Get()
  list(@Query('q') q?: string, @Query('mode') mode?: string): Promise<ConversationDto[]> {
    return this.conversations.list({ q: q?.trim() || undefined, mode: MODES.includes(mode ?? '') ? (mode as ConversationMode) : undefined });
  }

  @Post()
  @HttpCode(200)
  async create(@Body() body: unknown): Promise<ConversationDetailDto> {
    const { title, mode } = isRecord(body) ? body : {};
    if (title != null && typeof title !== 'string') throw new UnprocessableEntityException('title : texte attendu.');
    if (mode != null && typeof mode !== 'string') throw new UnprocessableEntityException('mode : texte attendu.');
    const created = await this.conversations.create({ title: (title as string | undefined) ?? undefined, mode: (mode as string | undefined) ?? undefined });
    await this.generations.publishConversation(created.id);
    return created;
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ConversationDetailDto> {
    const conversation = await this.conversations.get(id);
    if (!conversation) throw new NotFoundException('Conversation introuvable.');
    return conversation;
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<ConversationDto> {
    const { title, pinned } = isRecord(body) ? body : {};
    if (title != null && typeof title !== 'string') throw new UnprocessableEntityException('title : texte attendu.');
    if (pinned != null && typeof pinned !== 'boolean') throw new UnprocessableEntityException('pinned : booléen attendu.');
    const summary = await this.conversations.update(id, { title: (title as string | undefined) ?? undefined, pinned: (pinned as boolean | undefined) ?? undefined });
    if (!summary) throw new NotFoundException('Conversation introuvable.');
    this.events.publish('conversation.updated', summary);
    return summary;
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ ok: true }> {
    return this.generations.removeConversation(id);
  }
}
