/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventStreamService, InMemoryTransport, type ConnectionSink } from 'src/modules_shared/common/event-stream';
import { RedisService } from 'src/modules_shared/common/services/RedisService';
import { STUDIO_MAX_EVENT_BYTES, StudioEventLimitsModule } from './StudioEventLimitsModule';

const root = { id: 0, admin: true, kind: 'admin-token' } as const;
const noRedis = { getClient: () => null };

/** Like `CommonModule`: the stream service is declared in a module that does not import ours. */
@Module({ providers: [EventStreamService, { provide: RedisService, useValue: noRedis }], exports: [EventStreamService] })
class SharedStreamModule {}

async function streamWith(withLimits: boolean): Promise<{ service: EventStreamService; events: unknown[] }> {
  const ref = await Test.createTestingModule({ imports: withLimits ? [StudioEventLimitsModule, SharedStreamModule] : [SharedStreamModule] }).compile();
  const service = ref.get(EventStreamService);
  service.useTransport(new InMemoryTransport());
  const events: unknown[] = [];
  const sink: ConnectionSink = { send: (f) => f.name === 'event' && events.push(f.data), end: () => undefined };
  await service.openConnection(root, ['studio.message.updated'], sink);
  return { service, events };
}

const big = (bytes: number) => ({ type: 'message.updated', data: { text: 'x'.repeat(bytes) } });

describe('StudioEventLimitsModule', () => {
  it('lets a global module raise the limit of the stream service declared in another module', async () => {
    const { service, events } = await streamWith(true);
    service.publish('studio.message.updated', big(100 * 1024), { admin: true });
    expect(events).toHaveLength(1);
    service.publish('studio.message.updated', big(STUDIO_MAX_EVENT_BYTES), { admin: true });
    expect(events).toHaveLength(1); // still bounded
    service.onModuleDestroy();
  });

  it('control: without it the shared 16 KB limit drops the same event', async () => {
    const { service, events } = await streamWith(false);
    service.publish('studio.message.updated', big(100 * 1024), { admin: true });
    expect(events).toHaveLength(0);
    service.onModuleDestroy();
  });
});
