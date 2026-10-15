/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UnprocessableEntityException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { uploadStorage } from 'src/modules/media-library';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { ChatAttachmentService } from '../services/ChatAttachmentService';
import { ChatReplyService } from '../services/ChatReplyService';
import { ChatService } from '../services/ChatService';
import { PromptEnhanceService } from '../services/PromptEnhanceService';
import {
  parseEditBody, parseEnhanceBody, parseExportFormat, parseId, parseLeafBody, parseRegenerateBody, parseSearchQuery, parseSendBody, parseSettingsPatch,
} from '../services/chatValidation';
import { MAX_IMAGE_BYTES, type ChatAttachment, type ChatConversation, type ChatMessage, type ChatSettings } from '../types/chatTypes';
import { SseStream } from './SseStream';

/** `/api/chat/*`: the chat studio (conversations are the ones of `/api/conversations`, with `mode: 'chat'`). Admin only. */
@ApiExcludeController()
@Controller('api/chat')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly replies: ChatReplyService,
    private readonly attachments: ChatAttachmentService,
    private readonly enhancer: PromptEnhanceService,
  ) {}

  @Get('search')
  search(@Query('q') q?: string) {
    return this.chat.search(parseSearchQuery(q));
  }

  @Post('enhance-prompt')
  @HttpCode(200)
  enhance(@Body() body: unknown): Promise<{ prompt: string; model_id: string }> {
    const { kind, prompt, modelId } = parseEnhanceBody(body);
    return this.enhancer.enhance(kind, prompt, modelId);
  }

  @Post('attachments')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  upload(@UploadedFile() file?: Express.Multer.File): Promise<ChatAttachment> {
    if (!file) throw new UnprocessableEntityException('Aucun fichier reçu (champ « file »).');
    return this.attachments.accept(file);
  }

  @Post('model/unload')
  @HttpCode(200)
  unloadModel(): Promise<{ ok: true }> {
    return this.chat.unloadModel();
  }

  @Get('conversations/:id/messages/:mid/siblings')
  siblings(@Param('id') id: string, @Param('mid') mid: string): Promise<ChatMessage[]> {
    return this.chat.siblings(parseId(id, 'id'), parseId(mid, 'mid'));
  }

  @Get('conversations/:id')
  get(@Param('id') id: string): Promise<ChatConversation> {
    return this.chat.get(parseId(id, 'id'));
  }

  @Patch('conversations/:id/settings')
  settings(@Param('id') id: string, @Body() body: unknown): Promise<ChatSettings> {
    return this.chat.updateSettings(parseId(id, 'id'), parseSettingsPatch(body));
  }

  @Post('conversations/:id/leaf')
  @HttpCode(200)
  leaf(@Param('id') id: string, @Body() body: unknown): Promise<ChatConversation> {
    return this.chat.switchLeaf(parseId(id, 'id'), parseLeafBody(body));
  }

  @Get('conversations/:id/export')
  async export(@Param('id') id: string, @Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const file = await this.chat.export(parseId(id, 'id'), parseExportFormat(format));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  }

  @Delete('conversations/:id/messages/:mid')
  deleteMessage(@Param('id') id: string, @Param('mid') mid: string): Promise<ChatConversation> {
    return this.chat.deleteMessage(parseId(id, 'id'), parseId(mid, 'mid'));
  }

  @Post('conversations/:id/messages')
  async send(@Param('id') id: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = parseSendBody(body);
    await this.stream(res, (sink) => this.replies.send(parseId(id, 'id'), parsed, sink));
  }

  @Post('conversations/:id/messages/:mid/regenerate')
  async regenerate(@Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const { modelId } = parseRegenerateBody(body);
    await this.stream(res, (sink) => this.replies.regenerate(parseId(id, 'id'), parseId(mid, 'mid'), modelId, sink));
  }

  @Post('conversations/:id/messages/:mid/edit')
  async edit(@Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = parseEditBody(body);
    await this.stream(res, (sink) => this.replies.edit(parseId(id, 'id'), parseId(mid, 'mid'), parsed, sink));
  }

  /** Runs a reply into an SSE response. The headers go out with the first event: an error before it is a normal HTTP error. */
  private async stream(res: Response, run: (sink: SseStream) => Promise<void>): Promise<void> {
    const sink = new SseStream(res);
    try {
      await run(sink);
    } catch (error) {
      if (!sink.started) throw error; // nothing sent yet: Nest answers with the HTTP error
      sink.emit('error', { code: 'upstream', message: 'La réponse a échoué de façon inattendue.' });
    } finally {
      sink.end();
    }
  }
}
