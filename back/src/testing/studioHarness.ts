/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import './sqliteEnv';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Subject } from 'rxjs';
import { DataSource } from 'typeorm';
import { EngineError, EngineUnavailableError, type EngineEvent } from 'src/modules/engine';
import { AssetFileService, StudioEvents } from 'src/modules/media-library';
import { buildServices } from './services';
import { GenerationQueueService, GenerationService, JobRequestBuilder } from 'src/modules/studio-core';

export interface EngineCall {
  method: 'get' | 'post' | 'delete';
  path: string;
  options?: { body?: Record<string, unknown>; params?: Record<string, string> };
}

type Handler = (call: EngineCall) => unknown;

/** Stands in for `EngineClient`: records calls, answers from scripted handlers (`'POST /engine/v1/jobs'`). */
export class ScriptedEngine {
  calls: EngineCall[] = [];
  handlers = new Map<string, Handler>();

  constructor() {
    this.on('POST /engine/v1/jobs/check', () => ({ kind: 'image', name: 'Démo', max_count: 4, default_params: { steps: 12 } }));
    this.on('POST /engine/v1/jobs', (c) => ({ job_id: c.options?.body?.job_id, state: 'queued', outputs: [], error: null }));
    this.on('POST /engine/v1/jobs/{job_id}/cancel', () => ({ ok: true }));
    this.on('GET /engine/v1/jobs', () => ({ jobs: [] }));
    this.on('POST /engine/v1/media/purge', () => ({ deleted: 0 }));
  }

  on(key: string, handler: Handler): void {
    this.handlers.set(key, handler);
  }

  async get(path: string, options?: EngineCall['options']) {
    return this.call('get', path, options);
  }

  async post(path: string, options?: EngineCall['options']) {
    return this.call('post', path, options);
  }

  async delete(path: string, options?: EngineCall['options']) {
    return this.call('delete', path, options);
  }

  paths(method: string): string[] {
    return this.calls.filter((c) => c.method === method.toLowerCase()).map((c) => c.path);
  }

  submitted(): string[] {
    return this.calls.filter((c) => c.method === 'post' && c.path === '/engine/v1/jobs').map((c) => String(c.options?.body?.job_id));
  }

  private async call(method: EngineCall['method'], path: string, options?: EngineCall['options']): Promise<unknown> {
    const call = { method, path, options };
    this.calls.push(call);
    const handler = this.handlers.get(`${method.toUpperCase()} ${path}`);
    if (!handler) throw new Error(`no scripted answer for ${method.toUpperCase()} ${path}`);
    return handler(call);
  }
}

export const engineError = (status: number, detail: unknown) => new EngineError(status, '/engine/v1/x', detail);
export const engineDown = () => new EngineUnavailableError('/engine/v1/x', new Error('ECONNREFUSED'));

/** Everything of the studio wired by hand on a test data source, with a scripted engine and a captured event stream. */
export function buildStudio(dataSource: DataSource, engineOverride?: unknown, relayOverride?: unknown) {
  process.env.APP_DATA_DIR = process.env.APP_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'studio-data-'));
  const s = buildServices(dataSource);
  const scripted = new ScriptedEngine();
  const engine = (engineOverride ?? scripted) as never;
  const fakeRelay = { events$: new Subject<EngineEvent>(), linkChanges$: new Subject<boolean>(), connected: false };
  const relay = (relayOverride ?? fakeRelay) as typeof fakeRelay;
  const published: { topic: string; type: string; data: Record<string, unknown> }[] = [];
  /** `studio.queue.updated` goes to its own list so that the exact event lists asserted elsewhere stay about messages and assets. */
  const queueEvents: Record<string, unknown>[] = [];
  const stream = {
    publish: (topic: string, event: { type: string; data: Record<string, unknown> }) =>
      topic === 'studio.queue.updated' ? queueEvents.push(event.data) : published.push({ topic, type: event.type, data: event.data }),
  };
  const events = new StudioEvents(stream as never);
  const files = new AssetFileService(s.assets, engine);
  const queue = new GenerationQueueService(s.messages, s.assets, files, new JobRequestBuilder(s.messages), engine, relay as never, events);
  const generations = new GenerationService(s.conversations, s.messages, s.assets, files, queue, engine, events);
  const emit = (name: string, data: Record<string, unknown>) => relay.events$.next({ name, data });
  return { ...s, engine: scripted, client: engine, relay, published, queueEvents, events, files, queue, generations, emit };
}

export type Studio = ReturnType<typeof buildStudio>;
