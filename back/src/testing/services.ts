/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { DataSource } from 'typeorm';
import { VoiceEntity, VoiceService } from 'src/modules/audio-studio';
import { AssetEntity, AssetService } from 'src/modules/media-library';
import {
  ConversationEntity,
  ConversationService,
  MessageEntity,
  MessageRefEntity,
  MessageService,
} from 'src/modules/studio-core';

/** The persistence services wired by hand on a test data source (no Nest container needed). */
export function buildServices(dataSource: DataSource) {
  const assets = new AssetService(dataSource.getRepository(AssetEntity));
  const messages = new MessageService(
    dataSource.getRepository(MessageEntity),
    dataSource.getRepository(MessageRefEntity),
    dataSource.getRepository(AssetEntity),
  );
  const conversations = new ConversationService(
    dataSource.getRepository(ConversationEntity),
    dataSource.getRepository(MessageEntity),
    dataSource.getRepository(AssetEntity),
    messages,
  );
  const voices = new VoiceService(dataSource.getRepository(VoiceEntity));
  return { assets, messages, conversations, voices };
}
