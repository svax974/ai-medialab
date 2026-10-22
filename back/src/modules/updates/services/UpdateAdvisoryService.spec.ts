/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { createTestDataSource } from 'src/testing/testDataSource';
import { UpdateAdvisoryEntity } from '../entities/UpdateAdvisoryEntity';
import type { EngineAdvice, EngineUpdate, ModelUpdate, UpdatesReport } from '../types/updatesTypes';
import { ADVISORY_HISTORY, offeredVersions, UpdateAdvisoryService } from './UpdateAdvisoryService';

const advice = (over: Partial<EngineAdvice> = {}): EngineAdvice => ({
  kind: 'engine', id: 'sdcpp', target: 'pinned', from_version: 'master-900', to_version: 'master-956', verdict: 'caution',
  summary: 'Un point à surveiller.', findings: [{ severity: 'warning', title: 'Lent', quote: 'slower with flash attention', url: 'https://gh/i/1', source_kind: 'issue' }],
  sources: [{ title: 'Issue #1', url: 'https://gh/i/1' }], notes: [], truncated: 0, rejected: 0, llm_model_id: 'llm-qwen3-4b-instruct-2507', generated_at: 1, ...over,
});

const engine = (over: Partial<EngineUpdate> = {}): EngineUpdate => ({
  id: 'sdcpp', name: 'stable-diffusion.cpp', kinds: ['image'], state: 'update', installed: 'master-900', target: 'master-956', upstream: 'master-1002',
  latest: { tag: 'master-1002', regressions: [], advice: null }, rollback: false, variant: 'metal', size_mb: 30, reason: 'pinned', advice: null, ...over,
});

const model = (over: Partial<ModelUpdate> = {}): ModelUpdate => ({
  id: 'wan', name: 'Wan', kind: 'video', state: 'update', files: 1, size_gb: 3, error: null, revision: 'abc1234', fingerprint: 'f00dfeed1234', advice: null, ...over,
});

const report = (engines: EngineUpdate[], models: ModelUpdate[] = []): UpdatesReport => ({ engines, models, checked_at: 1 });

describe('UpdateAdvisoryService', () => {
  let dataSource: DataSource;
  let service: UpdateAdvisoryService;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });
  afterAll(() => dataSource.destroy());
  beforeEach(async () => {
    await dataSource.getRepository(UpdateAdvisoryEntity).clear();
    service = new UpdateAdvisoryService(dataSource.getRepository(UpdateAdvisoryEntity));
  });

  it('stores an advice and lists it with its public shape, newest first', async () => {
    const saved = await service.save(advice());
    expect(saved).toMatchObject({ kind: 'engine', item_id: 'sdcpp', from_version: 'master-900', to_version: 'master-956', verdict: 'caution', stale: null });
    expect(saved.findings[0]).toMatchObject({ quote: 'slower with flash attention', url: 'https://gh/i/1' });
    await service.save(advice({ id: 'audiocpp', to_version: 'v0.9.2' }));
    expect((await service.list()).map((a) => a.item_id)).toEqual(['audiocpp', 'sdcpp']);
  });

  it('refuses an engine answer without a target version', async () => {
    await expect(service.save(advice({ to_version: null }))).rejects.toMatchObject({ status: 502 });
  });

  it('keeps the five most recent advice of an item and nothing of the other items is touched', async () => {
    await service.save(advice({ id: 'audiocpp', to_version: 'v1' }));
    for (let i = 0; i < ADVISORY_HISTORY + 2; i++) await service.save(advice({ to_version: `master-${960 + i}` }));
    const mine = (await service.list()).filter((a) => a.item_id === 'sdcpp');
    expect(mine).toHaveLength(ADVISORY_HISTORY);
    expect(mine[0].to_version).toBe(`master-${960 + ADVISORY_HISTORY + 1}`);
    expect((await service.list()).filter((a) => a.item_id === 'audiocpp')).toHaveLength(1);
  });

  it('removes one advice, and a second removal is a 404', async () => {
    const saved = await service.save(advice());
    await service.remove(saved.id);
    expect(await service.list()).toEqual([]);
    await expect(service.remove(saved.id)).rejects.toMatchObject({ status: 404 });
  });

  describe('merge into a check', () => {
    it('attaches the advice about the release the update installs, and the one about the latest, not mixed up', async () => {
      await service.save(advice({ to_version: 'master-956', summary: 'tested one' }));
      await service.save(advice({ to_version: 'master-1002', target: 'latest', verdict: 'discouraged', summary: 'latest one' }));
      const [row] = (await service.merge(report([engine()]))).engines;
      expect(row.advice).toMatchObject({ summary: 'tested one', stale: false });
      expect(row.latest?.advice).toMatchObject({ summary: 'latest one', verdict: 'discouraged', stale: false });
    });

    it('shows an older advice of the item as stale when none is about the version on offer, never the latest one in the tested slot', async () => {
      await service.save(advice({ to_version: 'master-940', summary: 'old tested' }));
      const [row] = (await service.merge(report([engine({ latest: null })]))).engines;
      expect(row.advice).toMatchObject({ summary: 'old tested', stale: true });
      await service.save(advice({ to_version: 'master-1002', summary: 'about latest' }));
      const [again] = (await service.merge(report([engine()]))).engines;
      expect(again.advice).toMatchObject({ summary: 'old tested', stale: true });  // not the advice about the latest release
      expect(again.latest?.advice).toMatchObject({ summary: 'about latest', stale: false });
    });

    it('an item that is up to date, or an unknown one, gets no advice; a latest without advice stays null', async () => {
      await service.save(advice());
      const rows = (await service.merge(report([engine({ state: 'current' }), engine({ id: 'audiocpp', latest: null })]))).engines;
      expect(rows[0].advice).toBeNull();
      expect(rows[1].advice).toBeNull();
      expect(rows[0].latest?.advice).toBeNull();
    });

    it('ties the advice of a model to the fingerprint of what changed on the Hub', async () => {
      await service.save(advice({ kind: 'model', id: 'wan', to_version: 'f00dfeed1234', from_version: 'abc1234', summary: 'model advice' }));
      const same = (await service.merge(report([], [model()]))).models[0];
      expect(same.advice).toMatchObject({ summary: 'model advice', stale: false });
      const changed = (await service.merge(report([], [model({ fingerprint: '0123456789ab' })]))).models[0];
      expect(changed.advice).toMatchObject({ summary: 'model advice', stale: true });
      const current = (await service.merge(report([], [model({ state: 'current', fingerprint: null })]))).models[0];
      expect(current.advice).toBeNull();
    });

    it('does not mutate the engine report it receives', async () => {
      await service.save(advice());
      const input = report([engine()]);
      await service.merge(input);
      expect(input.engines[0].advice).toBeNull();
    });
  });

  describe('stale flag of the list', () => {
    it('is unknown until a check was merged, then tells which advice is about a version on offer', async () => {
      await service.save(advice({ to_version: 'master-956' }));
      await service.save(advice({ to_version: 'master-940' }));
      expect((await service.list()).map((a) => a.stale)).toEqual([null, null]);
      await service.merge(report([engine()]));
      const byVersion = Object.fromEntries((await service.list()).map((a) => [a.to_version, a.stale]));
      expect(byVersion).toEqual({ 'master-956': false, 'master-940': true });
    });
  });

  it('knows the versions a check offers', () => {
    const offered = offeredVersions(report([engine(), engine({ id: 'audiocpp', state: 'current', target: 'v0.9.1', latest: null })], [model(), model({ id: 'x', state: 'current', fingerprint: null })]));
    expect([...(offered.get('engine:sdcpp') ?? [])].sort()).toEqual(['master-1002', 'master-956']);
    expect([...(offered.get('engine:audiocpp') ?? [])]).toEqual([]);
    expect([...(offered.get('model:wan') ?? [])]).toEqual(['f00dfeed1234']);
    expect([...(offered.get('model:x') ?? [])]).toEqual([]);
  });
});
