/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { LegacyImportService } from './services/LegacyImportService';
import { buildLegacyDatabase, loadExpectedPublic } from './testing/legacyDatabase';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';

/**
 * Compares what the Nest services return with outputs of the legacy engine (`repo.py`, `voices.py`) captured once on the same demo rows (the capture
 * script went with the engine's database in H6; the fixture `testing/expectedPublic.json` is frozen): the migrated screens must see the same contract.
 */
describe('public shapes identical to the legacy engine', () => {
  const expected = loadExpectedPublic();
  let dataSource: DataSource;
  let services: ReturnType<typeof buildServices>;
  let cleanup: () => void;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    const built = buildLegacyDatabase();
    cleanup = built.cleanup;
    const moduleConfig = { getSchema: () => ({}), register: () => undefined, updateModuleConfig: async () => null };
    await new LegacyImportService(dataSource, moduleConfig as never).run(built.dir);
    services = buildServices(dataSource);
  });
  afterAll(async () => {
    await dataSource.destroy();
    cleanup();
  });

  it('conversation list: same summaries, same order (pinned first, then latest update)', async () => {
    expect(await services.conversations.list()).toEqual(expected.conversationList);
    expect(expected.conversationList[0].id).toBe('c1');
  });

  it('conversation list filters: mode and search in titles and prompts', async () => {
    expect(await services.conversations.list({ mode: 'audio' })).toEqual(expected.conversationListAudio);
    expect(await services.conversations.list({ q: 'plage' })).toEqual(expected.conversationListQuery);
    expect(expected.conversationListQuery.map((c: { id: string }) => c.id)).toEqual(['c5']);
  });

  it('conversation detail: messages, references, outputs, cover, busy flag', async () => {
    for (const [id, conversation] of Object.entries(expected.conversations)) {
      expect(await services.conversations.get(id)).toEqual(conversation);
    }
    expect(expected.conversations.c3.busy).toBe(true);
  });

  it('conversation summary after an update equals the detail without its messages', async () => {
    const { messages: _messages, ...summary } = expected.conversations.c1;
    expect(await services.conversations.getSummary('c1')).toEqual(summary);
  });

  it('messages', async () => {
    for (const [id, message] of Object.entries(expected.messages)) {
      expect(await services.messages.get(id)).toEqual(message);
    }
  });

  it('assets', async () => {
    for (const [id, asset] of Object.entries(expected.assets)) {
      expect(await services.assets.get(id)).toEqual(asset);
    }
  });

  it('gallery pages', async () => {
    expect((await services.assets.list()).items).toEqual(expected.gallery.generatedImage);
    expect((await services.assets.list({ media: 'audio' })).items).toEqual(expected.gallery.generatedAudio);
    expect((await services.assets.list({ kind: 'upload' })).items).toEqual(expected.gallery.uploadImage);
  });

  it('voices', async () => {
    expect(await services.voices.list()).toEqual(expected.voices);
  });
});
