/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { AudioStudioModule } from 'src/modules/audio-studio';
import { MediaLibraryModule } from 'src/modules/media-library';
import { ConversationController } from './controllers/ConversationController';
import { MessageController } from './controllers/MessageController';
import { QueueController } from './controllers/QueueController';
import { ConversationEntity } from './entities/ConversationEntity';
import { MessageEntity } from './entities/MessageEntity';
import { MessageRefEntity } from './entities/MessageRefEntity';
import { ConversationService } from './services/ConversationService';
import { GenerationQueueService } from './services/GenerationQueueService';
import { GenerationService } from './services/GenerationService';
import { JobRequestBuilder } from './services/JobRequestBuilder';
import { MessageService } from './services/MessageService';

/** Conversations, messages, the generation queue and their routes (`/api/conversations*`, `/api/messages*`). See README.md. */
@Module({
  imports: [CommonModule, MediaLibraryModule, AudioStudioModule, TypeOrmModule.forFeature([ConversationEntity, MessageEntity, MessageRefEntity])],
  controllers: [ConversationController, MessageController, QueueController],
  providers: [ConversationService, MessageService, JobRequestBuilder, GenerationQueueService, GenerationService],
  exports: [TypeOrmModule, ConversationService, MessageService, GenerationQueueService, GenerationService],
})
export class StudioCoreModule {}
