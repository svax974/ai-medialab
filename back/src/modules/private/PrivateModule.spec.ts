/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { describe, expect, it } from '@jest/globals';
import { ChatModelService, ChatReplyService, PromptEnhanceService } from 'src/modules/chat';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { PrivateModule } from './PrivateModule';
import { PrivateChatController } from './controllers/PrivateChatController';
import { PrivateChatAttachmentService } from './services/PrivateChatAttachmentService';
import { PrivateChatService } from './services/PrivateChatService';

const meta = <T>(key: string, target: object): T[] => (Reflect.getMetadata(key, target) as T[] | undefined) ?? [];

describe('PrivateModule wiring', () => {
  const exportedByImports = new Set<unknown>(meta<object>('imports', PrivateModule).flatMap((m) => meta<unknown>('exports', m)));

  it('imports a module that exports each service the private chat takes from the others (the container would refuse to start otherwise)', () => {
    const needs: [string, unknown][] = [
      ['ChatReplyService', ChatReplyService], ['ChatModelService', ChatModelService], ['PromptEnhanceService', PromptEnhanceService],
      ['GenerationQueueService', GenerationQueueService], ['EngineBusyGate', EngineBusyGate],
    ];
    for (const [name, token] of needs) expect([name, exportedByImports.has(token)]).toEqual([name, true]);
  });

  it('declares the chat services and the controller', () => {
    expect(meta('providers', PrivateModule)).toEqual(expect.arrayContaining([PrivateChatService, PrivateChatAttachmentService]));
    expect(meta('controllers', PrivateModule)).toContain(PrivateChatController);
  });
});
