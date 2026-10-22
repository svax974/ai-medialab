/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { ConversationDto } from './ConversationDto';
import { MessageDto } from './MessageDto';

/** A conversation with all its messages, oldest first (`GET /conversations/:id` of the legacy API). */
export class ConversationDetailDto extends ConversationDto {
  messages: MessageDto[];
}
