/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { mkdirSync, mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { EngineBusyGate, GenerationQueueService, JobRequestBuilder } from 'src/modules/studio-core';
import { buildStudio } from 'src/testing/studioHarness';
import { PrivateEvents } from '../services/PrivateEvents';
import { PrivateGenerationService } from '../services/PrivateGenerationService';
import { PrivateSessionService } from '../services/PrivateSessionService';
import { PrivateStore } from '../services/PrivateStore';
import { PrivateUploadService } from '../services/PrivateUploadService';

/** The usual folders of the data folder: a private generation must never write into them. */
export const NORMAL_FOLDERS = ['uploads', 'outputs', 'thumbs', 'previews'] as const;

/**
 * The private session wired by hand next to the normal studio of `buildStudio` (same scripted engine, same event relay,
 * same event capture), on a fresh data folder with the usual folders created and empty, and with a queue that holds
 * the shared engine gauge like the real one. `streamed` collects what the private events put on the browser stream.
 */
export function buildPrivate(dataSource: DataSource) {
  const dataDir = mkdtempSync(join(tmpdir(), 'private-data-'));
  process.env.APP_DATA_DIR = dataDir;
  for (const folder of NORMAL_FOLDERS) mkdirSync(join(dataDir, folder), { recursive: true });
  const studio = buildStudio(dataSource);
  const gate = new EngineBusyGate();
  const queue = new GenerationQueueService(
    studio.messages, studio.assets, studio.files, new JobRequestBuilder(studio.messages, studio.voices), studio.client as never,
    studio.relay as never, studio.events, gate,
  );
  const streamed: { topic: string; event: unknown }[] = [];
  const events = new PrivateEvents({ publish: (topic: string, event: unknown) => streamed.push({ topic, event }) } as never);
  const store = new PrivateStore();
  const session = new PrivateSessionService(store, events);
  const generations = new PrivateGenerationService(
    session, store, events, studio.events, studio.client as never, studio.relay as never, queue, gate, studio.voices,
  );
  const uploads = new PrivateUploadService(session, store, studio.client as never);
  generations.wipeWaitMs = 50; // a test that leaves a job running must not wait for the engine's answer
  generations.onModuleInit();
  const listing = (): Record<string, string[]> => Object.fromEntries(NORMAL_FOLDERS.map((f) => [f, readdirSync(join(dataDir, f))]));
  return { ...studio, dataDir, gate, queue, streamed, events, store, session, generations, uploads, listing };
}

export type PrivateHarness = ReturnType<typeof buildPrivate>;
