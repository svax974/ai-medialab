/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { describe, expect, it } from '@jest/globals';
import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EngineClient } from 'src/modules/engine';
import { StudioEvents } from 'src/modules/media-library';
import { ModelCatalogService } from 'src/modules/model-catalog';
import { SettingsService } from 'src/modules/settings';
import {
  ConversationEntity, ConversationModeRegistry, ConversationService, EngineBusyGate, GenerationQueueService, GenerationService,
} from 'src/modules/studio-core';
import { ChatModule } from './ChatModule';
import { ChatController } from './controllers/ChatController';
import { ChatMessageEntity } from './entities/ChatMessageEntity';
import { ChatSettingsEntity } from './entities/ChatSettingsEntity';
import { ChatBootstrap } from './services/ChatBootstrap';
import { ChatReplyService } from './services/ChatReplyService';
import { WEB_TOOL_DEPS } from './services/WebToolsService';

const meta = <T>(key: string, target: object): T[] => (Reflect.getMetadata(key, target) as T[] | undefined) ?? [];

describe('ChatModule wiring', () => {
  const imported = meta<{ prototype?: object }>('imports', ChatModule);
  const exportedByImports = new Set<unknown>(imported.flatMap((m) => meta<unknown>('exports', m as object)));

  it('imports a module that exports each service the chat takes from the others (the container would refuse to start otherwise)', () => {
    const needs: [string, unknown][] = [
      ['ConversationService', ConversationService], ['GenerationService', GenerationService], ['GenerationQueueService', GenerationQueueService],
      ['EngineBusyGate', EngineBusyGate], ['ConversationModeRegistry', ConversationModeRegistry], ['StudioEvents', StudioEvents],
      ['ModelCatalogService', ModelCatalogService], ['SettingsService', SettingsService],
    ];
    for (const [name, token] of needs) expect([name, exportedByImports.has(token)]).toEqual([name, true]);
  });

  it('gets the repository of the conversations from the studio-core import, and declares its own entities', () => {
    expect(exportedByImports.size).toBeGreaterThan(0);
    const forFeature = imported.map((m) => m as unknown as { module?: unknown; providers?: { provide: unknown }[] }).filter((m) => m.providers);
    const tokens = forFeature.flatMap((m) => (m.providers ?? []).map((p) => p.provide));
    expect(tokens).toEqual(expect.arrayContaining([getRepositoryToken(ChatMessageEntity), getRepositoryToken(ChatSettingsEntity)]));
  });

  it('lets the container build every provider and the controller of the module, with the other modules replaced by stand-ins', async () => {
    const providers = meta<Provider>('providers', ChatModule);
    const controllers = meta<new (...args: never[]) => unknown>('controllers', ChatModule);
    const repo = (entity: unknown): Provider => ({ provide: getRepositoryToken(entity as never), useValue: {} });
    const standIn = (token: unknown): Provider => ({ provide: token as never, useValue: {} });
    const moduleRef = await Test.createTestingModule({
      controllers,
      providers: [
        ...providers.filter((p) => p !== ChatBootstrap), // its start-up work needs a database: the wiring is what is checked here
        repo(ChatMessageEntity), repo(ChatSettingsEntity), repo(ConversationEntity),
        ...[ConversationService, GenerationService, GenerationQueueService, EngineBusyGate, ConversationModeRegistry, StudioEvents, ModelCatalogService, SettingsService, EngineClient].map(standIn),
      ],
    }).compile();
    expect(moduleRef.get(ChatController)).toBeInstanceOf(ChatController);
    expect(moduleRef.get(ChatReplyService)).toBeInstanceOf(ChatReplyService);
    expect(WEB_TOOL_DEPS).toBeDefined(); // optional: not provided in production, injected by the tests
  });
});
