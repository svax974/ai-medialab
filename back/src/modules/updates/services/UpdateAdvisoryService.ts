/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { newId, nowSeconds } from 'src/modules/media-library';
import { UpdateAdvisoryEntity } from '../entities/UpdateAdvisoryEntity';
import { toAdvisoryDto } from '../mappers/advisoryMapper';
import type { EngineAdvice, EngineUpdate, ModelUpdate, UpdateAdvisory, UpdateItemKind, UpdatesReport } from '../types/updatesTypes';
import { tr } from 'src/modules/i18n';

/** Advice kept per item (engine or model): the five most recent, whatever version they are about. */
export const ADVISORY_HISTORY = 5;

const slot = (kind: UpdateItemKind, id: string): string => `${kind}:${id}`;
const triple = (kind: UpdateItemKind, id: string, to: string): string => `${slot(kind, id)}:${to}`;

/**
 * The advice the adviser produced, kept in `update_advisories` so that it can be shown again (offline, without loading the
 * model) and tied to the version it is about. The check merges them into its rows (`merge`); an advice whose version is no
 * longer the one on offer is `stale`. Never decides anything: it is information.
 */
@Injectable()
export class UpdateAdvisoryService {
  /** The versions offered by the last check seen by this process, per item (null until one was seen). */
  private offered: Map<string, Set<string>> | null = null;
  private lastTimestamp = 0;

  constructor(@InjectRepository(UpdateAdvisoryEntity) private readonly rows: Repository<UpdateAdvisoryEntity>) {}

  /** Stores what the engine answered and keeps the history of the item bounded. */
  async save(advice: EngineAdvice): Promise<UpdateAdvisory> {
    if (!advice.to_version) throw new BadGatewayException(tr('updates.error.adviceNoVersion'));
    const row = await this.rows.save(
      this.rows.create({
        id: newId(),
        kind: advice.kind,
        itemId: advice.id,
        fromVersion: advice.from_version,
        toVersion: advice.to_version,
        verdict: advice.verdict,
        summary: advice.summary,
        findings: advice.findings,
        sources: advice.sources,
        notes: advice.notes,
        llmModelId: advice.llm_model_id,
        createdAt: this.nextTimestamp(),
      }),
    );
    await this.prune(row.kind, row.itemId);
    return toAdvisoryDto(row, this.isStale(row));
  }

  /** Every stored advice, newest first. */
  async list(): Promise<UpdateAdvisory[]> {
    const rows = await this.rows.find({ order: { createdAt: 'DESC' } });
    return rows.map((row) => toAdvisoryDto(row, this.isStale(row)));
  }

  async remove(id: string): Promise<void> {
    const found = await this.rows.delete({ id });
    if (!found.affected) throw new NotFoundException(tr('updates.error.adviceNotFound'));
  }

  /**
   * The report of a check with the stored advice attached to each row: engines get the one about the release the update
   * installs (`advice`) and the one about the untested newest one (`latest.advice`); models the one about what changed on
   * the Hub. An item that is up to date has none. Also remembers which versions are on offer, to tell `stale` ones.
   */
  async merge(report: UpdatesReport): Promise<UpdatesReport> {
    const rows = await this.rows.find({ order: { createdAt: 'DESC' } });
    this.offered = offeredVersions(report);
    const lookup = new AdvisoryLookup(rows);
    return {
      ...report,
      engines: report.engines.map((e) => mergeEngine(e, lookup)),
      models: report.models.map((m) => ({ ...m, advice: m.state === 'update' ? lookup.current('model', m.id, m.fingerprint, []) : null })),
    };
  }

  /** Strictly increasing, so that the order of the history is never a tie. */
  private nextTimestamp(): number {
    this.lastTimestamp = Math.max(nowSeconds(), this.lastTimestamp + 0.000001);
    return this.lastTimestamp;
  }

  private isStale(row: UpdateAdvisoryEntity): boolean | null {
    const current = this.offered?.get(slot(row.kind, row.itemId));
    return this.offered === null ? null : !current?.has(row.toVersion);
  }

  private async prune(kind: UpdateItemKind, itemId: string): Promise<void> {
    const rows = await this.rows.find({ where: { kind, itemId }, order: { createdAt: 'DESC' }, select: { id: true } });
    const old = rows.slice(ADVISORY_HISTORY).map((r) => r.id);
    if (old.length > 0) await this.rows.delete(old);
  }
}

/** Stored advice indexed for a merge: the exact match for a version, else the newest older one (flagged stale). */
class AdvisoryLookup {
  private readonly exact = new Map<string, UpdateAdvisoryEntity>();
  private readonly byItem = new Map<string, UpdateAdvisoryEntity[]>();

  /** `rows` newest first. */
  constructor(rows: UpdateAdvisoryEntity[]) {
    for (const row of rows) {
      const key = triple(row.kind, row.itemId, row.toVersion);
      if (!this.exact.has(key)) this.exact.set(key, row);
      this.byItem.set(slot(row.kind, row.itemId), [...(this.byItem.get(slot(row.kind, row.itemId)) ?? []), row]);
    }
  }

  /** The advice about exactly `to`, or null. */
  exactly(kind: UpdateItemKind, id: string, to: string | null): UpdateAdvisory | null {
    const hit = to ? this.exact.get(triple(kind, id, to)) : undefined;
    return hit ? toAdvisoryDto(hit, false) : null;
  }

  /** The advice about `to`, else the newest one about another version (`skip`: versions that belong to another slot), flagged stale. */
  current(kind: UpdateItemKind, id: string, to: string | null, skip: (string | null | undefined)[]): UpdateAdvisory | null {
    const hit = this.exactly(kind, id, to);
    if (hit || !to) return hit;
    const old = (this.byItem.get(slot(kind, id)) ?? []).find((r) => !skip.includes(r.toVersion));
    return old ? toAdvisoryDto(old, true) : null;
  }
}

function mergeEngine(e: EngineUpdate, lookup: AdvisoryLookup): EngineUpdate {
  const latest = e.latest ? { ...e.latest, advice: lookup.exactly('engine', e.id, e.latest.tag) } : null;
  const advice = e.state === 'update' ? lookup.current('engine', e.id, e.target, [e.latest?.tag]) : null;
  return { ...e, latest, advice };
}

/** The target versions a check offers: an engine's pinned and latest tags, a model's fingerprint. */
export function offeredVersions(report: UpdatesReport): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of report.engines) out.set(slot('engine', e.id), new Set([e.state === 'update' ? e.target : null, e.latest?.tag].filter((v): v is string => !!v)));
  for (const m of report.models as ModelUpdate[]) out.set(slot('model', m.id), new Set(m.state === 'update' && m.fingerprint ? [m.fingerprint] : []));
  return out;
}
