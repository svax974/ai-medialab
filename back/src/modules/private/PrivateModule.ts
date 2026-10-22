/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { AudioStudioModule } from 'src/modules/audio-studio';
import { ChatModule } from 'src/modules/chat';
import { MediaLibraryModule } from 'src/modules/media-library';
import { StudioCoreModule } from 'src/modules/studio-core';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { NoStoreInterceptor } from './controllers/NoStoreInterceptor';
import { PrivateChatController } from './controllers/PrivateChatController';
import { PrivateController } from './controllers/PrivateController';
import { PrivateChatAttachmentService } from './services/PrivateChatAttachmentService';
import { PrivateChatService } from './services/PrivateChatService';
import { PrivateEvents } from './services/PrivateEvents';
import { PrivateGenerationService } from './services/PrivateGenerationService';
import { PrivateSessionService } from './services/PrivateSessionService';
import { PrivateStore } from './services/PrivateStore';
import { PrivateUploadService } from './services/PrivateUploadService';

/** The private generation session (`/api/private/*`): conversations, generations and references held in memory. See README.md. */
@Module({
  imports: [CommonModule, MediaLibraryModule, StudioCoreModule, AudioStudioModule, ChatModule],
  controllers: [PrivateController, PrivateChatController],
  providers: [
    NoStoreInterceptor, PrivateStore, PrivateEvents, PrivateSessionService, PrivateGenerationService, PrivateUploadService,
    PrivateChatAttachmentService, PrivateChatService,
  ],
  exports: [PrivateSessionService, PrivateStore],
})
export class PrivateModule {}
