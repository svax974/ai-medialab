/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query,
  UnprocessableEntityException, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES, decodeUploadName, type AssetDto } from 'src/modules/media-library';
import {
  parseCreateMessage, parseRetry, MAX_TITLE_LENGTH,
  type ConversationDetailDto, type ConversationDto, type MessageDto,
} from 'src/modules/studio-core';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { PrivateEvents } from '../services/PrivateEvents';
import { PrivateGenerationService, type CreatedPrivateGeneration } from '../services/PrivateGenerationService';
import { PrivateSessionService } from '../services/PrivateSessionService';
import { PrivateStore } from '../services/PrivateStore';
import { PrivateUploadService } from '../services/PrivateUploadService';
import { privateChatTitle, privateDefaultTitle, type PrivateSessionInfo } from '../types/privateTypes';
import { NoStoreInterceptor } from './NoStoreInterceptor';
import { privateUploadStorage } from './privateUpload';

const MODES = ['image', 'audio', 'video', 'chat'] as const;
type PrivateMode = (typeof MODES)[number];
const MAX_FILES = 20;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `/api/private/*`: the routes of the studios (`/api/conversations`, `/api/messages`, `/api/queue`, `/api/assets`) for the
 * private session, with the same URLs below the prefix and the same shapes, answered from memory. Nothing reaches the
 * database and every answer is `no-store`. Admin only. See README.md.
 */
@ApiExcludeController()
@Controller('api/private')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor, NoStoreInterceptor)
export class PrivateController {
  constructor(
    private readonly session: PrivateSessionService,
    private readonly store: PrivateStore,
    private readonly generations: PrivateGenerationService,
    private readonly uploads: PrivateUploadService,
    private readonly events: PrivateEvents,
  ) {}

  // Session ----------------------------------------------------------------------------------------------------------

  @Get('session')
  info(): PrivateSessionInfo {
    this.session.touch();
    return this.session.info();
  }

  @Post('session')
  @HttpCode(200)
  start(): PrivateSessionInfo {
    return this.session.start();
  }

  @Delete('session')
  async end(): Promise<PrivateSessionInfo> {
    await this.session.end();
    return this.session.info();
  }

  /** The browser's last word as the page closes (`navigator.sendBeacon` can only POST). */
  @Post('session/leave')
  @HttpCode(204)
  async leave(): Promise<void> {
    await this.session.end();
  }

  // Conversations ----------------------------------------------------------------------------------------------------

  @Get('conversations')
  list(@Query('q') q?: string, @Query('mode') mode?: string): ConversationDto[] {
    this.requireSession();
    return this.store.list({ q: q?.trim() || undefined, mode: MODES.includes(mode as PrivateMode) ? (mode as PrivateMode) : undefined });
  }

  @Post('conversations')
  @HttpCode(200)
  create(@Body() body: unknown): ConversationDetailDto {
    this.requireSession();
    const { title, mode } = isRecord(body) ? body : {};
    if (title != null && typeof title !== 'string') throw new UnprocessableEntityException(tr('private.error.textExpected', ['title']));
    if (mode != null && !MODES.includes(mode as PrivateMode)) throw new UnprocessableEntityException(tr('private.error.modeExpected'));
    const chosen = (mode as PrivateMode | undefined) ?? 'image';
    const conversation = this.store.createConversation({
      title: (title as string | undefined)?.trim() || (chosen === 'chat' ? privateChatTitle() : privateDefaultTitle()), mode: chosen,
    });
    this.events.changed('conversation', { conversation_id: conversation.id });
    return this.store.detail(conversation.id) as ConversationDetailDto;
  }

  @Get('conversations/:id')
  get(@Param('id') id: string): ConversationDetailDto {
    this.requireSession();
    const detail = this.store.detail(id);
    if (!detail) throw new NotFoundException(tr('private.error.conversationNotFound'));
    return detail;
  }

  @Patch('conversations/:id')
  patch(@Param('id') id: string, @Body() body: unknown): ConversationDto {
    this.requireSession();
    const { title, pinned, message_count: count } = isRecord(body) ? body : {};
    if (title != null && typeof title !== 'string') throw new UnprocessableEntityException(tr('private.error.textExpected', ['title']));
    if (pinned != null && typeof pinned !== 'boolean') throw new UnprocessableEntityException(tr('private.error.booleanExpected', ['pinned']));
    if (count != null && (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 100_000)) {
      throw new UnprocessableEntityException(tr('private.error.messageCountRange'));
    }
    const updated = this.store.updateConversation(id, {
      ...(typeof title === 'string' ? { title: title.trim().slice(0, MAX_TITLE_LENGTH) } : {}),
      ...(typeof pinned === 'boolean' ? { pinned } : {}),
      ...(typeof count === 'number' ? { messageCount: count } : {}),
    });
    if (updated && typeof count === 'number') this.store.touch(id); // a chat that grew moves up the list
    if (!updated) throw new NotFoundException(tr('private.error.conversationNotFound'));
    this.events.changed('conversation', { conversation_id: id });
    return this.store.summary(id) as ConversationDto;
  }

  @Delete('conversations/:id')
  removeConversation(@Param('id') id: string): Promise<{ ok: true }> {
    return this.generations.removeConversation(id);
  }

  // Generations ------------------------------------------------------------------------------------------------------

  @Post('messages')
  @HttpCode(200)
  createMessage(@Body() body: unknown): Promise<CreatedPrivateGeneration> {
    return this.generations.create(parseCreateMessage(body));
  }

  @Post('messages/:id/retry')
  @HttpCode(200)
  retry(@Param('id') id: string, @Body() body: unknown): Promise<MessageDto> {
    return this.generations.retry(id, parseRetry(body));
  }

  @Post('messages/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): Promise<{ ok: true }> {
    return this.generations.cancel(id);
  }

  @Delete('messages/:id')
  removeMessage(@Param('id') id: string): Promise<{ ok: true; deleted: string[] }> {
    return this.generations.remove(id);
  }

  @Get('queue')
  queue(): { current: string | null; queue: string[] } {
    return this.generations.publicQueue();
  }

  // Assets (references) ----------------------------------------------------------------------------------------------

  @Post('assets')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES, { storage: privateUploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFiles() files: Express.Multer.File[] = []): Promise<AssetDto[]> {
    if (!files.length) throw new UnprocessableEntityException(tr('private.error.noFileReceivedMany'));
    const created: AssetDto[] = [];
    for (const file of files) {
      created.push(await this.uploads.ingest({ path: file.path, originalName: decodeUploadName(file.originalname), mimeType: file.mimetype }));
    }
    return created;
  }

  @Patch('assets/:id')
  patchAsset(@Param('id') id: string, @Body() body: { favorite?: unknown }): AssetDto {
    this.requireSession();
    if (body?.favorite != null && typeof body.favorite !== 'boolean') throw new UnprocessableEntityException(tr('private.error.booleanExpected', ['favorite']));
    const asset = body?.favorite == null ? this.store.getAsset(id) : this.store.setFavorite(id, body.favorite as boolean);
    if (!asset) throw new NotFoundException(tr('private.error.imageNotFound'));
    return this.store.assetDto(asset);
  }

  @Delete('assets/:id')
  async removeAsset(@Param('id') id: string): Promise<{ ok: true }> {
    this.requireSession();
    const asset = this.store.removeAsset(id);
    if (!asset) throw new NotFoundException(tr('private.error.imageNotFound'));
    await this.generations.eraseFiles([asset]);
    this.events.changed('message', asset.conversationId ? { conversation_id: asset.conversationId } : {});
    return { ok: true };
  }

  private requireSession(): void {
    this.session.touch();
    if (!this.session.active) throw new ConflictException(tr('private.error.noSession'));
  }
}
