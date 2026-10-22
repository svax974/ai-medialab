/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EventStreamService } from 'src/modules_shared/common/event-stream';

export const PRIVATE_TOPIC = 'private.changed';

export type PrivateChange = 'session' | 'conversation' | 'message' | 'queue';

/**
 * Tells the browser that something of the private session changed, with ids only: never a prompt, a title or a file
 * name. The event stream keeps recent events in a replay buffer; what the browser needs to show is read again through
 * `/api/private/*`, which sends no-store answers.
 */
@Injectable()
export class PrivateEvents {
  constructor(private readonly stream: EventStreamService) {}

  changed(kind: PrivateChange, ids: { conversation_id?: string; message_id?: string } = {}): void {
    this.stream.publish(PRIVATE_TOPIC, { type: PRIVATE_TOPIC, data: { kind, ...ids } }, { admin: true });
  }
}
