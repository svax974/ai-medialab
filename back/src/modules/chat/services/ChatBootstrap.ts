/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConversationModeRegistry } from 'src/modules/studio-core';
import { ChatAttachmentService } from './ChatAttachmentService';
import { ChatReplyService } from './ChatReplyService';
import { ChatStoreService } from './ChatStoreService';

/**
 * Plugs the chat into the shared conversation code (summary numbers, content search, what happens before a deletion)
 * and settles what a previous run left behind: replies still `streaming` and uploads that were never sent.
 */
@Injectable()
export class ChatBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChatBootstrap.name);

  constructor(
    private readonly registry: ConversationModeRegistry,
    private readonly store: ChatStoreService,
    private readonly replies: ChatReplyService,
    private readonly attachments: ChatAttachmentService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.registry.register({
      mode: 'chat',
      stats: (id) => this.store.stats(id),
      matching: (q) => this.store.matching(q),
      beforeRemove: async (id) => {
        this.replies.cancelConversation(id);
        await this.attachments.purgeConversation(id);
      },
    });
    try {
      const failed = await this.store.failInterrupted();
      if (failed) this.logger.warn(`${failed} chat reply(ies) interrupted by the last stop were marked as failed`);
      const swept = await this.attachments.sweepOrphans(await this.store.referencedAttachments());
      if (swept) this.logger.log(`${swept} unused chat upload(s) removed`);
    } catch (error) {
      this.logger.warn(`chat start-up cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
