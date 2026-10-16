/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { AudioStudioModule } from 'src/modules/audio-studio';
import { MediaLibraryModule } from 'src/modules/media-library';
import { ModelCatalogModule } from 'src/modules/model-catalog';
import { SettingsModule } from 'src/modules/settings';
import { StudioCoreModule } from 'src/modules/studio-core';
import { ChatController } from './controllers/ChatController';
import { ChatMessageEntity } from './entities/ChatMessageEntity';
import { ChatSettingsEntity } from './entities/ChatSettingsEntity';
import { ChatAttachmentService } from './services/ChatAttachmentService';
import { ChatBootstrap } from './services/ChatBootstrap';
import { ChatModelService } from './services/ChatModelService';
import { ChatReplyService } from './services/ChatReplyService';
import { ChatService } from './services/ChatService';
import { ChatStoreService } from './services/ChatStoreService';
import { CreationToolsService } from './services/CreationToolsService';
import { EngineLlmClient } from './services/EngineLlmClient';
import { PromptEnhanceService } from './services/PromptEnhanceService';
import { WebToolsService } from './services/WebToolsService';

/** The chat studio: conversations as a tree of messages with a local language model, web tools, `/api/chat/*`. See README.md. */
@Module({
  imports: [
    CommonModule, MediaLibraryModule, AudioStudioModule, StudioCoreModule, ModelCatalogModule, SettingsModule,
    TypeOrmModule.forFeature([ChatMessageEntity, ChatSettingsEntity]),
  ],
  controllers: [ChatController],
  providers: [
    ChatStoreService, ChatAttachmentService, ChatModelService, EngineLlmClient, WebToolsService, CreationToolsService, ChatReplyService, ChatService,
    PromptEnhanceService, ChatBootstrap,
  ],
  exports: [TypeOrmModule, ChatStoreService, ChatReplyService, EngineLlmClient, ChatModelService, WebToolsService, PromptEnhanceService, CreationToolsService],
})
export class ChatModule {}
