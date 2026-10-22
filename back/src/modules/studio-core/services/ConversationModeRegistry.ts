/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import type { ConversationMode } from '../entities/ConversationEntity';

/**
 * What a conversation mode that keeps its messages elsewhere (the chat studio, module `chat`) gives the shared
 * conversation code, which only knows the generation messages: the numbers of its summary, its content search and
 * what has to happen before it is deleted. `studio-core` never imports such a module: it registers itself here.
 */
export interface ConversationModeExtension {
  readonly mode: ConversationMode;
  /** Messages of the active branch and whether a reply is being generated. */
  stats(conversationId: string): Promise<{ generationCount: number; busy: boolean }>;
  /** Ids of the conversations of this mode whose messages contain `q` (a substring, case-insensitive). */
  matching(q: string): Promise<string[]>;
  /** Called before the conversation row is deleted: stop what runs, delete the files that belong to it. */
  beforeRemove(conversationId: string): Promise<void>;
}

@Injectable()
export class ConversationModeRegistry {
  private readonly extensions = new Map<ConversationMode, ConversationModeExtension>();

  register(extension: ConversationModeExtension): void {
    this.extensions.set(extension.mode, extension);
  }

  get(mode: ConversationMode): ConversationModeExtension | undefined {
    return this.extensions.get(mode);
  }

  all(): ConversationModeExtension[] {
    return [...this.extensions.values()];
  }
}
