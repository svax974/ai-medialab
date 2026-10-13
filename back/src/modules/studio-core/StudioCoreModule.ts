/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaLibraryModule } from 'src/modules/media-library';
import { ConversationEntity } from './entities/ConversationEntity';
import { MessageEntity } from './entities/MessageEntity';
import { MessageRefEntity } from './entities/MessageRefEntity';
import { ConversationService } from './services/ConversationService';
import { MessageService } from './services/MessageService';

/** Conversations and messages: persistence only for now, routes and the job queue arrive with H4.3. See README.md. */
@Module({
  imports: [MediaLibraryModule, TypeOrmModule.forFeature([ConversationEntity, MessageEntity, MessageRefEntity])],
  providers: [ConversationService, MessageService],
  exports: [TypeOrmModule, ConversationService, MessageService],
})
export class StudioCoreModule {}
