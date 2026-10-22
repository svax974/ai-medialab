/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { EventStreamService } from 'src/modules_shared/common/event-stream';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { AudioStudioModule, VoiceService } from 'src/modules/audio-studio';
import { EngineClient, EngineEventRelay } from 'src/modules/engine';
import { AssetService, MediaLibraryModule } from 'src/modules/media-library';
import { ConversationService, StudioCoreModule } from 'src/modules/studio-core';
import { ENTITY_GLOBS } from 'src/testing/testDataSource';

/** Stands in for the global `EngineModule`: the studio modules need the engine client and its event relay. */
@Global()
@Module({
  providers: [
    { provide: EngineClient, useValue: {} },
    { provide: EngineEventRelay, useValue: { events$: new Subject(), linkChanges$: new Subject(), connected: false } },
  ],
  exports: [EngineClient, EngineEventRelay],
})
class FakeEngineModule {}

/** The studio modules only use `EventStreamService` from `common` (the rest of it needs the whole app configuration). */
@Module({ providers: [{ provide: EventStreamService, useValue: { publish: () => undefined } }], exports: [EventStreamService] })
class FakeCommonModule {}

/** The three persistence modules wired in a real Nest container (DI, `forFeature`, cross-module imports). */
describe('persistence modules in a Nest container', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'better-sqlite3', database: ':memory:', synchronize: true, entities: ENTITY_GLOBS }),
        FakeEngineModule,
        MediaLibraryModule,
        StudioCoreModule,
        AudioStudioModule,
      ],
    })
      .overrideModule(CommonModule)
      .useModule(FakeCommonModule)
      .compile();
    await moduleRef.init();
  });
  afterAll(() => moduleRef.close());

  it('resolves the services (queue and routes included) and lets them share the database', async () => {
    const conversation = await moduleRef.get(ConversationService).create({ title: 'DI' });
    await moduleRef.get(AssetService).create({ id: 'a', kind: 'generated', filename: 'a.png', conversationId: conversation.id });
    expect((await moduleRef.get(ConversationService).get(conversation.id))?.cover?.id).toBe('a');
    expect(await moduleRef.get(VoiceService).list()).toEqual([]);
  });
});
