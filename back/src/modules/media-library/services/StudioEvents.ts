/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EventStreamService } from 'src/modules_shared/common/event-stream';

/** Topic prefix of the studio events; the event name (`message.updated`...) is the part after it, and the `type`. */
export const STUDIO_TOPIC_PREFIX = 'studio.';

/**
 * Names of the studio events: the same names and payloads as the legacy engine SSE (`engine/app/repo.py` (removed in H6),
 * `jobs.py`, `routes.py`), now published by Nest under the topic `studio.<name>`.
 */
export type StudioEventName =
  | 'job.progress'
  | 'job.image'
  | 'message.updated'
  | 'message.deleted'
  | 'conversation.updated'
  | 'conversation.deleted'
  | 'asset.updated'
  | 'asset.deleted'
  | 'queue.updated'
  | 'voices.changed'
  | 'ocr.updated'
  | 'ocr.deleted';

export const STUDIO_EVENT_NAMES: StudioEventName[] = [
  'job.progress', 'job.image', 'message.updated', 'message.deleted',
  'conversation.updated', 'conversation.deleted', 'asset.updated', 'asset.deleted', 'queue.updated',
  'voices.changed', 'ocr.updated', 'ocr.deleted',
];

/** Single-user app: every principal that can read the stream is an admin (`local-trust` included). */
const AUDIENCE = { admin: true } as const;

/** Publishes studio events to the browser event stream (`GET /api/v1/events/stream?topics=studio.message.updated,...`). */
@Injectable()
export class StudioEvents {
  constructor(private readonly stream: EventStreamService) {}

  publish(name: StudioEventName, data: object): void {
    this.stream.publish(`${STUDIO_TOPIC_PREFIX}${name}`, { type: name, data: data as Record<string, unknown> }, AUDIENCE);
  }
}
