/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { describe, expect, it } from '@jest/globals';
import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EngineClient } from 'src/modules/engine';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { UpdatesController } from './controllers/UpdatesController';
import { UpdateAdvisoryEntity } from './entities/UpdateAdvisoryEntity';
import { UpdateAdvisoryService } from './services/UpdateAdvisoryService';
import { UpdatesModule } from './UpdatesModule';
import { UpdatesService } from './services/UpdatesService';

const meta = <T>(key: string, target: object): T[] => (Reflect.getMetadata(key, target) as T[] | undefined) ?? [];

describe('UpdatesModule wiring', () => {
  const imported = meta<object>('imports', UpdatesModule);
  const exportedByImports = new Set<unknown>(imported.flatMap((m) => meta<unknown>('exports', m)));

  it('imports a module that exports the engine gauge and the generation queue the adviser waits for', () => {
    expect(exportedByImports.has(EngineBusyGate)).toBe(true);
    expect(exportedByImports.has(GenerationQueueService)).toBe(true);
  });

  it('lets the container build the services and the controller, with the other modules replaced by stand-ins', async () => {
    const standIn = (token: unknown): Provider => ({ provide: token as never, useValue: {} });
    const moduleRef = await Test.createTestingModule({
      controllers: meta<new (...args: never[]) => unknown>('controllers', UpdatesModule),
      providers: [...meta<Provider>('providers', UpdatesModule), standIn(getRepositoryToken(UpdateAdvisoryEntity)), ...[EngineClient, EngineBusyGate, GenerationQueueService].map(standIn)],
    }).compile();
    expect(moduleRef.get(UpdatesController)).toBeInstanceOf(UpdatesController);
    expect(moduleRef.get(UpdatesService)).toBeInstanceOf(UpdatesService);
    expect(moduleRef.get(UpdateAdvisoryService)).toBeInstanceOf(UpdateAdvisoryService);
  });
});
