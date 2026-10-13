/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioStudioModule, VoiceService } from 'src/modules/audio-studio';
import { AssetService, MediaLibraryModule } from 'src/modules/media-library';
import { ConversationService, StudioCoreModule } from 'src/modules/studio-core';
import { ENTITY_GLOBS } from 'src/testing/testDataSource';

/** The three persistence modules wired in a real Nest container (DI, `forFeature`, cross-module imports). */
describe('persistence modules in a Nest container', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'better-sqlite3', database: ':memory:', synchronize: true, entities: ENTITY_GLOBS }),
        MediaLibraryModule,
        StudioCoreModule,
        AudioStudioModule,
      ],
    }).compile();
    await moduleRef.init();
  });
  afterAll(() => moduleRef.close());

  it('resolves the services and lets them share the database', async () => {
    const conversation = await moduleRef.get(ConversationService).create({ title: 'DI' });
    await moduleRef.get(AssetService).create({ id: 'a', kind: 'generated', filename: 'a.png', conversationId: conversation.id });
    expect((await moduleRef.get(ConversationService).get(conversation.id))?.cover?.id).toBe('a');
    expect(await moduleRef.get(VoiceService).list()).toEqual([]);
  });
});
